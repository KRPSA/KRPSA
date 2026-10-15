import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Run the real hero slider from app.js against a small DOM fixture and a fake
// reel player, so slide changes, autoplay and focus can be checked in Node.
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const heroCode = app.slice(app.indexOf('// The hero slider'));
assert.ok(heroCode.length > 0, 'The hero slider must be present in app.js');

function node(name, parent = null, extra = {}) {
  const listeners = {};
  const classes = new Set();
  const element = {
    name,
    parent,
    hidden: false,
    removed: false,
    textContent: '',
    attributes: {},
    classList: {
      add: (c) => classes.add(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return this.attributes[key] ?? null; },
    removeAttribute(key) {
      delete this.attributes[key];
      if (key === 'hidden') this.hidden = false;
    },
    addEventListener(type, listener) { (listeners[type] ||= []).push(listener); },
    dispatch(type, event = {}) { (listeners[type] || []).forEach((listener) => listener({ preventDefault() {}, target: element, ...event })); },
    click() { element.dispatch('click'); },
    focus() { element.document.activeElement = element; },
    remove() { element.removed = true; },
    contains(other) {
      for (let n = other; n; n = n.parent) if (n === element) return true;
      return false;
    },
    scrollIntoView() {},
    ...extra,
  };
  return element;
}

function visit({ reduced = false, containerUnits = true, lang = 'ko' } = {}) {
  const document = { hidden: false, activeElement: null, fonts: {}, documentElement: { lang }, addEventListener() {} };
  const make = (name, parent, extra) => Object.assign(node(name, parent, extra), { document });
  const body = make('body');
  document.activeElement = body;
  const hero = make('hero', body);
  const copy = make('hero-copy', hero);
  const cta = make('cta', copy);
  const bottom = make('hero-bottom', hero);
  const figure = make('figure', hero);
  const chapters = make('chapters', figure);
  const chapterButton = make('chapter', chapters);
  const skip = make('skip', figure);
  const photos = [0, 1, 2, 3].map((i) => make(`photo${i}`, hero, { complete: true, naturalWidth: 1 }));
  const controls = make('controls', hero);
  const reelButton = make('reel-button', controls);
  const photoButtons = photos.map((_, i) => make(`photo-button${i}`, controls));
  const soundButton = make('sound', controls);
  const toggle = make('toggle', controls);
  const counter = make('counter', controls);
  const watch = make('watch', body);
  watch.hidden = true;

  const listeners = {};
  const reel = {
    time: 0,
    playing: false,
    sound: false,
    play() { reel.playing = true; },
    pause() { reel.playing = false; },
    seek(t) { reel.time = t; },
    setSound(on) { reel.sound = on; reel.emit('sound'); },
    on(name, fn) { (listeners[name] ||= []).push(fn); },
    emit(name) { (listeners[name] || []).forEach((fn) => fn()); },
    // What reel.js does at the end of the reel and on a chapter click.
    end() { reel.time = 37; reel.playing = false; reel.emit('ended'); },
    chapter(t) { reel.seek(t); reel.play(); reel.emit('select'); },
  };
  hero.querySelector = (selector) => ({ '.hero-reel': figure, '.hero-copy': copy, '.hero-bottom': bottom })[selector] ?? null;
  figure.querySelector = (selector) => ({ '[data-reel-chapters]': chapters, '.hero-reel-skip': skip })[selector] ?? null;
  controls.querySelector = (selector) => ({ '[data-slide="reel"]': reelButton, '.slideshow-sound': soundButton })[selector] ?? null;
  controls.querySelectorAll = (selector) => (selector === '[data-slide]' ? [reelButton, ...photoButtons].filter((b) => !b.removed) : []);
  document.querySelector = (selector) => ({ '.hero': hero, '.slideshow-toggle': toggle, '.slide-counter': counter, '.slideshow-controls': controls, '[data-reel-play]': watch })[selector] ?? null;
  document.querySelectorAll = (selector) => ({ '.hero-photo': photos, '[data-reel-play]': [watch] })[selector] ?? [];

  const timers = new Map();
  let nextTimer = 0;
  const sandbox = {
    document,
    window: { KRPSAReel: { player: () => reel } },
    CanvasRenderingContext2D: Object.assign(function CanvasRenderingContext2D() {}, { prototype: { roundRect() {} } }),
    CSS: { supports: (property, value) => containerUnits || !String(value).includes('cq') },
    matchMedia: () => ({ matches: reduced, addEventListener() {} }),
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout: (id) => timers.delete(id),
  };
  vm.runInNewContext(heroCode, sandbox);
  const runTimer = () => {
    const [[id, timer]] = timers;
    timers.delete(id);
    timer.callback();
  };
  return { document, hero, cta, figure, chapterButton, skip, reel, reelButton, photoButtons, soundButton, toggle, counter, watch, timers, runTimer };
}

test('the reel opens the hero and flows into the photographs', () => {
  const page = visit();
  assert.equal(page.counter.textContent, '01 / 05');
  assert.ok(page.hero.classList.contains('is-reel'));
  assert.ok(page.reel.playing);
  assert.equal(page.watch.hidden, false);
  page.reel.end();
  assert.equal(page.counter.textContent, '02 / 05');
  assert.equal(page.toggle.textContent, 'Ⅱ', 'the slideshow keeps playing');
  assert.equal(page.timers.size, 1);
});

test('with reduced motion, the reel plays once and then holds the first photograph', () => {
  for (const choose of [
    (page) => page.reelButton.click(),
    (page) => page.reel.chapter(31.5),
    (page) => page.watch.click(),
    // Sound on a paused reel resumes it.
    (page) => {
      page.reelButton.click();
      page.toggle.click();
      assert.ok(!page.reel.playing);
      page.soundButton.click();
    },
  ]) {
    const page = visit({ reduced: true });
    assert.equal(page.counter.textContent, '02 / 05', 'starts on a still photograph');
    assert.equal(page.toggle.textContent, '▶');
    choose(page);
    assert.equal(page.counter.textContent, '01 / 05');
    assert.ok(page.reel.playing, 'the chosen reel plays');
    page.reel.end();
    assert.equal(page.counter.textContent, '02 / 05');
    assert.equal(page.toggle.textContent, '▶', 'the slideshow stays paused');
    assert.equal(page.timers.size, 0, 'no autoplay timer is running');
  }
});

test('with reduced motion, a slideshow started with the toggle cycles the photographs only', () => {
  const page = visit({ reduced: true });
  page.photoButtons[3].click();
  page.toggle.click();
  assert.equal(page.counter.textContent, '05 / 05');
  page.runTimer();
  assert.equal(page.counter.textContent, '02 / 05', 'wraps past the reel');
  assert.ok(!page.reel.playing);
});

test('a chapter chosen while the reel is fading out is not rewound', () => {
  const page = visit();
  page.skip.click();
  assert.equal(page.counter.textContent, '02 / 05');
  page.reel.chapter(29);
  assert.equal(page.counter.textContent, '01 / 05');
  assert.equal(page.reel.time, 29);
  assert.ok(page.reel.playing);
  // Choosing the reel itself still starts it from the beginning.
  page.photoButtons[0].click();
  page.reelButton.click();
  assert.equal(page.reel.time, 0);
});

test('keyboard focus follows the slide when the reel or the hero copy is hidden', () => {
  const page = visit();
  page.skip.focus();
  page.skip.click();
  assert.equal(page.document.activeElement, page.photoButtons[0], 'skip hands focus to the photo selector');

  page.reelButton.click();
  page.soundButton.focus();
  page.reel.end();
  assert.equal(page.document.activeElement, page.photoButtons[0], 'the sound button hides when the reel ends');

  page.reelButton.click();
  page.chapterButton.focus();
  page.reel.end();
  assert.equal(page.document.activeElement, page.photoButtons[0], 'a chapter button hides when the reel ends');

  page.photoButtons[3].click();
  page.toggle.click();
  page.cta.focus();
  page.runTimer();
  assert.equal(page.counter.textContent, '01 / 05');
  assert.equal(page.document.activeElement, page.reelButton, 'the hero links hide when the reel comes round');

  page.photoButtons[2].click();
  page.toggle.click();
  page.photoButtons[2].focus();
  page.runTimer();
  assert.equal(page.counter.textContent, '05 / 05');
  assert.equal(page.document.activeElement, page.photoButtons[2], 'focus elsewhere is left alone');
});

test('the watch link plays the reel and moves focus into it', () => {
  const page = visit();
  page.skip.click();
  page.watch.focus();
  page.watch.click();
  assert.equal(page.counter.textContent, '01 / 05');
  assert.ok(page.reel.playing);
  assert.equal(page.document.activeElement, page.figure);
});

test('the sound toggle keeps one name and reports its state with aria-pressed', () => {
  const page = visit();
  assert.equal(page.soundButton.getAttribute('aria-label'), '영상 사운드');
  assert.equal(page.soundButton.getAttribute('aria-pressed'), 'false');
  page.soundButton.click();
  assert.equal(page.soundButton.getAttribute('aria-label'), '영상 사운드');
  assert.equal(page.soundButton.getAttribute('aria-pressed'), 'true');
  const english = visit({ lang: 'en' });
  assert.equal(english.soundButton.getAttribute('aria-label'), 'Reel sound');
});

test('the hero markup matches what the slider expects', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  // The "watch" link moves focus to the figure, so it must be focusable by script.
  assert.match(html, /<figure[^>]*class="hero-reel"[^>]*tabindex="-1"/);
  // The sound toggle keeps one name before app.js runs, too.
  assert.match(html, /class="slideshow-sound"[^>]*aria-pressed="false"[^>]*aria-label="영상 사운드"/);
});

test('browsers without container-query units keep the photo slideshow', () => {
  const page = visit({ containerUnits: false });
  assert.ok(page.figure.removed);
  assert.ok(page.reelButton.removed);
  assert.equal(page.counter.textContent, '01 / 04');
  assert.equal(page.watch.hidden, true);
  assert.ok(!page.hero.classList.contains('has-reel'));
});
