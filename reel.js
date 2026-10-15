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

  // The stage: a long course (27 rounds; IPSC long courses allow up to 32) over
  // three shooting areas. Everything is defined in stage time — milliseconds on
  // the shot timer — and RAMPS map it to video time, so the runs between areas
  // play fast and the swinger and the Texas Star play slow.
  const AREAS = {
    A: {
      pos: [-7, 0, 0],
      box: [
        [-8.1, -1.0],
        [-5.9, 1.0],
      ],
    },
    B: {
      pos: [-1.0, 0, 2.1],
      box: [
        [-2.0, 1.25],
        [0.0, 2.85],
      ],
    },
    C: {
      pos: [5.4, 0, 1.0],
      box: [
        [4.4, 0.0],
        [6.4, 2.0],
      ],
    },
  };
  const TARGETS = {
    T1: { kind: "paper", pos: [-9.2, 0, 6.6], from: "A" },
    T2: { kind: "paper", pos: [-7.3, 0, 7.6], from: "A" },
    NS1: { kind: "noshoot", pos: [-6.98, 0, 7.12], from: "A" },
    P1: { kind: "popper", pos: [-5.6, 0, 8.6], from: "A" },
    SW: { kind: "swinger", pos: [-3.9, 0, 9.4], from: "A" },
    RACK: { kind: "rack", pos: [-1.0, 0, 10.4], from: "B" },
    T3: { kind: "paper", pos: [0.5, 0, 8.4], from: "B" },
    STAR: { kind: "star", pos: [3.4, 0, 10.0], from: "C" },
    P2: { kind: "popper", pos: [6.3, 0, 8.6], from: "C" },
    DT: { kind: "turner", pos: [7.8, 0, 9.6], from: "C" },
    T4: { kind: "paper", pos: [6.8, 0, 6.2], from: "C" },
    T5: { kind: "paper", pos: [8.8, 0, 6.9], from: "C" },
  };
  const ZONE_POINTS = { A: 5, C: 3, D: 1, S: 5 }; // Minor (Production); S = steel
  const PAPER_KINDS = ["paper", "swinger", "turner"];
  const STEEL_COUNT = { popper: 1, rack: 6, star: 5 };
  const MAX_POINTS = Object.values(TARGETS).reduce(
    (sum, tg) =>
      sum +
      (PAPER_KINDS.includes(tg.kind) ? 10 : (STEEL_COUNT[tg.kind] ?? 0) * 5),
    0,
  );
  // [stage ms, target, zone, hit (paper: metres right/down of centre; steel: plate index)]
  const SHOTS = [
    [1050, "T1", "A", [-0.02, -0.06]],
    [1300, "T1", "A", [0.03, 0.02]],
    [1620, "T2", "A", [-0.04, -0.04]],
    [1880, "T2", "C", [-0.12, 0.1]],
    [2260, "P1", "S", 0],
    [3100, "SW", "A", [0.01, -0.05]],
    [3360, "SW", "C", [0.1, 0.08]],
    ...[0, 1, 2, 3, 4, 5].map((k) => [5750 + k * 200, "RACK", "S", k]),
    [7050, "T3", "A", [0.02, -0.03]],
    [7290, "T3", "A", [-0.03, 0.03]],
    [10300, "STAR", "S", 0],
    [10720, "STAR", "S", 1],
    [11180, "STAR", "S", 4],
    [11660, "STAR", "S", 2],
    [12160, "STAR", "S", 3],
    [12620, "P2", "S", 0],
    [13000, "DT", "A", [0.0, -0.04]],
    [13240, "DT", "A", [0.03, 0.03]],
    [13700, "T4", "A", [-0.02, -0.05]],
    [13930, "T4", "A", [0.03, 0.01]],
    [14300, "T5", "A", [0.01, -0.03]],
    [14540, "T5", "D", [0.19, 0.2]],
  ].map(([ms, target, zone, hit], i, list) => ({
    ms,
    st: ms / 1000,
    target,
    zone,
    hit,
    i,
    split: i ? ms - list[i - 1][0] : ms,
    points: ZONE_POINTS[zone],
  }));
  const MAG = 15; // Production: at most 15 rounds in a magazine at the start signal
  // Stage-time events (seconds).
  const EVENTS = {
    swingerRelease: 2.34,
    reload: [7.29, 7.45, 8.15, 8.55], // slide lock, magazine out, new magazine in, slide forward
    turnerRelease: 12.7,
    moves: [
      [3.48, 5.5, "A", "B"],
      [7.38, 10.18, "B", "C"],
    ],
  };
  // [from ms, to ms, playback rate]: slow motion below 1, fast forward above.
  const RAMPS = [
    [2850, 3450, 0.45],
    [3480, 5500, 2.8],
    [7380, 10180, 2.0],
    [10250, 12300, 0.8],
  ];
  function videoOfStage(ms) {
    let v = RESUME;
    let cur = FREEZE_MS;
    for (const [a, b, r] of RAMPS) {
      if (ms <= a) return v + (ms - cur) / 1000;
      v += (a - cur) / 1000;
      if (ms <= b) return v + (ms - a) / 1000 / r;
      v += (b - a) / 1000 / r;
      cur = b;
    }
    return v + (ms - cur) / 1000;
  }
  function stageOfVideo(t) {
    let v = RESUME;
    let cur = FREEZE_MS;
    for (const [a, b, r] of RAMPS) {
      const va = v + (a - cur) / 1000;
      if (t <= va) return cur + (t - v) * 1000;
      const vb = va + (b - a) / 1000 / r;
      if (t <= vb) return a + (t - va) * 1000 * r;
      v = vb;
      cur = b;
    }
    return cur + (t - v) * 1000;
  }
  const rateAt = (ms) =>
    (RAMPS.find(([a, b]) => ms >= a && ms < b) ?? [0, 0, 1])[2];
  SHOTS.forEach((s) => (s.t = videoOfStage(s.ms)));
  const STAGE_POINTS = SHOTS.reduce((sum, s) => sum + s.points, 0);
  const STAGE_MS = SHOTS[SHOTS.length - 1].ms;
  const STAGE_TIME = Math.round(STAGE_MS / 10) / 100; // a shot timer shows hundredths
  const HIT_FACTOR = STAGE_POINTS / STAGE_TIME;
  const STAGE_END = SHOTS[SHOTS.length - 1].t; // video time of the last shot
  // Everything after the stage moves later by SHIFT (kept on the 0.5 s beat grid).
  const SHIFT = Math.ceil((STAGE_END + 0.6 - 20) * 2) / 2;
  const DURATION = 28 + SHIFT;
  const vt = (ms) => videoOfStage(ms);

  // Stage time (ms) shown by the shot timer at video time t.
  function stageMs(t) {
    if (t < BEEP) return 0;
    if (t < FREEZE) return (t - BEEP) * 1000;
    if (t < RESUME) return FREEZE_MS;
    return Math.min(stageOfVideo(t), STAGE_MS);
  }

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
      t: 6.9,
      ko: "조준기",
      en: "Sights",
      sub: { ko: "아이언 사이트 vs 옵틱", en: "Iron sights vs optic" },
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
      sub: { ko: "롱 코스 · 무빙 타겟", en: "Long course · moving targets" },
    },
    {
      t: 20 + SHIFT,
      ko: "히트 팩터",
      en: "Hit factor",
      sub: { ko: "점수 ÷ 시간", en: "Points ÷ time" },
    },
    {
      t: 22.5 + SHIFT,
      ko: "레인지 클리어",
      en: "Range is clear",
      sub: { ko: "안전 확인", en: "Safety checks" },
    },
  ];

  const fmt2 = (ms) => (Math.round(ms / 10) / 100).toFixed(2);
  // width of a digits() string in units of its size
  const timeWidth = (str) =>
    [...str].reduce((w, ch) => w + (ch === "." || ch === " " ? 0.3 : 0.62), 0);

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
      7.9,
      "시간을 멈추고, 사수의 눈으로.",
      "Freeze the clock. See it through the shooter's eyes.",
    ],
    [
      8.1,
      10.45,
      "아이언 사이트 — 가늠자와 가늠쇠를 맞추고, 초점은 가늠쇠에.",
      "Iron sights: line up rear and front, and focus on the front sight.",
    ],
    [
      10.55,
      12.85,
      "옵틱 — 초점은 표적에. 디비전도 조준기에 따라 나뉩니다.",
      "Optic: focus on the target. Divisions are split by sights, too.",
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
      vt(2300) - 0.14,
      "프리스타일 — 해법은 선수가 정합니다.",
      "Freestyle: every competitor solves the stage their own way.",
    ],
    [
      vt(2300) + 0.16,
      vt(3450) - 0.08,
      "포퍼를 넘기면 스윙 타겟이 움직이기 시작합니다.",
      "Drop the popper and the swinger starts to move.",
    ],
    [
      vt(3480) + 0.19,
      vt(7290) - 0.03,
      "이동 중에도 총구는 180° 안에 — 포트 너머엔 플레이트 랙.",
      "On the move the muzzle stays inside the 180°. Then a plate rack, through a port.",
    ],
    [
      vt(7290) + 0.27,
      vt(10250) - 0.08,
      "15발 소진 — 이동하며 재장전.",
      "Fifteen rounds gone: reload on the move.",
    ],
    [
      vt(10250) + 0.22,
      vt(12620) - 0.27,
      "텍사스 스타 — 철판이 떨어질 때마다 별이 돌아갑니다.",
      "Texas Star: every plate that falls sets it spinning.",
    ],
    [
      vt(12620) + 0.03,
      STAGE_END + 0.55,
      "드롭 터너는 단 한 번 나타납니다. 마지막 한 발에 타이머가 멈춥니다.",
      "The drop turner shows itself once. The last shot stops the clock.",
    ],
    [
      20.1 + SHIFT,
      22.35 + SHIFT,
      "점수 ÷ 시간 = 히트 팩터. 스테이지는 가장 높은 히트 팩터가 이깁니다.",
      "Points ÷ time = hit factor. The highest hit factor wins the stage.",
    ],
    [
      22.6 + SHIFT,
      24.35 + SHIFT,
      "끝까지 안전하게 — 언로드, 쇼 클리어, 해머 다운.",
      "Safe to the very end — unload, show clear, hammer down.",
    ],
    [
      24.7 + SHIFT,
      27.2 + SHIFT,
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
    // line of sight, push in, split, settle, focus, a dry recoil, the divisions
    { t: 6.95, type: "blip", v: 0.45 },
    { t: 7.06, type: "tick", v: 0.45 },
    { t: 7.25, type: "tick", v: 0.45 },
    { t: 7.3, type: "blip", v: 0.6 },
    { t: 7.45, type: "riser", dur: 0.5 },
    { t: 8.0, type: "hit", v: 0.7 },
    { t: 9.22, type: "click", v: 0.7 },
    { t: 9.3, type: "blip", v: 0.6 },
    { t: 9.36, type: "blip", v: 0.5 },
    { t: 9.72, type: "whoosh", v: 0.35 },
    { t: 10.85, type: "whoosh", v: 0.5 },
    { t: 11.15, type: "tick", v: 0.7 },
    { t: 11.4, type: "tick", v: 0.7 },
    { t: 12.28, type: "whoosh", v: 0.45 },
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
    // the moving targets, the reload and the speed ramps
    { t: vt(EVENTS.swingerRelease * 1000), type: "clank", v: 0.7 },
    { t: vt(EVENTS.reload[1] * 1000), type: "clank", v: 0.45 },
    { t: vt(EVENTS.reload[2] * 1000), type: "click", v: 0.9 },
    { t: vt(EVENTS.reload[3] * 1000), type: "slide", v: 0.8 },
    { t: vt(EVENTS.turnerRelease * 1000), type: "clank", v: 0.7 },
    ...RAMPS.map(([ms, , rate]) => ({
      t: vt(ms),
      type: "whoosh",
      v: rate > 1 ? 0.65 : 0.4,
    })),
    { t: 19.95 + SHIFT, type: "whoosh", v: 0.8 },
    ...Array.from({ length: 9 }, (_, i) => ({
      t: 20.05 + SHIFT + i * 0.045,
      type: "tick",
      v: 0.3,
    })),
    { t: 20.5 + SHIFT, type: "hit", v: 0.7 },
    ...Array.from({ length: 10 }, (_, i) => ({
      t: 20.55 + SHIFT + i * 0.045,
      type: "tick",
      v: 0.3,
    })),
    { t: 21.0 + SHIFT, type: "hit", v: 1 },
    ...[21.5, 21.75, 22.0].map((t) => ({ t: t + SHIFT, type: "blip", v: 0.5 })),
    { t: 22.5 + SHIFT, type: "stab", v: 0.8 },
    { t: 22.62 + SHIFT, type: "slide", v: 0.6 },
    { t: 22.75 + SHIFT, type: "clank", v: 0.6 },
    { t: 23.25 + SHIFT, type: "stab", v: 0.8 },
    { t: 23.32 + SHIFT, type: "slide", v: 0.8 },
    { t: 23.47 + SHIFT, type: "click", v: 0.9 },
    { t: 24.0 + SHIFT, type: "stab", v: 1 },
    { t: 24.5 + SHIFT, type: "logo" },
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

  // CZ Shadow 2, right side, muzzle to the right, in millimetres. Outline,
  // trigger guard, grip panel and base pad are traced from a reference photo
  // (mirrored) and scaled to the 217 mm overall length; the slide rides
  // inside the frame rails, so only a narrow band of slide shows.
  const GUN = {
    cx: 108.5,
    cy: 80,
    muzzle: [217, 19.3],
    port: [119, 12.5],
    sight: [211.3, 1.2],
    barrel: rect(93, 12.4, 124, 13.8),
    slide: shape(
      "M 19.2,23.6 L 27.8,0.3 L 30.8,0.3 L 31.2,0.0 L 33.6,0.3 L 36.1,1.2 L 40.4,1.8 L 41.9,2.5 L 43.1,2.5 L 44.7,3.1 L 45.9,3.1 L 46.2,3.4 L 47.4,3.4 L 47.7,3.7 L 51.1,4.3 L 52.9,4.9 L 54.5,7.4 L 102.1,7.4 L 102.4,7.7 L 113.4,7.4 L 114.3,7.7 L 114.6,7.4 L 196.6,7.1 L 196.9,6.8 L 196.6,2.1 L 197.2,1.8 L 198.7,1.8 L 200.0,2.8 L 205.2,2.8 L 205.5,3.1 L 206.4,2.8 L 206.7,3.1 L 207.6,3.1 L 208.9,2.1 L 210.7,2.1 L 211.0,1.8 L 211.3,2.5 L 211.3,4.6 L 212.2,6.4 L 212.2,7.1 L 213.5,8.6 L 214.1,9.8 L 214.1,10.7 L 215.9,12.0 L 215.9,12.6 L 216.5,13.5 L 216.5,15.3 L 216.8,15.7 L 216.8,21.5 L 216.5,22.1 L 199.0,22.1 L 198.7,22.4 L 156.1,22.4 L 155.8,22.7 L 113.1,22.7 L 112.8,23.0 L 70.1,23.0 L 69.8,23.3 L 27.2,23.3 L 26.9,23.6 Z",
    ),
    port_: shape(
      "M 100,8.2 L 138,8.2 L 138,16.4 Q 138,17.6 136.8,17.6 L 101.2,17.6 Q 100,17.6 100,16.4 Z",
    ),
    hood: rect(102.5, 9.6, 33, 6.4),
    extractor: shape("M 86,10.6 L 99,10.6 L 99,13.4 L 86,13.4 Z"),
    frame: shape(
      "M 216.5,22.4 L 215.9,25.5 L 214.4,27.3 L 214.4,37.4 L 214.1,37.8 L 213.8,40.8 L 212.9,42.4 L 213.2,45.4 L 211.3,48.8 L 207.3,50.0 L 174.8,50.0 L 174.2,48.5 L 173.3,48.5 L 169.6,49.7 L 144.1,49.7 L 140.7,48.5 L 136.7,47.9 L 135.5,48.5 L 134.9,49.4 L 134.0,49.4 L 133.1,50.0 L 132.7,50.6 L 131.2,51.9 L 129.7,54.6 L 129.4,57.1 L 129.1,57.4 L 129.1,58.9 L 128.8,59.2 L 128.8,64.1 L 129.1,64.5 L 129.1,69.1 L 129.4,69.4 L 129.1,70.6 L 129.4,70.9 L 129.4,74.0 L 129.7,74.3 L 129.4,75.2 L 130.0,77.0 L 129.7,77.0 L 126.6,80.4 L 125.1,81.3 L 124.2,82.6 L 123.2,82.6 L 122.3,83.2 L 119.2,84.1 L 116.5,84.1 L 116.2,84.4 L 98.4,83.8 L 98.1,83.5 L 96.5,83.5 L 96.2,83.2 L 94.1,82.9 L 90.4,81.6 L 81.8,77.3 L 80.9,77.3 L 80.6,77.0 L 77.5,77.0 L 75.0,78.0 L 72.3,80.4 L 72.3,81.3 L 72.0,81.3 L 70.7,82.9 L 71.1,84.7 L 70.4,86.2 L 70.1,88.7 L 69.5,89.3 L 68.9,93.0 L 68.3,93.6 L 67.4,98.2 L 66.8,99.1 L 65.8,103.7 L 64.9,105.9 L 64.9,107.7 L 64.3,108.3 L 63.7,111.7 L 63.1,112.6 L 62.5,116.0 L 61.8,116.9 L 60.9,121.5 L 60.3,122.8 L 60.3,124.0 L 59.7,124.9 L 59.4,126.5 L 57.9,127.7 L 57.2,133.2 L 57.5,133.5 L 57.5,135.7 L 58.2,137.5 L 58.2,139.3 L 58.8,140.3 L 58.8,141.2 L 12.4,141.2 L 12.1,140.9 L 9.7,140.6 L 8.4,140.0 L 7.5,139.0 L 6.9,139.0 L 6.0,138.4 L 4.5,136.6 L 4.1,132.6 L 3.8,132.3 L 3.8,130.4 L 4.1,130.1 L 3.8,126.1 L 4.5,124.3 L 4.1,123.4 L 4.8,123.1 L 5.7,118.5 L 6.3,117.6 L 6.3,116.6 L 7.2,113.9 L 7.2,112.6 L 8.1,110.8 L 8.1,109.3 L 8.7,108.0 L 8.7,107.1 L 8.4,106.8 L 8.7,106.8 L 9.4,105.9 L 9.7,103.4 L 10.3,102.8 L 10.6,100.4 L 10.9,100.1 L 11.8,95.5 L 12.4,94.5 L 14.3,85.9 L 14.9,85.3 L 15.2,82.9 L 16.7,82.0 L 17.3,80.4 L 22.9,71.5 L 25.9,65.7 L 26.5,63.8 L 26.5,62.6 L 26.9,62.3 L 26.9,57.7 L 26.5,57.4 L 26.2,55.2 L 24.7,52.2 L 23.2,51.0 L 23.2,50.3 L 20.1,47.9 L 16.7,46.7 L 9.7,46.0 L 9.4,45.7 L 7.5,45.7 L 5.4,45.1 L 2.9,43.6 L 1.1,43.0 L 1.1,42.4 L 0.5,41.7 L 0.5,40.5 L 0.8,40.2 L 4.8,40.2 L 6.9,40.8 L 11.2,41.1 L 11.5,40.8 L 12.4,40.8 L 14.9,39.0 L 16.1,37.8 L 17.3,35.3 L 17.6,32.2 L 18.6,29.8 L 19.2,23.9 L 26.9,23.9 L 27.2,23.6 L 69.8,23.6 L 70.1,23.3 L 112.8,23.3 L 113.1,23.0 L 155.8,23.0 L 156.1,22.7 L 198.7,22.7 L 199.0,22.4 Z",
    ),
    guard: shape(
      "M 121.7,54.6 L 120.5,52.8 L 118.0,50.3 L 114.3,48.2 L 113.4,48.2 L 113.1,47.9 L 108.5,47.9 L 106.0,49.1 L 103.9,49.7 L 104.2,53.1 L 103.9,53.4 L 103.6,57.1 L 103.3,57.4 L 103.3,60.8 L 104.8,65.4 L 105.7,66.0 L 105.7,66.9 L 107.6,69.1 L 108.2,69.1 L 108.5,70.0 L 110.6,71.5 L 111.3,71.5 L 111.9,72.1 L 113.7,72.7 L 113.4,73.7 L 112.5,73.7 L 112.2,74.0 L 109.1,74.0 L 108.8,73.7 L 107.9,73.7 L 106.4,72.7 L 104.8,72.4 L 104.8,71.8 L 101.4,68.8 L 99.3,64.8 L 98.1,60.5 L 98.1,58.9 L 97.1,58.3 L 97.1,57.7 L 96.5,57.1 L 96.5,55.9 L 97.1,54.9 L 97.8,56.2 L 99.0,63.2 L 99.6,64.5 L 100.5,64.8 L 100.8,64.5 L 100.5,61.4 L 100.2,61.1 L 100.2,56.8 L 100.8,54.9 L 100.5,49.7 L 100.2,49.4 L 97.1,49.4 L 96.8,49.7 L 96.5,51.9 L 95.6,52.2 L 95.6,51.6 L 94.4,50.6 L 94.1,49.7 L 92.5,49.7 L 91.9,50.3 L 91.9,51.0 L 91.6,50.6 L 90.7,50.6 L 88.5,51.9 L 88.2,52.8 L 87.3,52.8 L 83.6,56.8 L 82.1,60.8 L 82.1,62.6 L 81.8,62.9 L 81.8,65.7 L 82.1,66.0 L 82.1,67.2 L 82.7,69.4 L 84.6,72.7 L 85.5,73.0 L 85.5,73.7 L 86.1,74.6 L 89.8,77.3 L 94.4,79.2 L 97.1,79.5 L 97.5,79.8 L 99.3,79.8 L 99.6,80.1 L 104.2,80.1 L 104.5,80.4 L 119.9,80.4 L 121.1,79.8 L 122.3,78.6 L 122.3,77.7 L 123.2,77.3 L 123.8,76.1 L 123.8,74.6 L 124.2,74.3 L 123.5,60.8 L 123.2,60.5 L 122.9,57.7 L 122.3,55.9 L 121.7,55.2 Z",
    ),
    grip: shape(
      "M 62.8,47.9 L 63.7,48.5 L 63.7,50.3 L 63.4,50.6 L 63.4,51.9 L 62.8,53.1 L 62.5,54.9 L 61.8,55.2 L 61.8,57.1 L 60.9,59.2 L 60.9,60.8 L 60.3,62.3 L 60.3,64.1 L 59.1,64.8 L 56.6,67.5 L 56.3,72.1 L 56.9,72.4 L 56.9,74.9 L 55.7,78.3 L 55.4,80.7 L 54.2,83.2 L 54.2,85.0 L 53.6,85.9 L 52.6,90.9 L 51.7,92.7 L 51.1,96.4 L 50.5,97.3 L 50.2,99.8 L 49.0,102.8 L 49.0,104.0 L 48.3,105.3 L 48.3,106.2 L 47.4,106.8 L 47.4,109.3 L 46.2,112.6 L 45.9,115.4 L 45.3,116.3 L 44.7,119.7 L 43.4,122.2 L 43.1,125.2 L 42.2,126.5 L 42.2,129.8 L 41.9,130.1 L 42.2,142.7 L 39.4,143.0 L 39.1,142.7 L 36.7,142.7 L 35.1,142.1 L 30.5,142.4 L 29.6,141.8 L 26.2,141.8 L 25.9,142.1 L 13.7,141.8 L 13.4,140.9 L 11.5,140.9 L 8.4,139.7 L 7.5,138.7 L 6.6,136.0 L 6.6,134.1 L 6.3,133.8 L 6.3,126.5 L 6.6,126.1 L 6.9,122.2 L 7.8,120.6 L 8.1,117.2 L 9.1,115.7 L 9.4,113.0 L 10.0,111.7 L 10.6,108.7 L 11.2,107.7 L 11.2,106.2 L 11.8,105.0 L 11.8,103.4 L 13.0,100.4 L 13.0,97.3 L 13.7,97.0 L 14.3,95.8 L 16.1,88.4 L 17.3,86.6 L 18.3,83.8 L 18.9,82.9 L 19.8,82.3 L 19.8,81.6 L 20.4,81.0 L 21.3,78.6 L 24.1,74.6 L 25.3,71.8 L 27.5,69.1 L 30.2,63.8 L 30.8,60.8 L 31.2,60.5 L 31.5,57.4 L 31.8,57.1 L 31.8,54.9 L 34.2,54.6 L 34.8,53.1 L 36.1,53.1 L 37.3,52.2 L 40.1,51.3 L 40.7,50.6 L 42.8,50.0 L 47.7,47.6 L 59.7,47.6 L 60.0,47.9 Z",
    ),
    hammer: shape(
      "M 27.5,0.3 L 24.7,8.3 L 24.1,9.2 L 23.8,10.7 L 23.2,11.7 L 22.9,13.2 L 22.3,14.1 L 21.9,15.7 L 21.3,16.6 L 21.0,18.1 L 20.4,19.0 L 19.8,19.0 L 18.0,14.1 L 18.0,10.1 L 19.2,8.6 L 19.5,8.9 L 21.9,8.9 L 24.1,8.3 L 24.7,3.7 L 25.3,3.1 L 26.2,0.9 L 26.9,0.3 Z",
    ),
    trigger: shape(
      "M 94.4,49.7 L 96.5,49.7 L 96.8,49.4 L 99.3,49.4 L 99.6,49.1 L 102.1,49.1 L 102.4,48.8 L 104.5,48.8 L 104.8,48.5 L 107.3,48.5 L 107.6,48.2 L 108.2,48.2 L 107.6,48.2 L 106.0,49.1 L 104.2,49.4 L 103.9,49.7 L 104.2,53.1 L 103.9,53.4 L 103.6,57.1 L 103.3,57.4 L 103.3,60.8 L 103.6,61.1 L 103.6,62.0 L 103.9,62.3 L 103.9,63.2 L 104.5,64.1 L 104.5,64.8 L 104.8,65.4 L 105.7,66.0 L 105.7,66.9 L 106.4,67.8 L 107.6,69.1 L 108.2,69.1 L 108.2,69.7 L 110.6,71.5 L 111.3,71.5 L 111.9,72.1 L 113.4,72.4 L 113.7,72.7 L 113.7,73.4 L 113.4,73.7 L 112.5,73.7 L 112.2,74.0 L 109.1,74.0 L 108.8,73.7 L 107.9,73.7 L 106.4,72.7 L 104.8,72.4 L 104.8,71.8 L 101.4,68.8 L 99.3,64.8 L 99.3,64.1 L 98.7,62.9 L 98.7,62.0 L 98.4,61.7 L 98.4,60.8 L 98.1,60.5 L 98.1,58.9 L 97.1,58.3 L 97.1,57.7 L 96.5,57.1 L 96.5,55.9 L 97.1,54.9 L 97.8,56.2 L 97.8,57.4 L 98.4,58.9 L 98.4,60.8 L 98.7,61.1 L 99.0,63.2 L 99.9,64.8 L 100.5,64.8 L 100.8,64.5 L 100.5,61.4 L 100.2,61.1 L 100.2,56.8 L 100.5,56.5 L 100.5,55.2 L 100.8,54.9 L 100.5,49.7 L 100.2,49.4 L 97.1,49.4 L 96.8,49.7 L 96.5,51.9 L 95.9,51.9 L 95.6,52.2 L 95.6,51.6 L 94.4,50.6 Z",
    ),
    hammerPivot: [20.4, 20.6],
    safety: shape(
      "M 58.5,32.5 L 54.2,31.6 L 41.9,32.5 L 35.8,35.6 L 33.3,37.8 L 34.5,39.6 L 39.4,39.9 L 48.6,39.3 L 54.8,40.5 L 57.5,37.4 Z",
    ),
    stopPin: [83.9, 31.9],
    screws: [
      [64.9, 67.5],
      [22.6, 93.6],
    ],
    magBody: shape("M 57.9,141.2 L 22.6,141.2 L 32.7,74.3 L 68.0,74.3 Z"),
    magPad: shape(
      "M 58.8,141.5 L 58.8,143.0 L 58.5,143.3 L 58.8,155.9 L 57.9,158.1 L 57.5,158.1 L 56.3,159.6 L 11.5,159.6 L 10.0,157.8 L 9.7,156.8 L 9.7,154.1 L 9.4,153.8 L 9.7,151.0 L 10.9,147.6 L 11.8,142.4 L 12.4,142.1 L 12.4,141.5 Z",
    ),
    magPivot: [36.4, 141.2],
    serrRear: [
      shape("M 64.3,11.0 L 61.8,20.0"),
      shape("M 59.9,11.0 L 57.4,20.0"),
      shape("M 55.4,11.0 L 52.9,20.0"),
      shape("M 50.8,11.0 L 48.3,20.0"),
      shape("M 46.2,11.0 L 43.7,20.0"),
      shape("M 41.4,11.0 L 39.0,20.0"),
      shape("M 37.1,11.0 L 34.7,20.0"),
      shape("M 32.7,11.0 L 30.2,20.0"),
    ],
    serrFront: [
      shape("M 192.1,11.0 L 188.1,21.8"),
      shape("M 187.2,11.0 L 183.2,21.8"),
      shape("M 182.2,11.0 L 178.2,21.8"),
      shape("M 177.3,11.0 L 173.3,21.8"),
      shape("M 172.2,11.0 L 168.2,21.8"),
      shape("M 167.1,11.0 L 163.1,21.8"),
      shape("M 162.4,11.0 L 158.4,21.8"),
      shape("M 157.5,11.0 L 153.5,21.8"),
    ],
    grooves: [
      shape("M 130.6,61.1 L 124.5,61.4"),
      shape("M 130.6,62.9 L 124.5,63.2"),
      shape("M 130.6,64.8 L 124.5,65.1"),
      shape("M 130.6,66.6 L 124.5,66.9"),
      shape("M 130.6,68.4 L 124.5,68.8"),
      shape("M 130.6,70.3 L 124.5,70.6"),
      shape("M 130.6,72.1 L 124.5,72.4"),
      shape("M 130.6,74.0 L 124.5,74.3"),
      shape("M 130.6,75.8 L 124.5,76.1"),
    ],
    rail: shape("M 204.6,45.4 L 140.1,45.4"),
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
      const g = (y0, y1, ...stops) => {
        const gr = ctx.createLinearGradient(0, y0, 0, y1);
        stops.forEach((c, k) => gr.addColorStop(k / (stops.length - 1), c));
        return gr;
      };
      const solidLayer = (fn) => {
        if (solid <= 0) return;
        ctx.save();
        ctx.globalAlpha *= solid;
        fn();
        ctx.restore();
      };
      const dot = (x, y, r, style) => {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = style;
        ctx.fill();
      };

      // The magazine: body behind the frame, base pad in front of it.
      const mag = o.mag;
      const [mpx, mpy] = GUN.magPivot;
      const withMag = (fn) => {
        ctx.save();
        if (mag) {
          ctx.translate(mpx + mag.dx, mpy + mag.dy);
          ctx.rotate(mag.rot);
          ctx.translate(-mpx, -mpy);
        }
        fn();
        ctx.restore();
      };
      if (mag) {
        withMag(() => solidLayer(() => fillShape(GUN.magBody, "#2a2e34")));
        if (blue > 0) withMag(() => strokeShape(GUN.magBody, blue * 0.6));
      }

      // Barrel, exposed at the muzzle once the slide is back.
      solidLayer(() =>
        fillShape(GUN.barrel, g(12.4, 26.2, "#9aa1aa", "#4a5059")),
      );

      // Hammer, cocked by the slide as it runs back.
      const [hx, hy] = GUN.hammerPivot;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(
        ((o.hammer ?? 0) * 38 - Math.min(slide, 6) * 2) * (Math.PI / 180),
      );
      ctx.translate(-hx, -hy);
      solidLayer(() => fillShape(GUN.hammer, "#2a2d32"));
      if (blue > 0) strokeShape(GUN.hammer, blue * 0.8);
      ctx.restore();

      // Frame: grey dust cover and rails, black trigger guard and grip.
      solidLayer(() => {
        tracePath(ctx, GUN.frame);
        tracePath2(GUN.guard);
        // grey dust cover and rails above ≈46 mm, black guard, grip and tang below
        const fg = ctx.createLinearGradient(0, 22, 0, 160);
        fg.addColorStop(0, "#73787f");
        fg.addColorStop(0.15, "#5c6168");
        fg.addColorStop(0.175, "#2a2d32");
        fg.addColorStop(0.2, "#212328");
        fg.addColorStop(1, "#16181b");
        ctx.fillStyle = fg;
        ctx.fill("evenodd");
        // front strap and trigger-guard grooves
        ctx.save();
        tracePath(ctx, GUN.frame);
        ctx.clip();
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.lineWidth = 0.6;
        GUN.grooves.forEach((sh) => {
          tracePath(ctx, sh);
          ctx.stroke();
        });
        tracePath(ctx, GUN.rail);
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.restore();
        // blue aluminium grip panel with checkering
        fillShape(GUN.grip, g(40, 140, "#3f74b3", "#2a548d"));
        ctx.save();
        tracePath(ctx, GUN.grip);
        ctx.clip();
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.lineWidth = 0.45;
        for (let k = -150; k < 120; k += 2.6) {
          ctx.beginPath();
          ctx.moveTo(k, 30);
          ctx.lineTo(k + 120, 150);
          ctx.moveTo(k + 120, 30);
          ctx.lineTo(k, 150);
          ctx.stroke();
        }
        ctx.restore();
        tracePath(ctx, GUN.grip);
        ctx.strokeStyle = "rgba(0,0,0,0.45)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        GUN.screws.forEach(([x, y]) => {
          dot(x, y, 2.3, "#1b1d21");
          dot(x, y, 0.9, "#4a4f57");
        });
        // ambidextrous safety and the slide-stop pin
        fillShape(GUN.safety, g(30, 41, "#3c4047", "#1d2024"));
        dot(GUN.stopPin[0], GUN.stopPin[1], 2.2, "#3a3e45");
        // trigger blade, then a rim light so the black frame reads on dark backgrounds
        fillShape(GUN.trigger, g(52, 78, "#5d636b", "#25282d"));
        tracePath(ctx, GUN.trigger);
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 0.8 * px;
        ctx.stroke();
        tracePath(ctx, GUN.frame);
        tracePath2(GUN.guard);
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 1.4 * px;
        ctx.stroke();
      });
      if (blue > 0) {
        strokeShape(GUN.frame, blue);
        strokeShape(GUN.guard, blue);
        strokeShape(GUN.grip, blue * 0.55, 1.2);
        strokeShape(GUN.safety, blue * 0.8);
        strokeShape(GUN.trigger, blue * 0.8);
        strokeShape(GUN.rail, blue * 0.45, 1);
        GUN.grooves.forEach((sh) => strokeShape(sh, blue * 0.35, 1));
      }

      // Slide: dark top strip over machined grey flanks.
      ctx.save();
      ctx.translate(-slide, 0);
      solidLayer(() => {
        fillShape(
          GUN.slide,
          g(0, 23.6, "#1c1e22", "#2c2f34", "#5d6168", "#7d828a", "#8f949b"),
        );
        fillShape(GUN.port_, "#0c0e11");
        if (slide < 4) fillShape(GUN.hood, g(9.6, 16, "#a7adb5", "#5d636c"));
        fillShape(GUN.extractor, "#2b2f36");
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.lineWidth = 1.1;
        [...GUN.serrRear, ...GUN.serrFront].forEach((sh) => {
          tracePath(ctx, sh);
          ctx.stroke();
        });
        line(32, 7.9, 197, 7.9, "rgba(255,255,255,0.28)", 0.5);
      });
      if (blue > 0) {
        strokeShape(GUN.slide, blue);
        strokeShape(GUN.port_, blue * 0.8);
        strokeShape(GUN.extractor, blue * 0.5, 1.1);
        [...GUN.serrRear, ...GUN.serrFront].forEach((sh) =>
          strokeShape(sh, blue * 0.45, 1),
        );
      }
      // fibre-optic front sight
      const glow = o.fiber ?? 1;
      if (glow > 0) {
        const [fx, fy] = GUN.sight;
        const gr = ctx.createRadialGradient(fx, fy, 0, fx, fy, 6);
        gr.addColorStop(0, rgba(C.red, 0.85 * glow));
        gr.addColorStop(1, rgba(C.red, 0));
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(fx, fy, 6, 0, Math.PI * 2);
        ctx.fill();
        dot(fx, fy, 1.3, `rgba(255,90,110,${glow})`);
      }
      ctx.restore();

      // Base pad, always in place unless the magazine is dropping.
      withMag(() =>
        solidLayer(() =>
          fillShape(GUN.magPad, g(141, 160, "#34383e", "#16181b")),
        ),
      );
      if (blue > 0) withMag(() => strokeShape(GUN.magPad, blue));

      // A soft highlight sweeping along the metal.
      if (o.sheen > 0 && o.sheen < 1 && solid > 0) {
        const lx = lerp(250, -40, o.sheen);
        const sg = ctx.createLinearGradient(lx - 28, 0, lx + 28, 0);
        sg.addColorStop(0, "rgba(255,255,255,0)");
        sg.addColorStop(0.5, "rgba(255,255,255,0.22)");
        sg.addColorStop(1, "rgba(255,255,255,0)");
        ctx.save();
        ctx.globalAlpha *= solid;
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = sg;
        tracePath(ctx, GUN.frame);
        tracePath2(GUN.guard);
        ctx.fill("evenodd");
        tracePath(ctx, GUN.magPad);
        ctx.fill();
        ctx.translate(-slide, 0);
        tracePath(ctx, GUN.slide);
        ctx.fill();
        ctx.restore();
      }

      // Bore axis as a technical centre line.
      if (blue > 0) {
        ctx.setLineDash([6 * px, 3 * px, 1.5 * px, 3 * px]);
        line(
          -6,
          GUN.muzzle[1],
          -6 + 232 * drawOn,
          GUN.muzzle[1],
          rgba(C.red, 0.55 * blue),
          px,
        );
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
    function camera(pos, look, fov, roll = 0) {
      const f = norm(sub(look, pos));
      let r = norm(cross(UP, f));
      let u = cross(f, r);
      if (roll) {
        const c = Math.cos(roll);
        const s = Math.sin(roll);
        [r, u] = [add(mul(r, c), mul(u, s)), sub(mul(u, c), mul(r, s))];
      }
      return { pos, f, r, u, focal: H / 2 / Math.tan((fov * Math.PI) / 360) };
    }
    // Clip a segment against the near plane; null when it is wholly behind.
    function clipSeg(cam, a, b, near = 0.3) {
      const za = dot(sub(a, cam.pos), cam.f);
      const zb = dot(sub(b, cam.pos), cam.f);
      if (za < near && zb < near) return null;
      if (za < near) a = add(a, mul(sub(b, a), (near - za) / (zb - za)));
      else if (zb < near) b = add(b, mul(sub(a, b), (near - zb) / (za - zb)));
      return [a, b];
    }
    // Clip a polygon against the near plane so close cameras can pass by it.
    function clipNear(cam, pts, near = 0.3) {
      const depth = (p) => dot(sub(p, cam.pos), cam.f);
      if (pts.every((p) => depth(p) >= near)) return pts;
      const out = [];
      pts.forEach((a, k) => {
        const b = pts[(k + 1) % pts.length];
        const za = depth(a);
        const zb = depth(b);
        if (za >= near) out.push(a);
        if (za >= near !== zb >= near)
          out.push(add(a, mul(sub(b, a), (near - za) / (zb - za))));
      });
      return out;
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
      pts = clipNear(cam, pts);
      if (pts.length < 2) return;
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
      const a = 1 - seg(t, DURATION - 1.4, DURATION - 0.8);
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
        text("STAGE 01 — LONG COURSE", W - 96, 92, {
          size: 14,
          weight: 700,
          tracking: 2,
          align: "right",
        });
        text(
          `${SHOTS.length} ROUNDS · ${MAX_POINTS} POINTS · COMSTOCK`,
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
      if (t < 6.52 || t > 20.4 + SHIFT) return;
      const ms = stageMs(t);
      const a = (t < 6.8 ? 1 : 1) * (1 - seg(t, 19.95 + SHIFT, 20.0 + SHIFT));
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
      // push into the rear sight: the camera becomes the shooter's eye
      const p = ease.inExpo(seg(t, 7.42, 8.0));
      if (p > 0) {
        const [rx, ry] = [39, 2];
        const fx = x + (rx - GUN.cx) * s;
        const fy = y + (ry - GUN.cy) * s;
        const ns = lerp(s, 34, p);
        x = lerp(fx, W / 2, p) - (rx - GUN.cx) * ns;
        y = lerp(fy, 430, p) - (ry - GUN.cy) * ns;
        s = ns;
      }
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
        drawGun({
          ...pose,
          alpha: 1 - seg(t, 7.82, 8.02),
          fiber: 1 - seg(t, 6.88, 7.0),
        });
      }
      // big timer that flies to the HUD
      const fly = ease.inOut3(seg(t, 6.26, 6.52));
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

    // Line of sight: eye, rear sight, front sight and target on one red line.
    function sceneLineOfSight(t) {
      if (t < 6.9 || t > 7.7) return;
      const o = gunPose(6.85);
      const R = gunPoint(o, 39, 0.4);
      const F = gunPoint(o, 211, 0.6);
      const E = [R[0] - 300, R[1] - 2];
      const T = [1760, R[1] + 6];
      const tip = ease.inOut3(seg(t, 6.95, 7.28));
      const fade = 1 - seg(t, 7.42, 7.62);
      ctx.save();
      ctx.globalAlpha = fade;
      // eye
      const ea = ease.out3(seg(t, 6.9, 7.05));
      ctx.globalAlpha = fade * ea;
      ctx.strokeStyle = C.white;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(E[0] - 32, E[1]);
      ctx.quadraticCurveTo(E[0], E[1] - 26, E[0] + 32, E[1]);
      ctx.quadraticCurveTo(E[0], E[1] + 26, E[0] - 32, E[1]);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(E[0] + 4, E[1], 9, 0, Math.PI * 2);
      ctx.fillStyle = C.white;
      ctx.fill();
      ctx.globalAlpha = fade;
      // the line, with a bright head
      const x = lerp(E[0] + 36, T[0], tip);
      const yAt = (px) => lerp(E[1], T[1], (px - E[0]) / (T[0] - E[0]));
      if (tip > 0) {
        line(E[0] + 36, yAt(E[0] + 36), x, yAt(x), C.red, 4);
        if (tip < 1) {
          const g = ctx.createRadialGradient(x, yAt(x), 0, x, yAt(x), 22);
          g.addColorStop(0, "rgba(255,230,235,0.95)");
          g.addColorStop(1, rgba(C.red, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, yAt(x), 22, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // target glyph at the far end
      const ta = ease.out3(seg(t, 7.18, 7.3));
      if (ta > 0) {
        ctx.save();
        ctx.globalAlpha *= ta;
        drawTarget(T[0], T[1] + 6 * 1.7, 1.7, { letters: 0 });
        ctx.restore();
      }
      // nodes and labels as the line reaches each point
      const lock = 1 - Math.abs(t - 7.3) / 0.05;
      const lang = opt.lang === "en" ? "en" : "ko";
      [
        [R, "가늠자", "REAR SIGHT"],
        [F, "가늠쇠", "FRONT SIGHT"],
        [T, "표적", "TARGET"],
      ].forEach(([P, ko, en], k) => {
        if (x < P[0] - 2) return;
        const at = 6.95 + 0.33 * ((P[0] - E[0]) / (T[0] - E[0]));
        const pop = ease.outBack(seg(t, at, at + 0.15));
        const ring = seg(t, at, at + 0.3);
        ctx.strokeStyle = rgba(C.red, 1 - ring);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(P[0], P[1], 10 + ring * 24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = lock > 0 ? C.white : C.red;
        ctx.beginPath();
        ctx.arc(P[0], P[1], 10 * pop, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.white;
        ctx.beginPath();
        ctx.arc(P[0], P[1], 4 * pop, 0, Math.PI * 2);
        ctx.fill();
        const la = ease.out3(seg(t, at, at + 0.2)) * (1 - seg(t, 7.36, 7.46));
        ctx.save();
        ctx.globalAlpha *= la;
        const align = "center";
        const lx = P[0];
        const ly = k === 2 ? P[1] + 128 : P[1] - 40;
        text(lang === "en" ? en : ko, lx, ly, {
          size: lang === "en" ? 18 : 26,
          weight: 700,
          tracking: lang === "en" ? 2 : 0,
          align,
          family: lang === "en" ? SANS : KR,
        });
        if (lang !== "en")
          text(en, lx, ly + 18, {
            size: 12,
            weight: 700,
            tracking: 2,
            color: C.dim,
            align,
          });
        ctx.restore();
      });
      ctx.restore();
    }

    // S3 — iron sights or an optic: the same shot pair through both.
    const SIGHT = {
      t0: 7.75,
      open: 8.05,
      settle: 9.3,
      recoil: 9.75, // a dry recoil cycle: the clock is frozen, nothing is fired
      zoom: 10.9,
      lower: 12.3,
      out: 12.75,
    };
    const canBlur = "filter" in CanvasRenderingContext2D.prototype;

    // Draw fn() softened, with a cheap fallback where canvas filters are missing.
    function soft(radius, fn) {
      if (radius <= 0.3) return fn();
      if (canBlur) {
        ctx.save();
        ctx.filter = `blur(${radius.toFixed(1)}px)`;
        fn();
        ctx.restore();
        return;
      }
      ctx.save();
      const a = ctx.globalAlpha;
      [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ].forEach(([dx, dy]) => {
        ctx.save();
        ctx.globalAlpha = a * 0.3;
        ctx.translate(dx * radius * 0.6, dy * radius * 0.6);
        fn();
        ctx.restore();
      });
      ctx.restore();
    }

    // Recoil of the sight picture dt seconds into the cycle: lift (px) and tilt.
    function kick(dt) {
      if (dt < 0 || dt > 0.5) return { lift: 0, tilt: 0 };
      const up =
        dt < 0.07
          ? ease.out3(dt / 0.07)
          : 1 - ease.inOut3(clamp((dt - 0.07) / 0.42));
      return { lift: up * 110, tilt: up * 0.03 };
    }

    const metal = (y0, y1) => {
      const gr = ctx.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, "#3a3f46");
      gr.addColorStop(0.15, "#1d2024");
      gr.addColorStop(1, "#0d0e10");
      return gr;
    };
    // The pistol from behind (origin: top of the rear notch): slide, then the
    // shooter's two-handed grip.
    function rearSlide(rim = 0.1) {
      const hands = ctx.createLinearGradient(0, 260, 0, 980);
      hands.addColorStop(0, "#1a1c20");
      hands.addColorStop(1, "rgba(14,15,18,0.92)");
      ctx.fillStyle = hands;
      ctx.beginPath();
      ctx.moveTo(-150, 300);
      ctx.quadraticCurveTo(-250, 330, -330, 560);
      ctx.lineTo(-470, 980);
      ctx.lineTo(470, 980);
      ctx.lineTo(330, 560);
      ctx.quadraticCurveTo(250, 330, 150, 300);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${rim})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      // thumbs forward along the frame
      ctx.fillStyle = "#202328";
      [-1, 1].forEach((side) => {
        ctx.beginPath();
        ctx.ellipse(side * 150, 360, 46, 120, side * 0.12, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = metal(150, 420);
      ctx.beginPath();
      ctx.moveTo(-170, 150);
      ctx.lineTo(170, 150);
      ctx.lineTo(176, 420);
      ctx.lineTo(-176, 420);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${rim + 0.02})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      for (let k = 0; k < 8; k++) {
        line(
          -160 + k * 2,
          190 + k * 26,
          -148 + k * 2,
          190 + k * 26,
          "rgba(0,0,0,0.6)",
          6,
        );
        line(
          160 - k * 2,
          190 + k * 26,
          148 - k * 2,
          190 + k * 26,
          "rgba(0,0,0,0.6)",
          6,
        );
      }
      ctx.fillStyle = "#16181b";
      ctx.beginPath();
      ctx.roundRect(-34, 250, 68, 120, 20);
      ctx.fill();
    }
    function frontPost(px, y, a = 1) {
      ctx.fillStyle = `rgba(27,29,33,${a})`;
      ctx.fillRect(px - 22, y, 44, 150);
      ctx.fillStyle = `rgba(255,255,255,${0.55 * a})`;
      ctx.fillRect(px - 22, y, 44, 3);
      ctx.fillStyle = `rgba(255,255,255,${0.16 * a})`;
      ctx.fillRect(px - 22, y, 3, 150);
    }
    function rearSight() {
      // rear sight block with its square notch
      ctx.fillStyle = metal(0, 150);
      ctx.beginPath();
      ctx.moveTo(-270, 0);
      ctx.lineTo(-38, 0);
      ctx.lineTo(-38, 64);
      ctx.lineTo(38, 64);
      ctx.lineTo(38, 0);
      ctx.lineTo(270, 0);
      ctx.lineTo(250, 150);
      ctx.lineTo(-250, 150);
      ctx.closePath();
      ctx.fill();
      line(-270, 1, -38, 1, "rgba(255,255,255,0.3)", 2);
      line(38, 1, 270, 1, "rgba(255,255,255,0.3)", 2);
    }
    // The stage seen through the shooter's eyes: sights on the point being
    // worked, lifting with each shot.
    function povGun(x, y, G, dt) {
      const rk = kick(dt);
      ctx.save();
      ctx.translate(x, y - rk.lift * G * 1.4);
      ctx.rotate(rk.tilt);
      ctx.scale(G, G);
      frontPost(0, -rk.lift * 0.5);
      rearSlide(0.32);
      rearSight();
      ctx.restore();
    }

    // One first-person sight picture, centred on cx. kind: "iron" | "optic".
    function sightView(t, kind, cx, zoom) {
      const aimY = 430; // the A zone centre sits here when the sights are on
      const s = 6.4; // target px per cm
      const G = 0.56; // the gun's scale in the sight picture
      const tgtY = aimY + 6 * s; // target centre (A zone centre is 6 cm above it)
      const settle = ease.inOut3(seg(t, SIGHT.open, SIGHT.settle));
      const wob = (1 - settle) * (kind === "iron" ? 46 : 34);
      let sx =
        Math.sin(t * 4.7 + (kind === "iron" ? 0 : 1.3)) * wob +
        (kind === "iron" ? (1 - settle) * 70 : 0);
      let sy =
        Math.cos(t * 3.9 + (kind === "iron" ? 0.6 : 2.1)) * wob * 0.7 +
        (kind === "iron" ? (1 - settle) * 60 : 0);
      const rk = kick(t - SIGHT.recoil);
      sy -= rk.lift;
      const tilt = rk.tilt;
      // at the end both guns lower out of frame, leaving two bare targets
      const lowered = ease.in3(seg(t, SIGHT.lower, SIGHT.lower + 0.35));
      sy += 760 * lowered;
      // the range behind: horizon glow, floor lines, the target on its stand
      const hz = 640;
      const sky = ctx.createLinearGradient(0, 160, 0, hz);
      sky.addColorStop(0, "#0f1216");
      sky.addColorStop(1, "#1a1e24");
      ctx.fillStyle = sky;
      ctx.fillRect(cx - 480, 0, 960, hz);
      ctx.fillStyle = "#0c0e11";
      ctx.fillRect(cx - 480, hz, 960, H - hz);
      for (let k = -8; k <= 8; k++)
        line(cx + k * 30, hz, cx + k * 190, H, "rgba(255,255,255,0.05)", 1);
      line(cx - 480, hz, cx + 480, hz, "rgba(255,255,255,0.12)", 1);
      ctx.save();
      ctx.translate(cx, 330);
      ctx.scale(zoom, zoom);
      ctx.translate(-cx, -330);
      const drawRange = () => {
        line(
          cx - 80,
          tgtY + 29 * s,
          cx - 80,
          hz + 40,
          "rgba(150,120,80,0.9)",
          4,
        );
        line(
          cx + 80,
          tgtY + 29 * s,
          cx + 80,
          hz + 40,
          "rgba(150,120,80,0.9)",
          4,
        );
        drawTarget(cx, tgtY, s, { letters: 0.9 });
      };
      // iron sights: the eye focuses on the front sight, the target goes soft
      soft(kind === "iron" ? (5 * settle + 1.5) * (1 - lowered) : 0, drawRange);

      ctx.save();
      ctx.translate(cx + sx, aimY + sy);
      ctx.rotate(tilt);
      ctx.scale(G, G);
      if (kind === "iron") {
        // front post: equal height, equal light in the rear notch
        const align = settle;
        const px = lerp(48, 0, align);
        // under recoil the post climbs out of the notch, then settles back
        const postLift = (dt) => kick(dt).lift * 1.15;
        const py = lerp(-52, 0, align) - postLift(t - SIGHT.recoil);
        [3, 2, 1].forEach((k) => {
          const d = t - SIGHT.recoil - k * 0.03;
          if (d > 0 && d < 0.5)
            frontPost(px, lerp(-52, 0, align) - postLift(d), 0.1 * (4 - k));
        });
        frontPost(px, py);
        rearSlide();
        rearSight();
      } else {
        // a slide-mounted red dot: the eye stays on the target, the housing goes soft
        soft(2.5 * settle, () => {
          rearSlide();
          ctx.fillStyle = metal(-140, 150);
          ctx.beginPath();
          ctx.moveTo(-200, 150);
          ctx.lineTo(-176, -110);
          ctx.quadraticCurveTo(-170, -150, -126, -150);
          ctx.lineTo(126, -150);
          ctx.quadraticCurveTo(170, -150, 176, -110);
          ctx.lineTo(200, 150);
          ctx.closePath();
          ctx.moveTo(-136, 84);
          ctx.lineTo(-146, -96);
          ctx.quadraticCurveTo(-146, -116, -120, -116);
          ctx.lineTo(120, -116);
          ctx.quadraticCurveTo(146, -116, 146, -96);
          ctx.lineTo(136, 84);
          ctx.closePath();
          ctx.fill("evenodd");
          ctx.strokeStyle = "rgba(255,255,255,0.16)";
          ctx.lineWidth = 2;
          ctx.stroke();
        });
        const glass = ctx.createLinearGradient(-140, -116, 140, 84);
        glass.addColorStop(0, "rgba(120,170,255,0.10)");
        glass.addColorStop(0.55, "rgba(120,170,255,0.03)");
        glass.addColorStop(1, "rgba(255,190,120,0.08)");
        ctx.fillStyle = glass;
        ctx.beginPath();
        ctx.moveTo(-136, 84);
        ctx.lineTo(-146, -96);
        ctx.quadraticCurveTo(-146, -116, -120, -116);
        ctx.lineTo(120, -116);
        ctx.quadraticCurveTo(146, -116, 146, -96);
        ctx.lineTo(136, 84);
        ctx.closePath();
        ctx.fill();
        line(-110, -100, -40, -100, "rgba(255,255,255,0.12)", 3);
      }
      ctx.restore();

      if (kind === "optic") {
        // the dot rides with the gun; its track shows the recoil
        const dx = cx + sx;
        const dy = aimY + sy;
        const dt = t - SIGHT.recoil;
        if (dt > 0 && dt < 0.6) {
          const top = aimY - kick(Math.min(dt, 0.07)).lift;
          ctx.strokeStyle = rgba(C.red, 0.55 * (1 - dt / 0.6));
          ctx.lineWidth = 6;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(cx, aimY);
          ctx.lineTo(cx + 4, top);
          ctx.stroke();
          ctx.lineCap = "butt";
        }
        const glow = ctx.createRadialGradient(dx, dy, 0, dx, dy, 30);
        glow.addColorStop(0, rgba(C.red, 0.85));
        glow.addColorStop(1, rgba(C.red, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(dx, dy, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ff6b7d";
        ctx.beginPath();
        ctx.arc(dx, dy, 7, 0, Math.PI * 2);
        ctx.fill();
      }

      // focus brackets: where the eye goes
      const fa =
        ease.outBack(seg(t, SIGHT.settle - 0.1, SIGHT.settle + 0.25)) *
        (1 - seg(t, SIGHT.lower - 0.1, SIGHT.lower + 0.08));
      if (fa > 0) {
        const [bx, by, bw, bh] =
          kind === "iron"
            ? [cx + sx, aimY + sy + 18, 84, 84]
            : [cx, tgtY, 23 * s * 2 + 34, 29 * s * 2 + 34];
        const grow = lerp(1.6, 1, fa);
        const hw = (bw / 2) * grow;
        const hh = (bh / 2) * grow;
        ctx.save();
        ctx.globalAlpha *= clamp(fa);
        ctx.strokeStyle = C.white;
        ctx.lineWidth = 3;
        const L = 22;
        [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ].forEach(([ix, iy]) => {
          ctx.beginPath();
          ctx.moveTo(bx + ix * hw, by + iy * hh - iy * L);
          ctx.lineTo(bx + ix * hw, by + iy * hh);
          ctx.lineTo(bx + ix * hw - ix * L, by + iy * hh);
          ctx.stroke();
        });
        const lang = opt.lang === "en" ? "en" : "ko";
        const label =
          kind === "iron"
            ? ["초점 · 가늠쇠", "FOCUS · FRONT SIGHT"]
            : ["초점 · 표적", "FOCUS · TARGET"];
        text(lang === "en" ? label[1] : label[0], bx + hw + 14, by + hh - 4, {
          size: 18,
          weight: 700,
          tracking: lang === "en" ? 2 : 0,
          family: lang === "en" ? SANS : KR,
        });
        ctx.restore();
      }
      ctx.restore();
    }

    function sceneSights(t) {
      if (t < SIGHT.t0 || t > 13.2) return;
      const open = ease.inOut3(seg(t, SIGHT.t0, SIGHT.open));
      const out = ease.in3(seg(t, SIGHT.out, 13.0));
      const zoom = ease.inOut3(seg(t, SIGHT.zoom, SIGHT.zoom + 0.45));
      ctx.save();
      ctx.globalAlpha = 1 - out;
      // both halves open out from the centre line
      const half = (W / 2) * open;
      [
        ["iron", W / 4],
        ["optic", (W * 3) / 4],
      ].forEach(([kind, cx], k) => {
        ctx.save();
        ctx.beginPath();
        if (k === 0) ctx.rect(W / 2 - half, 0, half, H);
        else ctx.rect(W / 2, 0, half, H);
        ctx.clip();
        sightView(t, kind, cx, lerp(1, 0.8, zoom));
        ctx.restore();
      });
      if (open > 0 && open < 1)
        line(W / 2 - half, 0, W / 2 - half, H, C.red, 3);
      if (open > 0 && open < 1)
        line(W / 2 + half, 0, W / 2 + half, H, C.red, 3);
      line(W / 2, 0, W / 2, H, "rgba(255,255,255,0.35)", 2);

      // titles
      const lt = t - SIGHT.open;
      const lang = opt.lang === "en" ? "en" : "ko";
      [
        [
          96,
          "IRON SIGHTS",
          "아이언 사이트 — 가늠자와 가늠쇠",
          "Rear notch and front post",
        ],
        [
          W / 2 + 96,
          "OPTIC",
          "옵틱 — 슬라이드에 장착한 도트 사이트",
          "A slide-mounted red dot",
        ],
      ].forEach(([x, title, ko, en]) => {
        kinetic(title, x, 236, {
          size: 64,
          t: lt,
          out: t - SIGHT.out,
          tracking: -1.5,
          stagger: 0.02,
        });
        ctx.save();
        ctx.globalAlpha *= ease.out3(seg(lt, 0.25, 0.55)) * (1 - out);
        text(lang === "en" ? en : ko, x + 2, 274, {
          size: 18,
          weight: 600,
          color: C.dim,
          family: lang === "en" ? SANS : KR,
        });
        ctx.restore();
      });

      // the two divisions this difference creates
      const chips = [
        [W / 4, "PRODUCTION", "아이언 사이트만 허용", "Iron sights only"],
        [
          (W * 3) / 4,
          "PRODUCTION OPTICS",
          "프로덕션 목록 권총 + 슬라이드 장착 옵틱",
          "Production-list handgun + slide-mounted optic",
        ],
      ];
      chips.forEach(([cx, name, ko, en], k) => {
        const at = SIGHT.zoom + 0.25 + k * 0.25;
        const p = ease.outBack(seg(t, at, at + 0.35));
        if (p <= 0) return;
        ctx.save();
        ctx.globalAlpha *= clamp(p) * (1 - out);
        ctx.translate(cx, 806);
        ctx.scale(lerp(0.85, 1, clamp(p)), lerp(0.85, 1, clamp(p)));
        const w = 520;
        ctx.fillStyle = "rgba(10,12,15,0.86)";
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-w / 2, -58, w, 116, 10);
        ctx.fill();
        ctx.stroke();
        text("IPSC HANDGUN DIVISION", 0, -24, {
          size: 13,
          weight: 700,
          tracking: 3,
          color: C.red,
          align: "center",
        });
        text(name, 0, 18, {
          size: 38,
          weight: 800,
          tracking: -0.5,
          align: "center",
        });
        text(lang === "en" ? en : ko, 0, 46, {
          size: 17,
          weight: 500,
          color: C.dim,
          align: "center",
          family: lang === "en" ? SANS : KR,
        });
        ctx.restore();
      });
      // neither side is "the" optics division
      ctx.save();
      ctx.globalAlpha *=
        ease.out3(seg(t, SIGHT.zoom + 0.8, SIGHT.zoom + 1.1)) * (1 - out);
      text(
        lang === "en"
          ? "Optics and Open also allow optics"
          : "옵틱스 · 오픈 디비전도 옵틱 허용",
        (W * 3) / 4,
        896,
        {
          size: 15,
          weight: 600,
          color: C.dim,
          align: "center",
          family: lang === "en" ? SANS : KR,
        },
      );
      ctx.restore();
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

    // S5 — the long course in 3D, driven by stage time (seconds) so speed ramps
    // slow or speed up every motion together.
    const lerp3 = (a, b, p) => [
      lerp(a[0], b[0], p),
      lerp(a[1], b[1], p),
      lerp(a[2], b[2], p),
    ];
    const WALL_B = {
      z: 3.4,
      x: [-2.7, 0.7],
      h: 2.1,
      port: [
        [-1.55, 0.9],
        [-0.45, 1.75],
      ],
    };
    const CTRL = { AB: [-4.6, 0, 1.7], BC: [2.4, 0, 0.4] };
    function moveAt(st) {
      return EVENTS.moves.find(([a, b]) => st >= a && st <= b);
    }
    function shooterPos(st) {
      let pos = AREAS.A.pos;
      for (const [a, b, from, to] of EVENTS.moves) {
        if (st < a) break;
        const p = ease.inOut3(seg(st, a, b));
        const A = AREAS[from].pos;
        const B = AREAS[to].pos;
        const c = CTRL[from + to];
        const u = 1 - p;
        pos = [
          u * u * A[0] + 2 * u * p * c[0] + p * p * B[0],
          0,
          u * u * A[2] + 2 * u * p * c[2] + p * p * B[2],
        ];
      }
      return pos;
    }
    function targetFrame(key) {
      const tg = TARGETS[key];
      const from = AREAS[tg.from].pos;
      const n = norm([from[0] - tg.pos[0], 0, from[2] - tg.pos[2]]);
      return { n, right: cross(n, UP) };
    }

    // Swinger: a paper target on a pendulum, held aside until the popper
    // releases it, then swinging past a barrier that hides its rest position.
    const SWING = { L: 1.05, pivot: 2.45, theta0: 1.15, period: 1.5 };
    function swingAngle(st) {
      const tau = st - EVENTS.swingerRelease;
      if (tau < 0) return SWING.theta0;
      return (
        SWING.theta0 *
        Math.cos(((2 * Math.PI) / SWING.period) * tau) *
        Math.exp(-0.18 * tau)
      );
    }
    function swingerPose(st) {
      const tg = TARGETS.SW;
      const { right } = targetFrame("SW");
      const th = swingAngle(st);
      const pivot = [tg.pos[0], SWING.pivot, tg.pos[2]];
      const centre = add(add(pivot, mul(right, Math.sin(th) * SWING.L)), [
        0,
        -Math.cos(th) * SWING.L,
        0,
      ]);
      return { pivot, centre, th, right };
    }
    // Drop turner: edge-on until released, turns to face the shooter, then away.
    function turnerAngle(st) {
      const r = EVENTS.turnerRelease;
      if (st < r) return Math.PI / 2;
      if (st < r + 0.3)
        return lerp(Math.PI / 2, 0, ease.out3(seg(st, r, r + 0.3)));
      if (st < r + 0.85) return 0;
      return lerp(0, -Math.PI / 2, ease.inOut3(seg(st, r + 0.85, r + 1.4)));
    }
    // Texas Star: five plates on a free hub. Removing plates unbalances it, so it
    // spins; integrated from the first hit with a fixed step for determinism.
    const STAR = { hub: 1.62, r: 0.56, plate: 0.1 };
    const starHits = SHOTS.filter((s) => s.target === "STAR");
    function starState(st) {
      const gone = new Set();
      let phi = 0;
      let w = 0;
      const dt = 1 / 240;
      let tt = starHits[0].st;
      if (st > tt) {
        for (; tt < st; tt += dt) {
          starHits.forEach((h) => tt >= h.st + 0.02 && gone.add(h.hit));
          let torque = 0;
          let n = 0;
          for (let k = 0; k < 5; k++) {
            if (gone.has(k)) continue;
            torque -= Math.cos(phi + Math.PI / 2 + (k * 2 * Math.PI) / 5);
            n++;
          }
          const alpha = (9.81 / STAR.r) * (torque / (n + 0.8)) - 0.9 * w;
          w += alpha * dt;
          phi += w * dt;
        }
      }
      starHits.forEach((h) => st >= h.st + 0.02 && gone.add(h.hit));
      return { phi, gone };
    }
    function starPlate(state, k) {
      const tg = TARGETS.STAR;
      const { right } = targetFrame("STAR");
      const a = state.phi + Math.PI / 2 + (k * 2 * Math.PI) / 5;
      return add(
        add([tg.pos[0], STAR.hub, tg.pos[2]], mul(right, Math.cos(a) * STAR.r)),
        [0, Math.sin(a) * STAR.r, 0],
      );
    }
    function rackPlate(k) {
      const tg = TARGETS.RACK;
      const { right } = targetFrame("RACK");
      return add([tg.pos[0], 1.12, tg.pos[2]], mul(right, -0.75 + k * 0.3));
    }

    // Where a shot lands, in world space, at stage time st (moving targets carry their holes).
    function hitWorld(s, st = s.st) {
      const tg = TARGETS[s.target];
      if (tg.kind === "popper") return [tg.pos[0], 0.7, tg.pos[2]];
      if (tg.kind === "rack") return rackPlate(s.hit);
      if (tg.kind === "star") return starPlate(starState(s.st), s.hit);
      const { right } = targetFrame(s.target);
      if (tg.kind === "swinger") {
        const p = swingerPose(st);
        const ax = [Math.cos(p.th), Math.sin(p.th)];
        return add(
          p.centre,
          add(mul(right, s.hit[0] * ax[0] - s.hit[1] * -ax[1]), [
            0,
            -(s.hit[0] * ax[1] + s.hit[1] * ax[0]),
            0,
          ]),
        );
      }
      if (tg.kind === "turner") {
        const { n } = targetFrame(s.target);
        const psi = turnerAngle(st);
        const r2 = add(mul(right, Math.cos(psi)), mul(n, -Math.sin(psi)));
        return add(add([tg.pos[0], 1.24, tg.pos[2]], mul(r2, s.hit[0])), [
          0,
          -s.hit[1],
          0,
        ]);
      }
      return add(add([tg.pos[0], 1.24, tg.pos[2]], mul(right, s.hit[0])), [
        0,
        -s.hit[1],
        0,
      ]);
    }
    // The point being worked on: swings from shot to shot, tracking moving targets.
    function workPoint(st) {
      let k = SHOTS.findIndex((s) => s.st >= st - 0.06);
      if (k < 0) k = SHOTS.length - 1;
      const cur = hitWorld(SHOTS[k], Math.max(st, SHOTS[k].st - 0.3));
      const prev = k > 0 ? hitWorld(SHOTS[k - 1]) : [-8.2, 1.1, 6.8];
      const from = k > 0 ? SHOTS[k - 1].st : 0.8;
      return lerp3(
        prev,
        cur,
        ease.inOut3(seg(st, from + 0.05, SHOTS[k].st - 0.04)),
      );
    }
    function aimDir(st) {
      const sp = shooterPos(st);
      // On the move the muzzle stays pointed downrange.
      const m = moveAt(st);
      const moving = m ? ease.inOut3(env(st, m[0], m[1], 0.15, 0.15)) : 0;
      const d = norm(sub(workPoint(st), [sp[0], 1.4, sp[2]]));
      return norm(lerp3(d, [0, -0.35, 1], moving));
    }
    // Camera: rigs blended at cut points in video time — a drone behind the
    // shooter, close-ups on the moving targets in slow motion, a high tracking
    // shot on the runs and a look through the port.
    const FOCUS = Object.fromEntries(
      Object.keys(AREAS).map((name) => {
        const list = Object.values(TARGETS).filter((tg) => tg.from === name);
        const mean = (k) =>
          list.reduce((sum, tg) => sum + tg.pos[k], 0) / list.length;
        return [name, [mean(0), 1.0, mean(2)]];
      }),
    );
    function focusAt(st) {
      let f = FOCUS.A;
      for (const [a, b, , to] of EVENTS.moves)
        if (st > a) f = lerp3(f, FOCUS[to], ease.inOut3(seg(st, a, b)));
      return f;
    }
    // A static close-up that pushes in slowly across [from, to] (stage time).
    function closeUp(key, o) {
      const tg = TARGETS[key];
      const { n, right } = targetFrame(key);
      return (st) => {
        const d = o.dist - o.push * ease.inOut3(seg(st, o.from, o.to));
        const pos = add(
          add(tg.pos, mul(n, d)),
          add(mul(right, o.side), [0, o.height, 0]),
        );
        return [pos, [tg.pos[0], o.lookY, tg.pos[2]], o.fov, o.roll];
      };
    }
    const RIGS = {
      drone(st) {
        const sp = shooterPos(st);
        const fc = focusAt(st);
        const wp = workPoint(st);
        const dir = norm([fc[0] - sp[0], 0, fc[2] - sp[2]]);
        const side = cross(UP, dir);
        const pos = add(
          sp,
          add(add(mul(dir, -6.2), mul(side, 1.6)), [0, 4.6, 0]),
        );
        return [pos, lerp3(fc, [wp[0], 1.0, wp[2]], 0.35), 31, 0];
      },
      high(st) {
        const sp = shooterPos(st);
        return [add(sp, [0.4, 9.5, -5.8]), add(sp, [0, 0, 3.4]), 44, 0];
      },
      swinger: closeUp("SW", {
        dist: 4.6,
        push: 0.9,
        from: 2.4,
        to: 3.5,
        side: -0.9,
        height: 1.8,
        lookY: 1.7,
        fov: 34,
        roll: -0.04,
      }),
      // the shooter's eyes, looking through the port
      pov(st) {
        const sp = shooterPos(st);
        const wp = workPoint(st);
        return [[sp[0], 1.65, sp[2] + 0.05], lerp3(FOCUS.B, wp, 0.6), 32, 0];
      },
      star: closeUp("STAR", {
        dist: 5.0,
        push: 1.0,
        from: 10.1,
        to: 12.4,
        side: -0.6,
        height: 1.4,
        lookY: 1.55,
        fov: 36,
        roll: 0.035,
      }),
      overview() {
        return [[-0.4, 15, -7.4], [-0.4, 0, 5.0], 54, 0];
      },
    };
    const CUTS = [
      [vt(2420), 0.5, "swinger"],
      [vt(3480) - 0.08, 0.32, "high"],
      [vt(5150), 0.4, "pov"],
      [vt(7330), 0.35, "high"],
      [vt(10100), 0.42, "star"],
      [vt(12380), 0.4, "drone"],
      [STAGE_END + 0.12, 0.6, "overview"],
    ];
    function stageCamera(t, st) {
      let [pos, look, fov, roll] = RIGS.drone(st);
      let pov = 0; // how much of the view is the shooter's own eyes
      const blend = ([p2, l2, f2, r2], p, rig) => {
        pos = lerp3(pos, p2, p);
        look = lerp3(look, l2, p);
        fov = lerp(fov, f2, p);
        roll = lerp(roll, r2, p);
        pov = lerp(pov, rig === "pov" ? 1 : 0, p);
      };
      for (const [at, dur, rig] of CUTS) {
        const p = ease.inOut3(seg(t, at, at + dur));
        if (p <= 0) break;
        blend(RIGS[rig](st), p, rig);
      }
      // the stage opens on the overview
      const e = 1 - ease.inOut3(seg(t, 15.9, 16.55));
      if (e > 0) blend(RIGS.overview(), e, "overview");
      return { ...camera(pos, look, fov, roll), pov };
    }
    function polyHole3(cam, outer, inner, fill, stroke) {
      ctx.beginPath();
      [outer, inner].forEach((pts) => {
        clipNear(cam, pts).forEach((p, k) => {
          const q = project(cam, p);
          if (k) ctx.lineTo(q[0], q[1]);
          else ctx.moveTo(q[0], q[1]);
        });
        ctx.closePath();
      });
      ctx.fillStyle = fill;
      ctx.fill("evenodd");
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    function label3(cam, p, str, color = "rgba(255,255,255,0.75)", size = 13) {
      const q = project(cam, p);
      if (q[2] < 0.5) return;
      text(str, q[0], q[1], {
        size,
        weight: 800,
        tracking: 1.5,
        align: "center",
        color,
      });
    }

    function sceneStage(t) {
      if (t < 15.7 || t > STAGE_END + 1.2) return;
      const st = stageOfVideo(Math.max(t, RESUME)) / 1000;
      const enter = ease.out3(seg(t, 15.7, 16.05));
      const leave = ease.in3(seg(t, STAGE_END + 0.45, STAGE_END + 0.9));
      ctx.save();
      ctx.translate((1 - enter) * W * 1.1, 0);
      ctx.globalAlpha = 1 - leave * 0.85;
      const cam = stageCamera(t, st);
      for (let x = -12; x <= 12; x++)
        seg3(
          cam,
          [x, 0, -5],
          [x, 0, 13],
          x === 0 ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.05)",
          1,
        );
      for (let z = -5; z <= 13; z++)
        seg3(cam, [-12, 0, z], [12, 0, z], "rgba(255,255,255,0.05)", 1);
      poly3(
        cam,
        [
          [-13, 0, 11.6],
          [13, 0, 11.6],
          [13, 2.8, 13],
          [-13, 2.8, 13],
        ],
        "rgba(255,255,255,0.025)",
        "rgba(255,255,255,0.08)",
        1,
      );
      // shooting areas
      Object.entries(AREAS).forEach(([name, ar]) => {
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
        label3(cam, [x0 + 0.5, 0, z0 - 0.35], `AREA ${name}`, C.red);
      });
      // the 180° rule, shown while moving
      const m = moveAt(st);
      const fanA = m ? env(st, m[0], m[1], 0.25, 0.3) : 0;
      const sp = shooterPos(st);
      if (fanA > 0) {
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
        if (lp[2] > 0.5)
          text("180°", lp[0], lp[1], {
            size: 30,
            weight: 800,
            align: "center",
            color: C.red,
          });
        ctx.restore();
      }
      // the route so far
      ctx.save();
      ctx.setLineDash([6, 8]);
      EVENTS.moves.forEach(([a, b]) => {
        if (st <= a) return;
        for (let k = 0; k < 30; k++) {
          const p0 = shooterPos(lerp(a, Math.min(st, b), k / 30));
          const p1 = shooterPos(lerp(a, Math.min(st, b), (k + 1) / 30));
          seg3(cam, p0, p1, "rgba(255,255,255,0.5)", 2);
        }
      });
      ctx.setLineDash([]);
      ctx.restore();

      // objects, far to near
      const objects = [];
      objects.push({
        z: project(cam, [WALL_B.x[0] / 2 + WALL_B.x[1] / 2, 1, WALL_B.z])[2],
        draw: () => {
          const [x0, x1] = WALL_B.x;
          const [[px0, py0], [px1, py1]] = WALL_B.port;
          polyHole3(
            cam,
            [
              [x0, 0, WALL_B.z],
              [x1, 0, WALL_B.z],
              [x1, WALL_B.h, WALL_B.z],
              [x0, WALL_B.h, WALL_B.z],
            ],
            [
              [px0, py0, WALL_B.z],
              [px1, py0, WALL_B.z],
              [px1, py1, WALL_B.z],
              [px0, py1, WALL_B.z],
            ],
            "#232831",
            "rgba(255,255,255,0.3)",
          );
          for (let y = 0.3; y < WALL_B.h; y += 0.3) {
            const cutA = y > py0 && y < py1;
            seg3(
              cam,
              [x0, y, WALL_B.z],
              [cutA ? px0 : x1, y, WALL_B.z],
              "rgba(255,255,255,0.05)",
              1,
            );
            if (cutA)
              seg3(
                cam,
                [px1, y, WALL_B.z],
                [x1, y, WALL_B.z],
                "rgba(255,255,255,0.05)",
                1,
              );
          }
          poly3(
            cam,
            [
              [px0, py0, WALL_B.z],
              [px1, py0, WALL_B.z],
              [px1, py1, WALL_B.z],
              [px0, py1, WALL_B.z],
            ],
            null,
            rgba(C.red, 0.8),
            2.5,
          );
          label3(cam, [(px0 + px1) / 2, py1 + 0.12, WALL_B.z], "PORT");
        },
      });
      Object.keys(TARGETS).forEach((key) => {
        const tg = TARGETS[key];
        objects.push({
          z: project(cam, add(tg.pos, [0, 1, 0]))[2],
          draw: () => drawStageTarget(cam, key, st),
        });
      });
      if (cam.pov < 0.98)
        objects.push({
          z: project(cam, add(sp, [0, 1, 0]))[2],
          draw: () => {
            ctx.save();
            ctx.globalAlpha *= 1 - ease.in3(cam.pov);
            drawShooter(cam, st);
            ctx.restore();
          },
        });
      objects
        .filter((o) => o.z > 0.5)
        .sort((a, b) => b.z - a.z)
        .forEach((o) => o.draw());

      // activators: a popper releasing a moving target
      [
        ["P1", "SW", EVENTS.swingerRelease],
        ["P2", "DT", EVENTS.turnerRelease],
      ].forEach(([from, to, at]) => {
        const a = env(st, at - 0.05, at + 0.9, 0.15, 0.35);
        if (a <= 0) return;
        const A = project(cam, add(TARGETS[from].pos, [0, 0.4, 0]));
        const B = project(cam, add(TARGETS[to].pos, [0, 1.6, 0]));
        if (A[2] < 0.5 || B[2] < 0.5) return;
        const p = ease.out3(seg(st, at - 0.05, at + 0.2));
        ctx.save();
        ctx.globalAlpha *= a;
        ctx.setLineDash([8, 6]);
        line(A[0], A[1], lerp(A[0], B[0], p), lerp(A[1], B[1], p), C.red, 2.5);
        ctx.setLineDash([]);
        const mx = (A[0] + B[0]) / 2;
        const my = (A[1] + B[1]) / 2 - 14;
        text(opt.lang === "en" ? "ACTIVATES" : "작동", mx, my, {
          size: 14,
          weight: 800,
          tracking: opt.lang === "en" ? 2 : 0,
          align: "center",
          color: C.red,
          family: opt.lang === "en" ? SANS : KR,
        });
        ctx.restore();
      });

      // tracers and score pops
      SHOTS.forEach((s) => {
        const dt = st - s.st;
        if (dt < 0 || dt > 0.9) return;
        const sp0 = shooterPos(s.st);
        const hit = hitWorld(s);
        const eye = [sp0[0], 1.65, sp0[2] + 0.05];
        const muzzle = lerp3(
          add([sp0[0], 1.4, sp0[2]], mul(aimDir(s.st), 0.72)),
          add(add(eye, mul(norm(sub(hit, eye)), 0.75)), [0, -0.035, 0]),
          cam.pov,
        );
        const clipped =
          dt < 0.08 &&
          clipSeg(
            cam,
            add(muzzle, mul(sub(hit, muzzle), clamp(dt / 0.06 - 0.5))),
            add(muzzle, mul(sub(hit, muzzle), clamp(dt / 0.06))),
          );
        if (clipped) {
          const A = project(cam, clipped[0]);
          const B = project(cam, clipped[1]);
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
          if (M[2] > 0.3)
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
          if (P[2] < 0.5) return;
          const pa = ease.out3(seg(dt, 0.05, 0.15)) * (1 - seg(dt, 0.55, 0.9));
          ctx.save();
          ctx.globalAlpha *= pa;
          const lbl = s.zone === "S" ? "+5" : `+${s.points} ${s.zone}`;
          const w = layout(lbl, font(800, 22), 1).width + 20;
          const hot = s.zone === "A" || s.zone === "S";
          ctx.fillStyle = hot ? C.red : "rgba(255,255,255,0.92)";
          ctx.beginPath();
          ctx.roundRect(P[0] - w / 2, P[1] - 30, w, 38, 4);
          ctx.fill();
          text(lbl, P[0], P[1] - 4, {
            size: 22,
            weight: 800,
            tracking: 1,
            align: "center",
            color: hot ? C.white : C.bg,
          });
          ctx.restore();
        }
      });
      if (cam.pov > 0.02) {
        const aim = project(cam, workPoint(st));
        const last = [...SHOTS].reverse().find((s) => st >= s.st);
        ctx.save();
        ctx.globalAlpha *= ease.out3(cam.pov);
        povGun(
          aim[0],
          aim[1] + 6 + (1 - cam.pov) * 520,
          0.34,
          last ? st - last.st : 9,
        );
        ctx.restore();
      }
      ctx.restore();

      const la =
        ease.out3(seg(t, 16.0, 16.3)) *
        (1 - seg(t, STAGE_END + 0.45, STAGE_END + 0.7));
      if (la <= 0) return;
      ctx.save();
      ctx.globalAlpha = la;
      // a panel behind the shot timer, the shot list and the totals
      const x1 = W - 96;
      const y0 = 236;
      ctx.fillStyle = "rgba(10,12,15,0.74)";
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x1 - 324, 44, 348, y0 + 44 + 8 * 32 + 10 + 84 - 44, 6);
      ctx.fill();
      ctx.stroke();
      // speed ramp badge under the shot timer
      const rate = rateAt(st * 1000);
      if (rate !== 1 && st < STAGE_TIME) {
        const label =
          rate > 1 ? `▶▶  ×${rate.toFixed(1)}` : `SLOW ×${rate.toFixed(2)}`;
        const w = layout(label, font(800, 14), 2).width + 24;
        ctx.fillStyle = rate > 1 ? "rgba(255,255,255,0.14)" : rgba(C.red, 0.9);
        ctx.beginPath();
        ctx.roundRect(W - 96 - w, 166, w, 28, 4);
        ctx.fill();
        text(label, W - 96 - w / 2, 185, {
          size: 14,
          weight: 800,
          tracking: 2,
          align: "center",
        });
      }
      // shot list (last eight), points and rounds
      text("SHOT", x1 - 300, y0, {
        size: 12,
        weight: 700,
        tracking: 2,
        color: C.dim,
      });
      text("TIME", x1 - 170, y0, {
        size: 12,
        weight: 700,
        tracking: 2,
        color: C.dim,
        align: "right",
      });
      text("SPLIT", x1 - 70, y0, {
        size: 12,
        weight: 700,
        tracking: 2,
        color: C.dim,
        align: "right",
      });
      line(x1 - 300, y0 + 12, x1, y0 + 12, "rgba(255,255,255,0.2)", 1);
      const fired = SHOTS.filter((s) => st >= s.st);
      const shown = fired.slice(-8);
      shown.forEach((s, row) => {
        const y = y0 + 44 + row * 32;
        const p = ease.out3(seg(st, s.st, s.st + 0.12));
        ctx.save();
        ctx.globalAlpha *= row === shown.length - 1 ? p : 1;
        digits(String(s.i + 1).padStart(2, "0"), x1 - 300, y, 20, {
          color: C.dim,
          weight: 600,
        });
        digits(fmt2(s.ms), x1 - 170, y, 20, { align: "right", weight: 700 });
        digits(s.i ? fmt2(s.split) : "—", x1 - 70, y, 20, {
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
      const ry = y0 + 44 + 8 * 32 + 10;
      line(x1 - 300, ry - 20, x1, ry - 20, "rgba(255,255,255,0.2)", 1);
      text("POINTS", x1 - 300, ry + 10, {
        size: 12,
        weight: 700,
        tracking: 2,
        color: C.dim,
      });
      digits(
        String(fired.reduce((a, s) => a + s.points, 0)).padStart(3, "0"),
        x1,
        ry + 14,
        34,
        { align: "right", weight: 800 },
      );
      const [rl0, , , rl3] = EVENTS.reload;
      const reloading = st >= rl0 && st < rl3;
      const inMag = st >= rl3 ? MAG - (fired.length - MAG) : MAG - fired.length;
      text("ROUNDS", x1 - 300, ry + 56, {
        size: 12,
        weight: 700,
        tracking: 2,
        color: C.dim,
      });
      if (reloading)
        text("RELOAD", x1, ry + 58, {
          size: 22,
          weight: 800,
          tracking: 2,
          align: "right",
          color: C.red,
        });
      else
        digits(`${String(inMag).padStart(2, "0")}/15`, x1, ry + 58, 26, {
          align: "right",
          weight: 700,
          color: C.dim,
        });
      ctx.restore();

      // the slide cycling and the reload, picture-in-picture
      const px = 96;
      const py = 168;
      ctx.save();
      ctx.globalAlpha = la;
      ctx.fillStyle = "rgba(10,12,15,0.78)";
      ctx.strokeStyle = reloading ? C.red : "rgba(255,255,255,0.16)";
      ctx.lineWidth = reloading ? 2 : 1;
      ctx.beginPath();
      ctx.roundRect(px, py, 420, 230, 6);
      ctx.fill();
      ctx.stroke();
      text(reloading ? "RELOAD" : "SLIDE CYCLE", px + 20, py + 32, {
        size: 12,
        weight: 800,
        tracking: 2.4,
        color: reloading ? C.red : C.dim,
      });
      const last = [...SHOTS].reverse().find((s) => st >= s.st);
      const rc =
        last && !reloading ? recoil(st - last.st) : { slide: 0, flip: 0 };
      const go = { x: px + 214, y: py + 124, s: 1.1, rot: rc.flip };
      const [, rOut, rIn, rFwd] = EVENTS.reload;
      let slide = rc.slide;
      let mag = null;
      if (reloading) {
        slide = 27 * (1 - ease.in3(seg(st, rFwd - 0.06, rFwd)));
        if (st < rIn - 0.35) {
          const d = seg(st, rOut, rOut + 0.4);
          mag = { dx: -d * 12, dy: d * d * 260, rot: d * 0.5 };
        } else {
          const d = 1 - ease.out3(seg(st, rIn - 0.35, rIn));
          mag = { dx: 0, dy: d * 120, rot: 0 };
        }
      }
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(px, py, 420, 230, 6);
      ctx.clip();
      drawGun({ ...go, slide, mag, fiber: 0.9 });
      if (last && !reloading && st - last.st < 0.05) {
        const [mx, my] = gunPoint(go, GUN.muzzle[0], GUN.muzzle[1]);
        muzzleFlash(mx + 10, my, 54, 1 - (st - last.st) / 0.05, last.i * 3 + 1);
      }
      ctx.restore();
      SHOTS.forEach((s) => brass(go, st - s.st, s.i * 7 + 3));
      ctx.restore();
    }

    function drawStageTarget(cam, key, st) {
      const tg = TARGETS[key];
      const { n, right } = targetFrame(key);
      const hitsOf = (k) =>
        SHOTS.filter((s) => s.target === k && st >= s.st + 0.02);
      const flashOf = (k, sub) =>
        SHOTS.filter(
          (s) => s.target === k && (sub === undefined || s.hit === sub),
        ).reduce(
          (a, s) => Math.max(a, 1 - Math.abs(st - s.st - 0.04) / 0.1),
          0,
        );
      const paper = (centre, r2, up2, noShoot, flash) => {
        const toW = (u, v) =>
          add(add(centre, mul(r2, u / 100)), mul(up2, -v / 100));
        poly3(
          cam,
          TGT.outer.pts.map(([u, v]) => toW(u, v)),
          noShoot ? "#e9ecef" : C.card,
          noShoot ? "rgba(0,0,0,0.3)" : C.cardEdge,
          1.5,
        );
        ctx.save();
        ctx.setLineDash([3, 3]);
        const zl = noShoot ? "rgba(0,0,0,0.15)" : "rgba(70,45,15,0.55)";
        poly3(
          cam,
          TGT.c.pts.map(([u, v]) => toW(u, v)),
          null,
          zl,
          1,
        );
        poly3(
          cam,
          TGT.a.pts.map(([u, v]) => toW(u, v)),
          flash > 0 ? rgba(C.red, flash * 0.7) : null,
          zl,
          1,
        );
        ctx.restore();
      };
      const hole = (s) => {
        const P = project(cam, hitWorld(s, st));
        if (P[2] < 0.3) return;
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
      };
      const stand = (x0, x1) =>
        [x0, x1].forEach((u) =>
          seg3(
            cam,
            add([tg.pos[0], 0, tg.pos[2]], mul(right, u)),
            add([tg.pos[0], 0.95, tg.pos[2]], mul(right, u)),
            "rgba(150,120,80,0.9)",
            2,
          ),
        );
      const steel = (pts, flash) =>
        poly3(
          cam,
          pts,
          flash > 0 ? "#ffffff" : C.steel,
          "rgba(0,0,0,0.35)",
          1.5,
        );
      const disc = (c, r2, up2, rad) => {
        const pts = [];
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          pts.push(
            add(
              add(c, mul(r2, Math.cos(a) * rad)),
              mul(up2, Math.sin(a) * rad),
            ),
          );
        }
        return pts;
      };
      const back = mul(n, -1);

      if (tg.kind === "paper" || tg.kind === "noshoot") {
        stand(-0.17, 0.17);
        paper(
          [tg.pos[0], 1.24, tg.pos[2]],
          right,
          UP,
          tg.kind === "noshoot",
          flashOf(key),
        );
        if (tg.kind === "noshoot")
          label3(cam, [tg.pos[0], 1.68, tg.pos[2]], "NO-SHOOT");
        hitsOf(key).forEach(hole);
      } else if (tg.kind === "popper") {
        const hit = SHOTS.find((s) => s.target === key);
        const fall = ease.in3(seg(st, hit.st + 0.05, hit.st + 0.45)) * 1.45;
        const base = [tg.pos[0], 0, tg.pos[2]];
        steel(
          POPPER.pts.map(([u, v]) => {
            const h = -v / 100;
            return add(
              add(base, mul(right, u / 100)),
              add(mul(UP, h * Math.cos(fall)), mul(back, h * Math.sin(fall))),
            );
          }),
          flashOf(key),
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
        label3(cam, [tg.pos[0], 1.05, tg.pos[2]], "POPPER");
      } else if (tg.kind === "swinger") {
        const p = swingerPose(st);
        // frame, arm, target, then the barrier in front of its rest position
        const top = [tg.pos[0], SWING.pivot + 0.12, tg.pos[2]];
        [-1, 1].forEach((sd) =>
          seg3(
            cam,
            add([tg.pos[0], 0, tg.pos[2] + 0.25], mul(right, sd * 1.35)),
            add(top, add(mul(right, sd * 1.35), [0, 0, 0.25])),
            "rgba(150,155,165,0.7)",
            2,
          ),
        );
        seg3(
          cam,
          add(top, add(mul(right, -1.35), [0, 0, 0.25])),
          add(top, add(mul(right, 1.35), [0, 0, 0.25])),
          "rgba(150,155,165,0.7)",
          2,
        );
        const r2 = add(mul(right, Math.cos(p.th)), mul(UP, -Math.sin(p.th)));
        const up2 = add(mul(right, Math.sin(p.th)), mul(UP, Math.cos(p.th)));
        seg3(
          cam,
          p.pivot,
          add(p.centre, mul(up2, 0.29)),
          "rgba(200,205,212,0.9)",
          3,
        );
        paper(p.centre, r2, up2, false, flashOf(key));
        hitsOf(key).forEach(hole);
        const bw = 0.42;
        const bz = tg.pos[2] - 0.7;
        poly3(
          cam,
          [
            add([tg.pos[0], 0, bz], mul(right, -bw)),
            add([tg.pos[0], 0, bz], mul(right, bw)),
            add([tg.pos[0], 2.05, bz], mul(right, bw)),
            add([tg.pos[0], 2.05, bz], mul(right, -bw)),
          ],
          "rgba(22,25,31,0.97)",
          "rgba(255,255,255,0.22)",
        );
        label3(cam, [tg.pos[0], 2.75, tg.pos[2]], "SWINGER");
      } else if (tg.kind === "turner") {
        const psi = turnerAngle(st);
        const r2 = add(mul(right, Math.cos(psi)), mul(n, -Math.sin(psi)));
        seg3(
          cam,
          [tg.pos[0], 0, tg.pos[2]],
          [tg.pos[0], 0.95, tg.pos[2]],
          "rgba(150,155,165,0.8)",
          3,
        );
        if (Math.abs(Math.cos(psi)) > 0.04)
          paper([tg.pos[0], 1.24, tg.pos[2]], r2, UP, false, flashOf(key));
        else
          seg3(
            cam,
            [tg.pos[0], 0.95, tg.pos[2]],
            [tg.pos[0], 1.53, tg.pos[2]],
            C.cardEdge,
            3,
          );
        hitsOf(key).forEach((s) => Math.abs(Math.cos(psi)) > 0.2 && hole(s));
        label3(cam, [tg.pos[0], 1.8, tg.pos[2]], "DROP TURNER");
      } else if (tg.kind === "rack") {
        const a = add([tg.pos[0], 0.98, tg.pos[2]], mul(right, -0.95));
        const b = add([tg.pos[0], 0.98, tg.pos[2]], mul(right, 0.95));
        seg3(cam, a, b, "rgba(170,175,185,0.9)", 4);
        [a, b].forEach((p) =>
          seg3(cam, p, [p[0], 0, p[2]], "rgba(170,175,185,0.9)", 3),
        );
        for (let k = 0; k < 6; k++) {
          const s = SHOTS.find((x) => x.target === key && x.hit === k);
          const fall = s
            ? ease.in3(seg(st, s.st + 0.02, s.st + 0.25)) * 1.5
            : 0;
          const hinge = add(rackPlate(k), [0, -0.12, 0]);
          const up2 = add(mul(UP, Math.cos(fall)), mul(back, Math.sin(fall)));
          steel(
            disc(add(hinge, mul(up2, 0.12)), right, up2, 0.1),
            flashOf(key, k),
          );
        }
        label3(cam, [tg.pos[0], 1.55, tg.pos[2]], "PLATE RACK");
      } else if (tg.kind === "star") {
        const state = starState(st);
        const hub = [tg.pos[0], STAR.hub, tg.pos[2]];
        seg3(
          cam,
          [tg.pos[0], 0, tg.pos[2] + 0.05],
          [tg.pos[0], STAR.hub, tg.pos[2] + 0.05],
          "rgba(170,175,185,0.9)",
          4,
        );
        for (let k = 0; k < 5; k++) {
          const s = starHits.find((x) => x.hit === k);
          const P = starPlate(state, k);
          seg3(cam, hub, P, "rgba(190,195,205,0.95)", 3);
          if (!state.gone.has(k)) steel(disc(P, right, UP, STAR.plate), 0);
          else {
            // the plate drops away from its arm
            const d = st - s.st;
            if (d < 0.7) {
              const from = starPlate(starState(s.st), k);
              const c = add(
                from,
                add(mul(back, d * 0.6), [0, -4.9 * d * d, 0]),
              );
              ctx.save();
              ctx.globalAlpha *= 1 - d / 0.7;
              steel(disc(c, right, UP, STAR.plate), flashOf(key, k));
              ctx.restore();
            }
          }
        }
        const H0 = project(cam, hub);
        if (H0[2] < 0.3) return;
        ctx.fillStyle = "#2a2e35";
        ctx.beginPath();
        ctx.arc(
          H0[0],
          H0[1],
          Math.max(3, (0.06 * cam.focal) / H0[2]),
          0,
          Math.PI * 2,
        );
        ctx.fill();
        label3(cam, [tg.pos[0], STAR.hub + 0.85, tg.pos[2]], "TEXAS STAR");
      }
      if (/^T\d/.test(key))
        label3(
          cam,
          [tg.pos[0], 1.78, tg.pos[2]],
          key,
          "rgba(255,255,255,0.5)",
          12,
        );
    }

    function drawShooter(cam, st) {
      const sp = shooterPos(st);
      const dir = aimDir(st);
      const face = norm([dir[0], 0, dir[2]]);
      const r = cross(UP, face);
      const at = (h, side, fwd = 0) =>
        add(add(add(sp, [0, h, 0]), mul(r, side)), mul(face, fwd));
      const P = (pt) => project(cam, pt);
      const body = "#232830";
      const rim = "rgba(244,245,247,0.85)";
      // ground ring
      const ring = [];
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        ring.push([sp[0] + Math.cos(a) * 0.4, 0.01, sp[2] + Math.sin(a) * 0.4]);
      }
      poly3(cam, ring, rgba(C.white, 0.05), "rgba(255,255,255,0.35)", 1.5);
      // running strides while moving between areas
      const m = moveAt(st);
      const step = m
        ? Math.sin(seg(st, m[0], m[1]) * Math.PI * 2 * (m[1] - m[0]) * 1.6) *
          0.2 *
          env(st, m[0], m[1], 0.12, 0.12)
        : 0;
      const fill = (pts, smooth = false) => {
        const q = pts.map(P);
        ctx.beginPath();
        ctx.moveTo(q[0][0], q[0][1]);
        if (smooth) {
          for (let k = 1; k < q.length; k++) {
            const n = q[(k + 1) % q.length];
            ctx.quadraticCurveTo(
              q[k][0],
              q[k][1],
              (q[k][0] + n[0]) / 2,
              (q[k][1] + n[1]) / 2,
            );
          }
        } else q.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
        ctx.closePath();
        ctx.fillStyle = body;
        ctx.fill();
        ctx.strokeStyle = rim;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      };
      // legs
      [-1, 1].forEach((side) => {
        const stride = side * step;
        fill([
          at(0.98, side * 0.03),
          at(0.98, side * 0.19),
          at(0.05, side * 0.2, stride),
          at(0.05, side * 0.08, stride),
        ]);
      });
      // torso with rounded shoulders, leaning slightly into the gun
      fill(
        [
          at(1.0, -0.17),
          at(1.32, -0.21, 0.04),
          at(1.5, -0.23, 0.06),
          at(1.55, -0.12, 0.07),
          at(1.57, 0, 0.07),
          at(1.55, 0.12, 0.07),
          at(1.5, 0.23, 0.06),
          at(1.32, 0.21, 0.04),
          at(1.0, 0.17),
          at(0.97, 0),
        ],
        true,
      );
      // arms out to a two-handed grip
      const hands = add([sp[0], 1.4, sp[2]], mul(dir, 0.62));
      const H2 = P(hands);
      const armW = Math.max(3, (0.085 * cam.focal) / H2[2]);
      [-1, 1].forEach((side) => {
        const S = P(at(1.47, side * 0.2, 0.06));
        ctx.lineCap = "round";
        ctx.strokeStyle = rim;
        ctx.lineWidth = armW + 3;
        ctx.beginPath();
        ctx.moveTo(S[0], S[1]);
        ctx.lineTo(H2[0], H2[1]);
        ctx.stroke();
        ctx.strokeStyle = body;
        ctx.lineWidth = armW;
        ctx.stroke();
        ctx.lineCap = "butt";
      });
      seg3(
        cam,
        hands,
        add(hands, mul(dir, 0.17)),
        C.red,
        Math.max(3, armW * 0.8),
      );
      // head with ear protection
      const head = P(at(1.72, 0, 0.08));
      const hr = Math.max(4, (0.105 * cam.focal) / head[2]);
      ctx.fillStyle = body;
      ctx.strokeStyle = rim;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(head[0], head[1], hr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const er = P(at(1.71, 0.1, 0.08));
      const el = P(at(1.71, -0.1, 0.08));
      ctx.strokeStyle = rim;
      ctx.lineWidth = Math.max(1.5, hr * 0.18);
      ctx.beginPath();
      ctx.moveTo(el[0], el[1]);
      ctx.quadraticCurveTo(head[0], head[1] - hr * 1.5, er[0], er[1]);
      ctx.stroke();
      [el, er].forEach(([x, y]) => {
        ctx.fillStyle = "#2a2e35";
        ctx.beginPath();
        ctx.ellipse(x, y, hr * 0.24, hr * 0.36, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }

    // S6 — hit factor.
    function sceneHitFactor(t) {
      if (t < 19.9 || t > 22.8) return;
      const out = ease.in3(seg(t, 22.28, 22.52));
      ctx.save();
      ctx.translate(0, -out * 140);
      ctx.globalAlpha = 1 - out;
      const y = 600;
      const size = 150;
      // positions
      const xP = 230;
      const xDiv = 560;
      const xT = 690;
      const xEq = 1140;
      const xHF = 1270;
      // time flies in from the HUD
      const fly = ease.inOut3(seg(t, 19.95, 20.35));
      const tsz = lerp(64, size, fly);
      const tx = lerp(W - 96 - timeWidth(fmt2(STAGE_MS)) * 64, xT, fly);
      const ty = lerp(150, y, fly);
      digits(fmt2(STAGE_MS), tx, ty, tsz, { weight: 800 });
      // points roll
      const pp = ease.out3(seg(t, 20.05, 20.45));
      const pts = Math.round(STAGE_POINTS * pp);
      ctx.save();
      ctx.globalAlpha *= ease.out3(seg(t, 20.0, 20.12));
      digits(
        String(pts).padStart(String(STAGE_POINTS).length, "0"),
        xP,
        y,
        size,
        { weight: 800 },
      );
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
        const enter = ease.out3(seg(t, 22.52, 22.82));
        const go = {
          x: lerp(2280, 1500, enter),
          y: 790 + holster * 520,
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
          const [cx, cy] = gunPoint(go, GUN.port[0], GUN.port[1]);
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
      // a slow push-in so the hold keeps breathing
      const push = lerp(1, 1.04, ease.inOut3(seg(t, 24.5, 28)));
      ctx.translate(W / 2, H / 2);
      ctx.scale(push, push);
      ctx.translate(-W / 2, -H / 2);
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
        [21.0 + SHIFT, 0.3, 7],
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
        [RESUME, 0.12, "255,255,255", 0.3],
        [21.0 + SHIFT, 0.18, "255,255,255", 0.14],
        [FREEZE, 0.25, "255,255,255", 0.35],
      ];
      for (const [at, dur, rgb, a] of flashes) {
        const d = t - at;
        if (d < 0 || d > dur) continue;
        ctx.fillStyle = `rgba(${rgb},${a * (1 - d / dur) ** 2})`;
        ctx.fillRect(0, 0, W, H);
      }
      // freeze: a short monochrome beat, cleared before the red line of sight
      if (t >= FREEZE && t < 6.98) {
        ctx.save();
        ctx.globalCompositeOperation = "saturation";
        ctx.fillStyle = `rgba(128,128,128,${1 - seg(t, 6.86, 6.98)})`;
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
      sceneLineOfSight(t);
      sceneSights(t);
      sceneTargets(t);
      sceneStage(t);
      sceneHitFactor(t - SHIFT);
      sceneClear(t - SHIFT);
      if (t >= 12.75 && t <= 13.25) blinds(t, 12.75, 13.15);
      sceneEnd(t - SHIFT);
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
      maxPoints: MAX_POINTS,
      reload: EVENTS.reload[0],
    },
    MARKS: {
      resume: RESUME,
      stageEnd: STAGE_END,
      shift: SHIFT,
      ramps: RAMPS.map(([a, b, rate]) => [vt(a), vt(b), rate]),
    },
    create,
  };
})();
