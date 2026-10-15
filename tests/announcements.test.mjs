import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSite, injectLatest, LATEST_END, LATEST_START, parseAnnouncement, readAnnouncements, renderList } from '../scripts/build.mjs';

function source(fields = {}, body = 'A useful announcement with **Markdown**.') {
  const data = { title: '공지 제목', date: '2026-10-15', summary: '공지 요약', ...fields };
  return `---\n${Object.entries(data).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n${body}`;
}

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'krpsa-announcements-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('parses metadata, Markdown, CRLF and filename-derived slugs', () => {
  const result = parseAnnouncement(source().replaceAll('\n', '\r\n'), '2026-10-15-hello-world.md');
  assert.equal(result.slug, 'hello-world');
  assert.equal(result.date, '2026-10-15');
  assert.equal(result.titleEn, result.title);
  assert.equal(result.category, '안내');
  assert.equal(result.draft, false);
  assert.equal(result.htmlEn, null);
  assert.match(result.html, /<strong>Markdown<\/strong>/);
});

test('one Markdown post renders independently formatted Korean and English bodies', () => {
  const body = '한국어 안내입니다.\n\n## 교육 문의\n\n- 카카오톡\n\n<!-- lang:en -->\n\nThis is the English announcement.\n\n## Training inquiries\n\n- KakaoTalk';
  const result = parseAnnouncement(source({}, body).replaceAll('\n', '\r\n'), 'notice.md');
  assert.match(result.html, /한국어 안내입니다/);
  assert.match(result.html, /<h2>교육 문의<\/h2>/);
  assert.doesNotMatch(result.html, /English|lang:en/);
  assert.match(result.htmlEn, /English announcement/);
  assert.match(result.htmlEn, /<h2>Training inquiries<\/h2>/);
  assert.match(result.htmlEn, /<li>KakaoTalk<\/li>/);
  assert.doesNotMatch(result.htmlEn, /한국어|lang:en/);
});

test('bilingual body validation catches duplicate dividers, empty translations and unsupported markers', () => {
  for (const body of ['<!-- lang:en -->\nEnglish', 'Korean\n<!-- lang:en -->', 'Korean\n<!-- lang:en -->\n   ']) {
    assert.throws(() => parseAnnouncement(source({}, body), 'notice.md'), /both Korean and English/);
  }
  assert.throws(() => parseAnnouncement(source({}, 'Korean\n<!-- lang:en -->\nEnglish\n<!-- lang:en -->\nOther'), 'notice.md'), /only one/);
  assert.throws(() => parseAnnouncement(source({}, 'Korean\n<!-- lang:fr -->\nFrench'), 'notice.md'), /unsupported body language/);
});

test('language divider examples inside fenced or indented code remain literal Markdown', () => {
  for (const example of ['```markdown\n<!-- lang:en -->\n```', '~~~markdown\n<!-- lang:en -->\n~~~', '    <!-- lang:en -->']) {
    const result = parseAnnouncement(source({}, `${example}\n\n한국어 안내\n\n<!-- lang:en -->\n\nEnglish announcement`), 'notice.md');
    assert.match(result.html, /<pre><code[^>]*>&lt;!-- lang:en --&gt;/);
    assert.match(result.html, /한국어 안내/);
    assert.match(result.htmlEn, /English announcement/);
  }
  const onlyExample = parseAnnouncement(source({}, '```markdown\n<!-- lang:en -->\n```'), 'notice.md');
  assert.equal(onlyExample.htmlEn, null);
});

test('English Markdown applies the same HTML escaping and unsafe-link protection', () => {
  const english = '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert%281%29)\n\n[valid](https://www.misia.world/)';
  const result = parseAnnouncement(source({}, `한국어\n\n<!-- lang:en -->\n\n${english}`), 'notice.md');
  assert.doesNotMatch(result.htmlEn, /<script|<img|href="javascript:/);
  assert.match(result.htmlEn, /&lt;script&gt;/);
  assert.match(result.htmlEn, /href="https:\/\/www\.misia\.world\/"/);
});

test('requires usable title, summary, date and body', () => {
  for (const field of ['title', 'summary', 'date']) {
    for (const value of [undefined, '', ' ', 123, ['value']]) {
      assert.throws(() => parseAnnouncement(source({ [field]: value }), 'notice.md'), new RegExp(field));
    }
  }
  assert.throws(() => parseAnnouncement(source({}, '  '), 'notice.md'), /body/);
  assert.throws(() => parseAnnouncement('missing metadata', 'notice.md'), /front matter/);
});

test('validates real calendar dates rather than only a date-shaped string', () => {
  for (const date of ['2026-02-29', '2024-02-30', '2026-13-01', '2026-00-05', '2026-10-32', '2026-1-1', 'today']) {
    assert.throws(() => parseAnnouncement(source({ date }), 'notice.md'), /date/);
  }
  assert.equal(parseAnnouncement(source({ date: '2024-02-29' }), 'notice.md').date, '2024-02-29');
});

test('rejects unsafe slugs, metadata typos and stringified draft flags', () => {
  for (const slug of ['../escape', 'A-Notice', 'a/b', 'a--b', '-a', 'a-', '', '<script>', '공지', 'a'.repeat(101)]) {
    assert.throws(() => parseAnnouncement(source({ slug }), 'notice.md'), /slug/);
  }
  assert.throws(() => parseAnnouncement(source({ draft: 'false' }), 'notice.md'), /draft/);
  assert.throws(() => parseAnnouncement(source({ summery: 'typo' }), 'notice.md'), /unknown metadata/);
  assert.throws(() => parseAnnouncement(source({ titleEn: 7 }), 'notice.md'), /titleEn/);
});

test('rejects YAML duplicate keys, custom tags and aliases', () => {
  assert.throws(() => parseAnnouncement(source().replace('title:', 'title: duplicate\ntitle:'), 'notice.md'), /invalid YAML/);
  assert.throws(() => parseAnnouncement(source().replace('title:', 'title: !unknown'), 'notice.md'), /invalid YAML/);
  const alias = '---\ntitle: &name Notice\nsummary: *name\ndate: "2026-10-15"\n---\nBody';
  assert.throws(() => parseAnnouncement(alias, 'notice.md'), /aliases/);
});

test('raw HTML and event handlers are text; executable link schemes never become links', () => {
  const body = `<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert%281%29)\n\n[bad](java&#x73;cript:alert%281%29)\n\n[bad](vbscript:alert%281%29)\n\n[bad](file:///etc/passwd)\n\n![bad](data:image/png;base64,AAAA)\n\n[bad](//attacker.test)\n\n[good](https://www.misia.world/)\n\n[mail](mailto:kor@ipsc.org)\n\n[home](../../#training)`;
  const { html } = parseAnnouncement(source({}, body), 'notice.md');
  assert.doesNotMatch(html, /<script|<img|href="(?:javascript|vbscript|file|data|\/\/)/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="https:\/\/www\.misia\.world\/"/);
  assert.match(html, /href="mailto:kor@ipsc\.org"/);
  assert.match(html, /href="\.\.\/\.\.\/#training"/);
});

test('discovers Markdown automatically, skips drafts/templates and sorts newest first', async (t) => {
  const directory = await temporaryDirectory(t);
  const contents = {
    'older.md': source({ date: '2025-10-01' }),
    'newer.md': source({ date: '2026-10-14' }),
    'z-same.md': source({ date: '2026-10-15' }),
    'a-same.md': source({ date: '2026-10-15' }),
    'draft.md': source({ draft: true, date: '2027-01-01' }),
    'README.md': 'documentation, not a post',
    '_template.md': 'template, not a post',
    'template.md': 'template, not a post',
    'ignored.txt': 'not Markdown',
  };
  await Promise.all(Object.entries(contents).map(([name, content]) => writeFile(path.join(directory, name), content)));
  await mkdir(path.join(directory, 'nested'));
  await writeFile(path.join(directory, 'nested', 'hidden.md'), source());
  const result = await readAnnouncements(directory);
  assert.deepEqual(result.map((item) => item.slug), ['a-same', 'z-same', 'newer', 'older']);
});

test('duplicate published or draft slugs fail with a useful diagnostic', async (t) => {
  const directory = await temporaryDirectory(t);
  await writeFile(path.join(directory, 'first.md'), source({ slug: 'same' }));
  await writeFile(path.join(directory, 'second.md'), source({ slug: 'same', draft: true }));
  await assert.rejects(readAnnouncements(directory), /duplicate slug: same/);
});

test('homepage injects only the first three items and requires an unambiguous marker pair', () => {
  const items = Array.from({ length: 5 }, (_, index) => parseAnnouncement(source({ slug: `notice-${index}` }), 'notice.md'));
  const homepage = `before${LATEST_START}placeholder${LATEST_END}after`;
  const result = injectLatest(homepage, items);
  assert.equal((result.match(/class="announcement-card"/g) || []).length, 3);
  assert.match(result, /href="announcements\/notice-0\/"/);
  assert.doesNotMatch(result, /notice-3/);
  assert.ok(result.startsWith(`before${LATEST_START}`));
  assert.ok(result.endsWith(`${LATEST_END}after`));
  for (const invalid of ['', LATEST_START, `${LATEST_END}${LATEST_START}`, `${homepage}${LATEST_START}`, `${homepage}${LATEST_END}`]) {
    assert.throws(() => injectLatest(invalid, items), /markers/);
  }
});

test('empty state works without JavaScript and metadata is escaped in attributes and text', () => {
  assert.match(renderList([]), /등록된 공지사항이 없습니다/);
  const item = parseAnnouncement(source({ title: '<img src=x onerror=alert(1)>', titleEn: '" onmouseover="alert(1)', category: '<b>bad</b>' }), 'notice.md');
  const html = renderList([item]);
  assert.doesNotMatch(html, /<img|<b>/);
  assert.match(html, /&lt;img/);
  assert.match(html, /data-en="&quot; onmouseover=&quot;alert\(1\)"/);
});

async function fixture(t, { empty = false } = {}) {
  const root = await temporaryDirectory(t);
  await mkdir(path.join(root, 'assets'));
  await mkdir(path.join(root, 'announcements'));
  const homepage = `<!doctype html><html><head></head><body><header class="header"><a class="brand" href="#"><svg><image href="assets/logo.png"></image></svg></a><nav><a href="#training">Training</a><a href="announcements/">News</a></nav><a href="https://example.com/">External</a></header><main>${LATEST_START}${LATEST_END}</main><footer><a class="brand" href="#">Home</a><a class="back-top" href="#">Top</a></footer></body></html>`;
  await writeFile(path.join(root, 'index.html'), homepage);
  await Promise.all(['style.css', 'announcements.css', 'app.js', 'reel.js', 'assets/logo.png', 'assets/kr.svg'].map((name) => writeFile(path.join(root, name), 'fixture')));
  await writeFile(path.join(root, 'CNAME'), 'ipsckorea.co.kr\n');
  await writeFile(path.join(root, 'private.txt'), 'must not be deployed');
  if (!empty) {
    for (let index = 1; index <= 5; index++) {
      await writeFile(path.join(root, 'announcements', `notice-${index}.md`), source({ date: `2026-10-0${index}`, title: `Notice ${index}`, slug: `notice-${index}`, draft: index === 5 }));
    }
  }
  return root;
}

test('full build creates latest three, complete archive, detail pages and correct shared relative links', async (t) => {
  const root = await fixture(t);
  const result = await buildSite(root);
  assert.equal(result.count, 4);
  const [home, archive, detail] = await Promise.all(['index.html', 'announcements/index.html', 'announcements/notice-4/index.html'].map((name) => readFile(path.join(result.dist, name), 'utf8')));
  assert.equal((home.match(/class="announcement-card"/g) || []).length, 3);
  assert.equal((archive.match(/class="announcement-card"/g) || []).length, 4);
  assert.match(home, /announcements\/notice-4\/[\s\S]*announcements\/notice-3\/[\s\S]*announcements\/notice-2\//);
  assert.doesNotMatch(home + archive + detail, /Notice 5/);
  assert.match(archive, /href="\.\.\/#training"/);
  assert.match(detail, /href="\.\.\/\.\.\/#training"/);
  assert.match(detail, /<image href="\.\.\/\.\.\/assets\/logo.png"/);
  assert.match(detail, /href="\.\.\/\.\.\/announcements\/" aria-current="page"/);
  assert.match(detail, /src="\.\.\/\.\.\/app.js"/);
  assert.match(detail, /href="https:\/\/example.com\/"/);
  assert.match(detail, /class="back-top" href="#"/);
  assert.match(detail, /data-title-ko="Notice 4 — KRPSA"/);
  assert.match(detail, /class="announcement-prose" data-announcement-language="ko" lang="ko"><p>A useful announcement with <strong>Markdown<\/strong>/);
  assert.match(detail, /href="\.\.\/notice-3\/"/);
  const published = await readdir(path.join(result.dist, 'announcements'));
  assert.deepEqual(published.sort(), ['index.html', 'notice-1', 'notice-2', 'notice-3', 'notice-4']);
  assert.equal(await readFile(path.join(result.dist, 'CNAME'), 'utf8'), 'ipsckorea.co.kr\n');
  const deployedFiles = await readdir(result.dist);
  assert.ok(!deployedFiles.includes('private.txt'));
  assert.ok(deployedFiles.includes('.nojekyll'));
  assert.ok(deployedFiles.includes('reel.js'));
});

test('bilingual posts keep one route per notice, translated metadata and an accessible locale switch contract', async (t) => {
  const root = await fixture(t);
  const body = '한국어 본문\n\n[교육 안내](../../#training)\n\n<!-- lang:en -->\n\n## English body\n\n[Training information](../../#training)';
  await writeFile(path.join(root, 'announcements', 'notice-4.md'), source({
    title: '교육 공지', titleEn: 'Training announcement',
    summary: '한국어 요약', summaryEn: 'An English summary.',
    category: '교육 안내', categoryEn: 'Training',
    date: '2026-10-04', slug: 'notice-4',
  }, body));
  // A translated draft must remain absent from the public site.
  await writeFile(path.join(root, 'announcements', 'notice-5.md'), source({ draft: true, slug: 'notice-5' }, body));
  const result = await buildSite(root);
  assert.equal(result.count, 4);
  const [home, archive, detail, fallback] = await Promise.all(['index.html', 'announcements/index.html', 'announcements/notice-4/index.html', 'announcements/notice-3/index.html'].map((name) => readFile(path.join(result.dist, name), 'utf8')));
  assert.equal((home.match(/class="announcement-card"/g) || []).length, 3);
  assert.equal((archive.match(/class="announcement-card"/g) || []).length, 4);
  assert.match(home, /data-en="Training announcement"/);
  assert.match(archive, /data-en="An English summary\."/);
  assert.match(detail, /data-title-en="Training announcement — KRPSA"/);
  assert.match(detail, /data-description-en="An English summary\."/);
  assert.match(detail, /data-aria-ko="공지사항 탐색" data-aria-en="Announcement navigation"/);
  assert.match(detail, /data-announcement-language="ko" lang="ko"><p>한국어 본문<\/p>/);
  assert.match(detail, /data-announcement-language="en" lang="en" hidden><h2>English body<\/h2>/);
  assert.match(detail, /href="\.\.\/\.\.\/#training">Training information<\/a>/);
  assert.doesNotMatch(detail, /data-announcement-fallback|lang:en|available in Korean/);
  assert.match(fallback, /data-announcement-fallback lang="en" hidden>An English translation is not available/);
  assert.match(fallback, /data-announcement-language="ko" lang="ko">/);
  assert.doesNotMatch(fallback, /data-announcement-language="en"/);
  const published = await readdir(path.join(result.dist, 'announcements'));
  assert.deepEqual(published.sort(), ['index.html', 'notice-1', 'notice-2', 'notice-3', 'notice-4']);
});

test('rebuild removes deleted or unpublished pages without leaving stale announcements', async (t) => {
  const root = await fixture(t);
  await buildSite(root);
  await rm(path.join(root, 'announcements', 'notice-4.md'));
  await writeFile(path.join(root, 'announcements', 'notice-3.md'), source({ slug: 'notice-3', draft: true }));
  const result = await buildSite(root);
  assert.equal(result.count, 2);
  const published = await readdir(path.join(result.dist, 'announcements'));
  assert.deepEqual(published.sort(), ['index.html', 'notice-1', 'notice-2']);
});

test('empty archive builds and an invalid edit preserves the last valid output', async (t) => {
  const root = await fixture(t, { empty: true });
  await buildSite(root);
  const before = await readFile(path.join(root, 'dist', 'announcements', 'index.html'), 'utf8');
  assert.match(before, /총 0개/);
  assert.match(before, /등록된 공지사항이 없습니다/);
  await writeFile(path.join(root, 'announcements', 'broken.md'), source({ date: '2026-02-30' }));
  await assert.rejects(buildSite(root), /date/);
  assert.equal(await readFile(path.join(root, 'dist', 'announcements', 'index.html'), 'utf8'), before);
});
