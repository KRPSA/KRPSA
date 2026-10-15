import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const sandbox = { window: {} };
vm.runInNewContext(await readFile(new URL('reel.js', ROOT), 'utf8'), sandbox);
const reel = sandbox.window.KRPSAReel;

test('the stage run follows IPSC Production scoring and the shot timer', () => {
  const minor = { A: 5, C: 3, D: 1, S: 5 };
  assert.equal(reel.STAGE.points, reel.SHOTS.reduce((sum, shot) => sum + minor[shot.zone], 0));
  const last = reel.SHOTS.at(-1);
  assert.equal(reel.STAGE.time, Math.round(last.ms / 10) / 100);
  assert.equal(reel.STAGE.hitFactor, reel.STAGE.points / reel.STAGE.time);
  // Production: no more than 15 rounds in the magazine at the start signal.
  assert.equal(reel.STAGE.magazine, 15);
  // One reload: no more than a magazine's worth of shots on either side of it.
  const beforeReload = reel.SHOTS.filter((shot) => shot.st <= reel.STAGE.reload).length;
  assert.ok(beforeReload <= reel.STAGE.magazine);
  assert.ok(reel.SHOTS.length - beforeReload <= reel.STAGE.magazine);
  // IPSC long courses: at most 32 rounds, and no more than 9 scoring hits from one location.
  assert.ok(reel.SHOTS.length <= 32);
  const hitsFrom = {};
  for (const shot of reel.SHOTS) {
    const area = reel.TARGETS[shot.target].from;
    hitsFrom[area] = (hitsFrom[area] ?? 0) + 1;
  }
  for (const [area, hits] of Object.entries(hitsFrom)) assert.ok(hits <= 9, `area ${area}: ${hits} hits`);
  // IPSC target arrays: no stars, racks or trees.
  for (const target of Object.values(reel.TARGETS))
    assert.ok(['paper', 'noshoot', 'popper', 'plates', 'swinger', 'turner', 'mover'].includes(target.kind), target.kind);
  assert.ok(reel.STAGE.points <= reel.STAGE.maxPoints);
  reel.SHOTS.forEach((shot, i) => {
    assert.ok(i === 0 || shot.ms > reel.SHOTS[i - 1].ms, 'shots are in time order');
    assert.ok(shot.t > 0 && shot.t < reel.DURATION, 'shots happen on screen');
  });
});

test('chapters, captions and sound cues stay inside the reel', () => {
  reel.CHAPTERS.forEach((chapter, i) => {
    assert.ok(chapter.ko && chapter.en && chapter.sub.ko && chapter.sub.en);
    assert.ok(i === 0 || chapter.t > reel.CHAPTERS[i - 1].t);
  });
  reel.CAPTIONS.forEach(([from, to, ko, en], i) => {
    assert.ok(from < to && to <= reel.DURATION && ko && en);
    assert.ok(i === 0 || from >= reel.CAPTIONS[i - 1][1], 'captions do not overlap');
  });
  for (const cue of reel.CUES) assert.ok(cue.t >= 0 && cue.t < reel.DURATION, `${cue.type} at ${cue.t}`);
});

test('the homepage plays the reel as the first hero slide', async () => {
  const html = await readFile(new URL('index.html', ROOT), 'utf8');
  assert.ok(html.indexOf('src="reel.js"') < html.indexOf('src="app.js"'), 'reel.js loads before app.js');
  assert.match(html, /class="hero-reel"[\s\S]*<canvas/);
  assert.match(html, /data-slide="reel"/);
  const audio = html.match(/<audio[^>]*src="([^"]+)"/)[1];
  await access(new URL(audio, ROOT));
});
