/*
 * KRPSA — "IPSC in Motion" reel.
 * A deterministic canvas renderer: render(t) draws the frame at t seconds, with no
 * hidden state, so the website can scrub it and the export script can capture
 * every frame. Facts on screen are listed with their sources in SOURCES.md.
 */
(function () {
  "use strict";

  const W = 1920;
  const H = 1080;
  const DURATION = 28;

  // ---------------------------------------------------------------- utilities
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const ease = {
    out3: (x) => 1 - (1 - x) ** 3,
    in3: (x) => x ** 3,
    inOut3: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
    out5: (x) => 1 - (1 - x) ** 5,
    outExpo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
    inExpo: (x) => (x <= 0 ? 0 : 2 ** (10 * x - 10)),
    inOutExpo: (x) =>
      x <= 0
        ? 0
        : x >= 1
          ? 1
          : x < 0.5
            ? 2 ** (20 * x - 10) / 2
            : (2 - 2 ** (-20 * x + 10)) / 2,
    outBack: (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2,
  };
  // Fade in over [a, a+fi], hold, fade out over [b-fo, b].
  const env = (t, a, b, fi = 0.2, fo = 0.2) =>
    Math.min(seg(t, a, a + fi), 1 - seg(t, b - fo, b));
  function rand(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let r = Math.imul(s ^ (s >>> 15), 1 | s);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------------ palette
  const C = {
    bg: "#0a0c0f",
    white: "#f4f5f7",
    dim: "#8b8f97",
    faint: "#4b5058",
    line: "rgba(255,255,255,0.09)",
    red: "#ec2242",
    redDeep: "#cf173c",
    card: "#c79d66",
    cardEdge: "#9c7643",
    steel: "#d5dae0",
    brass: "#d9a944",
    blue: "#2b55ad",
  };
  const SANS = '"Inter", "Noto Sans KR", system-ui, sans-serif';
  const KR = '"Noto Sans KR", "Inter", system-ui, sans-serif';
  const font = (weight, size, family = SANS) => `${weight} ${size}px ${family}`;
  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };

  // ----------------------------------------------------------------- timeline
  const BEEP = 6.0; // start signal
  const FREEZE = 6.8; // the clock is frozen here (stage time 0.80)...
  const RESUME = 16.0; // ...and resumes here
  const FREEZE_MS = 800;

  const CHAPTERS = [
    {
      t: 0,
      ko: "DVC",
      en: "DVC",
      sub: { ko: "정확 · 파워 · 속도", en: "Accuracy · Power · Speed" },
    },
    {
      t: 2,
      ko: "레인지 커맨드",
      en: "Range commands",
      sub: { ko: "Make Ready → Standby", en: "Make Ready → Standby" },
    },
    {
      t: BEEP,
      ko: "시작 신호",
      en: "Start signal",
      sub: { ko: "1~4초 후 신호음", en: "Beep in 1–4 s" },
    },
    {
      t: 8,
      ko: "CZ Shadow 2",
      en: "CZ Shadow 2",
      sub: { ko: "프로덕션 디비전", en: "Production division" },
    },
    {
      t: 13,
      ko: "표적과 채점",
      en: "Targets & scoring",
      sub: { ko: "A · C · D 존", en: "A · C · D zones" },
    },
    {
      t: RESUME,
      ko: "스테이지",
      en: "The stage",
      sub: { ko: "프리스타일 · 180°", en: "Freestyle · 180°" },
    },
    {
      t: 20,
      ko: "히트 팩터",
      en: "Hit factor",
      sub: { ko: "점수 ÷ 시간", en: "Points ÷ time" },
    },
    {
      t: 22.5,
      ko: "레인지 클리어",
      en: "Range is clear",
      sub: { ko: "안전 확인", en: "Safety checks" },
    },
  ];

  // The stage run. Stage times are integer milliseconds, so the shot timer, the
  // splits and the hit factor are all derived from the same numbers.
  const TARGETS = {
    T1: { kind: "paper", pos: [-3.7, 0, 5.2], from: "A" },
    T2: { kind: "paper", pos: [-1.8, 0, 6.0], from: "A" },
    P1: { kind: "popper", pos: [-0.6, 0, 6.8], from: "A" },
    T3: { kind: "paper", pos: [1.4, 0, 6.2], from: "B" },
    NS: { kind: "noshoot", pos: [2.45, 0, 5.75], from: "B" },
    T4: { kind: "paper", pos: [3.5, 0, 5.4], from: "B" },
    P2: { kind: "plate", pos: [4.7, 0, 6.9], from: "B" },
  };
  const ZONE_POINTS = { A: 5, C: 3, D: 1, S: 5 }; // Minor (Production); S = steel
  const SHOTS = [
    { ms: 1050, target: "T1", zone: "A", hit: [-0.02, -0.06] },
    { ms: 1300, target: "T1", zone: "A", hit: [0.03, 0.02] },
    { ms: 1675, target: "T2", zone: "A", hit: [0.01, -0.03] },
    { ms: 1925, target: "T2", zone: "C", hit: [-0.11, 0.12] },
    { ms: 2300, target: "P1", zone: "S", hit: [0, 0.7] },
    { ms: 3175, target: "T3", zone: "A", hit: [0.02, -0.02] },
    { ms: 3425, target: "T3", zone: "A", hit: [-0.03, 0.04] },
    { ms: 3800, target: "T4", zone: "A", hit: [0.0, -0.05] },
    { ms: 4050, target: "T4", zone: "D", hit: [0.18, 0.21] },
    { ms: 4425, target: "P2", zone: "S", hit: [0, 0] },
  ].map((s, i, list) => ({
    ...s,
    i,
    t: RESUME + (s.ms - FREEZE_MS) / 1000,
    split: i ? s.ms - list[i - 1].ms : s.ms,
    points: ZONE_POINTS[s.zone],
  }));
  const STAGE_POINTS = SHOTS.reduce((sum, s) => sum + s.points, 0);
  const STAGE_MS = SHOTS[SHOTS.length - 1].ms;
  const STAGE_TIME = Math.round(STAGE_MS / 10) / 100; // a shot timer shows hundredths
  const HIT_FACTOR = STAGE_POINTS / STAGE_TIME;
  const MAG = 15; // Production: at most 15 rounds in a magazine at the start signal
  const MOVE = [17.5, 18.25]; // shooting area A → B

  // Stage time (ms) shown by the shot timer at video time t.
  function stageMs(t) {
    if (t < BEEP) return 0;
    if (t < FREEZE) return (t - BEEP) * 1000;
    if (t < RESUME) return FREEZE_MS;
    return Math.min(FREEZE_MS + (t - RESUME) * 1000, STAGE_MS);
  }
  const fmt2 = (ms) => (Math.round(ms / 10) / 100).toFixed(2);

  const CAPTIONS = [
    [
      0.15,
      1.85,
      "정확, 파워, 속도. IPSC의 세 가지 원칙 — DVC.",
      "Accuracy, power, speed — DVC, the three pillars of IPSC.",
    ],
    [
      2.1,
      2.95,
      "“Make Ready” — 장전하고 시작 자세를 준비합니다.",
      "“Make ready” — load and take the start position.",
    ],
    [
      3.1,
      3.95,
      "“Are You Ready?” — 침묵은 준비 완료를 뜻합니다.",
      "“Are you ready?” — silence means ready.",
    ],
    [
      4.1,
      5.9,
      "“Standby” — 1~4초 안에 시작 신호가 울립니다.",
      "“Standby” — the start signal follows within 1–4 seconds.",
    ],
    [
      6.05,
      6.75,
      "신호음과 함께 타이머가 시작됩니다.",
      "The beep starts the clock.",
    ],
    [
      6.9,
      7.95,
      "시간을 멈추고, 장비부터 살펴봅니다.",
      "Freeze the clock. Meet the gun.",
    ],
    [
      8.1,
      10.95,
      "CZ Shadow 2 — 프로덕션 디비전에서 널리 쓰이는 스틸 프레임 9mm.",
      "CZ Shadow 2 — a steel-frame 9 mm widely used in Production.",
    ],
    [
      11.1,
      12.85,
      "프로덕션: 승인 모델 · 기계식 조준기 · 탄창 15발 · Minor 채점.",
      "Production: approved list, iron sights, 15 rounds, scored Minor.",
    ],
    [
      13.1,
      14.4,
      "종이 표적은 맞은 존에 따라 점수가 달라집니다.",
      "Paper targets score by zone — A, C and D.",
    ],
    [
      14.5,
      15.85,
      "철판은 넘어져야 득점. 노슛과 미스는 각 −10점.",
      "Steel must fall to score. No-shoots and misses cost 10.",
    ],
    [
      16.1,
      17.85,
      "프리스타일 — 스테이지를 푸는 방법은 선수가 정합니다.",
      "Freestyle — every competitor solves the stage their own way.",
    ],
    [
      17.95,
      19.85,
      "이동 중에도 총구는 언제나 180° 안전 범위 안에.",
      "On the move, the muzzle stays inside the 180°.",
    ],
    [
      20.1,
      22.35,
      "점수 ÷ 시간 = 히트 팩터. 가장 높은 히트 팩터가 이깁니다.",
      "Points ÷ time = hit factor. The highest hit factor wins.",
    ],
    [
      22.6,
      24.35,
      "끝까지 안전하게 — 언로드, 쇼 클리어, 해머 다운.",
      "Safe to the very end — unload, show clear, hammer down.",
    ],
    [
      24.7,
      27.2,
      "1976년 시작된 IPSC, 2026년 50주년.",
      "IPSC, founded in 1976 — fifty years in 2026.",
    ],
  ];

  // Sound cues, shared with scripts/reel-audio.mjs so picture and sound stay in sync.
  const CUES = [
    { t: 0.08, type: "hit", v: 0.8 },
    { t: 0.58, type: "hit", v: 0.85 },
    { t: 1.08, type: "hit", v: 0.9 },
    { t: 1.5, type: "swell" },
    { t: 1.84, type: "whoosh", v: 0.7 },
    { t: 2.05, type: "stab", v: 0.9 },
    ...Array.from({ length: MAG }, (_, i) => ({
      t: 2.15 + i * 0.04,
      type: "click",
      v: 0.35,
    })),
    { t: 3.05, type: "stab", v: 0.9 },
    { t: 4.05, type: "stab", v: 1 },
    { t: 4.1, type: "riser", dur: 1.72 },
    { t: 4.5, type: "heart" },
    { t: 5.0, type: "heart" },
    { t: 5.5, type: "heart" },
    { t: BEEP, type: "beep" },
    { t: BEEP, type: "drop" },
    { t: 6.32, type: "whoosh", v: 0.6 },
    { t: FREEZE, type: "freeze" },
    { t: 8.0, type: "scan" },
    ...[8.25, 8.75, 9.25, 9.75, 10.25, 10.75].map((t) => ({
      t,
      type: "blip",
      v: 0.6,
    })),
    { t: 11.05, type: "whoosh", v: 0.4 },
    ...[11.4, 11.65, 11.9, 12.15, 12.4].map((t) => ({
      t,
      type: "tick",
      v: 0.7,
    })),
    { t: 12.78, type: "whoosh", v: 0.6 },
    { t: 13.0, type: "hit", v: 0.6 },
    ...[13.5, 13.75, 14.0].map((t) => ({ t, type: "blip", v: 0.55 })),
    ...[14.5, 14.75, 15.0].map((t) => ({ t, type: "tick", v: 0.6 })),
    { t: 15.25, type: "steel" },
    { t: 15.42, type: "clank", v: 0.5 },
    { t: 15.62, type: "riser", dur: 0.38 },
    { t: RESUME, type: "drop" },
    ...SHOTS.flatMap((s) => [
      { t: s.t, type: "shot", v: 1 },
      ...(s.zone === "S"
        ? [
            { t: s.t + 0.06, type: "steel" },
            { t: s.t + 0.4, type: "clank", v: 0.45 },
          ]
        : []),
      { t: s.t + 0.32 + (s.i % 3) * 0.04, type: "brass", v: 0.25 },
    ]),
    { t: 19.95, type: "whoosh", v: 0.8 },
    ...Array.from({ length: 9 }, (_, i) => ({
      t: 20.05 + i * 0.045,
      type: "tick",
      v: 0.3,
    })),
    { t: 20.5, type: "hit", v: 0.7 },
    ...Array.from({ length: 10 }, (_, i) => ({
      t: 20.55 + i * 0.045,
      type: "tick",
      v: 0.3,
    })),
    { t: 21.0, type: "hit", v: 1 },
    ...[21.5, 21.75, 22.0].map((t) => ({ t, type: "blip", v: 0.5 })),
    { t: 22.5, type: "stab", v: 0.8 },
    { t: 22.62, type: "slide", v: 0.6 },
    { t: 22.75, type: "clank", v: 0.6 },
    { t: 23.25, type: "stab", v: 0.8 },
    { t: 23.32, type: "slide", v: 0.8 },
    { t: 23.47, type: "click", v: 0.9 },
    { t: 24.0, type: "stab", v: 1 },
    { t: 24.5, type: "logo" },
  ];

  // ------------------------------------------------------------------- shapes
  // Paths are written in a tiny M/L/Q/Z syntax and flattened into polylines so
  // that any outline can be drawn on progressively and filled with the same data.
  function shape(d) {
    const tk = d.match(/[MLQZ]|-?\d*\.?\d+/g);
    const pts = [];
    let i = 0;
    let cmd = "M";
    let x = 0;
    let y = 0;
    let closed = false;
    while (i < tk.length) {
      if (/[MLQZ]/.test(tk[i])) {
        cmd = tk[i++];
        if (cmd === "Z") {
          closed = true;
          continue;
        }
      }
      if (cmd === "Q") {
        const qx = +tk[i++];
        const qy = +tk[i++];
        const nx = +tk[i++];
        const ny = +tk[i++];
        for (let s = 1; s <= 10; s++) {
          const u = s / 10;
          pts.push([
            (1 - u) ** 2 * x + 2 * (1 - u) * u * qx + u * u * nx,
            (1 - u) ** 2 * y + 2 * (1 - u) * u * qy + u * u * ny,
          ]);
        }
        x = nx;
        y = ny;
      } else {
        x = +tk[i++];
        y = +tk[i++];
        pts.push([x, y]);
      }
    }
    if (closed) pts.push(pts[0]);
    const cum = [0];
    for (let k = 1; k < pts.length; k++) {
      cum.push(
        cum[k - 1] +
          Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]),
      );
    }
    return { pts, cum, len: cum[cum.length - 1], closed };
  }
  const octagon = (w, h, c, cy = 0) => {
    const x = w / 2;
    const t = cy - h / 2;
    const b = cy + h / 2;
    return shape(
      `M ${-x + c},${t} L ${x - c},${t} L ${x},${t + c} L ${x},${b - c} L ${x - c},${b} L ${-x + c},${b} L ${-x},${b - c} L ${-x},${t + c} Z`,
    );
  };
  const rect = (x, y, w, h) =>
    shape(`M ${x},${y} L ${x + w},${y} L ${x + w},${y + h} L ${x},${y + h} Z`);

  function tracePath(ctx, s, p = 1) {
    ctx.beginPath();
    const stop = s.len * p;
    ctx.moveTo(s.pts[0][0], s.pts[0][1]);
    for (let k = 1; k < s.pts.length; k++) {
      if (s.cum[k] <= stop) {
        ctx.lineTo(s.pts[k][0], s.pts[k][1]);
      } else {
        const r = (stop - s.cum[k - 1]) / (s.cum[k] - s.cum[k - 1] || 1);
        ctx.lineTo(
          lerp(s.pts[k - 1][0], s.pts[k][0], r),
          lerp(s.pts[k - 1][1], s.pts[k][1], r),
        );
        return;
      }
    }
    if (s.closed && p >= 1) ctx.closePath();
  }

  // CZ Shadow 2, right side, muzzle to the right. Millimetres: about 217 mm long,
  // barrel ≈124 mm, the slide riding inside the frame rails as on every CZ 75.
  const GUN = {
    cx: 109,
    cy: 73,
    muzzle: [217, 21],
    port: [117, 13],
    barrel: rect(93, 14, 124, 14),
    slide: shape(
      "M 23,8 L 211,8 Q 216,8 216.5,12 L 217,26 Q 217,30 213,30 L 22,30 L 19,13 Q 19.5,8.5 23,8 Z",
    ),
    port_: shape(
      "M 98,8 L 136,8 L 136,19 Q 136,21 134,21 L 100,21 Q 98,21 98,19 Z",
    ),
    hood: rect(101, 10, 32, 9),
    extractor: shape("M 82,12 L 97,12 L 97,15.5 L 82,15.5 Z"),
    rearSight: shape(
      "M 24,8 L 25,1.5 Q 25.5,0.5 27,0.5 L 38,0.5 Q 40,0.8 41,3 L 43,8 Z",
    ),
    frontSight: shape(
      "M 199,8 L 201,2 Q 201.5,1.2 202.5,1.2 L 207.5,1.2 Q 208.5,1.2 209,2 L 210.5,8 Z",
    ),
    frame: shape(
      "M 4,40 Q 8,33 17,31 L 212,30 Q 215,30 215,33 L 215,49 Q 215,53 211,53 L 128,53 Q 124,53 125,57 L 126,76 Q 126,83 119,83 L 90,83 Q 82,82 79,77 Q 77,75 76,79 L 62,132 Q 61,136 57,136 L 33,136 Q 29,136 28,132 L 13,72 Q 11,62 8,52 Q 5,46 2,44 Q 1,41 4,40 Z",
    ),
    guard: shape(
      "M 86,57 L 117,57 Q 120,57 120.5,60 L 121,73 Q 121,78 116,78 L 92,78 Q 86,78 84,72 L 83.5,62 Q 83.5,57 86,57 Z",
    ),
    grip: shape(
      "M 21,66 Q 22,63 26,63 L 66,72 Q 70,73 69,77 L 58,126 Q 57,129 54,129 L 34,129 Q 31,129 30,126 L 19,72 Q 18.5,68 21,66 Z",
    ),
    trigger: shape(
      "M 99,53 L 103,53 Q 106,63 101,74 Q 99,77 96,76 Q 95,75 96.5,72 Q 100,64 99,53 Z",
    ),
    safety: shape(
      "M 30,33 L 52,35 Q 55,36 54,39 L 44,41 L 31,39 Q 28,37 30,33 Z",
    ),
    hammer: shape("M 13,26 L 21,36 L 25,33 L 16,19 Z"),
    magBody: shape("M 33,136 L 61,136 L 77,70 L 49,70 Z"),
    magPad: shape(
      "M 30,136 L 63,136 Q 65,136 65.5,138 L 66,143 Q 66,146 63,146 L 31,146 Q 28,146 28,143 L 28.5,138 Q 29,136 30,136 Z",
    ),
    serrRear: Array.from({ length: 9 }, (_, i) =>
      shape(`M ${41.2 + i * 3.2},11 L ${40 + i * 3.2},27`),
    ),
    serrFront: Array.from({ length: 7 }, (_, i) =>
      shape(`M ${161.2 + i * 3.2},11 L ${160 + i * 3.2},27`),
    ),
    slots: Array.from({ length: 6 }, (_, i) =>
      rect(142 + i * 12, 49.5, 5, 3.5),
    ),
  };

  // IPSC target (46 × 58 cm cardboard) in centimetres, centre origin, y down:
  // A zone centre rectangle, C zone around it, D zone to the edge.
  const TGT = {
    outer: octagon(46, 58, 8),
    c: octagon(30, 45, 5, -2),
    a: rect(-7.5, -20, 15, 28),
  };
  // IPSC Popper, 85 cm tall, centimetres, base-centre origin, y down.
  const POPPER = shape(
    "M -10,0 L 10,0 L 6,-57 Q 15,-58 15,-70 Q 15,-85 0,-85 Q -15,-85 -15,-70 Q -15,-58 -6,-57 Z",
  );

  // ------------------------------------------------------------------ factory
  function create(canvas, options = {}) {
    const ctx = canvas.getContext("2d");
    const opt = {
      lang: "ko",
      assetBase: "assets/",
      credit: false,
      grain: true,
      chrome: true,
      captions: true,
      ...options,
    };
    const layoutCache = new Map();
    const images = {};
    let gradients = null;

    // Seeded film grain tile.
    const grain = document.createElement("canvas");
    grain.width = grain.height = 256;
    {
      const g = grain.getContext("2d");
      const img = g.createImageData(256, 256);
      const r = rand(7);
      for (let k = 0; k < img.data.length; k += 4) {
        const v = 110 + r() * 145;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
        img.data[k + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }
    const grainPattern = ctx.createPattern(grain, "repeat");

    function loadImage(name) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          images[name] = img;
          resolve();
        };
        img.onerror = () => resolve();
        img.src = opt.assetBase + name;
      });
    }
    const allText =
      CAPTIONS.map((c) => c[2]).join("") +
      CHAPTERS.map((c) => c.ko + c.sub.ko).join("") +
      "정확파워속도프로덕션디비전장비기준승인목록등재기계식조준기탄창발점수시간히트팩터철판노슛미스넘어져야득점존";
    const fontLoads = document.fonts
      ? [
          "400 20px Inter",
          "500 20px Inter",
          "600 20px Inter",
          "700 20px Inter",
          "800 20px Inter",
        ]
          .map((f) => document.fonts.load(f, "AZaz0123456789"))
          .concat(
            ['500 20px "Noto Sans KR"', '700 20px "Noto Sans KR"'].map((f) =>
              document.fonts.load(f, allText),
            ),
          )
      : [];
    const ready = Promise.all(
      [...fontLoads, loadImage("krpsa-logo.png")].map((p) => p.catch(() => {})),
    ).then(() => {
      layoutCache.clear();
    });

    // ---------------------------------------------------------------- text
    function layout(text, f, tracking) {
      const key = `${f}|${tracking}|${text}`;
      let l = layoutCache.get(key);
      if (!l) {
        ctx.save();
        ctx.font = f;
        ctx.letterSpacing = "0px";
        const chars = [...text];
        const xs = [];
        let prefix = "";
        for (let k = 0; k < chars.length; k++) {
          xs.push(ctx.measureText(prefix).width + k * tracking);
          prefix += chars[k];
        }
        const width =
          ctx.measureText(text).width + (chars.length - 1) * tracking;
        ctx.restore();
        l = { chars, xs, width };
        layoutCache.set(key, l);
      }
      return l;
    }

    // Draw text with letter-spacing; returns its width.
    function text(str, x, y, o = {}) {
      const f = font(o.weight ?? 600, o.size ?? 20, o.family);
      const l = layout(str, f, o.tracking ?? 0);
      const x0 =
        o.align === "center"
          ? x - l.width / 2
          : o.align === "right"
            ? x - l.width
            : x;
      ctx.font = f;
      ctx.fillStyle = o.color ?? C.white;
      ctx.textAlign = "left";
      ctx.textBaseline = o.baseline ?? "alphabetic";
      if (!o.tracking) ctx.fillText(str, x0, y);
      else l.chars.forEach((ch, k) => ctx.fillText(ch, x0 + l.xs[k], y));
      return l.width;
    }

    // Masked, staggered per-character rise in and out.
    function kinetic(str, x, y, o) {
      const size = o.size;
      const f = font(o.weight ?? 800, size, o.family);
      const l = layout(str, f, o.tracking ?? 0);
      const x0 =
        o.align === "center"
          ? x - l.width / 2
          : o.align === "right"
            ? x - l.width
            : x;
      const stagger = o.stagger ?? 0.028;
      const dur = o.dur ?? 0.42;
      if (o.t < 0) return l.width;
      ctx.save();
      ctx.font = f;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.beginPath();
      ctx.rect(x0 - size, y - size * 1.08, l.width + size * 2, size * 1.42);
      ctx.clip();
      const draw = (color, dx) => {
        ctx.fillStyle = color;
        l.chars.forEach((ch, k) => {
          const pin = ease.outExpo(clamp((o.t - k * stagger) / dur));
          const pout =
            o.out != null && o.out >= 0
              ? ease.in3(
                  clamp(
                    (o.out - k * (o.outStagger ?? stagger * 0.5)) /
                      (o.outDur ?? 0.24),
                  ),
                )
              : 0;
          const dy = (1 - pin) * size * 1.15 - pout * size * 1.25;
          ctx.fillText(ch, x0 + l.xs[k] + dx, y + dy);
        });
      };
      if (o.split) {
        ctx.globalCompositeOperation = "screen";
        draw(rgba(C.red, 0.9), -o.split);
        draw("rgba(0,220,255,0.75)", o.split);
        ctx.globalCompositeOperation = "source-over";
      }
      draw(o.color ?? C.white, 0);
      ctx.restore();
      return l.width;
    }

    // Fixed-width digits so a running timer never jitters.
    function digits(str, x, y, size, o = {}) {
      const cells = [...str].map((ch) =>
        ch === "." ? 0.3 : ch === " " ? 0.3 : 0.62,
      );
      const total = cells.reduce((a, b) => a + b, 0) * size;
      let cx =
        o.align === "right"
          ? x - total
          : o.align === "center"
            ? x - total / 2
            : x;
      ctx.font = font(o.weight ?? 700, size, o.family);
      ctx.fillStyle = o.color ?? C.white;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      [...str].forEach((ch, k) => {
        ctx.fillText(ch, cx + (cells[k] * size) / 2, y);
        cx += cells[k] * size;
      });
      return total;
    }

    function line(x1, y1, x2, y2, color, width = 1) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // ------------------------------------------------------------- the gun
    // o: x, y (screen position of the gun centre), s (px per mm), rot, blue
    // (0 solid → 1 blueprint), draw (outline draw-on), slide (mm back),
    // hammer (0 cocked → 1 down), mag ({dx, dy, rot} or null), alpha.
    function drawGun(o) {
      const s = o.s;
      const blue = o.blue ?? 0;
      const drawOn = o.draw ?? 1;
      ctx.save();
      ctx.globalAlpha *= o.alpha ?? 1;
      ctx.translate(o.x, o.y);
      ctx.rotate(o.rot ?? 0);
      ctx.scale(s, s);
      ctx.translate(-GUN.cx, -GUN.cy);
      const px = 1 / s;
      const solid = 1 - blue;
      const slide = o.slide ?? 0;
      const fillShape = (sh, style, rule) => {
        tracePath(ctx, sh);
        ctx.fillStyle = style;
        ctx.fill(rule);
      };
      const strokeShape = (sh, a = 1, w = 1.6, p = drawOn) => {
        if (a <= 0 || p <= 0) return;
        tracePath(ctx, sh, p);
        ctx.strokeStyle = `rgba(244,245,247,${a})`;
        ctx.lineWidth = w * px;
        ctx.stroke();
      };
      const g = (y0, y1, c0, c1) => {
        const gr = ctx.createLinearGradient(0, y0, 0, y1);
        gr.addColorStop(0, c0);
        gr.addColorStop(1, c1);
        return gr;
      };

      // Magazine body sits behind the frame; the base pad in front of it.
      const mag = o.mag;
      const withMag = (fn) => {
        ctx.save();
        if (mag) {
          ctx.translate(47 + mag.dx, 136 + mag.dy);
          ctx.rotate(mag.rot);
          ctx.translate(-47, -136);
        }
        fn();
        ctx.restore();
      };
      if (mag && solid > 0) {
        withMag(() => {
          ctx.globalAlpha *= solid;
          fillShape(GUN.magBody, "#2a2e34");
        });
      }
      if (mag && blue > 0) withMag(() => strokeShape(GUN.magBody, blue * 0.6));

      // Barrel (visible at the muzzle once the slide is back).
      if (solid > 0) {
        ctx.save();
        ctx.globalAlpha *= solid;
        fillShape(GUN.barrel, g(14, 28, "#8b929c", "#4a5059"));
        ctx.restore();
      }

      // Hammer pivots under the rear of the slide.
      ctx.save();
      ctx.translate(20, 33);
      ctx.rotate(
        ((o.hammer ?? 0) * 40 - Math.min(slide, 6) * 2) * (Math.PI / 180),
      );
      ctx.translate(-20, -33);
      if (solid > 0) {
        ctx.save();
        ctx.globalAlpha *= solid;
        fillShape(GUN.hammer, "#30343b");
        ctx.beginPath();
        ctx.arc(11, 21, 6.2, 0, Math.PI * 2);
        ctx.arc(11, 21, 2.6, 0, Math.PI * 2, true);
        ctx.fillStyle = "#30343b";
        ctx.fill();
        ctx.restore();
      }
      if (blue > 0) {
        strokeShape(GUN.hammer, blue * 0.8);
        ctx.beginPath();
        ctx.arc(11, 21, 6.2, 0, Math.PI * 2 * drawOn);
        ctx.strokeStyle = `rgba(244,245,247,${blue * 0.8})`;
        ctx.lineWidth = 1.6 * px;
        ctx.stroke();
      }
      ctx.restore();

      // Frame with the trigger-guard opening.
      if (solid > 0) {
        ctx.save();
        ctx.globalAlpha *= solid;
        tracePath(ctx, GUN.frame);
        tracePath2(GUN.guard);
        ctx.fillStyle = g(30, 136, "#2f343c", "#15181c");
        ctx.fill("evenodd");
        // grip panel, blue aluminium with checkering
        fillShape(GUN.grip, g(63, 129, "#2c5bb8", "#16316d"));
        ctx.save();
        tracePath(ctx, GUN.grip);
        ctx.clip();
        ctx.strokeStyle = "rgba(255,255,255,0.09)";
        ctx.lineWidth = 0.5;
        for (let k = -80; k < 80; k += 3) {
          ctx.beginPath();
          ctx.moveTo(k, 60);
          ctx.lineTo(k + 70, 130);
          ctx.moveTo(k + 70, 60);
          ctx.lineTo(k, 130);
          ctx.stroke();
        }
        ctx.restore();
        GUN.slots.forEach((sl) => fillShape(sl, "#0b0d10"));
        fillShape(GUN.trigger, "#3a3f47");
        fillShape(GUN.safety, "#3b4048");
        ctx.beginPath();
        ctx.arc(113, 41, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = "#4b515a";
        ctx.fill();
        tracePath(ctx, GUN.frame);
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.lineWidth = px;
        ctx.stroke();
        ctx.restore();
      }
      if (blue > 0) {
        strokeShape(GUN.frame, blue);
        strokeShape(GUN.guard, blue);
        strokeShape(GUN.grip, blue * 0.55, 1.2);
        strokeShape(GUN.trigger, blue * 0.9);
        strokeShape(GUN.safety, blue * 0.8);
        GUN.slots.forEach((sl) => strokeShape(sl, blue * 0.5, 1.1));
      }

      // Slide group.
      ctx.save();
      ctx.translate(-slide, 0);
      if (solid > 0) {
        ctx.save();
        ctx.globalAlpha *= solid;
        fillShape(GUN.rearSight, "#121418");
        fillShape(GUN.frontSight, "#121418");
        fillShape(GUN.slide, g(8, 30, "#454b54", "#1d2026"));
        fillShape(GUN.port_, "#0c0e11");
        if (slide < 4) fillShape(GUN.hood, g(10, 19, "#9aa1aa", "#5a606a"));
        fillShape(GUN.extractor, "#2b2f36");
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.lineWidth = 0.7;
        [...GUN.serrRear, ...GUN.serrFront].forEach((sh) => {
          tracePath(ctx, sh);
          ctx.stroke();
        });
        line(23, 8.4, 211, 8.4, "rgba(255,255,255,0.35)", 0.6);
        ctx.restore();
      }
      if (blue > 0) {
        strokeShape(GUN.slide, blue);
        strokeShape(GUN.port_, blue * 0.8);
        strokeShape(GUN.extractor, blue * 0.5, 1.1);
        strokeShape(GUN.rearSight, blue * 0.9);
        strokeShape(GUN.frontSight, blue * 0.9);
        [...GUN.serrRear, ...GUN.serrFront].forEach((sh) =>
          strokeShape(sh, blue * 0.45, 1),
        );
      }
      // fibre-optic front sight
      const glow = o.fiber ?? 1;
      if (glow > 0) {
        const gr = ctx.createRadialGradient(205, 3.2, 0, 205, 3.2, 6);
        gr.addColorStop(0, rgba(C.red, 0.85 * glow));
        gr.addColorStop(1, rgba(C.red, 0));
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(205, 3.2, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255,90,110,${glow})`;
        ctx.beginPath();
        ctx.arc(205, 3.2, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      if (mag && solid > 0) {
        withMag(() => {
          ctx.globalAlpha *= solid;
          fillShape(GUN.magPad, g(136, 146, "#3a3f47", "#1a1d22"));
        });
      }
      if (mag && blue > 0) withMag(() => strokeShape(GUN.magPad, blue));

      // Bore axis as a technical centre line.
      if (blue > 0) {
        ctx.setLineDash([6 * px, 3 * px, 1.5 * px, 3 * px]);
        line(-6, 21, -6 + 232 * drawOn, 21, rgba(C.red, 0.55 * blue), px);
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
    function tracePath2(sh) {
      // Adds a second subpath without starting a new path (for even-odd holes).
      ctx.moveTo(sh.pts[0][0], sh.pts[0][1]);
      for (let k = 1; k < sh.pts.length; k++)
        ctx.lineTo(sh.pts[k][0], sh.pts[k][1]);
      ctx.closePath();
    }
    // Map a gun-space point (mm) to the screen, matching drawGun's transform.
    function gunPoint(o, mx, my) {
      const dx = (mx - GUN.cx) * o.s;
      const dy = (my - GUN.cy) * o.s;
      const r = o.rot ?? 0;
      return [
        o.x + dx * Math.cos(r) - dy * Math.sin(r),
        o.y + dx * Math.sin(r) + dy * Math.cos(r),
      ];
    }

    // Recoil for a shot fired dt seconds ago: slide travel (mm) and muzzle flip.
    function recoil(dt) {
      if (dt < 0 || dt > 0.25) return { slide: 0, flip: 0 };
      const slide =
        dt < 0.03
          ? ease.out3(dt / 0.03) * 30
          : 30 * (1 - ease.inOut3(clamp((dt - 0.03) / 0.07)));
      const flip =
        -Math.sin(clamp(dt / 0.22) * Math.PI) * (1 - dt / 0.25) * 0.13;
      return { slide, flip };
    }

    function muzzleFlash(x, y, size, a, seed, angle = 0) {
      if (a <= 0) return;
      const r = rand(seed);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.globalCompositeOperation = "lighter";
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
      gr.addColorStop(0, `rgba(255,250,230,${a})`);
      gr.addColorStop(0.3, `rgba(255,190,90,${0.8 * a})`);
      gr.addColorStop(1, "rgba(255,80,30,0)");
      ctx.fillStyle = gr;
      ctx.beginPath();
      const spikes = 9;
      for (let k = 0; k <= spikes * 2; k++) {
        const ang = (k / (spikes * 2)) * Math.PI * 2;
        const len =
          k % 2
            ? size * (0.25 + r() * 0.2)
            : size * (0.6 + r() * 0.5) * (Math.abs(Math.cos(ang)) * 0.8 + 0.4);
        ctx.lineTo(
          Math.cos(ang) *
            len *
            (ang < Math.PI / 2 || ang > (3 * Math.PI) / 2 ? 1.6 : 0.8),
          Math.sin(ang) * len * 0.75,
        );
      }
      ctx.fill();
      ctx.restore();
    }

    // Brass ejected from the port of a gun at o, dt seconds after the shot.
    function brass(o, dt, seed) {
      if (dt < 0.02 || dt > 0.9) return;
      const r = rand(seed);
      const [px0, py0] = gunPoint(o, GUN.port[0], GUN.port[1]);
      const d = dt - 0.02;
      const vx = (-90 - r() * 80) * (o.s / 4);
      const vy = (-520 - r() * 160) * (o.s / 4);
      const gy = 1500 * (o.s / 4);
      const x = px0 + vx * d;
      const y = py0 + vy * d + 0.5 * gy * d * d;
      const spin = d * (24 + r() * 10);
      const a = 1 - seg(dt, 0.6, 0.9);
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.translate(x, y);
      ctx.rotate(spin);
      const L = 19 * (o.s / 4) * 1.0;
      const w = 9.9 * (o.s / 4);
      const gr = ctx.createLinearGradient(0, -w / 2, 0, w / 2);
      gr.addColorStop(0, "#ffe7a3");
      gr.addColorStop(0.5, C.brass);
      gr.addColorStop(1, "#8a6420");
      ctx.fillStyle = gr;
      ctx.fillRect(-L / 2, -w / 2, L, w);
      ctx.fillStyle = "#7a5518";
      ctx.fillRect(-L / 2, -w / 2, L * 0.12, w);
      ctx.restore();
    }

    // ------------------------------------------------------------- the target
    // Draws the IPSC target centred at (x, y) with s px per cm.
    function drawTarget(x, y, s, o = {}) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s, s);
      const px = 1 / s;
      const build = o.build ?? 1;
      const fill = o.fill ?? 1;
      if (fill > 0) {
        tracePath(ctx, TGT.outer);
        ctx.fillStyle = o.noShoot
          ? `rgba(240,242,244,${fill})`
          : rgba(C.card, fill);
        ctx.fill();
        // corrugated cardboard texture
        ctx.save();
        tracePath(ctx, TGT.outer);
        ctx.clip();
        ctx.strokeStyle = `rgba(0,0,0,${0.05 * fill})`;
        ctx.lineWidth = 0.35;
        for (let k = -30; k < 30; k += 1.3)
          line(k, -30, k, 30, `rgba(0,0,0,${0.045 * fill})`, 0.35);
        ctx.restore();
      }
      const ring = (outer, inner, a) => {
        if (a <= 0) return;
        tracePath(ctx, outer);
        if (inner) tracePath2(inner);
        ctx.fillStyle = rgba(C.red, a);
        ctx.fill("evenodd");
      };
      ring(TGT.outer, TGT.c, o.hiD ?? 0);
      ring(TGT.c, TGT.a, o.hiC ?? 0);
      ring(TGT.a, null, o.hiA ?? 0);
      tracePath(ctx, TGT.outer, build);
      ctx.strokeStyle = o.noShoot
        ? "rgba(0,0,0,0.25)"
        : rgba(o.edge ?? C.cardEdge, 1);
      ctx.lineWidth = (o.edgeW ?? 2) * px;
      ctx.stroke();
      ctx.setLineDash([1.6, 1.1]);
      ctx.strokeStyle = o.noShoot ? "rgba(0,0,0,0.18)" : "rgba(70,45,15,0.6)";
      ctx.lineWidth = Math.max(0.28, 1.2 * px);
      tracePath(ctx, TGT.c, o.zones ?? 1);
      ctx.stroke();
      tracePath(ctx, TGT.a, o.zones ?? 1);
      ctx.stroke();
      ctx.setLineDash([]);
      if (o.letters) {
        ctx.globalAlpha *= o.letters;
        ctx.font = font(800, 4.2);
        ctx.fillStyle = o.noShoot ? "rgba(0,0,0,0.3)" : "rgba(70,45,15,0.75)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("A", 0, -15.5);
        ctx.fillText("C", 0, 15);
        ctx.fillText("D", 0, 25);
      }
      ctx.restore();
    }

    // ------------------------------------------------------------- 3D stage
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const norm = (a) => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
    const UP = [0, 1, 0];
    function camera(pos, look, fov) {
      const f = norm(sub(look, pos));
      const r = norm(cross(UP, f));
      const u = cross(f, r);
      return { pos, f, r, u, focal: H / 2 / Math.tan((fov * Math.PI) / 360) };
    }
    function project(cam, p) {
      const d = sub(p, cam.pos);
      const z = dot(d, cam.f);
      return [
        W / 2 + (dot(d, cam.r) / z) * cam.focal,
        H / 2 - (dot(d, cam.u) / z) * cam.focal,
        z,
      ];
    }
    function seg3(cam, a, b, color, width) {
      let pa = sub(a, cam.pos);
      let pb = sub(b, cam.pos);
      let za = dot(pa, cam.f);
      let zb = dot(pb, cam.f);
      const near = 0.3;
      if (za < near && zb < near) return;
      if (za < near) a = add(a, mul(sub(b, a), (near - za) / (zb - za)));
      if (zb < near) b = add(b, mul(sub(a, b), (near - zb) / (za - zb)));
      const A = project(cam, a);
      const B = project(cam, b);
      line(A[0], A[1], B[0], B[1], color, width);
    }
    function poly3(cam, pts, fill, stroke, width = 1.5) {
      ctx.beginPath();
      pts.forEach((p, k) => {
        const q = project(cam, p);
        if (k) ctx.lineTo(q[0], q[1]);
        else ctx.moveTo(q[0], q[1]);
      });
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width;
        ctx.stroke();
      }
    }

    // ------------------------------------------------------------ frame chrome
    function background(t) {
      if (!gradients) {
        const rg = ctx.createRadialGradient(
          W / 2,
          H * 0.45,
          0,
          W / 2,
          H * 0.45,
          W * 0.7,
        );
        rg.addColorStop(0, "#161a20");
        rg.addColorStop(1, C.bg);
        const vg = ctx.createRadialGradient(
          W / 2,
          H / 2,
          H * 0.35,
          W / 2,
          H / 2,
          W * 0.75,
        );
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, "rgba(0,0,0,0.62)");
        gradients = { rg, vg };
      }
      ctx.fillStyle = gradients.rg;
      ctx.fillRect(-60, -60, W + 120, H + 120);
    }

    function floorGrid(a, t) {
      if (a <= 0) return;
      const hz = H * 0.66;
      ctx.save();
      ctx.globalAlpha = a;
      for (let k = -14; k <= 14; k++) {
        const x = W / 2 + k * 150;
        line(
          W / 2 + k * 18,
          hz,
          x + (x - W / 2) * 2.5,
          H + 40,
          "rgba(255,255,255,0.05)",
          1,
        );
      }
      const scroll = (t * 0.6) % 1;
      for (let k = 0; k < 12; k++) {
        const z = (k + scroll) / 12;
        const y = hz + (H - hz + 40) * z ** 2.2;
        line(0, y, W, y, `rgba(255,255,255,${0.06 * z})`, 1);
      }
      ctx.restore();
    }

    function blueprintGrid(a) {
      if (a <= 0) return;
      ctx.save();
      ctx.globalAlpha = a;
      for (let x = 0; x <= W; x += 40)
        line(
          x,
          0,
          x,
          H,
          x % 200 === 0 ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.025)",
          1,
        );
      for (let y = 20; y <= H; y += 40)
        line(
          0,
          y,
          W,
          y,
          (y - 20) % 200 === 0
            ? "rgba(255,255,255,0.06)"
            : "rgba(255,255,255,0.025)",
          1,
        );
      ctx.restore();
    }

    function cornerMarks(a) {
      if (a <= 0) return;
      ctx.save();
      ctx.globalAlpha = a;
      const m = 40;
      const L = 26;
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      [
        [m, m, 1, 1],
        [W - m, m, -1, 1],
        [m, H - m, 1, -1],
        [W - m, H - m, -1, -1],
      ].forEach(([x, y, sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(x, y + sy * L);
        ctx.lineTo(x, y);
        ctx.lineTo(x + sx * L, y);
        ctx.stroke();
      });
      ctx.restore();
    }

    function caption(t) {
      const lang = opt.lang;
      for (const [a, b, ko, en] of CAPTIONS) {
        if (t < a || t > b + 0.3) continue;
        const lt = t - a;
        const out = t > b ? t - b : -1;
        const fade = 1 - seg(t, b, b + 0.3);
        ctx.save();
        ctx.globalAlpha = fade;
        const y = lang === "both" ? H - 128 : H - 96;
        const bar = ease.outExpo(seg(lt, 0, 0.35));
        ctx.fillStyle = C.red;
        ctx.fillRect(96, y - 30 * bar, 4, 36 * bar);
        const primary = lang === "en" ? en : ko;
        kinetic(primary, 120, y, {
          size: 30,
          weight: lang === "en" ? 600 : 700,
          family: lang === "en" ? SANS : KR,
          t: lt,
          out,
          stagger: 0.008,
          dur: 0.4,
          outDur: 0.25,
        });
        if (lang === "both") {
          ctx.globalAlpha = fade * ease.out3(seg(lt, 0.15, 0.5));
          text(en, 120, y + 40, { size: 20, weight: 500, color: C.dim });
        }
        ctx.restore();
      }
    }

    function hud(t) {
      const a = 1 - seg(t, 26.6, 27.2);
      if (a <= 0) return;
      ctx.save();
      ctx.globalAlpha = a * ease.out3(seg(t, 0.1, 0.6));
      if (opt.chrome) {
        text("KRPSA", 96, 92, { size: 26, weight: 800, tracking: -0.5 });
        text("IPSC IN MOTION", 96, 116, {
          size: 12,
          weight: 600,
          tracking: 2.6,
          color: C.dim,
        });
      }
      // stage brief / shot timer
      if (t < BEEP) {
        text("STAGE 01 — SHORT COURSE", W - 96, 92, {
          size: 14,
          weight: 700,
          tracking: 2,
          align: "right",
        });
        text(
          `${SHOTS.length} ROUNDS · ${8 * 5 + 2 * 5} POINTS · COMSTOCK`,
          W - 96,
          116,
          { size: 12, weight: 600, tracking: 2, color: C.dim, align: "right" },
        );
      }
      if (!opt.chrome) {
        ctx.restore();
        return;
      }
      // chapter progress
      const idx = CHAPTERS.findLastIndex((c) => t >= c.t);
      const ch = CHAPTERS[Math.max(0, idx)];
      const lang = opt.lang === "en" ? "en" : opt.lang === "ko" ? "ko" : "en";
      const bx = W - 96 - 420;
      const by = H - 92;
      text(
        `${String(idx + 1).padStart(2, "0")} / ${String(CHAPTERS.length).padStart(2, "0")}`,
        bx,
        by - 18,
        { size: 13, weight: 700, tracking: 1.5 },
      );
      text(ch[lang].toUpperCase(), W - 96, by - 18, {
        size: 13,
        weight: 700,
        tracking: 1.5,
        align: "right",
        family: lang === "ko" ? KR : SANS,
      });
      CHAPTERS.forEach((c, k) => {
        const end = k + 1 < CHAPTERS.length ? CHAPTERS[k + 1].t : DURATION;
        const x0 = bx + (c.t / DURATION) * 420;
        const x1 = bx + (end / DURATION) * 420 - 4;
        ctx.fillStyle = "rgba(255,255,255,0.16)";
        ctx.fillRect(x0, by, x1 - x0, 3);
        const p = seg(t, c.t, end);
        ctx.fillStyle = k === idx ? C.red : "rgba(255,255,255,0.75)";
        ctx.fillRect(x0, by, (x1 - x0) * p, 3);
      });
      ctx.restore();
      cornerMarks(a * 0.9);
    }

    // The shot timer, as it sits in the top-right corner after the beep.
    function timerHud(t) {
      if (t < 6.75 || t > 20.4) return;
      const ms = stageMs(t);
      const a = (t < 6.8 ? 1 : 1) * (1 - seg(t, 19.95, 20.0));
      if (a <= 0) return;
      ctx.save();
      ctx.globalAlpha = a;
      const frozen = t >= FREEZE && t < RESUME;
      const done = t >= SHOTS[SHOTS.length - 1].t;
      text(frozen ? "TIME FREEZE" : done ? "LAST SHOT" : "TIME", W - 96, 84, {
        size: 12,
        weight: 700,
        tracking: 2.4,
        align: "right",
        color: frozen ? C.red : C.dim,
      });
      const blink = frozen
        ? 0.55 + 0.45 * Math.round((Math.sin(t * 7) + 1) / 2)
        : 1;
      ctx.globalAlpha = a * blink;
      digits(fmt2(ms), W - 96, 150, 64, { align: "right", weight: 700 });
      if (frozen) {
        ctx.fillStyle = C.red;
        ctx.fillRect(W - 96 - 200 - 30, 108, 8, 38);
        ctx.fillRect(W - 96 - 200 - 16, 108, 8, 38);
      }
      ctx.restore();
    }

    // ============================================================ SCENES
    // S0 — DVC: Diligentia, Vis, Celeritas.
    function sceneDVC(t) {
      if (t > 2.2) return;
      floorGrid(0.6 * ease.out3(seg(t, 0, 1.2)), t);
      const words = [
        ["DILIGENTIA", "ACCURACY", "01", 0.08],
        ["VIS", "POWER", "02", 0.55],
        ["CELERITAS", "SPEED", "03", 1.02],
      ];
      // ruler under the words
      const rw = ease.outExpo(seg(t, 0.0, 0.6)) * 1280;
      ctx.save();
      line(W / 2 - rw / 2, 680, W / 2 + rw / 2, 680, C.red, 2);
      for (let k = -32; k <= 32; k++) {
        const x = W / 2 + k * 20;
        if (Math.abs(x - W / 2) > rw / 2) continue;
        line(
          x,
          680,
          x,
          680 + (k % 5 === 0 ? 16 : 7),
          "rgba(255,255,255,0.3)",
          1,
        );
      }
      ctx.restore();
      words.forEach(([la, en, n, at], k) => {
        const next = k < 2 ? words[k + 1][3] - 0.07 : 1.4;
        const lt = t - at;
        if (lt < 0 || t > next + 0.4) return;
        const out = t - next;
        const impact = Math.max(0, 1 - lt / 0.12);
        kinetic(la, W / 2, 620, {
          size: 200,
          t: lt,
          out,
          outDur: 0.18,
          tracking: -4,
          align: "center",
          stagger: 0.022,
          dur: 0.36,
          split: impact * 9,
        });
        kinetic(`${n} — ${en}`, W / 2, 380, {
          size: 24,
          weight: 700,
          t: lt - 0.05,
          out,
          outDur: 0.18,
          tracking: 8,
          align: "center",
          color: C.red,
          stagger: 0.012,
        });
      });
      // the motto collapses into one line
      const lt = t - 1.62;
      if (lt >= 0) {
        kinetic("DILIGENTIA  ·  VIS  ·  CELERITAS", W / 2, 600, {
          size: 58,
          weight: 700,
          t: lt,
          tracking: 6,
          align: "center",
          stagger: 0.01,
          dur: 0.35,
        });
        ctx.save();
        ctx.globalAlpha = ease.out3(seg(lt, 0.05, 0.3));
        text("ACCURACY · POWER · SPEED", W / 2, 380, {
          size: 24,
          weight: 700,
          tracking: 8,
          align: "center",
          color: C.red,
        });
        ctx.restore();
      }
    }

    // S1 — range commands.
    function sceneCommands(t) {
      if (t < 1.8 || t >= BEEP) return;
      const anticip = ease.in3(seg(t, 5.7, 6.0));
      const beat = [4.5, 5.0, 5.5].reduce(
        (acc, b) => acc + Math.max(0, 1 - Math.abs(t - b) / 0.12) * 0.012,
        0,
      );
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(1 + beat - anticip * 0.05, 1 + beat - anticip * 0.05);
      ctx.translate(-W / 2, -H / 2);
      ctx.globalAlpha = 1 - anticip * 0.55;
      floorGrid(0.5, t);

      // section label + range-officer voice meter
      const la = ease.out3(seg(t, 2.0, 2.4));
      ctx.save();
      ctx.globalAlpha *= la;
      text("RANGE COMMANDS", 150, 300, {
        size: 16,
        weight: 700,
        tracking: 4,
        color: C.red,
      });
      const lang = opt.lang === "en" ? "en" : "ko";
      text(
        lang === "en"
          ? "Issued by the Range Officer"
          : "레인지 오피서(RO)의 공식 구령",
        150,
        330,
        {
          size: 18,
          weight: 500,
          color: C.dim,
          family: lang === "en" ? SANS : KR,
        },
      );
      for (let k = 0; k < 5; k++) {
        const v = Math.abs(Math.sin(t * 13 + k * 1.7)) * (t < 5.9 ? 1 : 0);
        const live = [2.05, 3.05, 4.05].some((c) => t > c && t < c + 0.55);
        const h = 6 + (live ? v * 26 : 2);
        ctx.fillStyle = live ? C.red : C.faint;
        ctx.fillRect(1770 - (4 - k) * 9, 300 - h, 5, h);
      }
      ctx.restore();

      const cmds = [
        ["MAKE READY", 2.05, 3.0],
        ["ARE YOU READY?", 3.05, 4.0],
      ];
      cmds.forEach(([str, a, b], k) => {
        if (t < a || t > b + 0.4) return;
        kinetic(str, 150, 600, {
          size: 168,
          t: t - a,
          out: t - b,
          tracking: -5,
          stagger: 0.025,
        });
        ctx.save();
        ctx.globalAlpha = 1 - seg(t, b, b + 0.2);
        text(`0${k + 1}`, 150, 420, {
          size: 18,
          weight: 700,
          tracking: 3,
          color: C.dim,
        });
        const w = ease.outExpo(seg(t, a + 0.1, a + 0.5)) * 160;
        ctx.fillStyle = C.red;
        ctx.fillRect(150, 650, w, 6);
        ctx.restore();
      });

      // MAKE READY: fifteen rounds into a magazine (the Production limit).
      if (t > 2.05 && t < 3.3) {
        const a = ease.out3(seg(t, 2.05, 2.25)) * (1 - seg(t, 2.95, 3.2));
        ctx.save();
        ctx.globalAlpha *= a;
        const mx = 1500;
        const my = 760;
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 2;
        ctx.strokeRect(mx - 46, my - 430, 92, 440);
        const loaded = Math.floor(clamp((t - 2.15) / 0.04 + 1, 0, MAG));
        for (let k = 0; k < loaded; k++) {
          const yy = my - 14 - k * 27;
          const xx = mx + (k % 2 ? 9 : -9);
          const pop = ease.outBack(clamp((t - (2.15 + k * 0.04)) / 0.12));
          ctx.save();
          ctx.translate(xx, yy);
          ctx.scale(pop, pop);
          ctx.fillStyle = C.brass;
          ctx.fillRect(-26, -12, 34, 24);
          ctx.fillStyle = "#b8bec7";
          ctx.beginPath();
          ctx.moveTo(8, -12);
          ctx.quadraticCurveTo(30, -10, 32, 0);
          ctx.quadraticCurveTo(30, 10, 8, 12);
          ctx.fill();
          ctx.restore();
        }
        digits(String(loaded).padStart(2, "0"), mx + 80, my - 380, 72, {
          weight: 800,
        });
        text("/ 15", mx + 168, my - 380, {
          size: 28,
          weight: 700,
          color: C.dim,
        });
        text("ROUNDS — PRODUCTION MAX", mx + 80, my - 340, {
          size: 13,
          weight: 700,
          tracking: 2,
          color: C.red,
        });
        ctx.restore();
      }

      // ARE YOU READY?: a flat line — silence means ready.
      if (t > 3.05 && t < 4.3) {
        const a = ease.out3(seg(t, 3.1, 3.3)) * (1 - seg(t, 3.95, 4.15));
        ctx.save();
        ctx.globalAlpha *= a;
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        const r = rand(Math.floor(t * 30));
        for (let x = 1340; x <= 1780; x += 8) {
          const y = 372 + (r() - 0.5) * 3;
          if (x === 1340) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        text("SILENCE = READY", 1780, 410, {
          size: 15,
          weight: 700,
          tracking: 3,
          color: C.red,
          align: "right",
        });
        text("Not ready? Say “not ready”.", 1780, 436, {
          size: 15,
          weight: 500,
          color: C.dim,
          align: "right",
        });
        ctx.restore();
      }

      // STANDBY: centred, slowly tracking out, with the 1–4 s window.
      if (t > 4.05) {
        const lt = t - 4.05;
        const track = lerp(-8, 26, ease.out3(seg(t, 4.05, 6.0)));
        kinetic("STANDBY", W / 2, 590, {
          size: 236,
          t: lt,
          tracking: track,
          align: "center",
          stagger: 0.03,
          dur: 0.5,
        });
        const a = ease.out3(seg(t, 4.3, 4.7));
        ctx.save();
        ctx.globalAlpha *= a;
        const x0 = 560;
        const x1 = 1360;
        const y = 760;
        text("START SIGNAL WINDOW", x0, y - 44, {
          size: 14,
          weight: 700,
          tracking: 3,
          color: C.dim,
        });
        text("1 – 4 s", x1, y - 44, {
          size: 14,
          weight: 700,
          tracking: 2,
          color: C.red,
          align: "right",
        });
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fillRect(x0, y - 2, x1 - x0, 4);
        ctx.fillStyle = rgba(C.red, 0.35);
        ctx.fillRect(x0 + (x1 - x0) / 4, y - 10, ((x1 - x0) * 3) / 4, 20);
        for (let k = 0; k <= 4; k++) {
          const x = x0 + ((x1 - x0) * k) / 4;
          line(x, y - 14, x, y + 14, "rgba(255,255,255,0.5)", 2);
          text(`${k}`, x, y + 44, {
            size: 16,
            weight: 600,
            align: "center",
            color: C.dim,
          });
        }
        const head = x0 + ((x1 - x0) * clamp((t - 4.0) / 2.0) * 2) / 4;
        ctx.fillStyle = C.white;
        ctx.fillRect(head - 2, y - 26, 4, 52);
        ctx.restore();
      }
      ctx.restore();
    }

    // S1 → S0 wipe.
    function wipe(t, a, b, drawA, drawB) {
      const p = ease.inOut3(seg(t, a, b));
      const edge = lerp(-260, W + 260, p);
      const skew = 160;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(edge, 0);
      ctx.lineTo(W + 400, 0);
      ctx.lineTo(W + 400, H);
      ctx.lineTo(edge - skew, H);
      ctx.closePath();
      ctx.clip();
      drawA(t);
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-400, 0);
      ctx.lineTo(edge, 0);
      ctx.lineTo(edge - skew, H);
      ctx.lineTo(-400, H);
      ctx.closePath();
      ctx.clip();
      background(t);
      drawB(t);
      ctx.restore();
      ctx.fillStyle = C.red;
      ctx.beginPath();
      ctx.moveTo(edge, 0);
      ctx.lineTo(edge + 70, 0);
      ctx.lineTo(edge + 70 - skew, H);
      ctx.lineTo(edge - skew, H);
      ctx.closePath();
      ctx.fill();
    }

    // Gun pose through S2–S3.
    function gunPose(t) {
      // draw from the holster
      const d = ease.out5(seg(t, 6.38, 6.78));
      let x = lerp(1640, 760, d);
      let y = lerp(1320, 560, d);
      let rot = lerp(1.25, 0, d);
      let s = 4.2;
      // push in and centre for the anatomy
      const p = ease.inOut3(seg(t, 7.0, 8.0));
      x = lerp(x, 1010, p);
      y = lerp(y, 532, p);
      s = lerp(s, 4.4, p);
      // make room for the Production check
      const q = ease.inOut3(seg(t, 11.0, 11.45));
      x = lerp(x, 590, q);
      y = lerp(y, 615, q);
      s = lerp(s, 3.5, q);
      return { x, y, s, rot };
    }

    // S2 — the beep, the draw, the freeze.
    function sceneBeep(t) {
      if (t < BEEP || t > 8.2) return;
      const lt = t - BEEP;
      // shockwave rings
      for (let k = 0; k < 3; k++) {
        const p = seg(lt, k * 0.05, 0.9 + k * 0.05);
        if (p <= 0 || p >= 1) continue;
        ctx.strokeStyle = rgba(k ? C.white : C.red, (1 - p) * 0.8);
        ctx.lineWidth = (1 - p) * 36 + 1;
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, ease.outExpo(p) * 1500, 0, Math.PI * 2);
        ctx.stroke();
      }
      // the beep as a square wave
      const wa = 1 - seg(lt, 0.15, 0.7);
      if (wa > 0) {
        const span = ease.outExpo(seg(lt, 0, 0.2)) * (W / 2 + 40);
        ctx.strokeStyle = rgba(C.red, wa);
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let x = -span; x <= span; x += 4) {
          const amp = 70 * wa * (1 - Math.abs(x) / (W / 2 + 40));
          const yy = H / 2 + (Math.floor((x + 4000) / 26) % 2 ? amp : -amp);
          if (x === -span) ctx.moveTo(W / 2 + x, yy);
          else ctx.lineTo(W / 2 + x, yy);
        }
        ctx.stroke();
      }
      // the draw
      if (t > 6.36) {
        const pose = gunPose(t);
        const ghosts = t < 6.8 ? 4 : 0;
        for (let k = ghosts; k >= 1; k--) {
          const gp = gunPose(t - k * 0.018);
          drawGun({ ...gp, alpha: 0.12, fiber: 0, blue: 0 });
        }
        drawGun({ ...pose, blue: ease.inOut3(seg(t, 7.3, 8.0)), draw: 1 });
      }
      // big timer that flies to the HUD
      const fly = ease.inOut3(seg(t, 6.42, 6.75));
      if (fly < 1) {
        const size = lerp(300, 64, fly);
        const x = lerp(W / 2, W - 96, fly);
        const y = lerp(H / 2 + 105, 150, fly);
        ctx.save();
        ctx.globalAlpha = ease.out3(seg(lt, 0, 0.06));
        const impact = Math.max(0, 1 - lt / 0.25);
        if (impact > 0) {
          ctx.globalCompositeOperation = "screen";
          digits(fmt2(stageMs(t)), x - impact * 14, y, size, {
            align: fly > 0 ? "right" : "center",
            color: rgba(C.red, 0.9),
            weight: 700,
          });
          digits(fmt2(stageMs(t)), x + impact * 14, y, size, {
            align: fly > 0 ? "right" : "center",
            color: "rgba(0,220,255,0.7)",
            weight: 700,
          });
          ctx.globalCompositeOperation = "source-over";
        }
        digits(fmt2(stageMs(t)), x, y, size, {
          align: fly > 0 ? "right" : "center",
          weight: 700,
        });
        ctx.restore();
      }
      // freeze frame
      if (t >= FREEZE) {
        const fa = 1 - seg(t, FREEZE, FREEZE + 0.35);
        ctx.strokeStyle = `rgba(255,255,255,${fa})`;
        ctx.lineWidth = 6;
        ctx.strokeRect(24, 24, W - 48, H - 48);
      }
    }

    // A callout: anchor dot, elbow leader, label + Korean/English note.
    function callout(t, at, anchor, lx, ly, title, note, side = 1) {
      const lt = t - at;
      if (lt < 0) return;
      const out = 1 - seg(t, 10.95, 11.2);
      if (out <= 0) return;
      ctx.save();
      ctx.globalAlpha = out;
      const [ax, ay] = anchor;
      const pop = ease.outBack(seg(lt, 0, 0.25));
      ctx.fillStyle = C.red;
      ctx.beginPath();
      ctx.arc(ax, ay, 6 * pop, 0, Math.PI * 2);
      ctx.fill();
      const ring = seg(lt, 0, 0.6);
      ctx.strokeStyle = rgba(C.red, 1 - ring);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ax, ay, 6 + ring * 26, 0, Math.PI * 2);
      ctx.stroke();
      const ex = lx - side * 24;
      const p1 = ease.out3(seg(lt, 0.05, 0.25));
      const p2 = ease.out3(seg(lt, 0.2, 0.38));
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(lerp(ax, ex, p1), lerp(ay, ly, p1));
      if (p2 > 0) ctx.lineTo(lerp(ex, lx, p2), ly);
      ctx.stroke();
      const align = side > 0 ? "left" : "right";
      const tx = lx + side * 14;
      kinetic(title, tx, ly + 7, {
        size: 22,
        weight: 700,
        t: lt - 0.25,
        tracking: 1.5,
        align,
        stagger: 0.006,
        dur: 0.3,
      });
      ctx.globalAlpha = out * ease.out3(seg(lt, 0.4, 0.7));
      const lang = opt.lang;
      const sub = lang === "en" ? note[1] : note[0];
      text(sub, tx, ly + 38, {
        size: 17,
        weight: 500,
        color: C.dim,
        align,
        family: lang === "en" ? SANS : KR,
      });
      if (lang === "both")
        text(note[1], tx, ly + 62, {
          size: 14,
          weight: 500,
          color: C.faint,
          align,
        });
      ctx.restore();
    }

    function dimension(x0, x1, y, label, a, tickUp = true) {
      if (a <= 0) return;
      ctx.save();
      ctx.globalAlpha *= a;
      const p = ease.outExpo(a);
      const mid = (x0 + x1) / 2;
      const hx0 = lerp(mid, x0, p);
      const hx1 = lerp(mid, x1, p);
      line(hx0, y, hx1, y, C.red, 1.5);
      const tk = tickUp ? -12 : 12;
      line(x0, y - tk, x0, y + tk * 0.4, C.red, 1.5);
      line(x1, y - tk, x1, y + tk * 0.4, C.red, 1.5);
      ctx.fillStyle = C.red;
      [
        [hx0, 1],
        [hx1, -1],
      ].forEach(([x, d]) => {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + d * 10, y - 4);
        ctx.lineTo(x + d * 10, y + 4);
        ctx.fill();
      });
      const w = layout(label, font(700, 15), 1.5).width + 18;
      ctx.fillStyle = C.bg;
      ctx.fillRect(mid - w / 2, y - 12, w, 24);
      text(label, mid, y + 5, {
        size: 15,
        weight: 700,
        tracking: 1.5,
        align: "center",
        color: C.red,
      });
      ctx.restore();
    }

    // S3 — CZ Shadow 2 anatomy and the Production check.
    function sceneGun(t) {
      if (t < 7.0 || t > 13.2) return;
      const pose = gunPose(t);
      const out = ease.in3(seg(t, 12.75, 13.0));
      blueprintGrid(ease.out3(seg(t, 7.3, 8.0)) * (1 - out));
      // giant outline type behind the gun
      ctx.save();
      ctx.globalAlpha =
        ease.out3(seg(t, 7.6, 8.4)) * (1 - seg(t, 10.9, 11.3)) * 0.9;
      ctx.font = font(800, 380);
      ctx.strokeStyle = "rgba(255,255,255,0.09)";
      ctx.lineWidth = 2;
      ctx.textAlign = "center";
      ctx.strokeText("SHADOW 2", W / 2 + lerp(80, -80, seg(t, 7.6, 11.2)), 690);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 1 - out;
      if (t >= 8.0) drawGun({ ...pose, blue: 1, draw: 1 });

      // title block
      const ta = t - 8.0;
      if (ta >= 0) {
        kinetic("CZ SHADOW 2", 96, 214, {
          size: 64,
          t: ta,
          tracking: -1.5,
          stagger: 0.02,
          out: t - 12.75,
        });
        ctx.save();
        ctx.globalAlpha *= ease.out3(seg(ta, 0.2, 0.5));
        text("9×19 mm  ·  SA/DA  ·  STEEL FRAME", 98, 250, {
          size: 15,
          weight: 700,
          tracking: 3,
          color: C.red,
        });
        ctx.restore();
      }
      // overall length
      const o = pose;
      const L0 = gunPoint(o, 0, 150);
      const L1 = gunPoint(o, 217, 150);
      const anat = 1 - seg(t, 10.95, 11.2);
      dimension(
        L0[0],
        L1[0],
        L0[1] + 24,
        "≈ 217 mm",
        seg(t, 8.05, 8.55) * anat,
        false,
      );

      const lang = opt.lang;
      callout(
        t,
        8.25,
        gunPoint(o, 205, 2),
        1500,
        262,
        "FIBRE-OPTIC FRONT SIGHT",
        [
          "파이버 옵틱 가늠쇠 · 조절식 가늠자",
          "Fibre-optic front, adjustable rear",
        ],
      );
      callout(
        t,
        8.75,
        gunPoint(o, 172, 30),
        1500,
        410,
        "SLIDE INSIDE THE FRAME",
        ["CZ 75 설계 — 낮은 보어축", "CZ 75 layout — a low bore axis"],
      );
      callout(
        t,
        9.25,
        gunPoint(o, 190, 46),
        1500,
        560,
        "STEEL FRAME · ≈1.3 kg",
        [
          "무게로 반동과 총구 들림을 억제",
          "Weight that tames recoil and muzzle rise",
        ],
      );
      callout(t, 9.75, gunPoint(o, 100, 66), 1180, 760, "SA / DA TRIGGER", [
        "싱글·더블 액션 해머 방식",
        "Single- and double-action hammer",
      ]);
      callout(
        t,
        10.25,
        gunPoint(o, 47, 142),
        470,
        760,
        "17-ROUND MAGAZINE",
        ["프로덕션 경기에선 최대 15발", "Loaded to 15 for Production"],
        -1,
      );
      callout(
        t,
        10.75,
        gunPoint(o, 40, 37),
        470,
        420,
        "AMBIDEXTROUS SAFETY",
        ["좌우 양손 수동 안전장치", "Manual safety on both sides"],
        -1,
      );
      void lang;

      // Production division check
      if (t > 11.1) {
        const pa = ease.out3(seg(t, 11.1, 11.4));
        const px0 = 1130;
        ctx.save();
        ctx.globalAlpha *= pa;
        kinetic("PRODUCTION", px0, 300, {
          size: 72,
          t: t - 11.1,
          tracking: -2,
          stagger: 0.02,
          out: t - 12.75,
        });
        text("IPSC HANDGUN DIVISION", px0 + 2, 338, {
          size: 14,
          weight: 700,
          tracking: 3,
          color: C.red,
        });
        const rows = [
          [
            "APPROVED LIST",
            "CZ SHADOW 2",
            "승인 모델 목록",
            "Approved model list",
          ],
          ["SIGHTS", "IRON — NO OPTICS", "기계식 조준기", "Iron sights only"],
          [
            "BARREL ≤ 127 mm",
            "≈ 124 mm",
            "총열 길이 제한",
            "Barrel length limit",
          ],
          [
            "MAGAZINE",
            "≤ 15 ROUNDS",
            "시작 신호 시 최대 15발",
            "Max 15 at the start signal",
          ],
          [
            "SCORING",
            "MINOR · PF ≥ 125",
            "Minor 파워 팩터로 채점",
            "Always scored Minor",
          ],
        ];
        rows.forEach(([k, v, ko, en], i) => {
          const at = 11.4 + i * 0.25;
          const lt = t - at;
          if (lt < 0) return;
          const y = 410 + i * 82;
          const pr = ease.outExpo(seg(lt, 0, 0.4));
          line(
            px0,
            y + 30,
            px0 + 660 * pr,
            y + 30,
            "rgba(255,255,255,0.14)",
            1,
          );
          line(
            px0,
            y + 30,
            px0 + 660 * pr * (1 - seg(lt, 0.3, 0.8)),
            y + 30,
            C.red,
            2,
          );
          kinetic(k, px0, y, {
            size: 22,
            weight: 700,
            t: lt,
            tracking: 1.5,
            stagger: 0.008,
            dur: 0.3,
          });
          kinetic(v, px0 + 610, y, {
            size: 22,
            weight: 700,
            t: lt - 0.06,
            tracking: 1,
            stagger: 0.008,
            dur: 0.3,
            align: "right",
            color: C.white,
          });
          ctx.save();
          ctx.globalAlpha *= ease.out3(seg(lt, 0.15, 0.4));
          const sub = lang === "en" ? en : ko;
          text(sub, px0, y + 22, {
            size: 14,
            weight: 500,
            color: C.dim,
            family: lang === "en" ? SANS : KR,
          });
          // check mark
          const cp = ease.out3(seg(lt, 0.1, 0.35));
          ctx.strokeStyle = C.red;
          ctx.lineWidth = 4;
          ctx.lineCap = "round";
          ctx.beginPath();
          const cx = px0 + 640;
          const cy = y - 8;
          ctx.moveTo(cx - 9, cy);
          ctx.lineTo(
            cx - 9 + 6 * Math.min(1, cp * 2),
            cy + 6 * Math.min(1, cp * 2),
          );
          if (cp > 0.5)
            ctx.lineTo(
              cx - 3 + 14 * (cp - 0.5) * 2,
              cy + 6 - 14 * (cp - 0.5) * 2,
            );
          ctx.stroke();
          ctx.lineCap = "butt";
          ctx.restore();
        });
        // highlights on the gun that answer each row
        const bar = seg(t, 11.9, 12.2);
        const B0 = gunPoint(o, 93, -6);
        const B1 = gunPoint(o, 217, -6);
        const Bmax = gunPoint(o, 90, -6);
        if (bar > 0) {
          dimension(B0[0], B1[0], B0[1] - 18, "≈124", bar * (1 - out));
          ctx.save();
          ctx.globalAlpha *= bar * (1 - out);
          ctx.setLineDash([4, 4]);
          line(
            Bmax[0],
            Bmax[1] - 50,
            Bmax[0],
            Bmax[1] + 4,
            "rgba(255,255,255,0.6)",
            1.5,
          );
          ctx.setLineDash([]);
          text("MAX 127", Bmax[0] - 8, Bmax[1] + 2, {
            size: 13,
            weight: 700,
            tracking: 1,
            color: C.dim,
            align: "right",
          });
          ctx.restore();
        }
        const mag = ease.outBack(seg(t, 12.15, 12.45));
        if (mag > 0) {
          const [mx, my] = gunPoint(o, 66, 141);
          ctx.save();
          ctx.globalAlpha *= 1 - out;
          line(mx + 4, my, mx + 70, my, C.red, 2);
          ctx.translate(mx + 108, my);
          ctx.scale(mag, mag);
          ctx.fillStyle = C.red;
          ctx.fillRect(-34, -18, 68, 36);
          digits("15", 0, 10, 28, { align: "center", weight: 800 });
          ctx.restore();
        }
        ctx.restore();
      }
      ctx.restore();
    }

    // Blinds transition S3 → S4.
    function blinds(t, a, b) {
      const n = 9;
      const h = H / n;
      for (let k = 0; k < n; k++) {
        const d = k * 0.012;
        const close = ease.inOut3(seg(t, a + d, a + (b - a) / 2 + d));
        const open = ease.inOut3(seg(t, a + (b - a) / 2 + d, b + d));
        const cover = close * (1 - open);
        if (cover <= 0) continue;
        const y = k * h;
        ctx.fillStyle = "#0d0f13";
        ctx.fillRect(0, y + (h * (1 - cover)) / 2, W, h * cover + 1);
        if (cover < 0.98) {
          ctx.fillStyle = C.red;
          ctx.fillRect(0, y + (h * (1 - cover)) / 2, W, 2);
        }
      }
    }

    // S4 — targets and scoring.
    function sceneTargets(t) {
      if (t < 12.9 || t > 16.1) return;
      const whip = ease.in3(seg(t, 15.7, 16.0));
      ctx.save();
      ctx.translate(-whip * W * 1.1, 0);
      const lt = t - 13.0;
      const lang = opt.lang;
      floorGrid(0.35, t);
      // target
      const tx = 600;
      const ty = 560;
      const s = 11;
      const zone = (at) =>
        seg(t, at, at + 0.08) *
        (1 - ease.out3(seg(t, at + 0.15, at + 0.9))) *
        0.8;
      drawTarget(tx, ty, s, {
        build: ease.out3(seg(lt, 0, 0.45)),
        fill: ease.out3(seg(lt, 0.15, 0.5)),
        zones: ease.out3(seg(lt, 0.3, 0.8)),
        letters: ease.out3(seg(lt, 0.5, 0.8)),
        hiA: zone(13.5),
        hiC: zone(13.75),
        hiD: zone(14.0),
      });
      // dimensions
      const da = seg(lt, 0.3, 0.7);
      dimension(tx - 23 * s, tx + 23 * s, ty + 29 * s + 40, "46 cm", da, false);
      ctx.save();
      ctx.translate(tx - 23 * s - 40, ty);
      ctx.rotate(-Math.PI / 2);
      dimension(-29 * s, 29 * s, 0, "58 cm", da);
      ctx.restore();
      // bullet holes
      [
        [-2, -9, 13.5],
        [4, -4, 13.52],
        [-12, 12, 13.75],
        [17, 23, 14.0],
      ].forEach(([hx, hy, at]) => {
        if (t < at) return;
        ctx.fillStyle = "#14100b";
        ctx.beginPath();
        ctx.arc(tx + hx * s, ty + hy * s, 6, 0, Math.PI * 2);
        ctx.fill();
        const r = seg(t, at, at + 0.35);
        if (r < 1) {
          ctx.strokeStyle = `rgba(255,255,255,${1 - r})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(tx + hx * s, ty + hy * s, 6 + r * 40, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      // scoring table
      const x0 = 1100;
      kinetic("SCORING", x0, 250, {
        size: 64,
        t: lt,
        tracking: -1.5,
        stagger: 0.02,
      });
      ctx.save();
      ctx.globalAlpha = ease.out3(seg(lt, 0.25, 0.55));
      text("ZONE", x0, 330, {
        size: 14,
        weight: 700,
        tracking: 3,
        color: C.dim,
      });
      text("MAJOR", x0 + 420, 330, {
        size: 14,
        weight: 700,
        tracking: 3,
        color: C.dim,
        align: "center",
      });
      text("MINOR", x0 + 600, 330, {
        size: 14,
        weight: 700,
        tracking: 3,
        color: C.white,
        align: "center",
      });
      line(x0, 346, x0 + 680, 346, "rgba(255,255,255,0.2)", 1);
      ctx.restore();
      [
        ["A", 5, 5, 13.5],
        ["C", 4, 3, 13.75],
        ["D", 2, 1, 14.0],
      ].forEach(([z, maj, min, at], i) => {
        const rl = t - at;
        if (rl < 0) return;
        const y = 420 + i * 76;
        const pill = ease.outBack(seg(rl, 0, 0.3));
        ctx.save();
        ctx.fillStyle = C.red;
        ctx.globalAlpha = 0.95;
        ctx.beginPath();
        ctx.roundRect(x0 + 600 - 48 * pill, y - 46, 96 * pill, 62, 8);
        ctx.fill();
        ctx.restore();
        kinetic(z, x0, y, { size: 56, t: rl, stagger: 0 });
        kinetic(String(maj), x0 + 420, y, {
          size: 52,
          weight: 600,
          t: rl - 0.04,
          align: "center",
          color: C.dim,
          stagger: 0,
        });
        kinetic(String(min), x0 + 600, y, {
          size: 52,
          t: rl - 0.08,
          align: "center",
          stagger: 0,
        });
        ctx.save();
        ctx.globalAlpha = ease.out3(seg(rl, 0.1, 0.4));
        const zl = {
          A: ["중앙 · 최고점", "Centre — top score"],
          C: ["중간", "Middle"],
          D: ["가장자리", "Outer edge"],
        }[z];
        text(lang === "en" ? zl[1] : zl[0], x0 + 80, y - 10, {
          size: 16,
          weight: 500,
          color: C.dim,
          family: lang === "en" ? SANS : KR,
        });
        ctx.restore();
      });
      ctx.save();
      ctx.globalAlpha = ease.out3(seg(t, 14.2, 14.45));
      text("PRODUCTION = MINOR", x0 + 680, 650, {
        size: 13,
        weight: 700,
        tracking: 2.5,
        color: C.red,
        align: "right",
      });
      ctx.restore();

      // steel, no-shoot, miss
      const cards = [
        ["STEEL", "MUST FALL", "5", 14.5],
        ["NO-SHOOT", "PENALTY", "−10", 14.75],
        ["MISS", "PENALTY", "−10", 15.0],
      ];
      cards.forEach(([name, sub, val, at], i) => {
        const cl = t - at;
        if (cl < 0) return;
        const cx = x0 + i * 236;
        const cy = 720;
        const pop = ease.out3(seg(cl, 0, 0.3));
        ctx.save();
        ctx.globalAlpha = pop;
        ctx.translate(0, (1 - pop) * 30);
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(cx, cy, 212, 200, 6);
        ctx.fill();
        ctx.stroke();
        // icons
        if (i === 0) {
          const fall = ease.in3(seg(t, 15.25, 15.55));
          ctx.save();
          ctx.translate(cx + 56, cy + 150);
          ctx.scale(1.2, 1.2 * Math.cos(fall * 1.45));
          ctx.transform(1, 0, -0.25 * fall, 1, 0, 0);
          ctx.scale(1 / 1.2, 1);
          tracePath(ctx, POPPER);
          ctx.restore();
          ctx.fillStyle = C.steel;
          ctx.fill();
          if (t > 15.25 && t < 15.5)
            muzzleFlash(
              cx + 56,
              cy + 150 - 70 * 1.2 * 0.95,
              26,
              1 - seg(t, 15.25, 15.4),
              99,
            );
        } else {
          ctx.save();
          ctx.translate(cx + 56, cy + 104);
          ctx.scale(2.1, 2.1);
          tracePath(ctx, TGT.outer);
          ctx.fillStyle = i === 1 ? "#eef0f2" : rgba(C.card, 0.25);
          ctx.fill();
          if (i === 2) {
            ctx.setLineDash([2, 2]);
            ctx.strokeStyle = rgba(C.card, 0.9);
            ctx.lineWidth = 0.6;
            ctx.stroke();
            ctx.setLineDash([]);
          }
          ctx.restore();
          if (i === 1) {
            ctx.strokeStyle = C.red;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(cx + 34, cy + 64);
            ctx.lineTo(cx + 78, cy + 144);
            ctx.moveTo(cx + 78, cy + 64);
            ctx.lineTo(cx + 34, cy + 144);
            ctx.stroke();
          }
        }
        text(name, cx + 112, cy + 48, { size: 15, weight: 800, tracking: 1.5 });
        text(sub, cx + 112, cy + 72, {
          size: 12,
          weight: 700,
          tracking: 1.5,
          color: C.dim,
        });
        text(val, cx + 112, cy + 160, {
          size: 54,
          weight: 800,
          color: i ? C.red : C.white,
        });
        ctx.restore();
      });
      ctx.restore();
      // speed lines during the whip pan
      if (whip > 0) {
        const r = rand(Math.floor(t * 60));
        ctx.save();
        ctx.globalAlpha = Math.sin(whip * Math.PI) * 0.8;
        for (let k = 0; k < 40; k++) {
          const y = r() * H;
          const len = 300 + r() * 900;
          line(
            r() * W,
            y,
            r() * W - len,
            y,
            "rgba(255,255,255,0.35)",
            1 + r() * 2,
          );
        }
        ctx.restore();
      }
    }

    // S5 — the stage run in 3D.
    const AREA = {
      A: {
        pos: [-2.5, 0, 0.1],
        box: [
          [-3.5, -0.8],
          [-1.5, 1.0],
        ],
      },
      B: {
        pos: [2.5, 0, 0.9],
        box: [
          [1.5, 0.0],
          [3.5, 1.8],
        ],
      },
    };
    const lerp3 = (a, b, p) => [
      lerp(a[0], b[0], p),
      lerp(a[1], b[1], p),
      lerp(a[2], b[2], p),
    ];
    function shooterPos(t) {
      const p = ease.inOut3(seg(t, MOVE[0], MOVE[1]));
      const a = AREA.A.pos;
      const b = AREA.B.pos;
      const c = [0, 0, 1.1];
      const u = 1 - p;
      return [
        u * u * a[0] + 2 * u * p * c[0] + p * p * b[0],
        0,
        u * u * a[2] + 2 * u * p * c[2] + p * p * b[2],
      ];
    }
    function targetFrame(key) {
      const tg = TARGETS[key];
      const from = AREA[tg.from].pos;
      const n = norm([from[0] - tg.pos[0], 0, from[2] - tg.pos[2]]);
      return { n, right: cross(n, UP) };
    }
    function aimPoint(key) {
      const tg = TARGETS[key];
      const h = tg.kind === "popper" ? 0.7 : tg.kind === "plate" ? 1.0 : 1.24;
      return [tg.pos[0], h, tg.pos[2]];
    }
    // The point the shooter is working on: swings from target to target.
    function workPoint(t) {
      let k = SHOTS.findIndex((s) => s.t >= t - 0.06);
      if (k < 0) k = SHOTS.length - 1;
      const cur = aimPoint(SHOTS[k].target);
      const prev = k > 0 ? aimPoint(SHOTS[k - 1].target) : [-2.6, 1.1, 5.6];
      const from = k > 0 ? SHOTS[k - 1].t : RESUME;
      return lerp3(
        prev,
        cur,
        ease.inOut3(seg(t, from + 0.05, SHOTS[k].t - 0.04)),
      );
    }
    function aimDir(t) {
      const sp = shooterPos(t);
      // While moving, the muzzle stays pointed downrange.
      const moving = ease.inOut3(env(t, MOVE[0], MOVE[1], 0.12, 0.12));
      const d = norm(sub(workPoint(t), [sp[0], 1.4, sp[2]]));
      return norm(lerp3(d, [0, -0.35, 1], moving));
    }
    function stageCamera(t) {
      const sp = shooterPos(t);
      const wp = workPoint(t);
      const otsPos = [sp[0] + 0.7, 3.0, sp[2] - 4.4];
      const otsLook = [lerp(sp[0], wp[0], 0.78), 0.95, wp[2]];
      const b =
        ease.inOut3(seg(t, 15.9, 16.5)) *
        (1 - ease.inOut3(seg(t, 19.7, 20.15)));
      return camera(
        lerp3([0.6, 9.5, -4.6], otsPos, b),
        lerp3([0.6, 0, 3.8], otsLook, b),
        lerp(50, 33, b),
      );
    }

    function sceneStage(t) {
      if (t < 15.7 || t > 20.4) return;
      const enter = ease.out3(seg(t, 15.7, 16.05));
      const leave = ease.in3(seg(t, 19.7, 20.2));
      ctx.save();
      ctx.translate((1 - enter) * W * 1.1, 0);
      ctx.globalAlpha = 1 - leave * 0.85;
      const cam = stageCamera(t);
      // ground grid and the backstop
      for (let x = -9; x <= 9; x++)
        seg3(
          cam,
          [x, 0, -4],
          [x, 0, 12],
          x === 0 ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.05)",
          1,
        );
      for (let z = -4; z <= 12; z++)
        seg3(cam, [-9, 0, z], [9, 0, z], "rgba(255,255,255,0.05)", 1);
      poly3(
        cam,
        [
          [-10, 0, 9.4],
          [10, 0, 9.4],
          [10, 2.6, 10.8],
          [-10, 2.6, 10.8],
        ],
        "rgba(255,255,255,0.025)",
        "rgba(255,255,255,0.08)",
        1,
      );
      // shooting areas with fault lines
      Object.entries(AREA).forEach(([name, ar]) => {
        const [[x0, z0], [x1, z1]] = ar.box;
        poly3(
          cam,
          [
            [x0, 0, z0],
            [x1, 0, z0],
            [x1, 0, z1],
            [x0, 0, z1],
          ],
          rgba(C.red, 0.1),
          C.red,
          3,
        );
        const lp = project(cam, [x0 + 0.08, 0, z1 + 0.3]);
        text(`AREA ${name}`, lp[0], lp[1], {
          size: 13,
          weight: 800,
          tracking: 2,
          color: C.red,
        });
      });
      // the 180° rule
      const fanA = env(t, 16.2, 17.3, 0.3, 0.4) + env(t, 17.45, 18.7, 0.2, 0.4);
      if (fanA > 0) {
        const sp = shooterPos(t);
        const pts = [sp];
        for (let k = 0; k <= 36; k++) {
          const a = (k / 36) * Math.PI;
          pts.push([
            sp[0] + Math.cos(a) * 1.6,
            0.01,
            sp[2] + Math.sin(a) * 1.6,
          ]);
        }
        ctx.save();
        ctx.globalAlpha *= fanA;
        poly3(cam, pts, rgba(C.red, 0.16), rgba(C.red, 0.9), 2);
        const lp = project(cam, [sp[0] - 1.25, 0, sp[2] + 1.25]);
        text("180°", lp[0], lp[1], {
          size: 30,
          weight: 800,
          align: "center",
          color: C.red,
        });
        ctx.restore();
      }
      // movement trail
      if (t > MOVE[0]) {
        ctx.save();
        ctx.setLineDash([6, 8]);
        ctx.beginPath();
        const end = Math.min(t, MOVE[1]);
        for (let k = 0; k <= 30; k++) {
          const q = project(cam, shooterPos(lerp(MOVE[0], end, k / 30)));
          if (k) ctx.lineTo(q[0], q[1]);
          else ctx.moveTo(q[0], q[1]);
        }
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // objects, far to near
      const objects = [];
      const wall = [
        [0, 0, 1.6],
        [0, 0, 4.4],
        [0, 1.9, 4.4],
        [0, 1.9, 1.6],
      ];
      objects.push({
        z: project(cam, [0, 1, 3])[2],
        draw: () =>
          poly3(cam, wall, "rgba(18,21,26,0.97)", "rgba(255,255,255,0.22)"),
      });
      Object.entries(TARGETS).forEach(([key, tg]) => {
        objects.push({
          z: project(cam, add(tg.pos, [0, 1, 0]))[2],
          draw: () => drawStageTarget(cam, key, t),
        });
      });
      const sp = shooterPos(t);
      objects.push({
        z: project(cam, add(sp, [0, 1, 0]))[2],
        draw: () => drawShooter(cam, t),
      });
      objects.sort((a, b) => b.z - a.z).forEach((o) => o.draw());

      // tracers and score pops
      SHOTS.forEach((s) => {
        const dt = t - s.t;
        if (dt < 0 || dt > 0.9) return;
        const sp0 = shooterPos(s.t);
        const muzzle = add([sp0[0], 1.4, sp0[2]], mul(aimDir(s.t), 0.72));
        const hit = hitWorld(s);
        if (dt < 0.08) {
          const p = dt / 0.06;
          const A = project(
            cam,
            add(muzzle, mul(sub(hit, muzzle), clamp(p - 0.5))),
          );
          const B = project(cam, add(muzzle, mul(sub(hit, muzzle), clamp(p))));
          const g = ctx.createLinearGradient(A[0], A[1], B[0], B[1]);
          g.addColorStop(0, "rgba(255,200,120,0)");
          g.addColorStop(1, "rgba(255,240,200,1)");
          ctx.strokeStyle = g;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(A[0], A[1]);
          ctx.lineTo(B[0], B[1]);
          ctx.stroke();
          const M = project(cam, muzzle);
          muzzleFlash(
            M[0],
            M[1],
            50 * (1 - dt / 0.08),
            1 - dt / 0.08,
            s.i * 13 + 5,
            Math.atan2(B[1] - M[1], B[0] - M[0]),
          );
        }
        if (dt > 0.05) {
          const P = project(cam, add(hit, [0, 0.42 + dt * 0.45, 0]));
          const pa = ease.out3(seg(dt, 0.05, 0.15)) * (1 - seg(dt, 0.55, 0.9));
          ctx.save();
          ctx.globalAlpha *= pa;
          const label = s.zone === "S" ? "+5 STEEL" : `+${s.points} ${s.zone}`;
          const w = layout(label, font(800, 22), 1).width + 20;
          const hot = s.zone === "A" || s.zone === "S";
          ctx.fillStyle = hot ? C.red : "rgba(255,255,255,0.92)";
          ctx.beginPath();
          ctx.roundRect(P[0] - w / 2, P[1] - 30, w, 38, 4);
          ctx.fill();
          text(label, P[0], P[1] - 4, {
            size: 22,
            weight: 800,
            tracking: 1,
            align: "center",
            color: hot ? C.white : C.bg,
          });
          ctx.restore();
        }
      });
      ctx.restore();

      // shot timer list, points, rounds
      const la = ease.out3(seg(t, 16.0, 16.3)) * (1 - seg(t, 19.7, 19.95));
      if (la <= 0) return;
      ctx.save();
      ctx.globalAlpha = la;
      const x1 = W - 96;
      text("SHOT", x1 - 300, 214, {
        size: 12,
        weight: 700,
        tracking: 2,
        color: C.dim,
      });
      text("TIME", x1 - 170, 214, {
        size: 12,
        weight: 700,
        tracking: 2,
        color: C.dim,
        align: "right",
      });
      text("SPLIT", x1 - 70, 214, {
        size: 12,
        weight: 700,
        tracking: 2,
        color: C.dim,
        align: "right",
      });
      line(x1 - 300, 226, x1, 226, "rgba(255,255,255,0.2)", 1);
      SHOTS.forEach((s, k) => {
        if (t < s.t) return;
        const y = 258 + k * 34;
        const p = ease.out3(seg(t, s.t, s.t + 0.12));
        ctx.save();
        ctx.globalAlpha *= p;
        ctx.translate((1 - p) * 30, 0);
        digits(String(k + 1).padStart(2, "0"), x1 - 300, y, 20, {
          color: C.dim,
          weight: 600,
        });
        digits(fmt2(s.ms), x1 - 170, y, 20, { align: "right", weight: 700 });
        digits(k ? fmt2(s.split) : "—", x1 - 70, y, 20, {
          align: "right",
          weight: 500,
          color: C.dim,
        });
        text(s.zone === "S" ? "■" : s.zone, x1, y, {
          size: 18,
          weight: 800,
          align: "right",
          color: s.zone === "A" || s.zone === "S" ? C.red : C.white,
        });
        ctx.restore();
      });
      const fired = SHOTS.filter((s) => t >= s.t);
      const ry = 258 + SHOTS.length * 34 + 24;
      line(x1 - 300, ry - 20, x1, ry - 20, "rgba(255,255,255,0.2)", 1);
      text("POINTS", x1 - 300, ry + 10, {
        size: 12,
        weight: 700,
        tracking: 2,
        color: C.dim,
      });
      digits(
        String(fired.reduce((a, s) => a + s.points, 0)).padStart(2, "0"),
        x1,
        ry + 14,
        34,
        { align: "right", weight: 800 },
      );
      text("ROUNDS", x1 - 300, ry + 56, {
        size: 12,
        weight: 700,
        tracking: 2,
        color: C.dim,
      });
      digits(
        `${String(MAG - fired.length).padStart(2, "0")}/15`,
        x1,
        ry + 58,
        26,
        { align: "right", weight: 700, color: C.dim },
      );

      // the slide cycling, picture-in-picture
      const px = 96;
      const py = 168;
      ctx.fillStyle = "rgba(10,12,15,0.78)";
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(px, py, 420, 230, 6);
      ctx.fill();
      ctx.stroke();
      text("SLIDE CYCLE", px + 20, py + 32, {
        size: 12,
        weight: 700,
        tracking: 2.4,
        color: C.dim,
      });
      text("CZ SHADOW 2", px + 400, py + 32, {
        size: 12,
        weight: 800,
        tracking: 2,
        align: "right",
      });
      const last = [...SHOTS].reverse().find((s) => t >= s.t);
      const rc = last ? recoil(t - last.t) : { slide: 0, flip: 0 };
      const go = { x: px + 214, y: py + 132, s: 1.2, rot: rc.flip };
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(px, py, 420, 230, 6);
      ctx.clip();
      drawGun({ ...go, slide: rc.slide, fiber: 0.9 });
      if (last && t - last.t < 0.05) {
        const [mx, my] = gunPoint(go, 217, 21);
        muzzleFlash(mx + 10, my, 54, 1 - (t - last.t) / 0.05, last.i * 3 + 1);
      }
      ctx.restore();
      SHOTS.forEach((s) => brass(go, t - s.t, s.i * 7 + 3));
      ctx.restore();
    }

    function hitWorld(s) {
      const tg = TARGETS[s.target];
      if (tg.kind === "popper") return [tg.pos[0], 0.7, tg.pos[2]];
      if (tg.kind === "plate") return [tg.pos[0], 1.0, tg.pos[2]];
      const { right } = targetFrame(s.target);
      return add(add([tg.pos[0], 1.24, tg.pos[2]], mul(right, s.hit[0])), [
        0,
        -s.hit[1],
        0,
      ]);
    }

    function drawStageTarget(cam, key, t) {
      const tg = TARGETS[key];
      const { n, right } = targetFrame(key);
      const hits = SHOTS.filter((s) => s.target === key && t >= s.t + 0.04);
      const flash = SHOTS.filter((s) => s.target === key).reduce(
        (a, s) => Math.max(a, 1 - Math.abs(t - s.t - 0.06) / 0.12),
        0,
      );
      if (tg.kind === "paper" || tg.kind === "noshoot") {
        const c = [tg.pos[0], 1.24, tg.pos[2]];
        const toW = (u, v) =>
          add(add(c, mul(right, u / 100)), [0, -v / 100, 0]);
        // stand
        [-0.17, 0.17].forEach((u) =>
          seg3(
            cam,
            add([tg.pos[0], 0, tg.pos[2]], mul(right, u)),
            add([tg.pos[0], 0.95, tg.pos[2]], mul(right, u)),
            "rgba(150,120,80,0.9)",
            2,
          ),
        );
        const outer = TGT.outer.pts.map(([u, v]) => toW(u, v));
        const noShoot = tg.kind === "noshoot";
        poly3(
          cam,
          outer,
          noShoot ? "#e9ecef" : C.card,
          noShoot ? "rgba(0,0,0,0.3)" : C.cardEdge,
          1.5,
        );
        ctx.save();
        ctx.setLineDash([3, 3]);
        poly3(
          cam,
          TGT.c.pts.map(([u, v]) => toW(u, v)),
          null,
          noShoot ? "rgba(0,0,0,0.15)" : "rgba(70,45,15,0.55)",
          1,
        );
        poly3(
          cam,
          TGT.a.pts.map(([u, v]) => toW(u, v)),
          flash > 0 ? rgba(C.red, flash * 0.7) : null,
          noShoot ? "rgba(0,0,0,0.15)" : "rgba(70,45,15,0.55)",
          1,
        );
        ctx.setLineDash([]);
        ctx.restore();
        if (noShoot) {
          const lp = project(cam, toW(0, -35));
          text("NO-SHOOT", lp[0], lp[1], {
            size: 12,
            weight: 800,
            tracking: 1.5,
            align: "center",
            color: "rgba(255,255,255,0.8)",
          });
        }
        hits.forEach((s) => {
          const P = project(cam, hitWorld(s));
          ctx.fillStyle = "#120d08";
          ctx.beginPath();
          ctx.arc(
            P[0],
            P[1],
            Math.max(2, (0.012 * cam.focal) / P[2]),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        });
      } else if (tg.kind === "popper") {
        const hit = SHOTS.find((s) => s.target === key);
        const fall = ease.in3(seg(t, hit.t + 0.05, hit.t + 0.45)) * 1.45;
        const base = [tg.pos[0], 0, tg.pos[2]];
        const back = mul(n, -1);
        const pts = POPPER.pts.map(([u, v]) => {
          const h = -v / 100;
          return add(
            add(base, mul(right, u / 100)),
            add(mul(UP, h * Math.cos(fall)), mul(back, h * Math.sin(fall))),
          );
        });
        poly3(
          cam,
          pts,
          flash > 0 ? "#ffffff" : C.steel,
          "rgba(0,0,0,0.35)",
          1.5,
        );
        poly3(
          cam,
          [
            add(base, mul(right, -0.2)),
            add(base, mul(right, 0.2)),
            add(add(base, mul(right, 0.2)), mul(back, 0.2)),
            add(add(base, mul(right, -0.2)), mul(back, 0.2)),
          ],
          "#2a2e35",
          null,
        );
      } else if (tg.kind === "plate") {
        const hit = SHOTS.find((s) => s.target === key);
        const fall = ease.in3(seg(t, hit.t + 0.05, hit.t + 0.35)) * 1.5;
        seg3(
          cam,
          [tg.pos[0], 0, tg.pos[2]],
          [tg.pos[0], 0.9, tg.pos[2]],
          "rgba(180,185,190,0.8)",
          3,
        );
        const hinge = [tg.pos[0], 0.9, tg.pos[2]];
        const back = mul(n, -1);
        const pts = [];
        for (let k = 0; k < 28; k++) {
          const a = (k / 28) * Math.PI * 2;
          const u = Math.cos(a) * 0.1;
          const v = 0.1 + Math.sin(a) * 0.1;
          pts.push(
            add(
              add(hinge, mul(right, u)),
              add(mul(UP, v * Math.cos(fall)), mul(back, v * Math.sin(fall))),
            ),
          );
        }
        poly3(
          cam,
          pts,
          flash > 0 ? "#ffffff" : C.steel,
          "rgba(0,0,0,0.35)",
          1.5,
        );
      }
      const lp = project(cam, [
        tg.pos[0],
        tg.kind === "paper" || tg.kind === "noshoot"
          ? 1.75
          : tg.kind === "plate"
            ? 1.35
            : 1.05,
        tg.pos[2],
      ]);
      if (tg.kind !== "noshoot")
        text(key, lp[0], lp[1], {
          size: 13,
          weight: 800,
          tracking: 1.5,
          align: "center",
          color: "rgba(255,255,255,0.7)",
        });
    }

    function drawShooter(cam, t) {
      const sp = shooterPos(t);
      const dir = aimDir(t);
      const face = norm([dir[0], 0, dir[2]]);
      const r = cross(UP, face);
      const at = (h, side, fwd = 0) =>
        add(add(add(sp, [0, h, 0]), mul(r, side)), mul(face, fwd));
      const ring = [];
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        ring.push([sp[0] + Math.cos(a) * 0.4, 0.01, sp[2] + Math.sin(a) * 0.4]);
      }
      poly3(cam, ring, rgba(C.white, 0.06), "rgba(255,255,255,0.5)", 1.5);
      const step =
        Math.sin(seg(t, MOVE[0], MOVE[1]) * Math.PI * 6) *
        0.18 *
        env(t, MOVE[0], MOVE[1], 0.1, 0.1);
      const ink = "rgba(244,245,247,0.85)";
      seg3(cam, at(0.95, -0.12), at(0, -0.16, step), ink, 2.5);
      seg3(cam, at(0.95, 0.12), at(0, 0.16, -step), ink, 2.5);
      poly3(
        cam,
        [at(1.47, -0.23), at(1.47, 0.23), at(0.95, 0.16), at(0.95, -0.16)],
        "rgba(244,245,247,0.1)",
        ink,
        2,
      );
      const hands = add([sp[0], 1.4, sp[2]], mul(dir, 0.6));
      seg3(cam, at(1.45, -0.21), hands, ink, 2);
      seg3(cam, at(1.45, 0.21), hands, ink, 2);
      seg3(cam, hands, add(hands, mul(dir, 0.16)), C.red, 5);
      const head = project(cam, at(1.7, 0));
      ctx.fillStyle = "rgba(244,245,247,0.14)";
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(
        head[0],
        head[1],
        Math.max(4, (0.11 * cam.focal) / head[2]),
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.stroke();
    }

    // S6 — hit factor.
    function sceneHitFactor(t) {
      if (t < 19.9 || t > 22.8) return;
      const out = ease.in3(seg(t, 22.35, 22.65));
      ctx.save();
      ctx.translate(0, -out * 140);
      ctx.globalAlpha = 1 - out;
      const y = 600;
      const size = 150;
      // positions
      const xP = 250;
      const xDiv = 590;
      const xT = 720;
      const xEq = 1150;
      const xHF = 1280;
      // time flies in from the HUD
      const fly = ease.inOut3(seg(t, 19.95, 20.35));
      const tsz = lerp(64, size, fly);
      const tx = lerp(W - 96 - 2.16 * 64, xT, fly);
      const ty = lerp(150, y, fly);
      digits(fmt2(STAGE_MS), tx, ty, tsz, { weight: 800 });
      // points roll
      const pp = ease.out3(seg(t, 20.05, 20.45));
      const pts = Math.round(STAGE_POINTS * pp);
      ctx.save();
      ctx.globalAlpha *= ease.out3(seg(t, 20.0, 20.12));
      digits(String(pts).padStart(2, "0"), xP, y, size, { weight: 800 });
      ctx.restore();
      const lang = opt.lang;
      const labels = [
        [xP, "POINTS", "점수", 20.05],
        [xT, "TIME", "시간", 20.25],
        [xHF, "HIT FACTOR", "히트 팩터", 20.6],
      ];
      labels.forEach(([x, en, ko, at]) => {
        kinetic(en, x + 4, y - size - 20, {
          size: 18,
          weight: 700,
          tracking: 3,
          t: t - at,
          color: C.red,
          stagger: 0.01,
        });
        ctx.save();
        ctx.globalAlpha *= ease.out3(seg(t, at + 0.1, at + 0.35));
        if (lang !== "en")
          text(ko, x + 4, y - size + 8, {
            size: 18,
            weight: 500,
            color: C.dim,
            family: KR,
          });
        ctx.restore();
      });
      // operators slam
      [
        [xDiv, "÷"],
        [xEq, "="],
      ].forEach(([x, op]) => {
        const p = seg(t, 20.5, 20.62);
        if (p <= 0) return;
        const sc = lerp(2.2, 1, ease.out3(p));
        ctx.save();
        ctx.globalAlpha *= p;
        ctx.translate(x + 40, y - 50);
        ctx.scale(sc, sc);
        text(op, 0, 50, {
          size: 130,
          weight: 500,
          align: "center",
          color: C.dim,
        });
        ctx.restore();
      });
      // hit factor rolls in, digit by digit
      const hf = HIT_FACTOR.toFixed(4);
      if (t > 20.55) {
        const r = rand(Math.floor(t * 40));
        const chars = [...hf].map((ch, k) => {
          const land = 20.62 + k * 0.07;
          if (ch === ".") return t > land ? "." : " ";
          return t >= land ? ch : String(Math.floor(r() * 10));
        });
        const settled = t >= 20.62 + hf.length * 0.07;
        const w = digits(chars.join(""), xHF, y, size, {
          weight: 800,
          color: settled ? C.white : "rgba(255,255,255,0.75)",
        });
        const ul = ease.outExpo(seg(t, 21.0, 21.4));
        ctx.fillStyle = C.red;
        ctx.fillRect(xHF, y + 26, w * ul, 8);
        if (t > 21.0 && t < 21.5) {
          const rp = seg(t, 21.0, 21.5);
          ctx.strokeStyle = rgba(C.red, 1 - rp);
          ctx.lineWidth = 3;
          ctx.strokeRect(
            xHF - 20 - rp * 30,
            y - size - rp * 30,
            w + 40 + rp * 60,
            size + 60 + rp * 60,
          );
        }
      }
      // what each part means
      const tags = [
        ["ACCURACY", "→ POINTS", 21.5],
        ["POWER", "→ MINOR / MAJOR", 21.75],
        ["SPEED", "→ TIME", 22.0],
      ];
      tags.forEach(([a, b, at], k) => {
        const lt = t - at;
        if (lt < 0) return;
        const x = 250 + k * 470;
        kinetic(a, x, 830, {
          size: 30,
          weight: 800,
          t: lt,
          tracking: 2,
          stagger: 0.012,
        });
        ctx.save();
        ctx.globalAlpha *= ease.out3(seg(lt, 0.1, 0.3));
        text(b, x, 866, { size: 18, weight: 600, tracking: 2, color: C.dim });
        ctx.restore();
      });
      ctx.restore();
    }

    // S7 — unload, show clear, hammer down, holster, range is clear.
    function sceneClear(t) {
      if (t < 22.4 || t > 24.8) return;
      const lines = [
        ["IF YOU ARE FINISHED,", "UNLOAD AND SHOW CLEAR", 22.5, 23.02],
        ["IF CLEAR,", "HAMMER DOWN, HOLSTER", 23.25, 23.77],
      ];
      lines.forEach(([a, b, at, end]) => {
        if (t < at || t > end + 0.4) return;
        kinetic(a, 150, 400, {
          size: 44,
          weight: 600,
          t: t - at,
          out: t - end,
          outDur: 0.18,
          outStagger: 0.003,
          color: C.dim,
          tracking: 1,
          stagger: 0.01,
        });
        kinetic(b, 150, 515, {
          size: 92,
          t: t - at - 0.05,
          out: t - end,
          outDur: 0.18,
          outStagger: 0.004,
          tracking: -3,
          stagger: 0.016,
        });
      });
      if (t > 24.0) {
        kinetic("RANGE IS CLEAR", 150, 540, {
          size: 150,
          t: t - 24.0,
          tracking: -5,
          stagger: 0.02,
        });
        const w = ease.outExpo(seg(t, 24.1, 24.45)) * 520;
        ctx.fillStyle = C.red;
        ctx.fillRect(150, 590, w, 8);
      }
      // the gun: slide locked back, magazine out, slide forward, hammer down, holster
      if (t < 24.0) {
        const lock =
          ease.out3(seg(t, 22.55, 22.65)) * (1 - ease.in3(seg(t, 23.3, 23.34)));
        const drop = seg(t, 22.7, 23.3);
        const holster = ease.in3(seg(t, 23.6, 23.95));
        const enter = ease.out3(seg(t, 22.4, 22.7));
        const go = {
          x: lerp(1960, 1500, enter),
          y: 805 + holster * 520,
          s: 2.5,
          rot: holster * 0.9,
        };
        drawGun({
          ...go,
          slide: lock * 27,
          hammer: ease.in3(seg(t, 23.44, 23.5)),
          mag: { dx: -drop * 18, dy: drop * drop * 900, rot: drop * 0.8 },
        });
        if (t > 22.62 && t < 23.25) {
          const [cx, cy] = gunPoint(go, 117, 18);
          const a = env(t, 22.62, 23.25, 0.1, 0.15);
          ctx.save();
          ctx.globalAlpha = a;
          ctx.strokeStyle = C.white;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.arc(cx, cy, 70, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          text("CHAMBER EMPTY", cx, cy + 100, {
            size: 13,
            weight: 800,
            tracking: 2,
            align: "center",
          });
          ctx.restore();
        }
      }
    }

    // S8 — end card.
    function sceneEnd(t) {
      if (t < 24.3) return;
      const iris = ease.inOut3(seg(t, 24.3, 24.75));
      const r = iris * 1300;
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
      ctx.clip();
      background(t);
      blueprintGrid(0.5);
      const lt = t - 24.5;
      const img = images["krpsa-logo.png"];
      const fade = 1 - seg(t, 27.2, 28);
      ctx.globalAlpha = fade;
      if (img) {
        const h = 420;
        const w = (img.width / img.height) * h;
        const p = ease.out5(seg(lt, 0, 0.7));
        ctx.save();
        ctx.translate(560, 540);
        ctx.scale(lerp(0.86, 1, p), lerp(0.86, 1, p));
        ctx.beginPath();
        ctx.rect(-w / 2 - 10, h / 2 - (h + 20) * p, w + 20, (h + 20) * p);
        ctx.clip();
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        // light sweep
        const sw = seg(lt, 0.4, 1.2);
        if (sw > 0 && sw < 1) {
          const sx = lerp(-w, w, sw);
          const g = ctx.createLinearGradient(sx - 80, 0, sx + 80, 0);
          g.addColorStop(0, "rgba(255,255,255,0)");
          g.addColorStop(0.5, "rgba(255,255,255,0.35)");
          g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.globalCompositeOperation = "source-atop";
          ctx.fillStyle = g;
          ctx.fillRect(-w / 2, -h / 2, w, h);
        }
        ctx.restore();
      }
      kinetic("KRPSA", 820, 545, {
        size: 190,
        t: lt - 0.15,
        tracking: -6,
        stagger: 0.035,
      });
      ctx.save();
      ctx.globalAlpha *= ease.out3(seg(lt, 0.5, 0.8));
      text("KOREA PRACTICAL SHOOTING ASSOCIATION", 826, 600, {
        size: 20,
        weight: 700,
        tracking: 5,
      });
      ctx.restore();
      const lw = ease.outExpo(seg(lt, 0.55, 1.1)) * 600;
      ctx.fillStyle = C.red;
      ctx.fillRect(826, 628, lw, 4);
      ctx.save();
      ctx.globalAlpha *= ease.out3(seg(lt, 0.8, 1.1));
      text("IPSC  1976 — 2026  ·  50 YEARS", 826, 678, {
        size: 20,
        weight: 700,
        tracking: 4,
        color: C.red,
      });
      text("DILIGENTIA · VIS · CELERITAS", 826, 714, {
        size: 16,
        weight: 600,
        tracking: 4,
        color: C.dim,
      });
      ctx.restore();
      if (opt.credit) {
        ctx.save();
        ctx.globalAlpha *= ease.out3(seg(lt, 1.2, 1.6));
        text("MOTION DESIGN — CLAUDE", W - 96, H - 150, {
          size: 12,
          weight: 700,
          tracking: 3,
          color: C.faint,
          align: "right",
        });
        ctx.restore();
      }
      ctx.restore();
      if (iris > 0 && iris < 1) {
        ctx.strokeStyle = C.red;
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Camera shake from impacts.
    function shake(t) {
      const hits = [
        [BEEP, 0.45, 20],
        [RESUME, 0.3, 9],
        [21.0, 0.3, 7],
        [0.08, 0.2, 5],
        [0.58, 0.2, 5],
        [1.08, 0.2, 5],
        ...SHOTS.map((s) => [s.t, 0.12, 3]),
      ];
      let x = 0;
      let y = 0;
      for (const [at, dur, amp] of hits) {
        const d = t - at;
        if (d < 0 || d > dur) continue;
        const k = (1 - d / dur) ** 2 * amp;
        x += Math.sin(d * 71 + at * 3) * k;
        y += Math.cos(d * 59 + at * 5) * k;
      }
      return [x, y];
    }

    function overlays(t) {
      // flashes
      const flashes = [
        [BEEP, 0.16, "255,255,255", 1],
        [BEEP + 0.03, 0.6, "236,34,66", 0.35],
        [RESUME, 0.18, "255,255,255", 0.6],
        [21.0, 0.25, "255,255,255", 0.25],
        [FREEZE, 0.25, "255,255,255", 0.35],
      ];
      for (const [at, dur, rgb, a] of flashes) {
        const d = t - at;
        if (d < 0 || d > dur) continue;
        ctx.fillStyle = `rgba(${rgb},${a * (1 - d / dur) ** 2})`;
        ctx.fillRect(0, 0, W, H);
      }
      // freeze: desaturate everything below
      if (t >= FREEZE && t < 8.0) {
        ctx.save();
        ctx.globalCompositeOperation = "saturation";
        ctx.fillStyle = `rgba(128,128,128,${1 - seg(t, 7.6, 8.0)})`;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
      // vignette + grain
      ctx.fillStyle = gradients.vg;
      ctx.fillRect(0, 0, W, H);
      if (opt.grain) {
        const r = rand(Math.floor(t * 24) + 1);
        ctx.save();
        ctx.globalAlpha = 0.07;
        ctx.globalCompositeOperation = "overlay";
        ctx.translate(-r() * 256, -r() * 256);
        ctx.fillStyle = grainPattern;
        ctx.fillRect(0, 0, W + 256, H + 256);
        ctx.restore();
      }
    }

    function render(time) {
      const t = clamp(time, 0, DURATION);
      const k = canvas.width / W;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      background(t);
      const [sx, sy] = shake(t);
      ctx.save();
      ctx.translate(sx, sy);
      if (t < 1.84) sceneDVC(t);
      else if (t < 2.14) wipe(t, 1.84, 2.14, sceneDVC, sceneCommands);
      else sceneCommands(t);
      sceneBeep(t);
      sceneGun(t);
      sceneTargets(t);
      sceneStage(t);
      sceneHitFactor(t);
      sceneClear(t);
      if (t >= 12.75 && t <= 13.25) blinds(t, 12.75, 13.15);
      sceneEnd(t);
      ctx.restore();
      timerHud(t);
      if (opt.captions) caption(t);
      hud(t);
      overlays(t);
    }

    return {
      ready,
      render,
      setLang(lang) {
        opt.lang = lang;
      },
    };
  }

  // ------------------------------------------------------------ site player
  // Plays the reel inside a <figure> with a canvas, an HTML caption line and a
  // chapter rail. The caption is real text, so it stays readable on phones and
  // to screen readers; an optional <audio> track follows the same clock.
  function player(figure) {
    const canvas = figure.querySelector("canvas");
    const captionEl = figure.querySelector("[data-reel-caption]");
    const rail = figure.querySelector("[data-reel-chapters]");
    const audio = figure.querySelector("audio");
    const language = () =>
      document.documentElement.lang === "en" ? "en" : "ko";
    const reel = create(canvas, {
      lang: language(),
      assetBase: figure.dataset.assets || "assets/",
      chrome: false,
      captions: false,
    });
    const listeners = {};
    const emit = (name) => (listeners[name] || []).forEach((fn) => fn());
    let t = 0;
    let playing = false;
    let wanted = false;
    let ready = false;
    let sound = false;
    let last = 0;
    let raf = 0;
    let synced = 0;
    let captionIndex = -2;

    const buttons = CHAPTERS.map((chapter, i) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = `<span class="reel-chapter-num">${String(i + 1).padStart(2, "0")}</span><span class="reel-chapter-name"></span><i aria-hidden="true"></i>`;
      button.addEventListener("click", () => {
        seek(chapter.t);
        play();
        emit("select");
      });
      item.append(button);
      rail?.append(item);
      return button;
    });
    function labels() {
      const lang = language();
      buttons.forEach((button, i) => {
        const chapter = CHAPTERS[i];
        button.querySelector(".reel-chapter-name").textContent = chapter[lang];
        button.setAttribute(
          "aria-label",
          `${String(i + 1).padStart(2, "0")} ${chapter[lang]} — ${chapter.sub[lang]}`,
        );
      });
      captionIndex = -2;
    }

    function updateChrome() {
      const index = CHAPTERS.findLastIndex((c) => t >= c.t);
      buttons.forEach((button, i) => {
        const end = i + 1 < CHAPTERS.length ? CHAPTERS[i + 1].t : DURATION;
        button.style.setProperty(
          "--p",
          clamp((t - CHAPTERS[i].t) / (end - CHAPTERS[i].t)).toFixed(3),
        );
        if (i === index) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      });
      const ci = CAPTIONS.findIndex(([a, b]) => t >= a - 0.05 && t <= b + 0.25);
      if (ci !== captionIndex && captionEl) {
        captionIndex = ci;
        const line = CAPTIONS[ci];
        captionEl.classList.remove("is-in");
        captionEl.textContent = line
          ? language() === "en"
            ? line[3]
            : line[2]
          : "";
        if (line) {
          void captionEl.offsetWidth;
          captionEl.classList.add("is-in");
        }
      }
    }
    function draw() {
      reel.render(t);
      updateChrome();
    }
    function startAudio() {
      if (!audio) return;
      audio.currentTime = t;
      audio.play().catch(() => {
        sound = false;
        emit("sound");
      });
    }
    function frame(now) {
      raf = 0;
      if (!playing) return;
      t += Math.min(0.1, (now - last) / 1000);
      last = now;
      // The picture keeps the clock; the soundtrack is nudged back if it drifts.
      if (
        sound &&
        audio &&
        !audio.paused &&
        now - synced > 1000 &&
        Math.abs(audio.currentTime - t) > 0.2
      ) {
        audio.currentTime = t;
        synced = now;
      }
      if (t >= DURATION) {
        t = DURATION;
        draw();
        playing = false;
        wanted = false;
        audio?.pause();
        emit("ended");
        return;
      }
      draw();
      raf = requestAnimationFrame(frame);
    }
    function play() {
      wanted = true;
      if (!ready || playing) return;
      if (t >= DURATION) t = 0;
      playing = true;
      last = performance.now();
      if (sound) startAudio();
      raf = requestAnimationFrame(frame);
    }
    function pause() {
      wanted = false;
      playing = false;
      cancelAnimationFrame(raf);
      audio?.pause();
    }
    function seek(time) {
      t = clamp(time, 0, DURATION);
      if (sound && audio && playing) audio.currentTime = t;
      draw();
    }
    function resize() {
      const width = canvas.clientWidth;
      if (!width) return;
      const target = Math.round(
        Math.min(width * Math.min(window.devicePixelRatio || 1, 2), 2560),
      );
      if (canvas.width !== target) {
        canvas.width = target;
        canvas.height = Math.round((target * H) / W);
        draw();
      }
    }

    labels();
    if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
    resize();
    draw();
    reel.ready.then(() => {
      ready = true;
      draw();
      if (wanted) play();
    });
    document.addEventListener("languagechange", () => {
      reel.setLang(language());
      labels();
      draw();
    });

    return {
      play,
      pause,
      seek,
      get time() {
        return t;
      },
      get playing() {
        return wanted;
      },
      get sound() {
        return sound;
      },
      setSound(on) {
        sound = Boolean(on) && Boolean(audio);
        if (sound && playing) startAudio();
        else audio?.pause();
        emit("sound");
      },
      on(name, fn) {
        (listeners[name] ||= []).push(fn);
      },
    };
  }

  window.KRPSAReel = {
    W,
    H,
    DURATION,
    player,
    CHAPTERS,
    CUES,
    CAPTIONS,
    SHOTS,
    STAGE: {
      points: STAGE_POINTS,
      time: STAGE_TIME,
      hitFactor: HIT_FACTOR,
      rounds: SHOTS.length,
      magazine: MAG,
    },
    create,
  };
})();
