/* KRPSA — main.js: language switching, nav behaviour, scroll reveal */
(function () {
  'use strict';

  var DICT = window.KRPSA_I18N || {};
  var SUPPORTED = ['ko', 'en'];
  var STORAGE_KEY = 'krpsa.lang';

  /* ---------- Language ---------- */
  function detectLang() {
    // explicit ?lang= wins, then the remembered choice, then the browser language
    var q = new URLSearchParams(location.search).get('lang');
    if (q && SUPPORTED.indexOf(q) !== -1) return q;
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.indexOf(saved) !== -1) return saved;
    } catch (e) { /* storage unavailable */ }
    var nav = (navigator.language || 'ko').toLowerCase();
    return nav.indexOf('ko') === 0 ? 'ko' : 'en';
  }

  function applyLang(lang) {
    var dict = DICT[lang];
    if (!dict) return;

    document.documentElement.lang = lang;

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (dict[key] !== undefined) el.innerHTML = dict[key];
    });

    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      // format: "attr:key" (multiple separated by ;)
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        var parts = pair.split(':');
        var attr = parts[0].trim(), key = parts[1] && parts[1].trim();
        if (key && dict[key] !== undefined) el.setAttribute(attr, dict[key]);
      });
    });

    if (dict['meta.title']) document.title = dict['meta.title'];

    document.querySelectorAll('.lang__btn').forEach(function (b) {
      var active = b.getAttribute('data-lang') === lang;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
  }

  document.querySelectorAll('.lang__btn').forEach(function (b) {
    b.addEventListener('click', function () { applyLang(b.getAttribute('data-lang')); });
  });

  applyLang(detectLang());

  /* ---------- Nav ---------- */
  var nav = document.getElementById('nav');
  var toggle = document.getElementById('navToggle');
  var mobile = document.getElementById('navMobile');

  function onScroll() {
    nav.classList.toggle('is-scrolled', window.scrollY > 12);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (toggle && mobile) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.classList.toggle('no-scroll', open);
    });
    mobile.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('no-scroll');
      });
    });
  }

  /* ---------- Scroll reveal ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });
    reveals.forEach(function (el, i) {
      // stagger siblings slightly
      el.style.transitionDelay = Math.min((i % 6) * 60, 300) + 'ms';
      io.observe(el);
    });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ---------- Hero stage: IPSC course-of-fire timeline ---------- */
  var stage = document.getElementById('heroStage');
  var motionOK = window.matchMedia('(prefers-reduced-motion: no-preference)').matches;

  if (stage && motionOK) {
    window.addEventListener('scroll', function () {
      var y = window.scrollY;
      if (y < window.innerHeight) stage.style.transform = 'translate3d(0,' + (y * 0.12) + 'px,0)';
    }, { passive: true });
  }

  if (stage) {
    var hits = {};
    stage.querySelectorAll('.hit').forEach(function (h) { hits[h.getAttribute('data-shot')] = h; });
    var popper = document.getElementById('popper');
    var plate = document.getElementById('plate');
    var hudTime = document.getElementById('hudTime');
    var hudShots = document.getElementById('hudShots');
    var hudHf = document.getElementById('hudHf');
    var hud = document.getElementById('heroHud');

    // Course of fire (ms): paper 2×A → popper → plate → swinger 2×A → paper 2×A
    // Points: 6 A-hits × 5 + popper 5 + plate 5 = 40
    var COURSE = [
      { t: 450,  shot: 1 }, { t: 680,  shot: 2 },
      { t: 1250, shot: 3, down: popper },
      { t: 1900, shot: 4, down: plate },
      { t: 2650, shot: 5 }, { t: 2900, shot: 6 },
      { t: 3550, shot: 7 }, { t: 3780, shot: 8 }
    ];
    var POINTS = 40, RESET_AT = 7200, LOOP = 8600;

    function fire(step) {
      var h = hits[step.shot];
      if (h) h.classList.add('is-hit');
      if (step.down) setTimeout(function () { step.down.classList.add('is-down'); }, 130);
      if (hudShots) hudShots.textContent = String(step.shot);
    }

    function runCourse() {
      stage.classList.remove('is-resetting');
      hud && hud.classList.remove('is-final');
      var start = performance.now();
      var last = COURSE[COURSE.length - 1].t;

      COURSE.forEach(function (step) { setTimeout(function () { fire(step); }, step.t); });

      (function tick() {
        var e = performance.now() - start;
        if (hudTime) hudTime.textContent = (Math.min(e, last) / 1000).toFixed(2);
        if (e < last) requestAnimationFrame(tick);
        else {
          if (hudHf) hudHf.textContent = (POINTS / (last / 1000)).toFixed(2);
          hud && hud.classList.add('is-final');
        }
      })();

      setTimeout(function () {
        stage.classList.add('is-resetting');
        Object.keys(hits).forEach(function (k) { hits[k].classList.remove('is-hit'); });
        popper && popper.classList.remove('is-down');
        plate && plate.classList.remove('is-down');
        if (hudShots) hudShots.textContent = '0';
        if (hudTime) hudTime.textContent = '0.00';
        if (hudHf) hudHf.textContent = '—';
      }, RESET_AT);

      setTimeout(runCourse, LOOP);
    }

    if (motionOK) {
      setTimeout(runCourse, 900);
    } else {
      // static: show the finished course
      COURSE.forEach(fire);
      if (hudTime) hudTime.textContent = (COURSE[COURSE.length - 1].t / 1000).toFixed(2);
      if (hudHf) hudHf.textContent = (POINTS / (COURSE[COURSE.length - 1].t / 1000)).toFixed(2);
    }
  }
})();
