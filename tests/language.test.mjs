import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Execute the actual shared translation/bootstrap code with a small DOM fixture.
// Navigation, slideshows and other unrelated enhancements follow this boundary.
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const languageCode = app.slice(0, app.indexOf("// Native disclosures"));
assert.ok(languageCode.length > 0, "The shared language bootstrap must be present");

function element(dataset = {}, innerHTML = "") {
  const listeners = {};
  return {
    dataset,
    innerHTML,
    hidden: false,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, listener) { listeners[name] = listener; },
    click() { listeners.click?.(); },
  };
}

function visit({ languages = ["en-US"], language = "en-US", stored = null, storageUnavailable = false, englishBody = true, country = null, sessionUnavailable = false, request } = {}) {
  const memory = new Map(stored === null ? [] : [["krpsa-language", stored]]);
  const writes = [];
  const session = new Map(country === null ? [] : [["krpsa-country", country]]);
  const calls = [];
  const timers = new Map();
  let nextTimer = 0;
  const buttons = [element({ lang: "ko" }), element({ lang: "en" })];
  const heading = element({ i18n: "navAbout" }, "협회 소개");
  const noticeTitle = element({ ko: "협회 공지", en: "Association notice" });
  const koreanBody = element({ announcementLanguage: "ko" });
  const bodies = englishBody ? [koreanBody, element({ announcementLanguage: "en" })] : [koreanBody];
  const fallback = element();
  const description = {};
  const document = {
    documentElement: { lang: "ko" },
    body: { dataset: { titleKo: "한국어 제목", titleEn: "English title", descriptionKo: "한국어 설명", descriptionEn: "English description" } },
    title: "한국어 제목",
    getElementById: () => null,
    querySelector: (selector) => selector === 'meta[name="description"]' ? description : null,
    querySelectorAll: (selector) => ({
      "[data-i18n]": [heading],
      "[data-ko][data-en]": [noticeTitle],
      "[data-lang]": buttons,
      "[data-announcement-language]": bodies,
      "[data-announcement-fallback]": [fallback],
    })[selector] || [],
    dispatchEvent() {},
  };
  const localStorage = {
    getItem(key) {
      if (storageUnavailable) throw new Error("Storage unavailable");
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      if (storageUnavailable) throw new Error("Storage unavailable");
      memory.set(key, value);
      writes.push([key, value]);
    },
  };
  const sessionStorage = {
    getItem(key) {
      if (sessionUnavailable) throw new Error("Session storage unavailable");
      return session.get(key) ?? null;
    },
    setItem(key, value) {
      if (sessionUnavailable) throw new Error("Session storage unavailable");
      session.set(key, value);
    },
  };
  const fetch = request ? (url, options) => {
    calls.push({ url, options });
    return request(url, options);
  } : undefined;
  const setTimeout = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, delay });
    return id;
  };
  const clearTimeout = (id) => timers.delete(id);
  const expireTimeout = () => {
    for (const [id, timer] of timers) {
      timers.delete(id);
      timer.callback();
    }
  };
  vm.runInNewContext(languageCode, { document, navigator: { languages, language }, localStorage, sessionStorage, fetch, AbortController, setTimeout, clearTimeout, Event });
  return { document, description, heading, noticeTitle, bodies, fallback, buttons, memory, writes, session, calls, timers, expireTimeout };
}

const response = (body, ok = true) => ({ ok, text: async () => body });
const settle = async () => {
  for (let step = 0; step < 8; step += 1) await Promise.resolve();
};
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("first visits use the top browser language and never persist an inferred preference", () => {
  for (const [languages, expected] of [
    [["ko-KR", "en-US"], "ko"],
    [["KO"], "ko"],
    [["en-US", "ko-KR"], "en"],
    [["fr-FR"], "en"],
    [["ja-JP"], "en"],
  ]) {
    const page = visit({ languages });
    assert.equal(page.document.documentElement.lang, expected);
    assert.deepEqual(page.writes, []);
    assert.equal(page.memory.has("krpsa-language"), false);
  }
  assert.equal(visit({ languages: [], language: "ko-KR" }).document.documentElement.lang, "ko");
  assert.equal(visit({ languages: [], language: "" }).document.documentElement.lang, "en");
});

test("existing Korean and English preferences take precedence without being rewritten", () => {
  for (const stored of ["ko", "en"]) {
    const page = visit({ stored, languages: [stored === "ko" ? "en-US" : "ko-KR"] });
    assert.equal(page.document.documentElement.lang, stored);
    assert.equal(page.memory.get("krpsa-language"), stored);
    assert.deepEqual(page.writes, []);
  }
});

test("invalid saved values and blocked storage still use the browser default", () => {
  for (const stored of ["", "fr", "KO", "null", "undefined"]) {
    assert.equal(visit({ stored }).document.documentElement.lang, "en");
  }
  const page = visit({ storageUnavailable: true, languages: ["ko-KR"] });
  assert.equal(page.document.documentElement.lang, "ko");
  assert.doesNotThrow(() => page.buttons[1].click());
  assert.equal(page.document.documentElement.lang, "en");
});

test("an explicit selection updates all shared page copy and persists for the next visit", () => {
  const page = visit({ languages: ["ko-KR"] });
  page.buttons[1].click();
  assert.equal(page.document.documentElement.lang, "en");
  assert.equal(page.heading.innerHTML, "About");
  assert.equal(page.noticeTitle.textContent, "Association notice");
  assert.equal(page.document.title, "English title");
  assert.equal(page.description.content, "English description");
  assert.deepEqual(page.bodies.map((body) => body.hidden), [true, false]);
  assert.equal(page.fallback.hidden, true);
  assert.equal(page.buttons[1].attributes["aria-pressed"], "true");
  assert.deepEqual(page.writes, [["krpsa-language", "en"]]);
  assert.equal(visit({ languages: ["ko-KR"], stored: page.memory.get("krpsa-language") }).document.documentElement.lang, "en");
  page.buttons[0].click();
  assert.equal(page.heading.innerHTML, "협회 소개");
  assert.equal(page.document.title, "한국어 제목");
  assert.deepEqual(page.bodies.map((body) => body.hidden), [false, true]);
  assert.equal(page.memory.get("krpsa-language"), "ko");
});

test("English defaults keep a Korean-only notice readable with its translation notice", () => {
  const page = visit({ englishBody: false });
  assert.equal(page.document.documentElement.lang, "en");
  assert.equal(page.bodies[0].hidden, false);
  assert.equal(page.fallback.hidden, false);
  page.buttons[0].click();
  assert.equal(page.bodies[0].hidden, false);
  assert.equal(page.fallback.hidden, true);
});

test("a first visit applies a browser fallback immediately, then uses the detected country", async () => {
  for (const [country, languages, expected] of [["KR\n", ["en-US"], "ko"], ["US", ["ko-KR"], "en"], ["JP", ["ko-KR"], "en"]]) {
    const pending = deferred();
    const page = visit({ languages, request: () => pending.promise });
    assert.equal(page.document.documentElement.lang, languages[0] === "ko-KR" ? "ko" : "en");
    assert.equal(page.calls.length, 1);
    assert.equal(page.calls[0].url, "https://get.geojs.io/v1/ip/country");
    assert.equal(page.calls[0].options.credentials, "omit");
    assert.equal(page.calls[0].options.referrerPolicy, "no-referrer");
    assert.equal(page.calls[0].options.cache, "no-store");
    assert.equal(page.calls[0].options.mode, "cors");
    assert.equal([...page.timers.values()][0].delay, 1200);
    pending.resolve(response(country));
    await settle();
    assert.equal(page.document.documentElement.lang, expected);
    assert.deepEqual([...page.session], [["krpsa-country", country.trim()]]);
    assert.deepEqual(page.writes, []);
    assert.equal(page.timers.size, 0);
  }
});

test("saved choices and valid session countries avoid a lookup while keeping distinct precedence", () => {
  const request = () => { throw new Error("A lookup should not be needed"); };
  const explicit = visit({ stored: "ko", country: "US", request });
  assert.equal(explicit.document.documentElement.lang, "ko");
  assert.equal(explicit.calls.length, 0);
  for (const [country, languages, expected] of [["KR", ["en-US"], "ko"], ["US", ["ko-KR"], "en"]]) {
    const page = visit({ country, languages, request });
    assert.equal(page.document.documentElement.lang, expected);
    assert.equal(page.calls.length, 0);
    assert.deepEqual(page.writes, []);
    page.buttons[expected === "ko" ? 1 : 0].click();
    assert.equal(page.memory.get("krpsa-language"), expected === "ko" ? "en" : "ko");
  }
});

test("unknown or malformed country responses retain the browser fallback without caching", async () => {
  for (const body of ["XX", "ZZ", "AB", "T1", "unknown", "kr", "", "<html>error</html>", '{"country":"US"}', "198.51.100.1: US"]) {
    const page = visit({ languages: ["ko-KR"], request: async () => response(body) });
    await settle();
    assert.equal(page.document.documentElement.lang, "ko", body);
    assert.equal(page.session.size, 0, body);
    assert.equal(page.timers.size, 0);
  }
});

test("network failures, HTTP failures and unreadable bodies leave the page usable", async () => {
  for (const request of [
    async () => { throw new Error("Network blocked"); },
    async () => response("US", false),
    async () => ({ ok: true, text: async () => { throw new Error("Unreadable body"); } }),
  ]) {
    const page = visit({ languages: ["ko-KR"], request });
    await settle();
    assert.equal(page.document.documentElement.lang, "ko");
    assert.equal(page.session.size, 0);
    assert.equal(page.timers.size, 0);
    page.buttons[1].click();
    assert.equal(page.document.documentElement.lang, "en");
  }
});

test("a lookup exceeding the deadline is aborted and a late response cannot change the page", async () => {
  const pending = deferred();
  const page = visit({ languages: ["ko-KR"], request: () => pending.promise });
  page.expireTimeout();
  assert.equal(page.calls[0].options.signal.aborted, true);
  pending.resolve(response("US"));
  await settle();
  assert.equal(page.document.documentElement.lang, "ko");
  assert.equal(page.session.size, 0);
  assert.equal(page.memory.size, 0);
});

test("the timeout also covers reading the country response body", async () => {
  const pending = deferred();
  const page = visit({ languages: ["ko-KR"], request: async () => ({ ok: true, text: () => pending.promise }) });
  await settle();
  page.expireTimeout();
  pending.resolve("US");
  await settle();
  assert.equal(page.calls[0].options.signal.aborted, true);
  assert.equal(page.document.documentElement.lang, "ko");
  assert.equal(page.session.size, 0);
});

test("manual choices win over an in-flight request even when preference storage is blocked", async () => {
  for (const storageUnavailable of [false, true]) {
    const pending = deferred();
    const page = visit({ request: () => pending.promise, storageUnavailable });
    page.buttons[0].click();
    assert.equal(page.calls[0].options.signal.aborted, true);
    pending.resolve(response("US"));
    await settle();
    assert.equal(page.document.documentElement.lang, "ko");
    assert.equal(page.session.size, 0);
  }
});

test("a preference saved by another tab during detection wins over the automatic result", async () => {
  const pending = deferred();
  const page = visit({ request: () => pending.promise });
  page.memory.set("krpsa-language", "ko");
  pending.resolve(response("US"));
  await settle();
  assert.equal(page.document.documentElement.lang, "ko");
  assert.equal(page.session.size, 0);
  assert.deepEqual(page.writes, []);
});

test("unavailable session storage does not prevent successful country detection", async () => {
  const page = visit({ languages: ["en-US"], sessionUnavailable: true, request: async () => response("KR") });
  await settle();
  assert.equal(page.document.documentElement.lang, "ko");
  assert.equal(page.session.size, 0);
  assert.equal(page.memory.size, 0);
});

test("invalid session cache entries are ignored and replaced only by a valid detected country", async () => {
  const page = visit({ languages: ["en-US"], country: "XX", request: async () => response("KR") });
  assert.equal(page.document.documentElement.lang, "en");
  await settle();
  assert.equal(page.document.documentElement.lang, "ko");
  assert.equal(page.session.get("krpsa-country"), "KR");
  assert.equal(page.memory.size, 0);
});
