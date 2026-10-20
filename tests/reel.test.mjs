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
  // Labelled LONG COURSE: more rounds than a medium course (24) allows.
  assert.ok(reel.SHOTS.length > 24);
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
  const reelScript = html.indexOf('<script src="reel.js"');
  const appScript = html.indexOf('<script src="app.js"');
  assert.ok(reelScript >= 0, 'index.html loads reel.js');
  assert.ok(appScript > reelScript, 'reel.js loads before app.js');
  assert.match(html, /class="hero-reel"[\s\S]*<canvas/);
  assert.match(html, /data-slide="reel"/);
  const audio = html.match(/<audio[^>]*src="([^"]+)"/)[1];
  await access(new URL(audio, ROOT));
});

// Point-in-polygon (even-odd) for the target zones; points are [x, y] in cm.
function inside(poly, [x, y]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const zoneOf = (p) => {
  const T = reel.TARGET;
  if (inside(T.a, p)) return 'A';
  if (inside(T.c, p)) return 'C'; // the open C line closes along the top edge
  if (inside(T.d, p)) return 'D';
  return 'miss';
};

test('the targets are the IPSC Target (Appendix B2) and the IPSC Popper (Appendix C2)', () => {
  const T = reel.TARGET;
  const span = (pts, k) => {
    const v = pts.map((p) => p[k]);
    return [Math.min(...v), Math.max(...v)];
  };
  // cardboard 46 × 58, scoring area 45 × 57, C zone 30 × 45, A zone 15 × 32.5
  assert.deepEqual([span(T.outer, 0), span(T.outer, 1)], [[-23, 23], [-29, 29]]);
  assert.deepEqual([span(T.d, 0), span(T.d, 1)], [[-22.5, 22.5], [-28.5, 28.5]]);
  assert.deepEqual([span(T.c, 0), span(T.c, 1)], [[-15, 15], [-28.5, 16.5]]);
  assert.deepEqual([span(T.a, 0), span(T.a, 1)], [[-7.5, 7.5], [-26, 6.5]]);
  // the C line starts and ends at the two ends of the D line's top edge
  assert.deepEqual([[...T.c[0]], [...T.c.at(-1)]], [[-7.5, -28.5], [7.5, -28.5]]);
  // the shoulders of all three zones sit 19 cm below the top of the D line
  for (const zone of [T.d, T.c, T.a]) assert.ok(zone.some(([, y]) => y === -9.5), 'shoulder at 19 cm');
  // sample points: top centre is C (no D band on top), bottom centre is D
  assert.equal(zoneOf([0, -27]), 'C');
  assert.equal(zoneOf([0, 27]), 'D');
  assert.equal(zoneOf([0, -10]), 'A');
  assert.equal(zoneOf([20, 0]), 'D');
  assert.equal(zoneOf([0, -28.8]), 'miss'); // the non-scoring border
  // popper: 85 cm tall, 30 cm across the disc, 15 cm at the ground
  assert.deepEqual(span(T.popper, 1), [-85, 0]);
  assert.deepEqual(span(T.popper, 0), [-15, 15]);
  const base = T.popper.filter(([, y]) => y === 0).map(([x]) => x);
  assert.deepEqual([Math.min(...base), Math.max(...base)], [-7.5, 7.5]);
});

test('every paper hit lands in the zone it is scored as', () => {
  for (const shot of reel.SHOTS) {
    if (!Array.isArray(shot.hit)) continue;
    const p = [shot.hit[0] * 100, shot.hit[1] * 100];
    assert.equal(zoneOf(p), shot.zone, `${shot.target} #${shot.i} at ${p} cm`);
  }
});
