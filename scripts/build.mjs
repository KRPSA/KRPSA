import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { isAlias, parseDocument, visit } from 'yaml';

export const LATEST_START = '<!-- latest-announcements:start -->';
export const LATEST_END = '<!-- latest-announcements:end -->';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FIELDS = new Set(['title', 'titleEn', 'date', 'summary', 'summaryEn', 'category', 'categoryEn', 'slug', 'draft']);

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
// Do not permit executable schemes, embedded data, or protocol-relative URLs.
markdown.validateLink = (url) => !/^[\s\u0000-\u0020]*\/\//.test(url)
  && !/[\u0000-\u0020\\]/.test(url)
  && (!/^[a-z][a-z\d+.-]*:/i.test(url) || /^(?:https?:|mailto:)/i.test(url));

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function translation(ko, en = ko) {
  return `data-ko="${escapeHtml(ko)}" data-en="${escapeHtml(en)}"`;
}

function fail(file, message) {
  throw new Error(`${file}: ${message}`);
}

function requiredText(data, key, file, maxLength = 300) {
  if (typeof data[key] !== 'string' || !data[key].trim() || data[key].length > maxLength) {
    fail(file, `${key} must be a nonempty string of at most ${maxLength} characters`);
  }
  return data[key].trim();
}

function renderBodies(body, filename) {
  const normalized = body.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const codeLines = new Set();
  // Markdown's source maps distinguish actual dividers from examples in code.
  for (const token of markdown.parse(normalized, {})) {
    if (['fence', 'code_block'].includes(token.type) && token.map) {
      for (let line = token.map[0]; line < token.map[1]; line++) codeLines.add(line);
    }
  }
  const dividers = [];
  for (const [line, text] of lines.entries()) {
    if (codeLines.has(line)) continue;
    const marker = text.match(/^ {0,3}<!--\s*lang:\s*([^\s>]+)\s*-->[ \t]*$/);
    if (!marker) continue;
    if (marker[1] !== 'en') fail(filename, 'unsupported body language marker; use <!-- lang:en -->');
    dividers.push(line);
  }
  if (dividers.length > 1) fail(filename, 'use only one <!-- lang:en --> body divider');
  if (!dividers.length) return { html: markdown.render(normalized), htmlEn: null };
  const korean = lines.slice(0, dividers[0]).join('\n');
  const english = lines.slice(dividers[0] + 1).join('\n');
  if (!korean.trim() || !english.trim()) fail(filename, 'both Korean and English Markdown bodies must be nonempty when using <!-- lang:en -->');
  return { html: markdown.render(korean), htmlEn: markdown.render(english) };
}

export function parseAnnouncement(source, filename) {
  const match = source.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) fail(filename, 'start with YAML front matter between --- lines');
  const document = parseDocument(match[1], { schema: 'core', uniqueKeys: true });
  if (document.errors.length || document.warnings.length) {
    fail(filename, `invalid YAML: ${(document.errors[0] || document.warnings[0]).message}`);
  }
  visit(document, (_key, node) => {
    if (isAlias(node)) fail(filename, 'YAML aliases are not supported');
  });
  const data = document.toJS({ maxAliasCount: 0 });
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(filename, 'front matter must be a mapping');
  for (const key of Object.keys(data)) {
    if (!FIELDS.has(key)) fail(filename, `unknown metadata field ${key}`);
  }
  const title = requiredText(data, 'title', filename, 180);
  const summary = requiredText(data, 'summary', filename);
  const date = requiredText(data, 'date', filename, 10);
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    fail(filename, 'date must be a real calendar date in YYYY-MM-DD format');
  }
  const slug = data.slug ?? path.basename(filename, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, '');
  if (typeof slug !== 'string' || slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    fail(filename, 'slug (or filename) must contain lowercase letters, numbers and single hyphens only');
  }
  if (data.draft !== undefined && typeof data.draft !== 'boolean') fail(filename, 'draft must be true or false');
  const optionalText = (key, fallback) => data[key] === undefined ? fallback : requiredText(data, key, filename);
  const category = optionalText('category', '안내');
  const body = match[2];
  if (!body.trim()) fail(filename, 'Markdown body must not be empty');
  return {
    title, summary, date, slug, category,
    titleEn: optionalText('titleEn', title),
    summaryEn: optionalText('summaryEn', summary),
    categoryEn: optionalText('categoryEn', category === '안내' ? 'Notice' : category),
    draft: data.draft ?? false,
    ...renderBodies(body, filename),
  };
}

export async function readAnnouncements(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const filenames = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')
    && !/^(?:readme|template)\.md$/i.test(entry.name) && !entry.name.startsWith('_'))
    .map((entry) => entry.name).sort();
  const announcements = await Promise.all(filenames.map(async (name) => parseAnnouncement(await readFile(path.join(directory, name), 'utf8'), name)));
  const slugs = new Set();
  for (const announcement of announcements) {
    if (slugs.has(announcement.slug)) fail(directory, `duplicate slug: ${announcement.slug}`);
    slugs.add(announcement.slug);
  }
  return announcements.filter((announcement) => !announcement.draft)
    .sort((left, right) => right.date.localeCompare(left.date) || left.slug.localeCompare(right.slug));
}

export function renderList(announcements, { prefix = '', latest = false } = {}) {
  if (!announcements.length) {
    return `<div class="announcement-empty"><span class="announcement-empty-mark" aria-hidden="true">↗</span><p ${translation('등록된 공지사항이 없습니다.', 'No announcements yet.')}>등록된 공지사항이 없습니다.</p><span ${translation('새로운 협회 소식을 이곳에서 전해 드립니다.', 'Association news will appear here.')}>새로운 협회 소식을 이곳에서 전해 드립니다.</span></div>`;
  }
  const heading = latest ? 'h3' : 'h2';
  return `<ol class="announcement-list${latest ? ' announcement-list--latest' : ''}">\n${announcements.map((announcement) => `<li><a class="announcement-card" href="${prefix}${announcement.slug}/"><div class="announcement-meta"><time datetime="${announcement.date}">${announcement.date.replaceAll('-', '.')}</time><span class="announcement-category" ${translation(announcement.category, announcement.categoryEn)}>${escapeHtml(announcement.category)}</span></div><div class="announcement-copy"><${heading} class="announcement-title" ${translation(announcement.title, announcement.titleEn)}>${escapeHtml(announcement.title)}</${heading}><p class="announcement-summary" ${translation(announcement.summary, announcement.summaryEn)}>${escapeHtml(announcement.summary)}</p></div><span class="announcement-arrow" aria-hidden="true">↗</span></a></li>`).join('\n')}\n</ol>`;
}

export function injectLatest(homepage, announcements) {
  const start = homepage.indexOf(LATEST_START);
  const end = homepage.indexOf(LATEST_END);
  if (start === -1 || end < start || homepage.indexOf(LATEST_START, start + 1) !== -1 || homepage.indexOf(LATEST_END, end + 1) !== -1) {
    throw new Error('index.html must contain exactly one ordered pair of latest-announcements markers');
  }
  return `${homepage.slice(0, start + LATEST_START.length)}\n${renderList(announcements.slice(0, 3), { prefix: 'announcements/', latest: true })}\n${homepage.slice(end)}`;
}

function sharedMarkup(homepage, tag, rootPrefix) {
  const markup = homepage.match(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`))?.[0];
  if (!markup) throw new Error(`index.html must contain a shared ${tag}`);
  return markup.replace(/<[a-z][^>]*>/gi, (element) => {
    const isBackTop = /class="[^"]*\bback-top\b/.test(element);
    const isAnnouncements = /href="(?:\.\/)?announcements\/?"/.test(element);
    let rewritten = element.replace(/\b(href|src)="([^"]*)"/g, (_match, attribute, url) => {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url) || !url || (isBackTop && url === '#')) return `${attribute}="${url}"`;
      const relative = url === '#' ? '' : url.replace(/^\/?(?:\.\/)?/, '');
      return `${attribute}="${rootPrefix}${relative}"`;
    });
    if (isAnnouncements) rewritten = rewritten.replace(/>$/, ' aria-current="page">');
    return rewritten;
  });
}

function pageDocument({ homepage, rootPrefix, title, titleEn, description, descriptionEn = description, content }) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta name="theme-color" content="#111317"><link rel="icon" href="${rootPrefix}assets/kr.svg"><link rel="stylesheet" href="${rootPrefix}style.css"><link rel="stylesheet" href="${rootPrefix}announcements.css"><script src="${rootPrefix}app.js" defer></script></head>
<body class="announcement-page" data-title-ko="${escapeHtml(title)}" data-title-en="${escapeHtml(titleEn)}" data-description-ko="${escapeHtml(description)}" data-description-en="${escapeHtml(descriptionEn)}">
<a href="#main" class="skip" data-i18n="skip">본문으로 이동</a>
${sharedMarkup(homepage, 'header', rootPrefix)}
<main id="main">${content}</main>
${sharedMarkup(homepage, 'footer', rootPrefix)}
</body></html>\n`;
}

function listPage(homepage, announcements) {
  return pageDocument({
    homepage, rootPrefix: '../', title: '공지사항 — KRPSA', titleEn: 'Announcements — KRPSA',
    description: 'KRPSA의 교육, 입회 및 협회 소식을 확인하세요.',
    descriptionEn: 'Explore KRPSA training, membership and association announcements.',
    content: `<section class="announcement-hero"><div class="wrap"><a class="announcement-back" href="../" ${translation('← 홈으로', '← Back to home')}>← 홈으로</a><span class="section-label">KRPSA NEWSROOM</span><h1 ${translation('협회의 소식.\n다음 도전의 시작.', 'Association news.\nYour next chapter.')}>협회의 소식.\n다음 도전의 시작.</h1><p ${translation('교육 안내부터 협회 소식까지, KRPSA의 새로운 이야기를 만나보세요.', 'Training updates and association news, all in one place.')}>교육 안내부터 협회 소식까지, KRPSA의 새로운 이야기를 만나보세요.</p></div></section><section class="announcement-index wrap" aria-labelledby="all-announcements"><div class="announcement-index-heading"><h2 id="all-announcements" ${translation('전체 공지사항', 'All announcements')}>전체 공지사항</h2><span ${translation(`총 ${announcements.length}개`, `${announcements.length} announcement${announcements.length === 1 ? '' : 's'}`)}>총 ${announcements.length}개</span></div>${renderList(announcements)}<div class="announcement-contact"><div><span class="section-label">LET’S CONNECT</span><h2 ${translation('궁금한 점이 있으신가요?', 'Have a question?')}>궁금한 점이 있으신가요?</h2><p ${translation('교육과 입회는 카카오톡 ipsckorea로 문의해 주세요.', 'For training and membership, contact ipsckorea on KakaoTalk.')}>교육과 입회는 카카오톡 ipsckorea로 문의해 주세요.</p></div><a class="inline-link" href="../#contact" ${translation('협회 문의 ↗', 'Contact KRPSA ↗')}>협회 문의 ↗</a></div></section>`,
  });
}

function detailPage(homepage, announcement, announcements) {
  const index = announcements.indexOf(announcement);
  const newer = announcements[index - 1];
  const older = announcements[index + 1];
  const adjacent = (item, ko, en) => item ? `<a href="../${item.slug}/"><span ${translation(ko, en)}>${ko}</span><strong ${translation(item.title, item.titleEn)}>${escapeHtml(item.title)}</strong></a>` : '<span aria-hidden="true"></span>';
  const body = `<div class="announcement-prose" data-announcement-language="ko" lang="ko">${announcement.html}</div>`;
  const englishBody = announcement.htmlEn
    ? `<div class="announcement-prose" data-announcement-language="en" lang="en" hidden>${announcement.htmlEn}</div>`
    : '';
  const fallback = announcement.htmlEn
    ? ''
    : '<p class="announcement-language-note" data-announcement-fallback lang="en" hidden>An English translation is not available for this announcement. The original Korean text is shown below.</p>';
  return pageDocument({
    homepage, rootPrefix: '../../', title: `${announcement.title} — KRPSA`, titleEn: `${announcement.titleEn} — KRPSA`, description: announcement.summary, descriptionEn: announcement.summaryEn,
    content: `<article class="announcement-article wrap"><a class="announcement-back" href="../" ${translation('← 전체 공지사항', '← All announcements')}>← 전체 공지사항</a><header class="announcement-article-header"><div class="announcement-meta"><span class="announcement-category" ${translation(announcement.category, announcement.categoryEn)}>${escapeHtml(announcement.category)}</span><time datetime="${announcement.date}">${announcement.date.replaceAll('-', '.')}</time></div><h1 ${translation(announcement.title, announcement.titleEn)}>${escapeHtml(announcement.title)}</h1><p class="announcement-deck" ${translation(announcement.summary, announcement.summaryEn)}>${escapeHtml(announcement.summary)}</p></header>${fallback}${body}${englishBody}<nav class="announcement-adjacent" aria-label="공지사항 탐색" data-aria-ko="공지사항 탐색" data-aria-en="Announcement navigation">${adjacent(newer, '← 이전 글', '← Previous announcement')}${adjacent(older, '다음 글 →', 'Next announcement →')}</nav><a class="button announcement-all-button" href="../" ${translation('전체 공지사항 보기 →', 'View all announcements →')}>전체 공지사항 보기 →</a></article>`,
  });
}

export async function buildSite(root = ROOT) {
  const homepage = await readFile(path.join(root, 'index.html'), 'utf8');
  const announcements = await readAnnouncements(path.join(root, 'announcements'));
  // Validate all content and templates before replacing the previous build.
  const home = injectLatest(homepage, announcements);
  const list = listPage(homepage, announcements);
  const details = announcements.map((announcement) => [announcement.slug, detailPage(homepage, announcement, announcements)]);
  const dist = path.join(root, 'dist');
  await rm(dist, { recursive: true, force: true });
  await mkdir(path.join(dist, 'announcements'), { recursive: true });
  await Promise.all(['assets', 'style.css', 'announcements.css', 'app.js'].map((name) => cp(path.join(root, name), path.join(dist, name), { recursive: true })));
  // Preserve a custom GitHub Pages domain and other existing public metadata.
  for (const name of ['CNAME', 'robots.txt', 'favicon.ico']) {
    try { await cp(path.join(root, name), path.join(dist, name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await writeFile(path.join(dist, '.nojekyll'), '');
  await writeFile(path.join(dist, 'index.html'), home);
  await writeFile(path.join(dist, 'announcements', 'index.html'), list);
  for (const [slug, html] of details) {
    await mkdir(path.join(dist, 'announcements', slug), { recursive: true });
    await writeFile(path.join(dist, 'announcements', slug, 'index.html'), html);
  }
  return { count: announcements.length, dist };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildSite();
    console.log(`Built ${result.count} announcements and the homepage in ${result.dist}`);
  } catch (error) {
    console.error(`Build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
