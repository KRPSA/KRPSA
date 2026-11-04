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
    card: "#c8a57a", // kraft cardboard
    cardEdge: "#8c6b45",
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

  // The stage: a long course (IPSC: at most 32 rounds, and no more than 9
  // scoring hits from any one location) over
  // four shooting areas. Everything is defined in stage time — milliseconds on
  // the shot timer — and RAMPS map it to video time, so the runs between areas
  // play fast and the swinger and the mover play slow.
  const AREAS = {
    A: {
      pos: [-7, 0, 0],
      box: [
        [-8.1, -1.0],
        [-5.9, 1.0],
      ],
    },
    B: {
      pos: [0.2, 0, 2.1],
      box: [
        [-0.8, 1.25],
        [1.2, 2.85],
      ],
    },
    C: {
      pos: [5.4, 0, 1.0],
      box: [
        [4.4, 0.0],
        [6.4, 2.0],
      ],
    },
    D: {
      pos: [9.0, 0, 2.4],
      box: [
        [8.0, 1.4],
        [10.0, 3.4],
      ],
    },
  };
  // Only IPSC-legal props: no stars, racks or trees (IPSC target arrays allow at
  // most two plates on a common base); moving targets start from activators.
  const TARGETS = {
    T1: { kind: "paper", pos: [-9.2, 0, 6.6], from: "A" },
    T2: { kind: "paper", pos: [-7.3, 0, 7.6], from: "A" },
    NS1: { kind: "noshoot", pos: [-6.98, 0, 7.12], from: "A" },
    P1: { kind: "popper", pos: [-5.6, 0, 8.6], from: "A" },
    SW: { kind: "swinger", pos: [-4.4, 0, 9.5], from: "A" },
    PL: { kind: "plates", pos: [0.2, 0, 10.2], from: "B" },
    T3: { kind: "paper", pos: [1.8, 0, 8.6], from: "B" },
    T7: { kind: "paper", pos: [-0.6, 0, 10.8], from: "B" },
    T6: { kind: "paper", pos: [-1.4, 0, 8.8], from: "B" },
    NS2: { kind: "noshoot", pos: [-1.12, 0, 8.45], from: "B" },
    P2: { kind: "popper", pos: [6.3, 0, 8.6], from: "C" },
    DT: { kind: "turner", pos: [7.0, 0, 9.8], from: "C" },
    MV: { kind: "mover", pos: [3.6, 0, 10.4], from: "C" },
    T4: { kind: "paper", pos: [8.6, 0, 7.4], from: "D" },
    T5: { kind: "paper", pos: [10.4, 0, 7.9], from: "D" },
    NS3: { kind: "noshoot", pos: [10.6, 0, 7.49], from: "D" },
    T8: { kind: "paper", pos: [11.8, 0, 6.6], from: "D" },
  };
  const ZONE_POINTS = { A: 5, C: 3, D: 1, S: 5 }; // Minor (Production); S = steel
  const PAPER_KINDS = ["paper", "swinger", "turner", "mover"];
  const STEEL_COUNT = { popper: 1, plates: 2 };
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
    [1880, "T2", "C", [-0.11, 0.04]],
    [2260, "P1", "S", 0],
    [3100, "SW", "A", [0.01, -0.05]],
    [3360, "SW", "C", [0.1, 0.08]],
    [5750, "PL", "S", 0],
    [5960, "PL", "S", 1],
    [6230, "T3", "A", [0.02, -0.03]],
    [6450, "T3", "A", [-0.03, 0.03]],
    [6740, "T7", "A", [0.0, -0.05]],
    [6960, "T7", "A", [0.03, 0.02]],
    [7240, "T6", "A", [-0.05, -0.02]],
    [7460, "T6", "C", [-0.13, 0.06]],
    [10300, "P2", "S", 0],
    [10720, "DT", "A", [0.0, -0.04]],
    [10960, "DT", "A", [0.03, 0.03]],
    [11560, "MV", "A", [0.01, -0.03]],
    [11920, "MV", "A", [-0.03, 0.02]],
    [13200, "T4", "A", [-0.02, -0.05]],
    [13430, "T4", "A", [0.03, 0.01]],
    [13760, "T5", "A", [-0.04, -0.03]],
    [13990, "T5", "A", [-0.05, 0.0]],
    [14330, "T8", "A", [0.01, -0.03]],
    [14560, "T8", "D", [0.17, 0.12]],
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
  const IMPACT = 0.045; // s from a shot to its bullet arriving, for the picture and the hit cues
  const MAG = 15; // Production: at most 15 rounds in a magazine at the start signal
  // Stage-time events (seconds).
  const EVENTS = {
    swingerRelease: 2.34,
    reload: [7.46, 7.6, 8.3, 8.7], // slide lock, magazine out, new magazine in, slide forward
    // P2 starts both the drop turner and the mover
    turnerRelease: 10.38,
    moverRelease: 10.38,
    mover: { start: 10.48, dur: 3.0 }, // crosses the rail at constant speed
    moves: [
      [3.48, 5.5, "A", "B"],
      [7.55, 10.18, "B", "C"],
      [12.0, 12.95, "C", "D"],
    ],
    // area D shoots through a low port: down to one knee, and stay there
    kneel: [12.95, 13.15],
  };
  // [from ms, to ms, playback rate]: slow motion below 1, fast forward above.
  const RAMPS = [
    [2850, 3085, 0.45],
    [3085, 3150, 0.04], // bullet time: the first swinger shot in flight
    [3150, 3450, 0.45],
    [3480, 5500, 1.4],
    [7550, 10180, 1.3], // the reload on the run
    [11250, 12050, 0.45],
    [14545, 14612, 0.05], // bullet time: the last shot
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
  // video time when the last bullet has landed (the final shot plays in bullet time)
  const STAGE_END = videoOfStage(SHOTS[SHOTS.length - 1].ms + 90);
  // Everything after the stage moves later by SHIFT (kept on the 0.5 s beat grid).
  const SHIFT = Math.ceil((STAGE_END + 0.6 - 20) * 2) / 2;
  const END_HOLD = 0.8; // RANGE IS CLEAR holds this long before the end card
  // length of the original cut, before the inserted chapters (see the timeline below)
  const BASE_DURATION = 28 + SHIFT + END_HOLD;
  const vt = (ms) => videoOfStage(ms);
  // The swinger's pendulum and the camera cuts [video s, blend s, rig]; both
  // are shared with scripts/reel-audio.mjs through MARKS.
  const SWING = {
    L: 1.05,
    pivot: 2.45,
    theta0: 1.15,
    period: 1.5,
    damping: 0.18,
  };
  const HARD = 0.001;
  const CUTS = [
    // [at, blend (s), rig, how]: a blend runs in a straight line, "arc"
    // swings round the shooter the short way, "arcBack" round behind him
    // (never in front of the muzzle); a blend of HARD is a hard cut
    [vt(2420), HARD, "swinger"],
    [vt(3070), 0.3, "orbitSwinger"],
    [vt(3150), HARD, "swinger"],
    [vt(3480) - 0.08, HARD, "side"],
    [vt(5150), HARD, "shoulder"],
    [vt(7500), HARD, "reload"],
    [vt(10120), 0.45, "drone", "arc"],
    [vt(11120), 0.42, "mover"],
    [vt(12000), HARD, "side"],
    [vt(12900), 0.45, "low", "arcBack"],
    [vt(14540) - 0.12, 0.35, "orbitEnd", "arc"],
    [STAGE_END + 0.05, HARD, "overview"],
  ];

  // Stage time (ms) shown by the shot timer at video time t.
  function stageMs(t) {
    if (t < BEEP) return 0;
    if (t < FREEZE) return (t - BEEP) * 1000;
    if (t < RESUME) return FREEZE_MS;
    return Math.min(stageOfVideo(t), STAGE_MS);
  }

  // `short` is the site rail's label where the full name does not fit; the
  // full name stays in the button's title and aria-label.
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
      short: { ko: "커맨드", en: "Ready" },
      sub: { ko: "Make Ready → Standby", en: "Make Ready → Standby" },
    },
    {
      t: BEEP,
      ko: "시작 신호",
      en: "Start signal",
      short: { ko: "시작 신호", en: "Signal" },
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
      short: { ko: "채점", en: "Scoring" },
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
      t: 22.02 + SHIFT, // the first command
      ko: "레인지 클리어",
      en: "Range is clear",
      short: { ko: "클리어", en: "Clear" },
      sub: { ko: "안전 확인", en: "Safety checks" },
    },
  ];

  const fmt2 = (ms) => (Math.round(ms / 10) / 100).toFixed(2);
  // width of a digits() string in units of its size
  const timeWidth = (str) =>
    [...str].reduce((w, ch) => w + (ch === "." || ch === " " ? 0.3 : 0.62), 0);

  // The opening's on-screen copy ([English, Korean]), here so that the font
  // preloader can fetch every glyph. Times are in the original cut; the
  // stretches play the motto at 0.61 and the commands at 0.55 of their pace,
  // so the scenes time each landing on the final timeline (since()): every
  // text settles in about 0.2 s and then holds still while the picture
  // around it keeps moving. The three words of the motto slam in on
  // sixteenths and are all still by 0.4 s; they hold together, three
  // seconds, until the wipe runs across them in reading order (it reaches
  // DILIGENTIA at 3.6 s). The three range commands build up, each on its
  // own stab and each read, with its meaning and nothing else new, for two
  // seconds or more before the next one lands: on the final timeline 3.62,
  // 5.75 and 8.00 s, the last two on the beep's eighth-note grid (the beep
  // is at 10.50).
  const OPENING = {
    // [Latin, English, Korean, slam]
    dvc: [
      ["DILIGENTIA", "ACCURACY", "정확", 0],
      ["VIS", "POWER", "파워", 0.0764],
      ["CELERITAS", "SPEED", "속도", 0.1529],
    ],
    // the wipe from the motto to the commands, [from, to] (3.44–3.84 s on
    // the final timeline): MAKE READY has risen behind it, and is uncovered
    // (3.55–3.65 s) on its stab
    wipe: [2.103, 2.329],
    // [command, its meaning, at]
    commands: [
      ["MAKE READY", ["Load and holster", "장전하고 준비"], 2.2075],
      ["ARE YOU READY?", ["Silence = ready", "준비됐습니까?"], 3.3807],
      ["STANDBY", ["Beep in 1–4 s", "대기 — 1~4초 뒤 신호음"], 4.6214],
    ],
    seconds: ["s", "초"],
    // STANDBY's heartbeat: a bar of four into the beep, which lands on the
    // downbeat (8.5, 9.0, 9.5 and 10.0 s on the final timeline)
    hearts: [4.8971, 5.1729, 5.4486, 5.7243],
    // the sights split: each half's name, and where its eye focuses
    iron: {
      name: ["IRON SIGHTS", "아이언 사이트"],
      focus: ["FOCUS: FRONT SIGHT", "초점 → 가늠쇠"],
    },
    optic: { name: ["OPTIC", "옵틱"], focus: ["FOCUS: TARGET", "초점 → 표적"] },
  };

  // The iris onto the end card opens at this time of sceneEnd's clock (the
  // original cut less SHIFT and END_HOLD): 0.3 s past the range-is-clear
  // stretch, so that RANGE IS CLEAR holds its two seconds before the iris
  // reaches it.
  const END_IRIS = 24.6;

  // Each line stays up long enough to read on the final timeline: at most
  // 6 Korean letters or 13 English characters a second, and two and a half
  // seconds or more (times here are in the original cut; the stretches slow
  // some of it down). The motto goes without one: its meaning is on screen,
  // under each word, and so do the first two range commands: each comes
  // with its meaning, and a line under them would leave too little time to
  // read it all before the next one lands. The opening's lines run with its
  // beats (on the final timeline): the start signal from STANDBY up to the
  // freeze (8.02–11.30 s; short, as STANDBY and its 1–4 s are read first),
  // then each sight picture, the iron sights from the push into the rear
  // sight (12.27–15.71) and the optic from just after the first dry recoil
  // (15.91–18.78).
  const CAPTIONS = [
    [4.63, 6.8, "신호음에 시작!", "The beep means go."],
    [
      7.6,
      10.38,
      "아이언 사이트 — 초점은 가늠쇠에.",
      "Iron sights: focus on the front sight.",
    ],
    [10.54, 12.85, "옵틱 — 초점은 표적에.", "Optic: focus on the target."],
    // targets and scoring: one line for each of its two beats (the table,
    // then the cards), saying what the beat shows (3.6 and 3.2 s on screen)
    [
      13.047,
      14.466,
      "종이 표적은 A·C·D 존으로 채점.",
      "Paper scores by zone: A, C, D.",
    ],
    [
      14.5429, // the cards (SCORING_CARDS)
      15.945,
      "철판은 넘어져야 득점, 노슛·미스는 −10점.",
      "Steel must fall; no-shoot/miss −10.",
    ],
    // The stage runs at its own pace, so its lines sit back to back, each a
    // little ahead of its beat (a line lands about 0.4 s after it starts),
    // and name the targets as their 3D labels do (SWINGER, PORT, DROP
    // TURNER, MOVER, LOW PORT).
    [
      16.1,
      vt(3150) - 0.37,
      "롱 코스 — 포퍼를 쓰러뜨리면 스윙어가 움직입니다.",
      "Long course. The popper starts the swinger.",
      ["POPPER", "SWINGER"], // the stage targets it names, drawn up large
    ],
    [
      vt(3150) - 0.21, // the run to B starts at vt(3480)
      vt(7460) - 0.25,
      "이동 중에도 총구는 180° 안 — 이어서 포트 사격.",
      "Muzzle inside 180°, then through the port.",
      ["PORT"],
    ],
    [
      vt(7460) - 0.09, // the slide locks back on the 15th shot
      vt(10300) - 0.17,
      // short: the reload panel's title (재장전 / RELOAD) shares the beat
      "빈 탄창은 달리며 교체.",
      "Swap mags on the run.",
    ],
    [
      vt(10300) - 0.01, // the popper that starts both
      vt(12050) + 0.23,
      "포퍼 하나로 드롭 터너·무버 작동.",
      "One popper, two targets.",
      ["POPPER", "DROP TURNER", "MOVER"],
    ],
    [
      vt(12050) + 0.39,
      STAGE_END + 0.55,
      "낮은 포트는 무릎쏴 — 마지막 발에 타이머가 멈춥니다.",
      "Low port: kneel. Last shot stops the clock.",
      ["LOW PORT"],
    ],
    [
      // while the equation builds and holds, gone as it leaves
      20.005 + SHIFT,
      21.948 + SHIFT,
      "점수 ÷ 시간 = 히트 팩터, 높을수록 승리.",
      "Points ÷ time. Highest hit factor wins.",
    ],
    [
      // from the first command through the RANGE IS CLEAR hold, until just
      // before the iris to the end card
      22.06 + SHIFT,
      END_IRIS - 0.1 + SHIFT + END_HOLD,
      "언로드, 쇼 클리어, 해머 다운 — 끝까지 안전.",
      "Unload, show clear, hammer down.",
    ],
    [
      // the end card's anniversary line, said again as the lettering lands;
      // its exit (the last 0.3 s) ends with the reel, as the card, its
      // credit and the chrome fade out
      END_IRIS + 0.3 + SHIFT + END_HOLD,
      27.7 + SHIFT + END_HOLD,
      "IPSC 50주년, 1976–2026.",
      "IPSC at fifty.",
    ],
  ];

  // Sound cues, shared with scripts/reel-audio.mjs so picture and sound stay in sync.
  const CUES = [
    // the three words of the motto slam in, and the swell runs into the wipe
    ...OPENING.dvc.map(([, , , t], k) => ({
      t,
      type: "hit",
      v: 0.8 + k * 0.05,
    })),
    { t: 1.81, type: "swell" },
    { t: OPENING.wipe[0], type: "whoosh", v: 0.7 },
    // a stab on each range command; the magazine loads round by round
    ...OPENING.commands.map(([, , t], k) => ({
      t,
      type: "stab",
      v: k === 2 ? 1 : 0.9,
    })),
    ...Array.from({ length: MAG }, (_, i) => ({
      t: OPENING.commands[0][2] + i * 0.04,
      type: "click",
      v: 0.35,
    })),
    // STANDBY: a riser that peaks 0.24 s before the beep on screen (its dur
    // is in original seconds and stretches with the scene), and the heartbeat
    { t: 4.65, type: "riser", dur: 1.22 },
    ...OPENING.hearts.map((t) => ({ t, type: "heart" })),
    { t: BEEP, type: "beep" },
    { t: BEEP, type: "drop" },
    { t: 6.32, type: "whoosh", v: 0.6 },
    { t: FREEZE, type: "freeze" },
    // line of sight, push in, split, settle, focus (on the beep grid's kick
    // at 14.5 s), two dry recoils (on its kicks at 15.5 and 16.5 s), the
    // guns lowered, the divisions; see SIGHT
    { t: 6.95, type: "blip", v: 0.45 },
    { t: 7.06, type: "tick", v: 0.45 },
    { t: 7.25, type: "tick", v: 0.45 },
    { t: 7.3, type: "blip", v: 0.6 },
    { t: 7.45, type: "riser", dur: 0.5 },
    { t: 8.0, type: "hit", v: 0.7 },
    { t: 9.42, type: "click", v: 0.7 },
    { t: 9.5, type: "blip", v: 0.6 },
    { t: 9.56, type: "blip", v: 0.5 },
    { t: 10.177, type: "whoosh", v: 0.35 },
    { t: 10.984, type: "whoosh", v: 0.35 },
    { t: 12.28, type: "whoosh", v: 0.45 },
    { t: 12.78, type: "whoosh", v: 0.6 },
    { t: 13.0, type: "hit", v: 0.6 },
    // the zones lit in turn, a second apart on the scoring hit's beat, then
    // the three cards, the popper shot and its fall (see sceneTargets)
    ...[13.3857, 13.7714, 14.1571].map((t) => ({ t, type: "blip", v: 0.55 })),
    { t: 14.5429, type: "tick", v: 0.8 },
    { t: 14.7357, type: "steel" },
    { t: 14.9286, type: "clank", v: 0.5 }, // as the steel icon lands
    { t: 15.62, type: "riser", dur: 0.38 },
    { t: RESUME, type: "drop" },
    ...SHOTS.flatMap((s) => [
      { t: s.t, type: "shot", v: 1 },
      { t: s.t + 0.32 + (s.i % 3) * 0.04, type: "brass", v: 0.25 },
    ]),
    // the moving targets, the reload and the speed ramps
    // Each hit sounds like its kind of target and lands as the target reacts on
    // screen, in stage time so slow motion stretches it: paper thuds, a popper
    // rings and falls over (see drawStageTarget), plates ping. The hit is the
    // bullet arriving (IMPACT), so bullet time cannot pull it ahead of the
    // picture. `target` and `k` (which plate) let reel-audio.mjs place it in stereo.
    ...SHOTS.flatMap((s) => {
      const at = (ms) => ({ t: vt(s.ms + ms), target: s.target });
      const hit = at(IMPACT * 1000);
      if (TARGETS[s.target].kind === "popper")
        return [
          { ...hit, type: "popper" },
          { ...at(450), type: "fall", v: 0.7 },
        ];
      if (s.zone === "S") return [{ ...hit, type: "plates", k: s.hit }];
      return [{ ...hit, type: "paper", v: s.zone === "A" ? 0.9 : 0.7 }];
    }),
    // The swinger's latch lets go (its swings, and the mover, are sampled in
    // reel-audio.mjs). The drop turner (see turnerAngle) is released, swings
    // round to stop facing the shooter, then turns away against its stop.
    ...Object.keys(TARGETS).flatMap((key) => {
      const kind = TARGETS[key].kind;
      if (kind === "swinger")
        return [
          { t: vt(EVENTS.swingerRelease * 1000), type: "latch", target: key },
        ];
      if (kind !== "turner") return [];
      return [
        [0, "latch", 0.8],
        [0, "turn", 0.8, 300],
        [220, "clack", 0.9],
        [850, "turn", 0.6, 550],
        [1330, "clack", 0.65],
      ].map(([ms, type, v, dur]) => {
        const at = EVENTS.turnerRelease * 1000 + ms;
        const cue = { t: vt(at), type, v, target: key };
        return dur ? { ...cue, dur: vt(at + dur) - vt(at) } : cue;
      });
    }),
    // Reload on the move: the slide locks back on the last round, the empty
    // magazine drops and hits the ground, a fresh one seats, the slide slams home.
    { t: vt(EVENTS.reload[0] * 1000 + 60), type: "lock", v: 0.8 },
    { t: vt(EVENTS.reload[1] * 1000), type: "magout" },
    { t: vt(EVENTS.reload[1] * 1000 + 420), type: "magdrop", v: 0.7 },
    { t: vt(EVENTS.reload[2] * 1000), type: "magin" },
    { t: vt(EVENTS.reload[3] * 1000), type: "slidefwd" },
    // Speed ramps: a tape stop into slow motion (deeper the slower it gets), a
    // riser into fast forward and a tape flutter while it lasts.
    ...RAMPS.map(([a, b, rate], i) => {
      // out of bullet time into a slow ramp: spin back up, not another stop
      const prev = i > 0 && RAMPS[i - 1][1] === a ? RAMPS[i - 1][2] : 1;
      if (rate < 1 && rate > prev)
        return { t: vt(a), type: "ffwd", v: 0.3, dur: 0 };
      return rate < 1
        ? { t: vt(a), type: "slowmo", v: 1 - rate }
        : {
            t: vt(a),
            type: "ffwd",
            v: Math.min(1, 0.4 + (rate - 1) * 0.35),
            dur: vt(b) - vt(a),
          };
    }),
    // the hit factor (see sceneHitFactor): the time flies in, the points
    // roll, the operators slam on the off-beat and the hit factor lands on
    // the beat, at 20.3675
    { t: 19.95 + SHIFT, type: "whoosh", v: 0.8 },
    ...Array.from({ length: 6 }, (_, i) => ({
      t: 20.0 + SHIFT + i * 0.025,
      type: "tick",
      v: 0.3,
    })),
    { t: 20.184 + SHIFT, type: "hit", v: 0.7 },
    ...Array.from({ length: 6 }, (_, i) => ({
      t: 20.2625 + SHIFT + i * 0.021,
      type: "tick",
      v: 0.3,
    })),
    { t: 20.3675 + SHIFT, type: "hit", v: 1 },
    // range is clear (see sceneClear and CLEAR_BEATS): a stab on each
    // command, 2.4 s apart on screen, and the pistol
    { t: 22.022 + SHIFT, type: "stab", v: 0.8 },
    { t: 22.345 + SHIFT, type: "clank", v: 0.6 }, // the magazine drops free
    { t: 22.513 + SHIFT, type: "slide", v: 0.6 }, // on the lock
    { t: 23.174 + SHIFT, type: "stab", v: 0.8 },
    { t: 23.19 + SHIFT, type: "slide", v: 0.8 }, // the slide going home
    { t: 23.435 + SHIFT, type: "click", v: 0.9 }, // hammer down
    { t: 24.254 + SHIFT, type: "stab", v: 1 },
    // the iris opening onto the end card, rising into the logo hit
    { t: END_IRIS + SHIFT + END_HOLD, type: "whoosh", v: 0.5 },
    { t: END_IRIS + 0.2 + SHIFT + END_HOLD, type: "logo" },
  ];

  // On-screen copy of the explained scenes after the divisions chapter
  // (sceneTargets, sceneHitFactor, sceneClear, sceneEnd), [English, Korean],
  // here so that the font preloader can fetch every glyph. Every line lands
  // within 0.35 s on screen and then holds still for two seconds or more,
  // and each beat carries no more new text than a first-time viewer reads
  // in its hold (about 6 Korean letters or 13 English characters a second);
  // its caption says the same thing.
  const FINALE_COPY = {
    scoring: {
      title: ["SCORING", "채점"],
      major: ["MAJOR", "메이저"],
      minor: ["MINOR", "마이너"],
      zones: {
        A: ["CENTRE", "중앙"],
        C: ["MIDDLE", "중간"],
        D: ["OUTER", "외곽"],
      },
      steel: ["STEEL", "철판"],
      steelSub: ["MUST FALL", "넘어져야 득점"],
      noShoot: ["NO-SHOOT", "노슛"],
      miss: ["MISS", "미스"],
    },
    hitFactor: {
      points: ["POINTS", "점수"],
      time: ["TIME", "시간"],
      hf: ["HIT FACTOR", "히트 팩터"],
    },
    clear: [
      ["UNLOAD AND SHOW CLEAR", "언로드 · 쇼 클리어"],
      ["HAMMER DOWN, HOLSTER", "해머 다운 · 홀스터"],
      ["RANGE IS CLEAR", "레인지 클리어"],
    ],
    // the association's names as the site gives them (index.html)
    end: {
      name: ["KOREA PRACTICAL SHOOTING ASSOCIATION", "대한민국 실용사격 협회"],
      years: ["IPSC  ·  50 YEARS", "IPSC 1976–2026  ·  50주년", "50주년"],
      // the motion-design credit (opt.credit): [label, Korean label, name]
      credit: ["MOTION DESIGN", "모션 디자인", "Claude"],
    },
  };

  // The handgun divisions chapter (sceneDivisions) runs in its own local time
  // lt, 0..dur, while the game clock stays frozen. One idea at a time: a
  // title, then the five main handgun divisions one after another, each with
  // its name and one big label for what sets it apart, then the five in a
  // line-up. Every beat holds its copy still for at least 2.2 s (the
  // line-up's, the payoff, for about 4 s), longer than its words take to
  // read at 6 Korean letters or 13 English characters a second; Standard's
  // holds 0.85 s longer for its three box dimensions. beats are the
  // entrances, in local seconds (the title, the five divisions, the
  // line-up); each holds until the next.
  // Its captions ([from, to, ko, en]) and sound cues ({ lt, type, v }) are in
  // local seconds too, derived from the beats, for the timeline to shift into
  // place. All of its on-screen copy lives here ([English, Korean]), so that
  // the font preloader can fetch every glyph.
  const DIV_BEATS = [0.0, 2.7, 5.05, 7.4, 10.6, 12.95, 15.3];
  const DIV_DUR = 19.8;
  const DIV = {
    dur: DIV_DUR,
    beats: DIV_BEATS,
    // the title's line, handing over to Production as its copy rises, and
    // the line-up's, gone before the blinds close
    captions: (([, p, , , , , l]) => [
      [
        0.1,
        p + 0.1,
        "디비전은 장비로 나뉩니다.",
        "Equipment sets the division.",
      ],
      [
        l + 0.2,
        l + 3.9,
        "클래식과 리볼버도 있습니다.",
        "Classic and Revolver, too.",
      ],
    ])(DIV_BEATS),
    // one cue on each visual beat, never two within 0.25 s
    cues: (([, p, po, s, o, op, l]) => [
      { lt: 0.3, type: "whoosh", v: 0.45 }, // the pistol inks in
      { lt: p, type: "blip", v: 0.6 }, // Production
      { lt: po, type: "blip", v: 0.6 }, // Production Optics
      { lt: po + 0.3, type: "click", v: 0.8 }, // the red dot seats
      { lt: s, type: "slide", v: 0.5 }, // Standard: the red dot lifts off
      { lt: s + 0.25, type: "clank", v: 0.9 }, // the box slams shut
      { lt: o, type: "whoosh", v: 0.5 }, // Optics: the box opens
      { lt: o + 0.3, type: "click", v: 0.8 }, // the red dot seats
      { lt: op, type: "stab", v: 0.8 }, // Open
      { lt: op + 0.3, type: "clank", v: 0.7 }, // the compensator seats
      { lt: l, type: "whoosh", v: 0.6 }, // the line-up
      { lt: l + 0.3, type: "hit", v: 0.45 }, // its names
      { lt: DIV_DUR - 0.25, type: "whoosh", v: 0.45 }, // the blinds close
    ])(DIV_BEATS),
    title: {
      kicker: ["IPSC HANDGUN", "IPSC 핸드건"],
      name: ["DIVISIONS", "디비전"],
      sub: ["Set by equipment", "장비로 나뉩니다"],
    },
    // the five main divisions, in order. label: what sets each apart; kit:
    // the pistol's parts (see drawGun); marks: the parts the label points
    // at. Production Optics' name grows out of Production's. Standard's
    // "no optic, no compensator" is drawn on the pistol (crossed outlines).
    specs: [
      {
        name: ["PRODUCTION", "프로덕션"],
        label: ["IRON SIGHTS", "아이언 사이트"],
        kit: {},
        marks: ["rear", "front"],
      },
      {
        name: ["PRODUCTION OPTICS", "프로덕션 옵틱스"],
        label: ["+ RED DOT", "레드 닷 추가"],
        kit: { optic: 1 },
        marks: ["optic"],
      },
      {
        name: ["STANDARD", "스탠더드"],
        label: ["FITS THE BOX", "규격 박스 안에"],
        kit: { flush: 1, magwell: 0.3 },
        marks: [],
      },
      {
        name: ["OPTICS", "옵틱스"],
        label: ["NO COMPENSATOR", "컴펜세이터 금지"],
        kit: { optic: 1, magwell: 0.65 },
        marks: ["comp"],
      },
      {
        name: ["OPEN", "오픈"],
        label: ["RED DOT + COMPENSATOR", "레드 닷 + 컴펜세이터"],
        kit: { optic: 1, comp: 1, extMag: 1, magwell: 1 },
        marks: ["optic", "comp"],
      },
    ],
    // Standard's box gauge, inside: width, height, depth
    box: ["225 mm", "150 mm", "45 mm"],
    others: ["+ CLASSIC · REVOLVER", "+ 클래식 · 리볼버"],
  };

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

  // CZ Shadow 2, right side (ejection port), muzzle to the right, in
  // millimetres, slide top at y = 0. Every outline is traced from a side
  // projection of a 3D model of the pistol (scratch pipeline: depth map →
  // per-part masks → simplified polygons), scaled to the 217 mm overall
  // length, so the slide/frame split, the squared trigger guard, the grip
  // panel, the sights and the controls sit where they do on the real gun.
  const GUN = {
    cx: 108.5,
    cy: 80,
    muzzle: [217.0, 16.6],
    port: [111.3, 13.8], // centre of the ejection port
    sight: [205.2, 4.6], // fibre-optic front sight
    rearSight: [41.3, 3.5],
    barrel: rect(93.6, 11.1, 124.9, 11.1),
    slide: shape(
      "M 29.2,0.0 L 32.7,0.0 L 33.0,0.8 L 36.5,1.5 L 37.8,2.5 L 51.1,5.0 L 52.4,5.5 L 54.1,7.8 L 198.9,7.6 L 199.6,7.0 L 199.4,4.0 L 198.9,3.5 L 198.9,2.3 L 199.6,1.3 L 203.4,2.8 L 208.9,2.8 L 210.5,1.8 L 211.5,1.8 L 212.7,2.8 L 212.7,5.5 L 214.7,10.6 L 215.2,11.1 L 216.2,11.1 L 216.7,11.6 L 216.7,13.1 L 217.5,13.3 L 217.5,14.9 L 216.7,15.1 L 216.7,23.7 L 24.4,23.7 L 24.4,22.4 L 27.4,13.3 L 27.4,10.6 L 29.7,9.6 Z",
    ),
    port_: shape(
      "M 126.9,7.6 L 126.9,12.3 L 122.6,17.4 L 120.1,18.9 L 117.8,19.6 L 110.8,20.1 L 97.7,19.9 L 97.4,17.1 L 95.7,16.6 L 95.7,7.8 Z",
    ),
    hood: rect(97.0, 8.5, 29.6, 10.3), // the barrel hood seen through the port
    extractor: rect(80.6, 11.6, 15.1, 5.5),
    frame: shape(
      "M 24.4,23.9 L 216.7,23.9 L 216.7,24.9 L 215.5,25.4 L 214.2,27.2 L 214.5,39.0 L 214.2,40.0 L 212.5,41.8 L 212.5,43.6 L 211.7,46.1 L 210.7,46.8 L 181.3,47.1 L 180.7,46.8 L 180.7,45.1 L 180.0,44.1 L 176.2,44.1 L 175.5,44.8 L 175.5,46.8 L 175.0,47.1 L 150.5,47.3 L 146.0,45.8 L 142.7,45.8 L 138.2,47.3 L 134.2,50.9 L 132.2,55.4 L 131.9,64.2 L 132.4,75.0 L 129.9,77.8 L 126.6,79.8 L 121.8,81.1 L 107.0,81.3 L 96.2,80.1 L 83.3,75.3 L 79.5,75.5 L 75.8,77.3 L 74.0,78.8 L 71.7,82.3 L 71.2,83.8 L 71.0,88.1 L 70.5,88.6 L 68.5,96.2 L 67.5,98.2 L 67.2,100.2 L 66.2,102.2 L 66.0,104.2 L 64.9,106.5 L 63.4,112.5 L 62.4,114.5 L 61.4,119.1 L 60.4,121.1 L 60.2,123.1 L 58.4,127.1 L 57.9,132.7 L 58.9,138.2 L 58.2,139.0 L 10.3,139.0 L 7.8,138.2 L 2.3,134.7 L 2.0,128.9 L 2.5,127.4 L 2.5,124.1 L 4.3,119.6 L 4.5,117.6 L 5.5,115.3 L 6.3,111.8 L 6.8,111.3 L 7.6,107.7 L 8.1,107.2 L 8.3,105.2 L 8.8,104.7 L 15.1,83.3 L 26.7,66.0 L 28.4,61.7 L 28.7,56.9 L 26.4,51.6 L 22.9,48.3 L 17.9,46.3 L 10.1,46.3 L 5.3,45.1 L 0.0,42.0 L 0.0,39.5 L 6.3,41.0 L 10.3,41.0 L 14.9,40.3 L 17.6,39.0 L 21.9,35.2 L 23.7,32.0 L 24.4,29.2 L 24.4,26.2 L 23.7,24.4 Z",
    ),
    guard: shape(
      "M 113.8,47.1 L 118.3,47.1 L 122.1,48.6 L 124.9,50.9 L 127.4,55.1 L 128.4,59.4 L 128.4,71.7 L 126.9,74.8 L 124.4,76.5 L 107.2,76.5 L 97.9,75.5 L 89.6,72.8 L 86.9,69.5 L 85.3,65.7 L 85.3,60.9 L 85.8,58.9 L 87.6,55.6 L 90.4,52.9 L 92.1,51.9 L 93.4,50.1 L 94.9,49.6 L 97.7,49.3 L 98.2,49.8 L 98.7,49.1 L 108.0,47.8 L 109.8,47.8 L 110.5,48.3 Z",
    ),
    grip: shape(
      "M 59.9,46.1 L 70.7,46.1 L 71.7,46.6 L 71.7,48.3 L 48.1,123.1 L 47.1,128.6 L 47.1,138.2 L 16.1,138.5 L 14.6,132.9 L 14.6,125.4 L 21.4,100.7 L 23.2,95.4 L 26.4,97.9 L 28.4,97.9 L 29.7,97.4 L 31.7,95.2 L 32.0,92.1 L 30.7,90.1 L 29.0,89.1 L 25.2,89.4 L 25.2,88.9 L 40.0,65.2 L 42.0,58.7 L 42.3,51.6 L 55.1,46.3 Z",
    ),
    // the hammer, down: its spur between the slide and the beavertail, its
    // body behind the frame; it swings about the hammer pin to cock
    hammer: shape(
      "M 21.6,10.6 L 25.7,9.9 L 27.4,11.1 L 27.4,24.2 L 28.7,27.2 L 32.7,34.2 L 34.0,38.3 L 32.4,42.3 L 28.7,41.8 L 26.7,37.3 L 23.7,28.2 L 19.6,24.7 L 19.1,20.1 L 20.1,14.1 Z",
    ),
    trigger: shape(
      "M 108.0,47.8 L 109.8,47.8 L 109.8,48.3 L 107.7,49.1 L 107.7,51.4 L 106.7,54.1 L 106.7,59.4 L 107.5,61.7 L 109.3,64.9 L 112.8,68.2 L 115.3,69.7 L 116.8,70.0 L 116.8,71.2 L 112.5,71.0 L 109.3,69.2 L 106.5,66.7 L 105.2,64.9 L 103.2,60.2 L 102.7,54.4 L 98.4,49.8 L 98.7,49.1 Z",
    ),
    hammerPivot: [30.7, 38.6], // the hammer pin
    safety: shape(
      "M 49.1,26.4 L 56.4,26.4 L 65.7,30.0 L 66.5,31.0 L 66.5,33.0 L 64.7,38.0 L 62.4,39.0 L 48.1,39.5 L 45.6,39.5 L 44.3,39.0 L 42.3,37.0 L 41.3,34.7 L 41.0,32.7 L 41.5,30.5 L 42.3,29.0 L 44.8,26.7 Z",
    ),
    stopPin: [99.1, 31.7], // slide-stop pin, with its boss
    // hammer pin, trigger pin and the sear pin: [x, y, r]
    pins: [
      [30.7, 38.6, 2.3],
      [101.2, 40.8, 2.2],
      [114.2, 30.2, 1.0],
    ],
    screws: [[23.7, 92.1]],
    magBody: shape("M 55.9,139.0 L 16.6,139.0 L 34.7,78.5 L 74.0,78.5 Z"),
    magPad: shape(
      "M 11.1,139.2 L 58.2,139.2 L 57.9,156.1 L 56.6,157.6 L 55.4,158.1 L 33.5,158.1 L 33.2,158.8 L 14.3,158.8 L 14.3,158.3 L 11.8,156.1 L 11.6,152.6 L 15.4,140.2 Z",
    ),
    magPivot: [36.3, 139.0],
    // the base pad: its seam with the frame, its x extent there and the grip's
    // slant (mm back per mm down), for the extended pad
    pad: { top: 139.0, x0: 14.1, x1: 58.2, slope: 0.3 },
    serrRear: [
      shape("M 41.0,9.6 L 36.7,20.6"),
      shape("M 45.9,9.6 L 41.6,20.6"),
      shape("M 50.9,9.6 L 46.5,20.6"),
      shape("M 55.6,9.6 L 51.3,20.6"),
      shape("M 59.9,9.6 L 55.6,20.6"),
      shape("M 64.7,9.6 L 60.4,20.6"),
      shape("M 69.4,9.6 L 65.0,20.6"),
      shape("M 74.8,9.6 L 70.4,20.6"),
    ],
    serrFront: [
      shape("M 166.7,9.6 L 162.3,20.6"),
      shape("M 171.2,9.6 L 166.9,20.6"),
      shape("M 176.2,9.6 L 171.9,20.6"),
      shape("M 180.9,9.6 L 176.5,20.6"),
      shape("M 186.0,9.6 L 181.7,20.6"),
      shape("M 189.9,9.6 L 185.6,20.6"),
      shape("M 194.9,9.6 L 190.6,20.6"),
      shape("M 199.4,9.6 L 195.0,20.6"),
    ],
    grooves: [
      shape("M 67.5,82.6 L 71.5,82.6"),
      shape("M 67.0,85.0 L 71.0,85.0"),
      shape("M 66.8,87.4 L 70.8,87.4"),
      shape("M 66.0,89.8 L 70.0,89.8"),
      shape("M 65.3,92.2 L 69.3,92.2"),
      shape("M 64.5,94.7 L 68.5,94.7"),
      shape("M 63.7,97.1 L 67.8,97.1"),
      shape("M 63.0,99.5 L 67.0,99.5"),
      shape("M 62.2,101.9 L 66.3,101.9"),
      shape("M 61.7,104.3 L 65.8,104.3"),
      shape("M 60.7,106.7 L 64.7,106.7"),
      shape("M 60.0,109.2 L 64.0,109.2"),
      shape("M 59.2,111.6 L 63.2,111.6"),
      shape("M 58.5,114.0 L 62.5,114.0"),
      shape("M 58.0,116.4 L 62.0,116.4"),
      shape("M 57.2,118.8 L 61.2,118.8"),
      shape("M 56.2,121.2 L 60.2,121.2"),
      shape("M 55.7,123.7 L 59.7,123.7"),
      shape("M 54.9,126.1 L 59.0,126.1"),
      shape("M 53.9,128.5 L 58.0,128.5"),
      shape("M 53.7,130.9 L 57.7,130.9"),
      shape("M 53.9,133.3 L 58.0,133.3"),
      shape("M 54.2,135.7 L 58.2,135.7"),
    ],
    rail: shape("M 139.0,45.3 L 212.5,45.3"), // the accessory rail's top edge
  };

  // The IPSC Target (rule book Appendix B2), in centimetres, centre of the
  // cardboard at the origin, y down. The scoring area is a 45 × 57 octagon
  // (the D line) with a 0.5 cm non-scoring border, so the cardboard is 46 × 58.
  // The zones are not concentric: the C line starts at the two ends of the D
  // line's top edge, so the D zone exists only at the sides and the bottom,
  // and the A zone is a tall octagon (15 wide, 32.5 high) just under the top
  // edge, narrow at the top and the bottom. All three zones' shoulders sit at
  // the same height (19 cm below the top of the D line).
  const TARGET_TOP = -28.5; // the D line's top edge
  const tgtPts = (pairs, close) =>
    shape(
      pairs
        .map(([x, y], k) => `${k ? "L" : "M"} ${x},${y + TARGET_TOP}`)
        .join(" ") + (close ? " Z" : ""),
    );
  const TGT = {
    // cardboard: the D line pushed out by 0.5 cm
    outer: shape(
      "M -7.742,-29 L 7.742,-29 L 23,-9.674 L 23,9.674 L 7.742,29 L -7.742,29 L -23,9.674 L -23,-9.674 Z",
    ),
    d: tgtPts(
      [
        [-7.5, 0],
        [7.5, 0],
        [22.5, 19],
        [22.5, 38],
        [7.5, 57],
        [-7.5, 57],
        [-22.5, 38],
        [-22.5, 19],
      ],
      true,
    ),
    // an open line from one end of the top edge to the other
    c: tgtPts(
      [
        [-7.5, 0],
        [-15, 19],
        [-15, 33.5],
        [-5, 45],
        [5, 45],
        [15, 33.5],
        [15, 19],
        [7.5, 0],
      ],
      false,
    ),
    a: tgtPts(
      [
        [-2.5, 2.5],
        [2.5, 2.5],
        [7.5, 19],
        [7.5, 27.5],
        [2.5, 35],
        [-2.5, 35],
        [-7.5, 27.5],
        [-7.5, 19],
      ],
      true,
    ),
    aCentre: TARGET_TOP + 18.75, // the A zone runs from 2.5 to 35 cm below the top
  };
  // IPSC Popper (Appendix C2): 85 cm tall, a 30 cm disc whose centre is 70 cm
  // up, on a body 20 cm wide at the disc and 15 cm at the ground. Centimetres,
  // base-centre origin, y down.
  const POPPER = (() => {
    const r = 15;
    const cy = 70;
    const neck = 10;
    const joint = cy - Math.sqrt(r * r - neck * neck); // 58.8 cm up
    const a0 = Math.atan2(cy - joint, neck); // the right joint, seen from the disc centre (y down)
    const pts = ["M -7.5,0", "L 7.5,0", `L ${neck},${-joint}`];
    for (let k = 1; k < 40; k++) {
      const a = a0 - (k / 40) * (Math.PI + 2 * Math.abs(a0));
      pts.push(
        `L ${(r * Math.cos(a)).toFixed(3)},${(-cy + r * Math.sin(a)).toFixed(3)}`,
      );
    }
    pts.push(`L ${-neck},${-joint}`, "Z");
    return shape(pts.join(" "));
  })();

  // ------------------------------------------------------------------ factory
  function create(canvas, options = {}) {
    // `let`: soft() points the drawing helpers at an offscreen layer for a moment.
    let ctx = canvas.getContext("2d");
    const opt = {
      lang: "ko",
      assetBase: "assets/",
      credit: true,
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
      "정확파워속도프로덕션디비전장비기준승인목록등재기계식조준기탄창발점수시간히트팩터철판노슛미스넘어져야득점존" +
      JSON.stringify(DIV) +
      JSON.stringify(OPENING) +
      JSON.stringify(FINALE_COPY) +
      "≤≥×÷·";
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
          // Inter has no ≤ ≥: they fall back to Noto Sans KR, at every weight
          .concat(
            [
              "600 20px Inter",
              "700 20px Inter",
              "800 20px Inter",
              '500 20px "Noto Sans KR"',
              '800 20px "Noto Sans KR"',
            ].map((f) => document.fonts.load(f, "≤≥×÷·")),
          )
      : [];
    const ready = Promise.all(
      [
        ...fontLoads,
        loadImage("krpsa-logo.png"),
        loadImage("ipsc-crest.png"),
      ].map((p) => p.catch(() => {})),
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
    // Division kit in the gun's millimetres: a slide-mounted red dot just ahead
    // of the rear sight (side view, its hood recess) and a three-port
    // compensator on the muzzle.
    const GUN_KIT = {
      optic: shape(
        "M 56,7.8 L 56.4,-1.5 Q 57,-12.5 64.5,-14.2 L 84.5,-14.2 Q 90,-14.2 92.8,-9.6 L 98.6,0.8 L 99,7.8 Z",
      ),
      hood: shape(
        "M 62.5,-9.6 Q 63.6,-11.4 66,-11.4 L 83.6,-11.4 Q 87.2,-11.4 89.4,-8 L 91.6,-3.6 L 62.5,-3.6 Z",
      ),
      comp: shape(
        "M 216.4,6.6 L 248.6,6.6 Q 252.6,6.6 252.6,10.6 L 252.6,23.4 Q 252.6,27.4 248.6,27.4 L 216.4,27.4 Z",
      ),
      ports: [223.5, 231, 238.5].map((x) => rect(x, 6.6, 4.2, 4.4)),
    };

    // o: x, y (screen position of the gun centre), s (px per mm), rot, blue
    // (0 solid → 1 blueprint), draw (outline draw-on), slide (mm back),
    // hammer (0 down, the traced pose → 1 cocked; the slide also cocks it as it
    // opens), mag ({dx, dy, rot} or null), alpha.
    // Division kit, all off by default: optic (0..1 drops a slide-mounted red
    // dot in and draws it on), comp (0..1 drops a compensator onto the
    // muzzle), extMag (0..1 a long base pad), flush (0..1 flattens the pad),
    // ghost ({ optic, comp }: 0..1 a dashed outline, then a red cross, for
    // parts a division does not allow).
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

      // Hammer: traced down against the slide; cocked, it swings 55° back over
      // the beavertail. The slide cocks it as it runs back; o.hammer = 1 keeps
      // it cocked once the slide has closed again.
      const [hx, hy] = GUN.hammerPivot;
      const cock = Math.max(o.hammer ?? 0, Math.min(slide, 6) / 6);
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(-cock * 55 * (Math.PI / 180));
      ctx.translate(-hx, -hy);
      solidLayer(() => {
        fillShape(GUN.hammer, "#2a2d32");
        // a rim light, as on the frame, so the dark spur reads when cocked
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = px;
        ctx.stroke();
      });
      if (blue > 0) strokeShape(GUN.hammer, blue * 0.8);
      ctx.restore();

      // Frame: grey dust cover and rails, black trigger guard and grip.
      solidLayer(() => {
        tracePath(ctx, GUN.frame);
        tracePath2(GUN.guard);
        // grey dust cover and rails above ≈46 mm, black guard, grip and tang below
        const fg = ctx.createLinearGradient(0, 22, 0, 160);
        fg.addColorStop(0, "#5f646c");
        fg.addColorStop(0.15, "#4a4f57");
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
          dot(x, y, 3.9, "#1b1d21");
          dot(x, y, 2.6, "#2f3339");
          dot(x, y, 1.4, "#4a4f57");
        });
        // ambidextrous safety and the slide-stop pin
        fillShape(GUN.safety, g(26.5, 39.5, "#3c4047", "#1d2024"));
        tracePath(ctx, GUN.safety);
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 0.6 * px;
        ctx.stroke();
        dot(GUN.stopPin[0], GUN.stopPin[1], 4.6, "#1b1d21");
        dot(GUN.stopPin[0], GUN.stopPin[1], 2.8, "#454a52");
        GUN.pins.forEach(([x, y, r]) => dot(x, y, r, "#15171a"));
        // trigger blade, then a rim light so the black frame reads on dark backgrounds
        fillShape(GUN.trigger, g(47, 72, "#5d636b", "#25282d"));
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
          g(0, 24, "#1c1e22", "#2c2f34", "#5d6168", "#7d828a", "#8f949b"),
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
        line(56, 8.0, 198, 8.0, "rgba(255,255,255,0.28)", 0.5);
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
      // A slide-mounted red dot: it drops onto the slide as its outline draws
      // on, then fills in; the emitter glints once it is seated.
      const optic = o.optic ?? 0;
      if (optic > 0) {
        ctx.save();
        ctx.translate(0, -(1 - ease.out3(seg(optic, 0, 0.6))) * 12);
        const fill = ease.out3(seg(optic, 0.35, 0.9));
        solidLayer(() => {
          ctx.globalAlpha *= fill;
          fillShape(
            GUN_KIT.optic,
            g(-14.2, 7.4, "#454a52", "#24272c", "#131518"),
          );
          // the hood's window, tinted like coated glass, with a glare line
          fillShape(GUN_KIT.hood, g(-11.4, -3.6, "#1d2a3c", "#0b1018"));
          line(68, -10.2, 74, -4.6, "rgba(170,200,255,0.35)", 0.7);
          line(65, -13.5, 84, -13.5, "rgba(255,255,255,0.32)", 0.5);
          line(93.4, -8.4, 98.1, 0.2, "rgba(140,180,255,0.6)", 0.9);
          dot(61.2, 3.6, 1.1, "#4f545c");
          dot(94.2, 3.6, 1.1, "#4f545c");
        });
        strokeShape(
          GUN_KIT.optic,
          0.9 - 0.62 * fill * solid,
          1.4,
          Math.min(drawOn, seg(optic, 0, 0.55)),
        );
        if (blue > 0)
          strokeShape(GUN_KIT.hood, blue * 0.6, 1.1, seg(optic, 0.2, 0.7));
        const glint = seg(optic, 0.8, 1) * solid;
        if (glint > 0) {
          const gr = ctx.createRadialGradient(95.6, -4.4, 0, 95.6, -4.4, 5);
          gr.addColorStop(0, rgba(C.red, 0.9 * glint));
          gr.addColorStop(1, rgba(C.red, 0));
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.arc(95.6, -4.4, 5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();

      // A compensator drops onto the muzzle from above, as the optic does.
      const comp = o.comp ?? 0;
      if (comp > 0) {
        ctx.save();
        ctx.translate(0, -(1 - ease.out3(comp)) * 10);
        ctx.globalAlpha *= clamp(comp / 0.3);
        solidLayer(() => {
          fillShape(
            GUN_KIT.comp,
            g(6.6, 27.4, "#24272c", "#5d6168", "#8f949b", "#4a4f57", "#2a2d32"),
          );
          GUN_KIT.ports.forEach((sh) => fillShape(sh, "#0b0c0e"));
          line(218, 7.3, 248, 7.3, "rgba(255,255,255,0.35)", 0.5);
          line(249.6, 9.5, 249.6, 24.5, "rgba(0,0,0,0.45)", 0.7);
          dot(221.5, 23.2, 1.1, "#2b2f36");
          tracePath(ctx, GUN_KIT.comp);
          ctx.strokeStyle = "rgba(255,255,255,0.3)";
          ctx.lineWidth = px;
          ctx.stroke();
        });
        if (blue > 0) strokeShape(GUN_KIT.comp, blue);
        ctx.restore();
      }

      // Parts a division does not allow: a dashed outline, then a red cross.
      const ghost = o.ghost ?? {};
      [
        [ghost.comp, GUN_KIT.comp, [216, 4, 257, 33]],
        [ghost.optic, GUN_KIT.optic, [52, -19, 103, 12]],
      ].forEach(([a = 0, sh, [x0, y0, x1, y1]]) => {
        if (a <= 0) return;
        ctx.save();
        ctx.setLineDash([6 * px, 4 * px]);
        strokeShape(sh, 0.75 * seg(a, 0, 0.4), 1.5, 1);
        ctx.restore();
        const p1 = ease.out3(seg(a, 0.4, 0.7));
        const p2 = ease.out3(seg(a, 0.6, 0.9));
        ctx.strokeStyle = C.red;
        ctx.lineWidth = 3 * px;
        ctx.lineCap = "round";
        ctx.beginPath();
        if (p1 > 0) {
          ctx.moveTo(x0, y0);
          ctx.lineTo(lerp(x0, x1, p1), lerp(y0, y1, p1));
        }
        if (p2 > 0) {
          ctx.moveTo(x1, y0);
          ctx.lineTo(lerp(x1, x0, p2), lerp(y0, y1, p2));
        }
        ctx.stroke();
        ctx.lineCap = "butt";
      });

      // Base pad, always in place unless the magazine is dropping. extMag
      // lengthens it down the line of the grip; flush flattens it.
      const ext = (o.extMag ?? 0) * 22;
      const flat = 1 - 0.67 * (o.flush ?? 0);
      const { top: padTop, x0: padX0, x1: padX1, slope: padSlope } = GUN.pad;
      const withPad = (fn) =>
        withMag(() => {
          if (ext) ctx.translate(-padSlope * ext, ext);
          if (flat !== 1) {
            ctx.translate(0, padTop);
            ctx.scale(1, flat);
            ctx.translate(0, -padTop);
          }
          fn();
        });
      if (ext > 0) {
        const body = [
          [padX0, padTop - 1],
          [padX1, padTop - 1],
          [padX1 - padSlope * ext, padTop + 0.5 + ext],
          [padX0 - padSlope * ext, padTop + 0.5 + ext],
        ];
        const trace = () => {
          ctx.beginPath();
          body.forEach(([x, y]) => ctx.lineTo(x, y));
          ctx.closePath();
        };
        withMag(() => {
          solidLayer(() => {
            trace();
            ctx.fillStyle = g(padTop, padTop + 1 + ext, "#2e3238", "#1d2024");
            ctx.fill();
            for (let k = 1; k < 4; k++) {
              const y = padTop + (ext * k) / 4;
              line(
                padX0 + 0.6 - padSlope * (y - padTop),
                y,
                padX1 - 0.8 - padSlope * (y - padTop),
                y,
                "rgba(0,0,0,0.35)",
                0.6,
              );
            }
          });
          if (blue > 0) {
            trace();
            ctx.strokeStyle = `rgba(244,245,247,${blue})`;
            ctx.lineWidth = 1.6 * px;
            ctx.stroke();
          }
        });
      }
      withPad(() =>
        solidLayer(() =>
          fillShape(GUN.magPad, g(GUN.pad.top, 160, "#34383e", "#16181b")),
        ),
      );
      if (blue > 0) withPad(() => strokeShape(GUN.magPad, blue));

      // A magwell: a flared funnel around the base of the grip, sized 0..1
      // (Standard's small enough to fit the box, Open's as big as it likes).
      // magwellIn (0..1) drops it on from below, as the optic drops on from
      // above. It sits on the frame, so it stays put when the magazine drops.
      const mw = o.magwell ?? 0;
      if (mw > 0) {
        const inn = o.magwellIn ?? 1;
        const h = 10 + 10 * mw;
        const f = 2 + 9 * mw;
        const e = 1 + 2 * mw;
        const yt = GUN.pad.top - h;
        const yb = GUN.pad.top + e;
        // the grip's back and front straps near the base, from the frame outline
        const xl = (y) => (y < 128 ? 6.8 - (y - 110) * 0.267 : 2.0);
        const xr = (y) => (y < 128 ? 63.9 - (y - 110) * 0.317 : 58.2);
        const pts = [
          [xl(yt) + 1, yt],
          [xl(yb) - f, yb],
          [xr(yb) + 0.6 * f, yb],
          [xr(yt) - 1, yt],
        ];
        const trace = () => {
          ctx.beginPath();
          pts.forEach(([x, y]) => ctx.lineTo(x, y));
          ctx.closePath();
        };
        ctx.save();
        ctx.translate(0, (1 - ease.out3(inn)) * 12);
        ctx.globalAlpha *= clamp(inn / 0.3);
        solidLayer(() => {
          trace();
          ctx.fillStyle = g(yt, yb, "#515b6e", "#2a303a", "#1b1f26");
          ctx.fill();
          line(
            xl(yb) - f + 1.5,
            yb - 1.3,
            xr(yb) + 0.6 * f - 1.5,
            yb - 1.3,
            "rgba(0,0,0,0.45)",
            0.7,
          );
          trace();
          ctx.strokeStyle = "rgba(255,255,255,0.3)";
          ctx.lineWidth = px;
          ctx.stroke();
        });
        if (blue > 0) {
          trace();
          ctx.strokeStyle = `rgba(244,245,247,${blue})`;
          ctx.lineWidth = 1.6 * px;
          ctx.stroke();
        }
        ctx.restore();
      }

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
        // corrugated cardboard texture (o.texture 0 skips it, e.g. under a blur)
        const tex = fill * (o.texture ?? 1);
        if (tex > 0) {
          ctx.save();
          tracePath(ctx, TGT.outer);
          ctx.clip();
          for (let k = -30; k < 30; k += 1.3)
            line(k, -30, k, 30, `rgba(0,0,0,${0.045 * tex})`, 0.35);
          ctx.restore();
        }
      }
      const ring = (outer, inner, a) => {
        if (a <= 0) return;
        tracePath(ctx, outer);
        if (inner) tracePath2(inner);
        ctx.fillStyle = rgba(C.red, a);
        ctx.fill("evenodd");
      };
      // the D zone is the scoring area outside the C line: the open C line
      // closes along the top edge, where it meets the D line anyway
      ring(TGT.d, TGT.c, o.hiD ?? 0);
      ring(TGT.c, TGT.a, o.hiC ?? 0);
      ring(TGT.a, null, o.hiA ?? 0);
      tracePath(ctx, TGT.outer, build);
      ctx.strokeStyle = o.noShoot
        ? "rgba(0,0,0,0.25)"
        : rgba(o.edge ?? C.cardEdge, 1);
      ctx.lineWidth = (o.edgeW ?? 2) * px;
      ctx.stroke();
      // zone lines: thin and faint, as the rules want them (not visible from 10 m)
      ctx.setLineDash([1.6, 1.1]);
      ctx.strokeStyle = o.noShoot ? "rgba(0,0,0,0.18)" : "rgba(70,45,15,0.6)";
      ctx.lineWidth = Math.max(0.28, 1.2 * px);
      [TGT.d, TGT.c, TGT.a].forEach((z) => {
        tracePath(ctx, z, o.zones ?? 1);
        ctx.stroke();
      });
      ctx.setLineDash([]);
      if (o.letters) {
        ctx.globalAlpha *= o.letters;
        ctx.font = font(800, 4.2);
        ctx.fillStyle = o.noShoot ? "rgba(0,0,0,0.3)" : "rgba(70,45,15,0.75)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("A", 0, -3); // low in the A zone, clear of the holes
        ctx.fillText("C", 0, 11.5);
        ctx.fillText("D", 0, 22.5);
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
    function poly3(cam, pts, fill, stroke, width = 1.5, open = false) {
      pts = clipNear(cam, pts);
      if (pts.length < 2) return;
      ctx.beginPath();
      pts.forEach((p, k) => {
        const q = project(cam, p);
        if (k) ctx.lineTo(q[0], q[1]);
        else ctx.moveTo(q[0], q[1]);
      });
      if (!open) ctx.closePath();
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
      CAPTIONS.forEach(([a, b, ko, en], i) => {
        // each caption is fully gone before the next one starts
        const next = CAPTIONS[i + 1]?.[0] ?? Infinity;
        const exit = clamp(next - b - 0.02, 0.06, 0.3);
        if (t < a || t > b + exit) return;
        const lt = t - a;
        const out = t > b ? t - b : -1;
        const fade = 1 - seg(t, b, b + exit);
        ctx.save();
        // a soft scrim keeps the caption legible over busy scenes; the end
        // card is plain and holds still, so its closing line goes without
        if (i < CAPTIONS.length - 1) {
          const scrim = ctx.createLinearGradient(0, H - 300, 0, H);
          scrim.addColorStop(0, "rgba(8,10,13,0)");
          scrim.addColorStop(1, "rgba(8,10,13,0.62)");
          ctx.globalAlpha = fade * ease.out3(seg(lt, 0, 0.3));
          ctx.fillStyle = scrim;
          ctx.fillRect(0, H - 300, W, 300);
        }
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
          // in place within about a third of a second, however long the line
          stagger: Math.min(0.008, 0.06 / primary.length),
          dur: 0.26,
          outDur: exit * 0.8,
          outStagger: 0,
        });
        if (lang === "both" && en.toLowerCase() !== ko.toLowerCase()) {
          ctx.globalAlpha = fade * ease.out3(seg(lt, 0.05, 0.25));
          ctx.shadowColor = "rgba(0,0,0,0.8)";
          ctx.shadowBlur = 6;
          text(en, 120, y + 40, { size: 22, weight: 500, color: "#a4a8af" });
        }
        ctx.restore();
      });
    }

    function hud(t) {
      // out with the end card and its closing caption, over the last 0.3 s
      const a = 1 - seg(t, DURATION - 0.3, DURATION);
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
      // hud runs on the final timeline: the brief leaves with the start signal
      if (t < ins(BEEP)) {
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
    // beat: the clock its frozen digits blink on (inside an insert, where t
    // stands still, the final timeline's time).
    function timerHud(t, beat = t) {
      if (t < 6.52 || t > 20.4 + SHIFT) return;
      const ms = stageMs(t);
      // gone the moment its time flies off into the hit factor
      const a = t < 19.95 + SHIFT ? 1 : 0;
      if (a <= 0) return;
      ctx.save();
      ctx.globalAlpha = a;
      const frozen = t >= FREEZE && t < RESUME;
      const done = t >= SHOTS[SHOTS.length - 1].t;
      const lw = text(
        frozen ? "TIME FREEZE" : done ? "LAST SHOT" : "TIME",
        W - 96,
        84,
        {
          size: 12,
          weight: 700,
          tracking: 2.4,
          align: "right",
          color: frozen ? C.red : C.dim,
        },
      );
      // the clock holds through the explainers: say so in Korean too
      if (frozen && opt.lang !== "en")
        text("시간 정지", W - 96 - lw - 14, 85, {
          size: 18,
          weight: 700,
          align: "right",
          color: C.red,
          family: KR,
        });
      // on for the first half of every beat (120 BPM), dim for the second
      const blink = frozen ? ((beat - BEEP) % 0.5 < 0.25 ? 1 : 0.55) : 1;
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
    // Final-timeline seconds since `at` (both in the original cut). The
    // opening times its entrances in these, so a text lands just as fast
    // however much a stretch slows its scene down.
    const since = (t, at) => ins(t) - ins(at);

    // A soft, slanted band of light that crosses the frame left to right as
    // p runs from 0 to 1 (leaning like the wipe): the holds' slow sweep. It
    // is screened over what is drawn so far, so the scenes draw it before
    // their type and the ground lifts as it passes behind the words. Returns
    // the band's centre at mid-height.
    function lightSweep(p, a, y0 = 0, y1 = H) {
      if (p <= 0 || p >= 1 || a <= 0) return null;
      const x = lerp(-640, W + 640, p);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.transform(1, 0, -0.18, 1, 0.09 * H, 0);
      const g = ctx.createLinearGradient(x - 380, 0, x + 380, 0);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, `rgba(255,255,255,${a})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - 380, y0, 760, y1 - y0);
      ctx.restore();
      return x;
    }

    // S0 — DVC: Diligentia, Vis, Celeritas. The three words slam in a
    // sixteenth apart (0.125 s), side by side, each with its meaning under
    // it, and hold together until the wipe to the range commands runs over
    // them, left to right, in the order they are read. The hold is alive but
    // the type reads as still: the camera eases in by 2.5 % (under 7 px/s at
    // the far edge), a band of light sweeps across behind the words and a
    // glint runs along the ruler with it.
    function sceneDVC(t) {
      if (t > OPENING.wipe[1]) return;
      const f = since(t, 0); // the final timeline
      floorGrid(0.6 * ease.out3(seg(f, 0, 1.6)), t);
      const lang = opt.lang;
      const size = 112;
      const tracking = -3;
      const gap = 132;
      const widths = OPENING.dvc.map(
        ([la]) => layout(la, font(800, size), tracking).width,
      );
      const total = widths.reduce((a, b) => a + b, 0) + gap * 2;
      const y = 528;
      const ry = y + 46;
      const sx = lightSweep(ease.inOut3(seg(f, 0.6, 3.3)), 0.07);
      ctx.save();
      const push = 1 + 0.025 * seg(f, 0.4, since(OPENING.wipe[1], 0));
      ctx.translate(W / 2, y);
      ctx.scale(push, push);
      ctx.translate(-W / 2, -y);
      // ruler under the words
      const rw = ease.outExpo(seg(f, 0, 0.9)) * (total + 120);
      line(W / 2 - rw / 2, ry, W / 2 + rw / 2, ry, C.red, 2);
      for (let k = -45; k <= 45; k++) {
        const x = W / 2 + k * 20;
        if (Math.abs(x - W / 2) > rw / 2) continue;
        line(x, ry, x, ry + (k % 5 === 0 ? 16 : 7), "rgba(255,255,255,0.3)", 1);
      }
      // the glint, where the band of light crosses the ruler
      if (sx != null) {
        const gx = sx - 0.18 * (ry - H / 2);
        const x0 = Math.max(gx - 90, W / 2 - rw / 2);
        const x1 = Math.min(gx + 90, W / 2 + rw / 2);
        if (x1 > x0) {
          const gl = ctx.createLinearGradient(gx - 90, 0, gx + 90, 0);
          gl.addColorStop(0, "rgba(255,220,226,0)");
          gl.addColorStop(0.5, "rgba(255,236,240,0.9)");
          gl.addColorStop(1, "rgba(255,220,226,0)");
          ctx.fillStyle = gl;
          ctx.fillRect(x0, ry - 1.5, x1 - x0, 3);
        }
      }
      let x = W / 2 - total / 2;
      OPENING.dvc.forEach(([la, en, ko, at], k) => {
        const cx = x + widths[k] / 2;
        x += widths[k] + gap;
        const lt = since(t, at);
        if (lt < 0) return;
        // the word is still 0.15 s after its slam, which lands with a
        // chromatic hit
        kinetic(la, cx, y, {
          size,
          t: lt,
          tracking,
          align: "center",
          stagger: 0.004,
          dur: 0.15,
          split: Math.max(0, 1 - lt / 0.16) * 9,
        });
        // its meaning: in en the English, in ko the Korean, in both the two
        const g = { t: lt - 0.03, align: "center", dur: 0.16, weight: 700 };
        if (lang !== "ko")
          kinetic(en, cx, y + 110, {
            ...g,
            size: lang === "en" ? 36 : 30,
            tracking: lang === "en" ? 6 : 8,
            stagger: 0.006,
            color: C.red,
          });
        if (lang !== "en")
          kinetic(ko, cx, lang === "ko" ? y + 126 : y + 168, {
            ...g,
            size: lang === "ko" ? 56 : 40,
            family: KR,
            stagger: 0.015,
            color: lang === "ko" ? C.red : "#c9ccd1",
          });
      });
      ctx.restore();
    }

    // S1 — range commands. The Range Officer's three commands build up as a
    // list, each with its meaning under it (the Korean in ko and both, what
    // it asks for in en), and stay until the start signal: the number of
    // the latest one turns red. Each is still about 0.25 s after its stab
    // and is read alone for two seconds before the next one lands. MAKE
    // READY loads a magazine; STANDBY runs a clock through the 1–4 s window
    // in which the beep comes. Through the holds the list eases in by 2 %
    // about its left edge (under 5 px/s anywhere, so the type reads as
    // still), and a band of light sweeps behind each command as it lands.
    const CMD_X = 232;
    const CMD_Y = [318, 514, 710]; // baselines
    // MAKE READY rises behind the wipe, so that the wipe uncovers it already
    // still, on its stab
    const cmdRise = ([, , at], k) =>
      k === 0 ? Math.min(at - 0.25, OPENING.wipe[0]) : at;
    function sceneCommands(t) {
      if (t < 1.8 || t >= BEEP) return;
      // a breath in, the last 0.24 s before the beep
      const anticip = ease.in3(seg(t, 5.87, BEEP));
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(1 - anticip * 0.05, 1 - anticip * 0.05);
      ctx.translate(-W / 2, -H / 2);
      ctx.globalAlpha = 1 - anticip * 0.55;
      floorGrid(0.5, t);
      const lang = opt.lang;
      const cmds = OPENING.commands;
      cmds.forEach(([, , at]) =>
        lightSweep(ease.inOut3(seg(since(t, at), 0.15, 2.0)), 0.06),
      );
      const push = 1 + 0.02 * seg(since(t, 2.14), 0, since(BEEP, 2.14));
      ctx.translate(150, H / 2);
      ctx.scale(push, push);
      ctx.translate(-150, -H / 2);
      const latest = cmds.findLastIndex((c, k) => t >= cmdRise(c, k));
      cmds.forEach(([cmd, meaning], k) => {
        const lt = since(t, cmdRise(cmds[k], k));
        if (lt < 0) return;
        const y = CMD_Y[k];
        ctx.save();
        ctx.globalAlpha *= ease.out3(seg(lt, 0, 0.15));
        text(`0${k + 1}`, 150, y - 62, {
          size: 24,
          weight: 700,
          tracking: 3,
          color: k === latest ? C.red : C.dim,
        });
        ctx.restore();
        // still within 0.2 s on the final timeline, with a chromatic hit
        kinetic(cmd, CMD_X, y, {
          size: 112,
          t: lt,
          tracking: -3,
          stagger: 0.0035,
          dur: 0.17,
          split: Math.max(0, 1 - lt / 0.16) * 7,
        });
        const str = lang === "en" ? meaning[0] : meaning[1];
        kinetic(str, CMD_X + 4, y + 64, {
          size: lang === "en" ? 36 : 40,
          weight: lang === "en" ? 600 : 700,
          family: lang === "en" ? SANS : KR,
          color: "#c9ccd1",
          t: lt - 0.03,
          dur: 0.17,
          stagger: Math.min(0.008, 0.05 / [...str].length),
        });
      });

      // MAKE READY: fifteen rounds into a magazine (the Production limit),
      // which clears the stage for the STANDBY clock
      const [, , ready] = cmds[0];
      const [, , standby] = cmds[2];
      const ma =
        ease.out3(seg(since(t, ready), 0, 0.3)) *
        (1 - seg(since(t, standby), 0, 0.25));
      if (ma > 0) {
        ctx.save();
        ctx.globalAlpha *= ma;
        const mx = 1660;
        const my = 600;
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 2;
        ctx.strokeRect(mx - 46, my - 430, 92, 440);
        const loaded = Math.floor(clamp((t - ready) / 0.04 + 1, 0, MAG));
        for (let k = 0; k < loaded; k++) {
          const yy = my - 14 - k * 27;
          const xx = mx + (k % 2 ? 9 : -9);
          const pop = ease.outBack(clamp((t - (ready + k * 0.04)) / 0.12));
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
        ctx.restore();
      }

      // STANDBY: the start signal comes 1 to 4 s after it. The playhead runs
      // in real seconds of the final timeline, and the window pulses with the
      // heartbeat.
      if (t >= standby) {
        const x0 = 900;
        const x1 = 1720;
        const y = CMD_Y[2] - 42;
        const sx = (s) => x0 + ((x1 - x0) * s) / 4;
        const grow = ease.outExpo(seg(since(t, standby), 0, 0.3));
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fillRect(x0, y - 2, (x1 - x0) * grow, 4);
        const pulse = OPENING.hearts.reduce(
          (p, h) => Math.max(p, t >= h ? Math.exp(-since(t, h) * 7) : 0),
          0,
        );
        ctx.fillStyle = rgba(C.red, 0.35 + 0.35 * pulse);
        ctx.fillRect(sx(1), y - 10, (sx(4) - sx(1)) * grow, 20);
        ctx.globalAlpha *= ease.out3(seg(since(t, standby), 0.03, 0.2));
        for (let k = 0; k <= 4; k++) {
          line(sx(k), y - 14, sx(k), y + 14, "rgba(255,255,255,0.5)", 2);
          text(`${k}`, sx(k), y + 52, {
            size: 26,
            weight: 600,
            align: "center",
            color: "#b4b8bf",
          });
        }
        // the unit, just after the 4
        text(
          lang === "ko" ? OPENING.seconds[1] : OPENING.seconds[0],
          x1 + 12,
          y + 52,
          {
            size: 26,
            weight: 600,
            color: "#b4b8bf",
            family: lang === "ko" ? KR : SANS,
          },
        );
        const s = clamp(ins(t) - ins(standby), 0, 4);
        ctx.fillStyle = C.white;
        ctx.fillRect(sx(s) - 2, y - 26, 4, 52);
        ctx.restore();
      }
      ctx.restore();
    }

    // S0 → S1 wipe. It runs at an even pace on the final timeline, across
    // the stretch's change of rate.
    function wipe(t, a, b, drawA, drawB) {
      const p = ease.inOut3(seg(ins(t), ins(a), ins(b)));
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
        const [rx, ry] = GUN.rearSight;
        const fx = x + (rx - GUN.cx) * s;
        const fy = y + (ry - GUN.cy) * s;
        const ns = lerp(s, 34, p);
        x = lerp(fx, W / 2, p) - (rx - GUN.cx) * ns;
        y = lerp(fy, SIGHT.aimY, p) - (ry - GUN.cy) * ns;
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

    // Line of sight: eye, rear sight, front sight and target on one red line.
    function sceneLineOfSight(t) {
      if (t < 6.9 || t > 7.7) return;
      const o = gunPose(6.85);
      const R = gunPoint(o, GUN.rearSight[0], 1.5);
      const F = gunPoint(o, GUN.sight[0], GUN.sight[1] - 1.5);
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
        drawTarget(T[0], T[1] - TGT.aCentre * 1.7, 1.7, { letters: 0 });
        ctx.restore();
      }
      // a node as the line reaches each point: the rear sight, the front
      // sight and the target. Its 0.8 s are too short to read labels in, so
      // the picture carries it, and the sights split names the parts.
      const lock = 1 - Math.abs(t - 7.3) / 0.05;
      [R, F, T].forEach((P) => {
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
      });
      ctx.restore();
    }

    // S3 — iron sights or an optic: the same shot pair through both. On the
    // final timeline (the stretch plays it at 0.81): the halves open on the
    // split's hit (12.45–12.83 s) and the names land; the sights settle and
    // the focus lines land with their brackets on the beep grid's kick at
    // 14.5 s; the dry recoils fall on its kicks at 15.5 and 16.5 s; the guns
    // lower at 18.1 s and the blinds close at 18.65 s.
    const SIGHT = {
      // the A zone centre sits this high when the sights are on: low enough
      // to leave the names and focus lines above it clear, even in recoil
      aimY: 520,
      t0: 7.75,
      open: 8.05,
      settle: 9.5,
      // two dry recoil cycles: the clock is frozen, nothing is fired
      recoils: [10.2073, 11.014],
      lower: 12.3,
      out: 12.75,
    };
    // final-timeline seconds since the latest dry recoil (-Infinity before
    // the first): a recoil is as sharp as it is in life, whatever the stretch
    const sinceRecoil = (t) => {
      const r = SIGHT.recoils.findLast((at) => t >= at);
      return r == null ? -Infinity : since(t, r);
    };
    const canBlur = "filter" in CanvasRenderingContext2D.prototype;

    let softLayer = null;

    // Draw fn() softened by a blur of `radius` design px. A canvas filter blurs
    // every fill and stroke on its own, so fn() is drawn once, sharp, into an
    // offscreen layer (with the current transform), and that layer is blurred
    // onto the canvas in a single pass, under the caller's clip and alpha. The
    // radius scales with the canvas, so every size matches the 1920 export.
    // Without canvas filters fn() is simply drawn sharp.
    function soft(radius, fn) {
      if (radius <= 0.3 || !canBlur) return fn();
      const main = ctx;
      if (!softLayer)
        softLayer = document.createElement("canvas").getContext("2d");
      const layer = softLayer.canvas;
      if (layer.width !== canvas.width || layer.height !== canvas.height) {
        layer.width = canvas.width;
        layer.height = canvas.height;
      }
      softLayer.save();
      softLayer.clearRect(0, 0, layer.width, layer.height);
      softLayer.setTransform(main.getTransform());
      ctx = softLayer;
      try {
        fn();
      } finally {
        ctx = main;
        softLayer.restore();
      }
      main.save();
      main.setTransform(1, 0, 0, 1, 0, 0);
      main.filter = `blur(${((radius * canvas.width) / W).toFixed(2)}px)`;
      main.drawImage(layer, 0, 0);
      main.restore();
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
    // One first-person sight picture, centred on cx. kind: "iron" | "optic".
    function sightView(t, kind, cx) {
      const aimY = SIGHT.aimY;
      const f = ins(t); // the final timeline
      // target px per cm: through the hold the range eases in by 4 %, about
      // the point of aim, as the eye settles on its sight picture
      const s = 6.4 * (1 + 0.04 * seg(f, ins(SIGHT.open), ins(SIGHT.out)));
      const G = 0.56; // the gun's scale in the sight picture
      const tgtY = aimY - TGT.aCentre * s; // target centre (the A zone centre is above it)
      const settle = ease.inOut3(seg(t, SIGHT.open, SIGHT.settle));
      const wob = (1 - settle) * (kind === "iron" ? 46 : 34);
      // once settled, a hold is never quite still: the gun keeps a small,
      // slow arc of movement over the target
      const arc = settle * (kind === "iron" ? 4 : 3);
      const ph = kind === "iron" ? 0 : 2.4;
      let sx =
        Math.sin(t * 4.7 + (kind === "iron" ? 0 : 1.3)) * wob +
        (kind === "iron" ? (1 - settle) * 70 : 0) +
        Math.sin(f * 1.7 + ph) * arc;
      let sy =
        Math.cos(t * 3.9 + (kind === "iron" ? 0.6 : 2.1)) * wob * 0.7 +
        (kind === "iron" ? (1 - settle) * 60 : 0) +
        Math.sin(f * 3.4 + ph + 0.8) * arc * 0.6;
      const rk = kick(sinceRecoil(t));
      sy -= rk.lift;
      const tilt = rk.tilt;
      // at the end both guns lower out of frame, leaving two bare targets
      const lowered = ease.in3(seg(t, SIGHT.lower, SIGHT.lower + 0.35));
      sy += 1000 * lowered;
      // the range behind: horizon glow, floor lines, the target on its stand
      const hz = aimY + 210;
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
      // iron sights: the eye focuses on the front sight, the target goes soft
      const blur = kind === "iron" ? (5 * settle + 1.5) * (1 - lowered) : 0;
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
        // the faint corrugation is lost in the blur: fade it out, then skip it
        drawTarget(cx, tgtY, s, {
          letters: 0.9,
          texture: clamp((1.5 - blur) / 1.2),
        });
      };
      soft(blur, drawRange);

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
        const py = lerp(-52, 0, align) - postLift(sinceRecoil(t));
        [3, 2, 1].forEach((k) => {
          const d = sinceRecoil(t) - k * 0.03;
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
        const dt = sinceRecoil(t);
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

      // focus brackets: where the eye goes (the label is in the title
      // block, still, while the bracket rides the recoil)
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
        ctx.strokeStyle = C.red;
        ctx.lineWidth = 4;
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
        ctx.restore();
      }
      ctx.restore();
    }

    function sceneSights(t) {
      if (t < SIGHT.t0 || t > 13.2) return;
      const open = ease.inOut3(seg(t, SIGHT.t0, SIGHT.open));
      const out = ease.in3(seg(t, SIGHT.out, 13.0));
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
        sightView(t, kind, cx);
        ctx.restore();
      });
      if (open > 0 && open < 1)
        line(W / 2 - half, 0, W / 2 - half, H, C.red, 3);
      if (open > 0 && open < 1)
        line(W / 2 + half, 0, W / 2 + half, H, C.red, 3);
      line(W / 2, 0, W / 2, H, "rgba(255,255,255,0.35)", 2);

      // Each half's name (the Korean first in ko, under the English in
      // both) and, in red as its focus brackets come in, where its eye
      // focuses. Every line is still about 0.2 s after it starts (on the
      // final timeline) and stays still, out of the recoil, until the blinds
      // close: the names for 5.6 s, the focus lines for 4 s.
      const lang = opt.lang;
      const ko = lang === "ko";
      [
        [96, OPENING.iron],
        [W / 2 + 96, OPENING.optic],
      ].forEach(([x, { name, focus }]) => {
        const rise = (str, y, at, o) =>
          kinetic(str, x, y, {
            t: since(t, at),
            out: since(t, SIGHT.out),
            stagger: Math.min(0.01, 0.05 / [...str].length),
            dur: 0.18,
            ...o,
          });
        const at = SIGHT.open;
        if (ko) {
          rise(name[1], 236, at, { size: 64, weight: 700, family: KR });
          rise(name[0], 282, at + 0.04, {
            size: 26,
            weight: 700,
            tracking: 3,
            color: "#b4b8bf",
          });
        } else {
          rise(name[0], 236, at, { size: 64, tracking: -1.5 });
          if (lang === "both")
            rise(name[1], 290, at + 0.04, {
              size: 40,
              weight: 700,
              family: KR,
              color: "#c9ccd1",
            });
        }
        const fa = SIGHT.settle - 0.1;
        // (in both the pair sits lower, so the English one is set smaller
        // to stay clear of the front post at the top of its recoil)
        const both = lang === "both";
        const fy = ko ? 352 : both ? 360 : 306;
        if (ko)
          rise(focus[1], fy, fa, {
            size: 36,
            weight: 700,
            family: KR,
            color: C.red,
          });
        else
          rise(focus[0], fy, fa, {
            size: both ? 28 : 32,
            tracking: both ? 0.5 : 1,
            color: C.red,
          });
        if (both)
          rise(focus[1], fy + 42, fa + 0.04, {
            size: 30,
            weight: 700,
            family: KR,
          });
      });
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

    // Handgun divisions (DIV), in local time lt. One idea at a time: the
    // title stays top left; one pistol morphs through the five divisions on
    // the right while, on the left, each one's name and its one big label
    // hold still long enough to read; then the five line up. Text rises in
    // as kinetic type, still 0.15 s after its beat, and holds until the next
    // beat, when it rolls up out of its mask as the next line rises into its
    // place. The holds are never dead: the camera pushes steadily in on the
    // pistol (and, less, on the grid behind it), a slow light runs along its
    // metal through each hold once its change has landed, and the giant
    // index number behind it drifts up.
    const DIV_B = DIV.beats;
    const DIV_POSE = { x: 1295, y: 572, s: 2.55 };
    const DIV_IN = 0.15; // a line's rise in, and the roll out of the one it replaces
    const DIV_OUT = 0.06; // the marks' fade as their copy rolls out
    // the parts a label points at, as rects on the pistol (mm)
    const DIV_MARKS = {
      rear: [34, -3.5, 49, 9],
      front: [198, -3.5, 214, 9],
      optic: [52, -18, 103, 10],
      comp: [213, 2, 258, 31],
    };
    const divKo = () => opt.lang === "ko";
    // how far gone things leaving on beat at are (0..1)
    const divGone = (lt, at) => seg(lt, at, at + DIV_OUT);
    // A line of copy rising in at tIn (local s), as kinetic type, and from
    // tOut rolling up out of its own mask, fading as it goes, in step with
    // the next line rising in below it: more than a line height apart, the
    // two never overlap, and neither crosses the line above. The stagger is
    // capped so that long lines settle as fast as short ones.
    function divLine(str, x, y, o, tIn, tOut, lt) {
      if (lt < tIn || lt >= tOut + DIV_IN) return;
      const q = ease.outExpo(clamp((lt - tOut) / DIV_IN));
      ctx.save();
      if (q > 0) {
        ctx.beginPath();
        ctx.rect(0, y - o.size * 1.08, W, o.size * 1.42);
        ctx.clip();
        ctx.globalAlpha *= 1 - q;
      }
      kinetic(str, x, y - q * o.size * 1.4, {
        weight: 800,
        ...o,
        t: lt - tIn,
        dur: DIV_IN,
        stagger: Math.min(0.008, 0.024 / [...str].length),
      });
      ctx.restore();
    }
    // the in and out of division k's name: its own beat, and the next one
    // unless the next name grows out of it (Production's runs on through
    // Production Optics)
    function divSpan(k) {
      const d = DIV.specs;
      let end = k + 1;
      while (d[end] && d[end].name[0].startsWith(d[k].name[0])) end++;
      return [DIV_B[k + 1], DIV_B[end + 1]];
    }

    // The title, top left, from the first beat to the end: still by 0.35 s.
    function divHeader(lt) {
      const t = lt - DIV_B[0];
      if (t < 0) return;
      const T = DIV.title;
      const ko = divKo();
      const kw = kinetic(ko ? T.kicker[1] : T.kicker[0], 98, 172, {
        size: 22,
        weight: 700,
        family: ko ? KR : SANS,
        tracking: ko ? 2 : 4,
        color: C.red,
        t,
        stagger: 0.008,
        dur: 0.24,
      });
      if (opt.lang === "both")
        kinetic(T.kicker[1].replace("IPSC ", ""), 98 + kw + 14, 172, {
          size: 22,
          weight: 700,
          family: KR,
          tracking: 2,
          color: C.red,
          t: t - 0.04,
          stagger: 0.008,
          dur: 0.24,
        });
      const w = kinetic(ko ? T.name[1] : T.name[0], 96, 248, {
        size: 72,
        weight: ko ? 700 : 800,
        family: ko ? KR : SANS,
        tracking: ko ? 0 : -2,
        t: t - 0.02,
        stagger: 0.01,
        dur: 0.24,
      });
      if (opt.lang === "both")
        kinetic(T.name[1], 96 + w + 22, 248, {
          size: 52,
          weight: 700,
          family: KR,
          color: "#c9ccd1",
          t: t - 0.06,
          stagger: 0.012,
          dur: 0.24,
        });
      ctx.save();
      ctx.globalAlpha *= ease.out3(seg(t, 0.16, 0.34));
      const sub =
        opt.lang === "en"
          ? T.sub[0]
          : ko
            ? T.sub[1]
            : `${T.sub[0]}  ·  ${T.sub[1]}`;
      text(sub, 97, 296, {
        size: 30,
        weight: 500,
        color: "#b4b8bf",
        family: ko ? KR : SANS,
      });
      ctx.restore();
    }

    // Baselines of the copy column, by language: counter, name, the name in
    // the other language, label, its Korean. The column is centred on the
    // pistol.
    function divRows() {
      if (opt.lang === "en") return { count: 438, name: 532, label: 660 };
      if (opt.lang === "ko")
        return { count: 418, name: 512, name2: 562, label: 670 };
      return {
        count: 404,
        name: 498,
        name2: 554,
        label: 660,
        label2: 718,
      };
    }

    // The copy column, left: for each division its counter, its name (in
    // ko the Korean name, with the English one under it) and its label,
    // each in on its beat and out just before the next.
    function divCopy(lt) {
      const lang = opt.lang;
      const ko = lang === "ko";
      const R = divRows();
      // one size for every name, the longest fitting the column
      const nameSize = Math.min(
        80,
        Math.floor(
          (80 * 840) / layout(DIV.specs[1].name[0], font(800, 80), -1).width,
        ),
      );
      // a pair's main line: the Korean in ko, else the English
      const big = (pair, tracking) =>
        ko
          ? { str: pair[1], family: KR, weight: 700, tracking: 0 }
          : { str: pair[0], family: SANS, weight: 800, tracking };
      DIV.specs.forEach((d, k) => {
        const tIn = DIV_B[k + 1];
        const tOut = DIV_B[k + 2];
        if (lt < tIn) return;
        divLine(
          `0${k + 1} / 05`,
          98,
          R.count,
          { size: 28, weight: 700, tracking: 3, color: C.red },
          tIn,
          tOut,
          lt,
        );
        // the name; a name that grows out of the last one adds its tail
        const prev = DIV.specs[k - 1];
        const grows = prev && d.name[0].startsWith(prev.name[0]);
        const nOut = divSpan(k)[1];
        // (i: 0 the English name, 1 the Korean)
        const nameLine = (i, y, o) => {
          const name = d.name[i];
          const head = grows ? prev.name[i] : "";
          const f = font(o.weight, o.size, o.family);
          const x = grows
            ? 96 + layout(head, f, o.tracking).width + o.tracking
            : 96;
          divLine(name.slice(head.length), x, y, o, tIn, nOut, lt);
        };
        const nb = big(d.name, -1);
        nameLine(ko ? 1 : 0, R.name, {
          size: nameSize,
          weight: nb.weight,
          family: nb.family,
          tracking: nb.tracking,
        });
        if (lang === "both")
          nameLine(1, R.name2, {
            size: 36,
            weight: 700,
            family: KR,
            tracking: 0,
            color: "#c9ccd1",
          });
        else if (ko)
          nameLine(0, R.name2, {
            size: 28,
            weight: 700,
            family: SANS,
            tracking: 2,
            color: "#b4b8bf",
          });
        // the label, red, with its Korean under it in both
        const lb = big(d.label, 0.5);
        divLine(
          lb.str,
          96,
          R.label,
          {
            size: 56,
            weight: lb.weight,
            family: lb.family,
            tracking: lb.tracking,
            color: C.red,
          },
          tIn,
          tOut,
          lt,
        );
        if (lang === "both")
          divLine(
            d.label[1],
            97,
            R.label2,
            { size: 40, weight: 700, family: KR, color: C.white },
            tIn,
            tOut,
            lt,
          );
      });
    }

    // The pistol's kit and the box at lt: each division's change starts on
    // its beat (the red dot drops on, lifts off; the box slams shut on the
    // Standard beat + 0.25, on its cue, and its dimensions draw out; the
    // compensator drops on), all of it still well inside the beat's hold.
    const DIV_STRIKE = 0.25;
    function divKit(lt) {
      const [, , po, s, o, op] = DIV_B;
      const hit = s + DIV_STRIKE;
      return {
        optic:
          lt < s
            ? seg(lt, po, po + 0.3)
            : lt < o
              ? 1 - seg(lt, s, s + 0.2)
              : seg(lt, o, o + 0.3),
        flush:
          lt < o
            ? ease.inOut3(seg(lt, s, s + 0.25))
            : 1 - ease.inOut3(seg(lt, o, o + 0.25)),
        box: lt < o ? seg(lt, s, hit) : 1 - seg(lt, o, o + 0.24),
        // the dimensions leave with the copy
        dims: ease.out3(seg(lt, hit, hit + 0.08)) * (1 - divGone(lt, o)),
        // a small magwell drops on in Standard (it must fit the box), grows
        // in Optics and again in Open, where there is no box at all
        magwell:
          lt < o
            ? 0.3
            : lt < op
              ? lerp(0.3, 0.65, ease.inOut3(seg(lt, o + 0.05, o + 0.3)))
              : lerp(0.65, 1, ease.outBack(seg(lt, op + 0.05, op + 0.3))),
        magwellIn: ease.outBack(seg(lt, s + 0.05, s + 0.3)),
        comp: seg(lt, op, op + 0.3),
        extMag: ease.outBack(seg(lt, op + 0.05, op + 0.3)),
        // what Standard may not carry: a dashed outline and a red cross;
        // the compensator's stays crossed through Optics
        ghost: {
          optic: lt < o ? seg(lt, s + 0.05, s + 0.3) : 1 - seg(lt, o, o + 0.1),
          comp:
            lt < op ? seg(lt, s + 0.05, s + 0.3) : 1 - seg(lt, op, op + 0.1),
        },
      };
    }

    // Standard's box gauge around pose g: 225 × 150 mm inside, 45 mm deep
    // (drawn oblique, at half scale). layer "back" draws the depth faces
    // behind the gun, "front" the four walls, which close in as close goes
    // 0 → 1 and strike together at 1 (from no further than the frame's
    // content band), and the three dimensions (dims 0..1), around pose gd
    // (the box without its strike shake, so that they hold still to read).
    function divBox(g, close, dims, layer, gd = g) {
      if (close <= 0) return;
      let [x0, y0] = gunPoint(g, -3.5, -1.25);
      let [x1, y1] = gunPoint(g, 221.5, 148.75);
      let ox = 19.5 * g.s;
      let oy = -11.25 * g.s;
      ctx.save();
      if (layer === "back") {
        ctx.globalAlpha *= seg(close, 0.7, 1);
        ctx.fillStyle = "rgba(213,218,224,0.05)";
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + ox, y0 + oy);
        ctx.lineTo(x1 + ox, y0 + oy);
        ctx.lineTo(x1 + ox, y1 + oy);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x1, y0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0 + ox, y0 + oy, x1 - x0, y1 - y0);
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ].forEach(([x, y]) => line(x, y, x + ox, y + oy, ctx.strokeStyle, 1.5));
        ctx.restore();
        return;
      }
      const wall = 4 * g.s;
      const fly = (n) =>
        (1 - ease.in3(clamp((close - n * 0.04) / 0.88))) * 22 * g.s;
      ctx.globalAlpha *= clamp(close * 2.5);
      [
        [x0 - wall, y0 - wall - fly(0), x1 - x0 + 2 * wall, wall],
        [x0 - wall, y1 + fly(1), x1 - x0 + 2 * wall, wall],
        [x0 - wall - fly(2), y0, wall, y1 - y0],
        [x1 + fly(3), y0, wall, y1 - y0],
      ].forEach(([x, y, w, h]) => {
        ctx.fillStyle = "rgba(213,218,224,0.16)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = "rgba(244,245,247,0.8)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, w, h);
      });
      if (dims > 0) {
        const [w, h, d] = DIV.box;
        [x0, y0] = gunPoint(gd, -3.5, -1.25);
        [x1, y1] = gunPoint(gd, 221.5, 148.75);
        ox = 19.5 * gd.s;
        oy = -11.25 * gd.s;
        divDim(x0 + ox, y0 + oy - 34, x1 + ox, y0 + oy - 34, w, dims, 0);
        divDim(x1 + ox + 62, y0 + oy, x1 + ox + 62, y1 + oy, h, dims, 0);
        divDim(
          x1 + wall + 14,
          y1 + wall + 14,
          x1 + ox + wall + 14,
          y1 + oy + wall + 14,
          d,
          dims,
          1,
        );
      }
      ctx.restore();
    }
    // A red dimension line from (xa, ya) to (xb, yb), drawn out from its
    // middle, with its label level and readable: centred on it (side 0) or
    // to its right (side 1).
    function divDim(xa, ya, xb, yb, label, a, side) {
      ctx.save();
      ctx.globalAlpha *= a;
      const p = ease.outExpo(a);
      const mx = (xa + xb) / 2;
      const my = (ya + yb) / 2;
      const ux = (xb - xa) / Math.hypot(xb - xa, yb - ya);
      const uy = (yb - ya) / Math.hypot(xb - xa, yb - ya);
      const [ha, hb] = [
        [lerp(mx, xa, p), lerp(my, ya, p)],
        [lerp(mx, xb, p), lerp(my, yb, p)],
      ];
      line(ha[0], ha[1], hb[0], hb[1], C.red, 2);
      // end ticks across the line, and arrowheads
      [
        [xa, ya],
        [xb, yb],
      ].forEach(([x, y]) =>
        line(x - uy * 12, y + ux * 12, x + uy * 12, y - ux * 12, C.red, 2),
      );
      ctx.fillStyle = C.red;
      [
        [ha, 1],
        [hb, -1],
      ].forEach(([[x, y], dd]) => {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dd * (ux * 12 - uy * 5), y + dd * (uy * 12 + ux * 5));
        ctx.lineTo(x + dd * (ux * 12 + uy * 5), y + dd * (uy * 12 - ux * 5));
        ctx.fill();
      });
      const f = font(700, 28);
      const tw = layout(label, f, 1).width;
      if (side === 0) {
        ctx.fillStyle = C.bg;
        ctx.fillRect(mx - tw / 2 - 12, my - 20, tw + 24, 40);
        text(label, mx, my + 10, {
          size: 28,
          weight: 700,
          tracking: 1,
          align: "center",
          color: C.red,
        });
      } else
        text(label, mx + 22, my + 30, {
          size: 28,
          weight: 700,
          tracking: 1,
          color: C.red,
        });
      ctx.restore();
    }

    // Lock-on corner brackets round a part of the pistol (rect in mm) on
    // pose g; they close in from 1.6× as a goes 0 → 1.
    function divBrackets(g, [mx0, my0, mx1, my1], a) {
      if (a <= 0) return;
      const [ax, ay] = gunPoint(g, mx0, my0);
      const [bx, by] = gunPoint(g, mx1, my1);
      const k = lerp(1.6, 1, ease.outExpo(clamp(a)));
      const cx = (ax + bx) / 2;
      const cy = (ay + by) / 2;
      const hw = ((bx - ax) / 2) * k + 8;
      const hh = ((by - ay) / 2) * k + 8;
      const arm = Math.min(18, hw * 0.7, hh * 0.7);
      ctx.save();
      ctx.globalAlpha *= clamp(a * 2.5);
      ctx.strokeStyle = C.red;
      ctx.lineWidth = 3;
      ctx.lineCap = "square";
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].forEach(([sx, sy]) => {
        const x = cx + sx * hw;
        const y = cy + sy * hh;
        ctx.beginPath();
        ctx.moveTo(x - sx * arm, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y - sy * arm);
        ctx.stroke();
      });
      ctx.restore();
    }

    // A giant, faint index number behind the gun, rolling up on each change
    // and drifting slowly up while its division holds; the last one rolls
    // away as the line-up comes in.
    function divNumeral(lt) {
      const k = DIV_B.findLastIndex((x) => lt >= x) - 1;
      if (k < 0 || k > 5) return;
      const q = ease.inOutExpo(seg(lt, DIV_B[k + 1], DIV_B[k + 1] + 0.4));
      const drift = (n) => 64 * seg(lt, DIV_B[n + 1], DIV_B[n + 2]);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 320, W, 540);
      ctx.clip();
      ctx.font = font(800, 560);
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(255,255,255,0.045)";
      const x = DIV_POSE.x + 40;
      if (k > 0 && q < 1)
        ctx.fillText(`0${k}`, x, 790 - drift(k - 1) - q * 560);
      if (k < 5) ctx.fillText(`0${k + 1}`, x, 790 - drift(k) + (1 - q) * 560);
      ctx.restore();
    }

    // The line-up's slots and the pose of division n's pistol in it; the
    // pistols breathe with a slow swell in place, and the names hold still.
    const divSlot = (n) => 269 + n * 346;
    const divSlotPose = (n, lt) => ({
      x: divSlot(n) - (DIV.specs[n].kit.comp ? 28 : 0),
      y: 520,
      s: 1.2 * lerp(1, 1.03, seg(lt, DIV_B[6] + 0.3, DIV.dur)),
    });
    // once the names have been read, a slow light runs along the five, from
    // Open back to Production, until the blinds close
    const divLineupSheen = (n, lt) => {
      const a = DIV_B[6] + 1.3 + (4 - n) * 0.35;
      return seg(lt, a, a + 1.6);
    };

    // The pistol: it inks in under the title, then morphs through the five
    // divisions under a steady push in; on the line-up it shrinks into
    // Open's slot.
    function divPistol(lt) {
      const [, p, , s, , , l] = DIV_B;
      // every change lands with a small punch-in, and the box strike with a
      // hard one and a short shake, all over before the copy has settled
      const hitAt = s + DIV_STRIKE;
      const bump = DIV_B.slice(1, 6).reduce(
        (b, at) =>
          b + (lt < at ? 0 : Math.sin(Math.PI * seg(lt, at, at + 0.24))),
        0,
      );
      const jolt = lt >= hitAt ? 1 - seg(lt, hitAt, hitAt + 0.1) : 0;
      const kit = divKit(lt);
      // the push: 10 % closer by the line-up, at an even pace through every
      // hold, drifting right just enough that the gun's back edge stays put
      // beside the copy
      const push = seg(lt, 0, l);
      const base = {
        x: DIV_POSE.x + 28 * push,
        y: DIV_POSE.y,
        s: DIV_POSE.s * (1 + 0.1 * push),
      };
      const calm = { ...base, s: base.s * (1 + 0.014 * bump) };
      let pose = {
        x: base.x + Math.sin(lt * 157) * 3 * jolt,
        y: base.y + Math.cos(lt * 131) * 3 * jolt,
        s: base.s * (1 + 0.014 * bump + 0.024 * jolt),
      };
      const move = ease.inOut3(seg(lt, l, l + 0.3));
      if (move > 0) {
        const to = divSlotPose(4, lt);
        pose = {
          x: lerp(pose.x, to.x, move),
          y: lerp(pose.y, to.y, move),
          s: lerp(pose.s, to.s, move),
        };
      }
      // a slow light runs along the metal once it has turned solid, and
      // again through each hold, from when its change has landed and its
      // beam has passed until just before the next
      const sheen =
        lt >= l
          ? divLineupSheen(4, lt)
          : [
              [1.4, 2.6],
              ...DIV_B.slice(1, 6).map((at, i) => [
                at + 0.6,
                DIV_B[i + 2] - 0.1,
              ]),
            ]
              .map(([a, b]) => seg(lt, a, b))
              .find((q) => q > 0 && q < 1);
      divNumeral(lt);
      divBox(pose, kit.box, 0, "back");
      drawGun({
        ...pose,
        blue: 1 - ease.inOut3(seg(lt, 0.6, 1.4)),
        draw: ease.out3(seg(lt, 0.05, 1.2)),
        sheen: sheen ?? 0,
        optic: kit.optic,
        flush: kit.flush,
        magwell: kit.magwell,
        magwellIn: kit.magwellIn,
        comp: kit.comp,
        extMag: kit.extMag,
        ghost: kit.ghost,
      });
      divBox(pose, kit.box, kit.dims, "front", calm);
      // the box locks with a flash on the strike
      const lock = seg(lt, hitAt, hitAt + 0.3);
      if (lock > 0 && lock < 1) {
        const [bx0, by0] = gunPoint(pose, -3.5, -1.25);
        const [bx1, by1] = gunPoint(pose, 221.5, 148.75);
        ctx.strokeStyle = `rgba(255,255,255,${1 - lock})`;
        ctx.lineWidth = 3;
        const gr = ease.out3(lock) * 22;
        ctx.strokeRect(
          bx0 - gr,
          by0 - gr,
          bx1 - bx0 + 2 * gr,
          by1 - by0 + 2 * gr,
        );
      }
      // an inspection beam sweeps the gun on every change
      DIV_B.slice(1, 6).forEach((at) => {
        const q = seg(lt, at, at + 0.42);
        if (q <= 0 || q >= 1) return;
        const x = lerp(DIV_POSE.x - 330, DIV_POSE.x + 400, ease.inOut3(q));
        const a = Math.sin(q * Math.PI);
        const gr = ctx.createLinearGradient(x - 70, 0, x + 70, 0);
        gr.addColorStop(0, rgba(C.red, 0));
        gr.addColorStop(0.5, rgba(C.red, 0.16 * a));
        gr.addColorStop(1, rgba(C.red, 0));
        ctx.fillStyle = gr;
        ctx.fillRect(x - 70, 300, 140, 540);
        line(x, 300, x, 840, rgba(C.red, 0.85 * a), 2);
      });
      // the labels' marks on the pistol: Production's sight line and the
      // brackets, which lock on once the part has landed and leave with the
      // copy
      DIV.specs.forEach((d, k) => {
        const tIn = DIV_B[k + 1];
        const tOut = DIV_B[k + 2];
        if (lt < tIn || lt >= tOut + DIV_OUT) return;
        const out = 1 - divGone(lt, tOut);
        const on = seg(lt, tIn + 0.12, tIn + 0.35) * out;
        d.marks.forEach((m) => divBrackets(pose, DIV_MARKS[m], on));
        if (tIn !== p) return;
        const [rx, ry] = gunPoint(pose, GUN.rearSight[0], 1.2);
        const [fx, fy] = gunPoint(pose, GUN.sight[0], 1.2);
        const len = ease.outExpo(seg(lt, tIn + 0.05, tIn + 0.35));
        const ex = lerp(rx, fx + 150, len);
        ctx.save();
        ctx.globalAlpha *= out;
        ctx.setLineDash([10, 7]);
        line(
          rx - 60,
          ry + ((fy - ry) * -60) / (fx - rx),
          ex,
          ry + ((fy - ry) * (ex - rx)) / (fx - rx),
          rgba(C.red, 0.9),
          2,
        );
        ctx.setLineDash([]);
        ctx.restore();
      });
    }

    // The line-up: the other four ink in as blueprints, then solid, beside
    // Open; once Open has landed in its slot every name comes in at once and
    // holds; then Classic and Revolver.
    function divLineup(lt) {
      const t0 = DIV_B[6];
      if (lt < t0) return;
      const tNames = t0 + 0.2; // Open's pistol has cleared the names' row
      const tOthers = tNames;
      const lang = opt.lang;
      const ko = lang === "ko";
      DIV.specs.forEach((d, n) => {
        const lx = divSlot(n);
        if (n < 4) {
          const tn = t0 + 0.04 + n * 0.05; // Optics' last, as Open passes
          const draw = ease.out3(seg(lt, tn, tn + 0.25));
          if (draw > 0) {
            const g = divSlotPose(n, lt);
            const blue = 1 - ease.inOut3(seg(lt, tn + 0.12, tn + 0.3));
            if (d.kit.flush) divBox(g, draw, 0, "back");
            const sheen = divLineupSheen(n, lt);
            drawGun({ ...g, ...d.kit, blue, draw, fiber: 1 - blue, sheen });
            if (d.kit.flush) divBox(g, draw, 0, "front");
          }
        }
        // the name, fitted to its slot
        const pair = d.name;
        const str = ko ? pair[1] : pair[0];
        const family = ko ? KR : SANS;
        const weight = ko ? 700 : 800;
        const size = Math.min(
          ko ? 32 : 30,
          Math.floor(
            ((ko ? 32 : 30) * 326) /
              layout(str, font(weight, ko ? 32 : 30, family), 0.5).width,
          ),
        );
        divLine(
          str,
          lx,
          716,
          { size, weight, family, tracking: 0.5, align: "center" },
          tNames,
          DIV.dur + 1,
          lt,
        );
        if (lang === "both")
          divLine(
            pair[1],
            lx,
            756,
            {
              size: 28,
              weight: 700,
              family: KR,
              color: "#c9ccd1",
              align: "center",
            },
            tNames,
            DIV.dur + 1,
            lt,
          );
      });
      // and the others
      const rule = ease.outExpo(seg(lt, tNames, tNames + 0.5));
      line(96, 796, 96 + (1824 - 96) * rule, 796, "rgba(255,255,255,0.14)", 1);
      const [en, kr] = DIV.others;
      const o = { size: 34, weight: 800, tracking: 1 };
      if (lang === "both") {
        const f = font(800, 34);
        const fk = font(700, 30, KR);
        const we = layout(en, f, 1).width;
        const wk = layout(kr.slice(2), fk, 0).width;
        const x = W / 2 - (we + 28 + wk) / 2;
        divLine(en, x, 852, o, tOthers, DIV.dur + 1, lt);
        divLine(
          kr.slice(2),
          x + we + 28,
          852,
          { size: 30, weight: 700, family: KR, color: "#c9ccd1" },
          tOthers,
          DIV.dur + 1,
          lt,
        );
      } else
        divLine(
          ko ? kr : en,
          W / 2,
          852,
          {
            ...o,
            align: "center",
            family: ko ? KR : SANS,
            weight: ko ? 700 : 800,
          },
          tOthers,
          DIV.dur + 1,
          lt,
        );
    }

    // The whole chapter.
    function sceneDivisions(lt) {
      if (lt < 0 || lt > DIV.dur) return;
      // the grid behind takes a third of the pistol's push, the whole chapter
      // through (never so far that its edge shows)
      const g = 1 + 0.03 * (lt / DIV.dur);
      ctx.save();
      ctx.translate(DIV_POSE.x + 9 * (lt / DIV.dur), DIV_POSE.y);
      ctx.scale(g, g);
      ctx.translate(-DIV_POSE.x, -DIV_POSE.y);
      blueprintGrid(0.45);
      ctx.restore();
      divPistol(lt);
      divLineup(lt);
      divHeader(lt);
      divCopy(lt);
    }

    // Captions for renderDivisions, as caption() draws the reel's.
    function divCaption(lt) {
      const lang = opt.lang;
      DIV.captions.forEach(([a, b, ko, en], i) => {
        const next = DIV.captions[i + 1]?.[0] ?? Infinity;
        const exit = clamp(next - b - 0.02, 0.06, 0.3);
        if (lt < a || lt > b + exit) return;
        const ct = lt - a;
        const fade = 1 - seg(lt, b, b + exit);
        ctx.save();
        const scrim = ctx.createLinearGradient(0, H - 300, 0, H);
        scrim.addColorStop(0, "rgba(8,10,13,0)");
        scrim.addColorStop(1, "rgba(8,10,13,0.62)");
        ctx.globalAlpha = fade * ease.out3(seg(ct, 0, 0.3));
        ctx.fillStyle = scrim;
        ctx.fillRect(0, H - 300, W, 300);
        ctx.globalAlpha = fade;
        const y = lang === "both" ? H - 128 : H - 96;
        const bar = ease.outExpo(seg(ct, 0, 0.35));
        ctx.fillStyle = C.red;
        ctx.fillRect(96, y - 30 * bar, 4, 36 * bar);
        kinetic(lang === "en" ? en : ko, 120, y, {
          size: 30,
          weight: lang === "en" ? 600 : 700,
          family: lang === "en" ? SANS : KR,
          t: ct,
          out: lt > b ? lt - b : -1,
          stagger: 0.008,
          dur: 0.4,
          outDur: exit * 0.8,
          outStagger: 0,
        });
        if (lang === "both") {
          ctx.globalAlpha = fade * ease.out3(seg(ct, 0.15, 0.5));
          text(en, 120, y + 40, { size: 22, weight: 500, color: C.dim });
        }
        ctx.restore();
      });
    }

    // A gleam running once along a red rule (x, y, w, h) as p goes 0 → 1.
    function gleam(x, y, w, h, p) {
      if (p <= 0 || p >= 1) return;
      const gx = x + lerp(-90, w + 90, ease.inOut3(p));
      const g = ctx.createLinearGradient(gx - 90, 0, gx + 90, 0);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "rgba(255,255,255,0.75)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }

    // The push from scoring to the stage: one eased value moves both scenes,
    // so the stage's left edge follows the scoring panel's right edge.
    const stagePush = (t) => ease.inOut3(seg(t, 15.7, 16.0));

    // A line of copy that lands fast and then holds still, so that it can be
    // read: kinetic type whose last glyph is at rest `land` seconds (of the
    // original cut) after `at`, however long the line, pushed up out of its
    // mask and faded over `exit` from `out` on. Returns its width.
    function landLine(str, x, y, o, t, at, land, out = Infinity, exit = 0.05) {
      const n = [...str].length;
      if (t < at || t >= out + exit)
        return layout(
          str,
          font(o.weight ?? 800, o.size, o.family),
          o.tracking ?? 0,
        ).width;
      ctx.save();
      ctx.globalAlpha *= 1 - seg(t, out, out + exit);
      const w = kinetic(str, x, y, {
        weight: 800,
        ...o,
        t: t - at,
        dur: land * 0.7,
        stagger: n > 1 ? (land * 0.3) / (n - 1) : 0,
        out: t >= out ? t - out : -1,
        outDur: exit,
        outStagger: 0,
      });
      ctx.restore();
      return w;
    }

    // S4 — targets and scoring, in two beats (at this stretch a second on
    // screen is 0.386 s of the cut; times below are on screen, from 13.0).
    // Beat one, as the blinds open: the target and its points table (title,
    // the Major and Minor heads, the zone rows A, C and D), every line still
    // within 0.3 s of its start and all of it by 0.6 s; then, a second apart
    // on the scoring hit's beat (1, 2 and 3 s), each zone lights up in turn
    // on the target, with its hits and its row. Beat two, at 4 s: steel,
    // no-shoot and miss, three cards together, still by 4.3 s; the popper is
    // shot at 4.5 s and lies down by 5 s, and a light runs across the target
    // and the cards while they hold with the table until the push to the
    // stage (7 s). The table reads for 3.4 s before the cards and 6.4 s in
    // all, the cards for 2.7 s.
    // Copy: FINALE_COPY.scoring.
    // [zone, Major, Minor, the row's entrance, its zone lit on the target]
    const SCORING_ROWS = [
      ["A", 5, 5, 13.1, 13.3857],
      ["C", 4, 3, 13.112, 13.7714],
      ["D", 2, 1, 13.124, 14.1571],
    ];
    const SCORING_CARDS = [14.5429, 14.5506, 14.5583]; // steel, no-shoot, miss
    const STEEL_HIT = 14.7357; // the popper is shot; it lies down by 14.9286
    function sceneTargets(t) {
      if (t < 12.9 || t > 16.1) return;
      const whip = stagePush(t);
      ctx.save();
      ctx.translate(-whip * W * 1.1, 0);
      const lt = t - 13.0;
      const lang = opt.lang;
      const ko = lang === "ko";
      const both = lang === "both";
      const S = FINALE_COPY.scoring;
      // the line in the viewer's language: Korean in ko, else English
      const pick = (pair) => (ko ? pair[1] : pair[0]);
      const face = (o) =>
        ko ? { ...o, weight: 700, family: KR, tracking: 0 } : o;
      const LAND = 0.115; // 0.3 s on screen
      floorGrid(0.35, t);
      // the target
      const tx = 540;
      const ty = 540;
      const s = 10.5;
      // Once the popper is down, a soft light runs left to right across the
      // target and then the cards (1.7 s on screen), over their surfaces
      // only; their letters stay put.
      const sweep = seg(t, 14.95, 15.62);
      const sweepX = lerp(100, W + 200, ease.inOut3(sweep));
      const light = (a) => {
        const g = ctx.createLinearGradient(sweepX - 170, 0, sweepX + 170, 90);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, `rgba(255,255,255,${a})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        return g;
      };
      // a zone glows for 0.7 s on screen and is dark again as the next one
      // lights
      const glow = (i) => {
        const at = SCORING_ROWS[i][4];
        return (
          seg(t, at, at + 0.04) * (1 - ease.out3(seg(t, at + 0.27, at + 0.37)))
        );
      };
      drawTarget(tx, ty, s, {
        build: ease.out3(seg(lt, 0, 0.2)),
        fill: ease.out3(seg(lt, 0.04, 0.2)),
        zones: ease.out3(seg(lt, 0.08, 0.24)),
        letters: ease.out3(seg(lt, 0.12, 0.24)),
        hiA: glow(0) * 0.8,
        hiC: glow(1) * 0.8,
        hiD: glow(2) * 0.8,
      });
      if (sweep > 0 && sweep < 1) {
        ctx.save();
        ctx.translate(tx, ty);
        ctx.scale(s, s);
        tracePath(ctx, TGT.outer);
        ctx.scale(1 / s, 1 / s);
        ctx.translate(-tx, -ty);
        ctx.clip();
        ctx.fillStyle = light(0.13);
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
      // bullet holes: two in A, one in C, one in D (cm from the centre),
      // each as its zone lights up
      [
        [-2, -12, SCORING_ROWS[0][4]],
        [4, -6, SCORING_ROWS[0][4] + 0.01],
        [-12, 4, SCORING_ROWS[1][4]],
        [17, 12, SCORING_ROWS[2][4]],
      ].forEach(([hx, hy, at]) => {
        if (t < at) return;
        ctx.fillStyle = "#14100b";
        ctx.beginPath();
        ctx.arc(tx + hx * s, ty + hy * s, 6, 0, Math.PI * 2);
        ctx.fill();
        const r = seg(t, at, at + 0.2);
        if (r < 1) {
          ctx.strokeStyle = `rgba(255,255,255,${1 - r})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(tx + hx * s, ty + hy * s, 6 + r * 40, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      // the points table: what each zone scores at Major and at Minor
      const x0 = 1000;
      const xMaj = x0 + 590;
      const xMin = W - 96 - 48;
      const tw = landLine(
        pick(S.title),
        x0,
        232,
        face({ size: 72, tracking: -2 }),
        t,
        13.047,
        LAND,
      );
      if (both)
        landLine(
          S.title[1],
          x0 + tw + 22,
          232,
          { size: 52, weight: 700, family: KR, color: "#c9ccd1" },
          t,
          13.06,
          LAND,
        );
      [
        [xMaj, S.major, C.dim],
        [xMin, S.minor, C.white],
      ].forEach(([x, pair, color]) => {
        const head = { align: "center", color };
        if (both) {
          landLine(
            pair[0],
            x,
            288,
            { ...head, size: 22, tracking: 2 },
            t,
            13.085,
            LAND,
          );
          landLine(
            pair[1],
            x,
            320,
            { ...head, size: 22, weight: 700, family: KR },
            t,
            13.09,
            LAND,
          );
        } else
          landLine(
            pick(pair),
            x,
            306,
            face({ ...head, size: 24, tracking: 2 }),
            t,
            13.085,
            LAND,
          );
      });
      const rule = ease.outExpo(seg(lt, 0.06, 0.2));
      line(x0, 346, x0 + (W - 96 - x0) * rule, 346, "rgba(255,255,255,0.2)", 1);
      SCORING_ROWS.forEach(([z, maj, min, at], i) => {
        if (t < at) return;
        const y = 428 + i * 82;
        // the row of the zone that is lit
        const band = glow(i);
        if (band > 0) {
          ctx.fillStyle = rgba(C.red, 0.13 * band);
          ctx.fillRect(x0 - 20, y - 56, W - 96 - x0 + 40, 76);
        }
        const pill = ease.outBack(seg(t, at, at + 0.1));
        ctx.save();
        ctx.fillStyle = C.red;
        ctx.globalAlpha = 0.95;
        ctx.beginPath();
        ctx.roundRect(xMin - 48 * pill, y - 46, 96 * pill, 62, 8);
        ctx.fill();
        ctx.restore();
        landLine(z, x0, y, { size: 60 }, t, at, 0.1);
        landLine(
          String(maj),
          xMaj,
          y,
          { size: 52, weight: 600, align: "center", color: C.dim },
          t,
          at + 0.01,
          0.1,
        );
        landLine(
          String(min),
          xMin,
          y,
          { size: 52, align: "center" },
          t,
          at + 0.02,
          0.1,
        );
        const name = S.zones[z];
        if (both) {
          landLine(
            name[0],
            x0 + 86,
            y - 18,
            { size: 24, tracking: 1.5 },
            t,
            at,
            LAND,
          );
          landLine(
            name[1],
            x0 + 86,
            y + 14,
            { size: 24, weight: 700, family: KR, color: "#c9ccd1" },
            t,
            at + 0.01,
            LAND,
          );
        } else
          landLine(
            pick(name),
            x0 + 86,
            y - 6,
            face({ size: ko ? 32 : 28, tracking: 1.5, color: "#dfe1e5" }),
            t,
            at,
            LAND,
          );
      });

      // steel, no-shoot, miss: three cards, in together
      const cw = 258;
      const chh = 250;
      const cy = 640;
      SCORING_CARDS.forEach((at, i) => {
        const cl = t - at;
        if (cl < 0) return;
        const cx = x0 + i * (cw + 25);
        const pop = ease.out3(seg(cl, 0, 0.11));
        ctx.save();
        ctx.globalAlpha = pop;
        ctx.translate(0, (1 - pop) * 24);
        ctx.fillStyle = "rgba(255,255,255,0.045)";
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(cx, cy, cw, chh, 6);
        ctx.fill();
        ctx.stroke();
        // the light runs across the card, behind its icon and name
        if (sweep > 0 && sweep < 1) {
          ctx.save();
          ctx.clip();
          ctx.fillStyle = light(0.08);
          ctx.fillRect(cx, cy, cw, chh);
          ctx.restore();
        }
        // the icon: the popper (shot down when it is hit), the white
        // no-shoot, the outline of a target that was missed
        if (i === 0) {
          const fall = ease.in3(seg(t, STEEL_HIT, 14.9286));
          const bx = cx + cw / 2;
          const by = cy + 134;
          ctx.save();
          ctx.translate(bx, by);
          ctx.scale(1.1, 1.1 * Math.cos(fall * 1.45));
          ctx.transform(1, 0, -0.25 * fall, 1, 0, 0);
          tracePath(ctx, POPPER);
          ctx.restore();
          ctx.fillStyle = C.steel;
          ctx.fill();
          if (t > STEEL_HIT && t < STEEL_HIT + 0.12)
            muzzleFlash(
              bx,
              by - 70 * 1.1,
              26,
              1 - seg(t, STEEL_HIT, STEEL_HIT + 0.08),
              99,
            );
        } else {
          ctx.save();
          ctx.translate(cx + 66, cy + 80);
          ctx.scale(1.8, 1.8);
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
          text("−10", cx + cw - 24, cy + 110, {
            size: 64,
            weight: 800,
            color: C.red,
            align: "right",
          });
        }
        // the name, and for steel what it takes to score
        const name = [S.steel, S.noShoot, S.miss][i];
        const tx0 = cx + 24;
        if (both) {
          const w = text(name[0], tx0, cy + 178, {
            size: 28,
            weight: 800,
            tracking: 1,
          });
          text(name[1], tx0 + w + 12, cy + 178, {
            size: 24,
            weight: 700,
            family: KR,
            color: "#c9ccd1",
          });
          if (i === 0) {
            text(S.steelSub[0], tx0, cy + 210, {
              size: 22,
              weight: 700,
              tracking: 2,
              color: "#dfe1e5",
            });
            text(S.steelSub[1], tx0, cy + 238, {
              size: 22,
              weight: 700,
              family: KR,
              color: "#c9ccd1",
            });
          }
        } else {
          text(pick(name), tx0, cy + 190, {
            size: ko ? 34 : 30,
            weight: ko ? 700 : 800,
            family: ko ? KR : SANS,
            tracking: ko ? 0 : 1,
          });
          if (i === 0)
            text(pick(S.steelSub), tx0, cy + 228, {
              size: ko ? 26 : 22,
              weight: 700,
              family: ko ? KR : SANS,
              tracking: ko ? 0 : 2,
              color: "#dfe1e5",
            });
        }
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
      x: [-1.5, 1.9],
      h: 2.1,
      port: [
        [-0.35, 0.9],
        [0.75, 1.75],
      ],
      label: "PORT",
    };
    // area D: a low port, so the shooter has to kneel
    const WALL_D = {
      z: 3.7,
      x: [7.6, 10.9],
      h: 2.0,
      port: [
        [8.35, 0.45],
        [10.35, 1.2],
      ],
      label: "LOW PORT",
    };
    const CTRL = { AB: [-3.6, 0, 1.7], BC: [2.8, 0, 0.6], CD: [7.6, 0, 1.2] };
    function moveAt(st) {
      return EVENTS.moves.find(([a, b]) => st >= a && st <= b);
    }
    // Accelerate, hold a running speed, decelerate: the feet can keep up.
    function runProfile(x, r) {
      r = Math.min(r, 0.45);
      const v = 1 / (1 - r);
      const S = (u) => r * v * (u * u * u - (u * u * u * u) / 2);
      if (x < r) return S(x / r);
      if (x > 1 - r) return 1 - S((1 - x) / r);
      return v * (x - r / 2);
    }
    function shooterPos(st) {
      let pos = AREAS.A.pos;
      for (const [a, b, from, to] of EVENTS.moves) {
        if (st < a) break;
        const p = runProfile(seg(st, a, b), 0.3 / (b - a));
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
    function swingAngle(st) {
      const tau = st - EVENTS.swingerRelease;
      if (tau < 0) return SWING.theta0;
      return (
        SWING.theta0 *
        Math.cos(((2 * Math.PI) / SWING.period) * tau) *
        Math.exp(-SWING.damping * tau)
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
      // the paper's own axes turn with the arm (up2 points along it to the pivot)
      const r2 = add(mul(right, Math.cos(th)), mul(UP, Math.sin(th)));
      const up2 = add(mul(right, -Math.sin(th)), mul(UP, Math.cos(th)));
      return { pivot, centre, th, right, r2, up2 };
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
    // Two IPSC metal plates on a common base, falling back when hit.
    function platePos(k) {
      const tg = TARGETS.PL;
      const { right } = targetFrame("PL");
      return add([tg.pos[0], 1.1, tg.pos[2]], mul(right, k ? 0.24 : -0.24));
    }
    // Mover: a paper target on a carriage, crossing a rail at constant speed
    // between two barricades.
    const MOVER = { half: 2.4, gap: 1.25 };
    function moverOffset(st) {
      const { start, dur } = EVENTS.mover;
      return lerp(-MOVER.half, MOVER.half, seg(st, start, start + dur));
    }
    function moverCentre(st) {
      const tg = TARGETS.MV;
      const { right } = targetFrame("MV");
      return add([tg.pos[0], 1.24, tg.pos[2]], mul(right, moverOffset(st)));
    }

    // Where a shot lands, in world space, at stage time st (moving targets carry their holes).
    function hitWorld(s, st = s.st) {
      const tg = TARGETS[s.target];
      if (tg.kind === "popper") return [tg.pos[0], 0.7, tg.pos[2]];
      if (tg.kind === "plates") return platePos(s.hit);
      const { right } = targetFrame(s.target);
      if (tg.kind === "mover")
        return add(add(moverCentre(st), mul(right, s.hit[0])), [
          0,
          -s.hit[1],
          0,
        ]);
      if (tg.kind === "swinger") {
        const p = swingerPose(st);
        return add(add(p.centre, mul(p.r2, s.hit[0])), mul(p.up2, -s.hit[1]));
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
      const prev =
        k > 0
          ? hitWorld(SHOTS[k - 1], SHOTS[k - 1].st + 0.06)
          : [-8.2, 1.1, 6.8];
      const from = k > 0 ? SHOTS[k - 1].st : 0.8;
      return lerp3(
        prev,
        cur,
        ease.inOut3(seg(st, from + 0.05, SHOTS[k].st - 0.04)),
      );
    }
    // Camera: rigs blended at cut points in video time — a drone behind the
    // shooter, close-ups on the moving targets in slow motion, tracking shots
    // on the runs and a look over the shoulder through the port.
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
    // The muzzle crown of the shooter's pistol, from the character rig.
    function muzzleAt(st) {
      return shooterRig(st).muzzle;
    }
    // Bullet time: the camera rides alongside one round from the muzzle to the
    // target while the clock crawls, swinging round as it goes.
    function bulletCam(s, from, to, o) {
      return (st) => {
        const muzzle = muzzleAt(s.st);
        const hit = hitWorld(s);
        const pd = norm(sub(hit, muzzle));
        const perp = norm(cross(UP, pd));
        const prog = clamp((st - s.st) / IMPACT);
        const c = lerp3(muzzle, hit, lerp(0.04, 0.92, prog));
        const a = lerp(o.a0, o.a1, ease.inOut3(seg(st, from, to)));
        const pos = add(
          c,
          add(add(mul(perp, Math.cos(a) * o.r), mul(pd, Math.sin(a) * o.r)), [
            0,
            o.h,
            0,
          ]),
        );
        // looking a little ahead of the round brings the target into the
        // frame early, clear of the shot timer
        const look = lerp3(
          c,
          hit,
          (o.lead ?? 0) * ease.inOut3(clamp(prog / 0.5)),
        );
        return [pos, look, o.fov, 0.06 * Math.sin(a)];
      };
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
        // wide enough off his line of fire that the pistol shows its slide in
        // three-quarter view, never end-on
        const pos = add(
          sp,
          add(add(mul(dir, -5.4), mul(side, -3.0)), [0, 4.6, 0]),
        );
        // tilted down enough to keep the shooter, gun and all, in frame
        const look = lerp3(fc, [wp[0], 1.0, wp[2]], 0.35);
        return [
          pos,
          add(lerp3(look, add(sp, [0, 1.2, 0]), 0.2), mul(side, 1.3)),
          34,
          0,
        ];
      },
      // the reload on the run: low and ahead of him on his support side, so
      // the magwell, the support hand and the pouch face the lens; while the
      // split screen covers the left half he is framed right of centre
      reload(st) {
        const sp = shooterPos(st);
        const [r0, , , r3] = EVENTS.reload;
        const split = ease.inOut3(env(st, r0 - 0.05, r3 + 0.1, 0.3, 0.3));
        const pos = add(sp, [3.0, lerp(2.2, 2.6, seg(st, 7.5, 10.2)), 1.8]);
        const look = add(sp, [0, 1.0, 0]);
        const v = norm([look[0] - pos[0], 0, look[2] - pos[2]]);
        const shift = mul([-v[2], 0, v[0]], 0.8 * split);
        return [add(pos, shift), add(look, shift), 40, 0];
      },
      // a tracking shot leading the run, square to the muzzle so the pistol
      // reads in profile at the chest
      side(st) {
        const sp = shooterPos(st);
        const [a, b] =
          EVENTS.moves.findLast(([a]) => st >= a - 0.3) ?? EVENTS.moves[0];
        const p = seg(st, a - 0.08, b + 0.1);
        return [
          add(sp, [lerp(4.6, 3.9, p), lerp(1.25, 1.4, p), 0.55]),
          add(sp, [0.35, 1.05, 0.2]),
          lerp(36, 33, p),
          0.015,
        ];
      },
      // low and to the side for the kneeling position at the low port
      low(st) {
        const sp = shooterPos(st);
        return [add(sp, [-2.5, 0.65, 0.3]), add(sp, [0.3, 0.8, 0.7]), 48, 0.02];
      },
      orbitSwinger: bulletCam(
        SHOTS.find((x) => x.target === "SW"),
        3.085,
        3.15,
        {
          r: 2.2,
          h: 0.4,
          a0: -0.7,
          a1: 0.45,
          fov: 42,
          lead: 0.5,
        },
      ),
      orbitEnd: bulletCam(SHOTS[SHOTS.length - 1], 14.545, 14.612, {
        r: 2.1,
        h: 0.35,
        a0: -0.25,
        a1: 0.4,
        fov: 42,
      }),
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
      // over the strong shoulder: both hands on the pistol, through the port
      shoulder(st) {
        const r = shooterRig(st);
        const right = norm(sub(r.shoulders[1], r.shoulders[0]));
        const f = r.facing;
        const back = lerp(1.15, 0.85, ease.inOut3(seg(st, 5.15, 7.5)));
        // high over the strong shoulder, so the pistol sits under the target
        // it is working instead of across its neighbours
        const eye = add(r.head, add(mul(f, -back), mul(right, 0.46)));
        return [
          add(eye, [0, 0.3, 0]),
          lerp3(FOCUS.B, workPoint(st), 0.65),
          35,
          -0.02,
        ];
      },
      mover: closeUp("MV", {
        dist: 5.2,
        push: 0.8,
        from: 11.1,
        to: 12.2,
        side: 0.5,
        height: 1.3,
        lookY: 1.2,
        fov: 34,
        roll: 0.03,
      }),
      overview() {
        // centred on the whole course, areas A to D
        return [[1.2, 16, -8.2], [1.2, 0, 4.8], 54, 0];
      },
    };
    function stageCamera(t, st) {
      let [pos, look, fov, roll] = RIGS.drone(st);
      const blend = ([p2, l2, f2, r2], p, how) => {
        if (how === "arc" || how === "arcBack") {
          // swing round the shooter instead of through him
          const c = shooterPos(st);
          const a = sub(pos, c);
          const b = sub(p2, c);
          const ya = Math.atan2(a[2], a[0]);
          let dy = Math.atan2(b[2], b[0]) - ya;
          dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
          if (how === "arcBack" && Math.sin(ya + dy / 2) > 0)
            dy -= Math.sign(dy) * 2 * Math.PI;
          const y = ya + dy * p;
          const r = lerp(Math.hypot(a[0], a[2]), Math.hypot(b[0], b[2]), p);
          pos = [
            c[0] + Math.cos(y) * r,
            lerp(pos[1], p2[1], p),
            c[2] + Math.sin(y) * r,
          ];
        } else pos = lerp3(pos, p2, p);
        look = lerp3(look, l2, p);
        fov = lerp(fov, f2, p);
        roll = lerp(roll, r2, p);
      };
      for (const [at, dur, rig, how] of CUTS) {
        const p = ease.inOut3(seg(t, at, at + dur));
        if (p <= 0) break;
        blend(RIGS[rig](st), p, how);
      }
      // the stage opens on the overview
      const e = 1 - ease.inOut3(seg(t, 15.9, 16.55));
      if (e > 0) blend(RIGS.overview(), e);
      return camera(pos, look, fov, roll);
    }
    // The course walk before the clock resumes (lt: 0..FLY.dur, the clock
    // frozen at st): down from the overview to area A, along behind the
    // shooting areas, over the port and the low port, and back up to the
    // overview. The path runs through its keys on a centripetal Catmull-Rom
    // curve, some 6 m up and 5 m or more behind the shooting areas: high
    // over the walls, 7.5 m or more from the shooter, nowhere near a target.
    // It eases out of the stage's own frame and back into it, and between
    // them keeps an even pace, a little slower through the keys, so the shot
    // flows on under the course card.
    const FLY_KEYS = [
      // [share of the walk, position, look at, fov, roll]
      [0.3, [-12.4, 6.0, -5.8], [-6.6, 0.2, 4.8], 42, -0.03],
      [0.51, [0.4, 6.4, -6.8], [1.0, 0.2, 5.2], 40, 0],
      [0.72, [12.8, 6.0, -5.4], [8.6, 0.2, 4.8], 42, 0.03],
    ];
    function flyCamera(lt, st, t) {
      const over = RIGS.overview();
      const keys = [
        [0, ...over],
        ...FLY_KEYS.map(([at, ...k]) => [at * FLY.dur, ...k]),
        [FLY.dur, ...over],
      ];
      const n = keys.length - 1;
      let i = 0;
      while (i < n - 1 && lt >= keys[i + 1][0]) i++;
      // the pace: still at both ends, and through each key at 0.85 of the
      // mean of the speeds either side of it (a Hermite curve on the key
      // index, its slopes from the chords between the keys)
      const chord = (j) => Math.hypot(...sub(keys[j + 1][1], keys[j][1]));
      const speed = (j) => chord(j) / (keys[j + 1][0] - keys[j][0]);
      const h = keys[i + 1][0] - keys[i][0];
      const pace = (j) =>
        j === 0 || j === n
          ? 0
          : (((0.85 * (speed(j - 1) + speed(j))) / 2) * h) / chord(i);
      const s = seg(lt, keys[i][0], keys[i + 1][0]);
      const u =
        (s * s * (s - 2) + s) * pace(i) +
        s * s * (3 - 2 * s) +
        s * s * (s - 1) * pace(i + 1);
      const at = (j) => keys[clamp(j, 0, n)];
      const ends = (j, f) =>
        j < 0
          ? sub(mul(f(at(0)), 2), f(at(1)))
          : j > n
            ? sub(mul(f(at(n)), 2), f(at(n - 1)))
            : f(at(j));
      // centripetal Catmull-Rom between key i and key i + 1
      const curve = (f) => {
        const P = [i - 1, i, i + 1, i + 2].map((j) => ends(j, f));
        const T = [0];
        for (let k = 1; k < 4; k++)
          T.push(
            T[k - 1] +
              Math.max(1e-3, Math.hypot(...sub(P[k], P[k - 1]))) ** 0.5,
          );
        const q = lerp(T[1], T[2], u);
        const L = (A, B, a, b) => lerp3(A, B, (q - T[a]) / (T[b] - T[a]));
        const A1 = L(P[0], P[1], 0, 1);
        const A2 = L(P[1], P[2], 1, 2);
        const A3 = L(P[2], P[3], 2, 3);
        return L(L(A1, A2, 0, 2), L(A2, A3, 1, 3), 1, 2);
      };
      const [fov, roll] = curve((k) => [k[3], k[4] * 100, 0]);
      const fly = camera(
        curve((k) => k[1]),
        curve((k) => k[2]),
        fov,
        roll / 100,
      );
      // hand over exactly: from the stage's frame as the walk starts, and to
      // its frame at RESUME as the walk ends
      const w = Math.max(
        1 - ease.inOut3(seg(lt, 0, 0.5)),
        ease.inOut3(seg(lt, FLY.dur - 0.5, FLY.dur)),
      );
      if (w <= 0) return fly;
      const edge = stageCamera(lt < FLY.dur / 2 ? t : RESUME, st);
      const f = norm(lerp3(fly.f, edge.f, w));
      const r0 = lerp3(fly.r, edge.r, w);
      const r = norm(sub(r0, mul(f, dot(r0, f))));
      return {
        pos: lerp3(fly.pos, edge.pos, w),
        f,
        r,
        u: cross(f, r),
        focal: lerp(fly.focal, edge.focal, w),
      };
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
    // the shot-timer panel and the slide-cycle picture-in-picture
    let hudLive = false;
    const HUD_RECTS = [
      [W - 96 - 334, 34, W - 96 + 34, 640],
      [86, 158, 526, 408],
    ];
    // How much of a stage label to show, from its box (w × h, centred on x,
    // standing on y): none under a HUD panel or above one, where it would sit
    // on the panel's border, and fading out within about 60 px of the frame.
    // the caption on screen during the stage (set by sceneStage): labels keep
    // out of its band, and the targets it names are drawn up large
    let stageCap = null;
    // over the course walk: the card's panel (as wide as its copy, see
    // cardLayout) and how far it is up (0..1), and the frozen shot timer,
    // which has no panel behind it until the clock resumes
    const CARD_AT = [86, 136]; // its top left corner
    const TIMER_RECT = [W - 340, 40, W - 90, 160];
    // the stage's panels as they come in at RESUME (the slide-cycle panel
    // grows later, for the reload)
    const PANELS_AT_RESUME = HUD_RECTS.map((r) => r.slice());
    let cardUp = 0;
    let walking = false;
    // 0..1: how far the walk has handed its labels over to the stage's
    // panels. Those under a panel fade out before it comes in and stay out
    // until the panel hides them itself (hudLive).
    let handOver = 0;
    // the labels drawn so far in a frame of the walk ([x0, y0, x1, y1, how
    // far it is shown]), and how far a label gives way to one where they meet
    const walkBoxes = [];
    let unclutter = 0;
    // where the target numbers stand in a frame of the walk (T1 to T8, over
    // each paper target, see drawStageTarget): the walk names the kinds of
    // target and leaves the numbers to the stage, so they step back for it
    let walkTags = [];
    function labelAlpha(x, y, w, h) {
      const under = ([x0, , x1, y1]) =>
        x > x0 - 40 && x < x1 + 40 && y < y1 + 10;
      if (hudLive && HUD_RECTS.some(under)) return 0;
      const edge = seg(
        Math.min(x - w / 2, W - x - w / 2, y - h, H - y),
        20,
        60,
      );
      // (the walk keeps the band clear throughout, for its caption, and on
      // through the hand-over until the stage's first caption takes it)
      const inBand = (stageCap || walking || handOver > 0) && x - w / 2 < 1460;
      let a = inBand ? edge * seg(H - 215 - y, 0, 25) : edge;
      if (PANELS_AT_RESUME.some(under)) a *= 1 - handOver;
      if (!walking) return a;
      // on the walk a label fades out as it nears the card or the timer,
      // and gives way to a label already drawn where it would land: seen low
      // and from the side, one target's name can sit on its neighbour's
      const clear = ([x0, , x1, y1]) =>
        seg(Math.max(x0 - x - w / 2, x - w / 2 - x1, y - h - y1), 8, 36);
      const box = [x - w / 2, y - h, x + w / 2, y + 4];
      // a label gives way over the last 10 px before it meets one
      const meet = ([x0, y0, x1, y1, b]) =>
        b *
        (1 -
          seg(
            Math.max(x0 - box[2], box[0] - x1, y0 - box[3], box[1] - y1),
            0,
            10,
          ));
      const tag = walkTags.some(
        ([qx, qy]) => Math.abs(qx - x) + Math.abs(qy - y) < 0.5,
      );
      const shown =
        a *
        (1 - cardUp * (1 - clear(cardLayout().rect))) *
        clear(TIMER_RECT) *
        (tag ? 1 - unclutter : 1);
      const out = shown * (1 - unclutter * Math.max(0, ...walkBoxes.map(meet)));
      // it holds its place even where it gives way itself, so a crowd shows
      // one name rather than passing it round
      walkBoxes.push([...box, shown]);
      return out;
    }
    // the stage's target names, in Korean for the Korean captions
    const TAG_KO = {
      SWINGER: "스윙어",
      POPPER: "포퍼",
      "NO-SHOOT": "노슛",
      PLATES: "철판",
      "DROP TURNER": "드롭 터너",
      MOVER: "무버",
      PORT: "포트",
      "LOW PORT": "낮은 포트",
    };
    function label3(cam, p, str, color = "rgba(255,255,255,0.75)", size = 13) {
      const q = project(cam, p);
      if (q[2] < 0.5) return;
      const named = stageCap?.[4]?.includes(str);
      const ko = opt.lang === "en" ? null : TAG_KO[str];
      const sz = named ? 22 : size;
      const main = opt.lang === "ko" && ko ? ko : str;
      const isKo = main !== str;
      const sub = opt.lang === "both" ? ko : null;
      const w = layout(
        main,
        font(800, sz, isKo ? KR : SANS),
        isKo ? 0 : 1.5,
      ).width;
      const a = labelAlpha(q[0], q[1] + (sub ? sz : 0), w, sz * (sub ? 2 : 1));
      if (a <= 0) return;
      ctx.save();
      ctx.globalAlpha *= a;
      const col = named ? C.white : color;
      text(main, q[0], q[1], {
        size: sz,
        weight: 800,
        tracking: isKo ? 0 : 1.5,
        align: "center",
        color: col,
        family: isKo ? KR : SANS,
      });
      if (sub)
        text(sub, q[0], q[1] + sz + 2, {
          size: Math.max(12, sz - 2),
          weight: 700,
          align: "center",
          color: col,
          family: KR,
        });
      ctx.restore();
    }

    // fly: local time inside the course walk (the clock stays frozen)
    function sceneStage(t, fly = null) {
      if (fly == null && (t < 15.7 || t > STAGE_END + 1.2)) return;
      const tfin = fly == null ? ins(t) : insStart(FLY) + fly;
      stageCap =
        CAPTIONS.find((c) => tfin >= c[0] - 0.05 && tfin <= c[1] + 0.3) ?? null;
      const st = stageOfVideo(Math.max(t, RESUME)) / 1000;
      const enter = fly == null ? stagePush(t) : 1;
      // out before the hit factor lands (19.9 + SHIFT)
      const leave = ease.in3(seg(t, STAGE_END + 0.3, STAGE_END + 0.55));
      ctx.save();
      ctx.translate((1 - enter) * W * 1.1, 0);
      if (enter < 1) {
        // and keeps to its own frame, off the scoring panel
        ctx.beginPath();
        ctx.rect(0, 0, W, H);
        ctx.clip();
      }
      ctx.globalAlpha = 1 - leave;
      const cam = fly == null ? stageCamera(t, st) : flyCamera(fly, st, t);
      hudLive = t > 16.05 && t < STAGE_END + 0.55; // while the panel is up
      walking = fly != null;
      cardUp = walking ? cardPanel(fly) : 0;
      // over the end of the walk, on until the panels are up
      handOver = walking
        ? ease.inOut3(seg(fly, FLY.dur - 0.7, FLY.dur - 0.2))
        : !hudLive && t >= RESUME && t < RESUME + 0.1
          ? 1
          : 0;
      walkBoxes.length = 0;
      unclutter = walking ? seg(fly, 0, 0.4) * (1 - handOver) : 0;
      walkTags = !walking
        ? []
        : Object.keys(TARGETS)
            .filter((k) => /^T\d/.test(k))
            .map((k) =>
              project(cam, [TARGETS[k].pos[0], 1.78, TARGETS[k].pos[2]]),
            );
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
      [WALL_B, WALL_D].forEach((WALL) =>
        objects.push({
          z: project(cam, [WALL.x[0] / 2 + WALL.x[1] / 2, 1, WALL.z])[2],
          draw: () => {
            const [x0, x1] = WALL.x;
            const [[px0, py0], [px1, py1]] = WALL.port;
            polyHole3(
              cam,
              [
                [x0, 0, WALL.z],
                [x1, 0, WALL.z],
                [x1, WALL.h, WALL.z],
                [x0, WALL.h, WALL.z],
              ],
              [
                [px0, py0, WALL.z],
                [px1, py0, WALL.z],
                [px1, py1, WALL.z],
                [px0, py1, WALL.z],
              ],
              // translucent, so the targets behind the wall stay in view
              "rgba(35,40,49,0.62)",
              "rgba(255,255,255,0.3)",
            );
            for (let y = 0.3; y < WALL.h; y += 0.3) {
              const cutA = y > py0 && y < py1;
              seg3(
                cam,
                [x0, y, WALL.z],
                [cutA ? px0 : x1, y, WALL.z],
                "rgba(255,255,255,0.05)",
                1,
              );
              if (cutA)
                seg3(
                  cam,
                  [px1, y, WALL.z],
                  [x1, y, WALL.z],
                  "rgba(255,255,255,0.05)",
                  1,
                );
            }
            poly3(
              cam,
              [
                [px0, py0, WALL.z],
                [px1, py0, WALL.z],
                [px1, py1, WALL.z],
                [px0, py1, WALL.z],
              ],
              null,
              rgba(C.red, 0.8),
              2.5,
            );
            label3(cam, [(px0 + px1) / 2, py1 + 0.12, WALL.z], WALL.label);
          },
        }),
      );
      Object.keys(TARGETS).forEach((key) => {
        const tg = TARGETS[key];
        objects.push({
          z: project(cam, add(tg.pos, [0, 1, 0]))[2],
          draw: () => drawStageTarget(cam, key, st),
        });
      });
      objects.push({
        z: project(cam, add(sp, [0, 1, 0]))[2],
        draw: () => drawShooter(cam, st),
      });
      objects
        .filter((o) => o.z > 0.5)
        .sort((a, b) => b.z - a.z)
        .forEach((o) => o.draw());

      // activators: a popper releasing a moving target. The line goes
      // unlabelled: it rides cameras that cut or swing within a second, and
      // the captions name what the popper starts.
      [
        ["P1", "SW", EVENTS.swingerRelease],
        ["P2", "DT", EVENTS.turnerRelease],
        ["P2", "MV", EVENTS.moverRelease],
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
        ctx.restore();
      });

      // tracers and score pops
      SHOTS.forEach((s) => {
        const dt = st - s.st;
        if (dt < 0 || dt > 0.9) return;
        const hit = hitWorld(s);
        const muzzle = muzzleAt(s.st);
        const clipped =
          dt < IMPACT + 0.035 &&
          clipSeg(
            cam,
            add(muzzle, mul(sub(hit, muzzle), clamp(dt / IMPACT - 0.5))),
            add(muzzle, mul(sub(hit, muzzle), clamp(dt / IMPACT))),
          );
        if (clipped) {
          const A = project(cam, clipped[0]);
          const B = project(cam, clipped[1]);
          if (rateAt(st * 1000) < 0.1 && dt < IMPACT) {
            // bullet time: the round, its glow and the air it pushes aside
            const head = add(muzzle, mul(sub(hit, muzzle), clamp(dt / IMPACT)));
            const Hd = project(cam, head);
            if (Hd[2] > 0.3) {
              const r = Math.max(3, (0.02 * cam.focal) / Hd[2]);
              const glow = ctx.createRadialGradient(
                Hd[0],
                Hd[1],
                0,
                Hd[0],
                Hd[1],
                r * 5,
              );
              glow.addColorStop(0, "rgba(255,230,180,0.9)");
              glow.addColorStop(1, "rgba(255,200,120,0)");
              ctx.fillStyle = glow;
              ctx.beginPath();
              ctx.arc(Hd[0], Hd[1], r * 5, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = C.brass;
              ctx.beginPath();
              ctx.arc(Hd[0], Hd[1], r, 0, Math.PI * 2);
              ctx.fill();
              for (let k = 1; k <= 3; k++) {
                const back = add(head, mul(sub(muzzle, hit), 0.035 * k));
                const Q = project(cam, back);
                if (Q[2] < 0.3) continue;
                ctx.strokeStyle = `rgba(255,255,255,${0.32 / k})`;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(Q[0], Q[1], r * (1.6 + k * 1.4), 0, Math.PI * 2);
                ctx.stroke();
              }
            }
          }
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
          // sized by distance, so a far shooter's flash doesn't swallow their head
          const flash = clamp((0.12 * cam.focal) / M[2], 10, 50);
          if (M[2] > 0.3)
            muzzleFlash(
              M[0],
              M[1],
              flash * (1 - dt / 0.08),
              1 - dt / 0.08,
              s.i * 13 + 5,
              Math.atan2(B[1] - M[1], B[0] - M[0]),
            );
        }
        if (dt > IMPACT) {
          // the pop rides with a moving target
          const P = project(
            cam,
            add(hitWorld(s, st), [0, 0.42 + dt * 0.45, 0]),
          );
          if (P[2] < 0.5) return;
          // a follow-up hit on the same target lifts this pop instead of stacking on it
          P[1] -= SHOTS.filter(
            (o) => o.target === s.target && o.st > s.st && o.st - s.st < 0.9,
          ).reduce(
            (sum, o) => sum + 44 * ease.out3(seg(st - o.st, 0.03, 0.15)),
            0,
          );
          const pa = ease.out3(seg(dt, 0.05, 0.15)) * (1 - seg(dt, 0.55, 0.9));
          const lbl = s.zone === "S" ? "+5 A" : `+${s.points} ${s.zone}`;
          const w = layout(lbl, font(800, 22), 1).width + 20;
          ctx.save();
          ctx.globalAlpha *= pa * labelAlpha(P[0], P[1] + 8, w, 38);
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
      ctx.restore();
      if (fly != null) courseCard(fly);

      const la =
        ease.out3(seg(t, 16.0, 16.3)) *
        (1 - seg(t, STAGE_END + 0.3, STAGE_END + 0.55));
      if (la <= 0) return;
      // in bullet time the panel steps back to let the round and its target
      // through; the clock and the ramp badge stay readable
      const bullet = Math.max(
        ...RAMPS.filter(([, , r]) => r < 0.1).map(([a, b]) =>
          env(t, vt(a), vt(b), 0.25, 0.25),
        ),
      );
      const back = la * (1 - 0.7 * bullet);
      ctx.save();
      ctx.globalAlpha = back;
      // a panel behind the shot timer, the shot list and the totals
      const x1 = W - 96;
      const y0 = 236;
      ctx.fillStyle = "rgba(10,12,15,0.9)";
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x1 - 324, 44, 348, y0 + 44 + 8 * 32 + 10 + 84 - 44, 6);
      ctx.fill();
      ctx.stroke();
      // speed ramp badge under the shot timer
      const rate = rateAt(st * 1000);
      ctx.globalAlpha = la;
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
      ctx.globalAlpha = back;
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
        // the time and split come with the shot, the zone once it lands
        const landed = seg(st, s.st + IMPACT, s.st + IMPACT + 0.05);
        if (landed > 0) {
          ctx.globalAlpha *= ease.out3(landed);
          // steel that falls scores like an A hit, so it is listed as one
          text(s.zone === "S" ? "A" : s.zone, x1, y, {
            size: 18,
            weight: 800,
            align: "right",
            color: s.zone === "A" || s.zone === "S" ? C.red : C.white,
          });
        }
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
      const scored = fired.filter((s) => st >= s.st + IMPACT);
      digits(
        String(scored.reduce((a, s) => a + s.points, 0)).padStart(3, "0"),
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
        text(opt.lang === "ko" ? "재장전" : "RELOAD", x1, ry + 58, {
          size: 22,
          weight: 800,
          tracking: opt.lang === "ko" ? 0 : 2,
          align: "right",
          color: C.red,
          family: opt.lang === "ko" ? KR : SANS,
        });
      else
        digits(`${String(inMag).padStart(2, "0")}/15`, x1, ry + 58, 26, {
          align: "right",
          weight: 700,
          color: C.dim,
        });
      ctx.restore();

      // the slide cycling and the reload, picture-in-picture; for the reload
      // it opens into a split screen
      const [rl0e, , , rl3e] = EVENTS.reload;
      // held open after the last step so its title (재장전 / RELOAD) stays
      // settled for its reading time; closed before the cut to the drone
      const split = ease.inOut3(env(st, rl0e - 0.05, rl3e + 1.38, 0.3, 0.2));
      const px = lerp(96, 60, split);
      const py = lerp(168, 150, split);
      const pw = lerp(420, 740, split); // clear of the shooter on the right
      const ph = lerp(230, 640, split);
      HUD_RECTS[1] = [px - 10, py - 10, px + pw + 10, py + ph + 10];
      ctx.save();
      ctx.globalAlpha = la;
      ctx.fillStyle = "rgba(10,12,15,0.9)";
      // red for the whole reload, until the panel starts to close
      const reloadUi = reloading || (st >= rl3e && split > 0.9);
      ctx.strokeStyle = reloadUi ? C.red : "rgba(255,255,255,0.16)";
      ctx.lineWidth = reloadUi ? 2 : 1;
      ctx.beginPath();
      ctx.roundRect(px, py, pw, ph, 6);
      ctx.fill();
      ctx.stroke();
      // the small chrome title while the panel rides with the shots; it
      // gives way as the panel opens, and once the panel is open its title
      // is the reload, in the viewer's language, at a size to read, still
      // from the moment the panel stops growing until it starts to close
      ctx.save();
      ctx.globalAlpha *= 1 - seg(split, 0, 0.3);
      text(
        opt.lang === "ko" ? "슬라이드 작동" : "SLIDE CYCLE",
        px + 20,
        py + 32,
        {
          size: 12,
          weight: 800,
          tracking: opt.lang === "ko" ? 0 : 2.4,
          color: C.dim,
          family: opt.lang === "ko" ? KR : SANS,
        },
      );
      ctx.restore();
      if (split > 0.6) {
        ctx.save();
        ctx.globalAlpha *= seg(split, 0.6, 0.95);
        const ko = opt.lang === "ko";
        const tw = text(ko ? "재장전" : "RELOAD", px + 24, py + 50, {
          size: 26,
          weight: ko ? 700 : 800,
          family: ko ? KR : SANS,
          tracking: ko ? 0 : 2.4,
          color: C.red,
        });
        if (opt.lang === "both")
          text("재장전", px + 24 + tw + 16, py + 50, {
            size: 26,
            weight: 700,
            family: KR,
            color: "#c9ccd1",
          });
        ctx.restore();
      }
      if (split > 0.02) {
        // the four steps of the reload (slide lock, magazine out, magazine
        // in, slide forward) as a bar of four segments, each filling as the
        // gun above does it. They go unnamed: the whole reload takes under a
        // second on screen, with steps 0.13-0.54 s apart, and the title and
        // the caption ("Swap mags on the run.") take the beat's reading time.
        const bw = (pw - 48 - 3 * 10) / 4;
        ctx.save();
        // only on the open panel, clear of the grip on the way in and out
        ctx.globalAlpha *= seg(split, 0.75, 1);
        EVENTS.reload.forEach((at, k) => {
          const x = px + 24 + k * (bw + 10);
          const y = py + ph - 44;
          ctx.fillStyle = "rgba(255,255,255,0.14)";
          ctx.fillRect(x, y, bw, 6);
          ctx.fillStyle = C.red;
          ctx.fillRect(x, y, bw * ease.out3(seg(st, at, at + 0.12)), 6);
        });
        ctx.restore();
      }
      const last = [...SHOTS].reverse().find((s) => st >= s.st);
      const rc =
        last && !reloading ? recoil(st - last.st) : { slide: 0, flip: 0 };
      const go = {
        x: px + pw / 2 + 4,
        y: py + lerp(124, 270, split),
        s: lerp(1.1, 2.5, split),
        rot: rc.flip,
      };
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
      ctx.roundRect(px, py, pw, ph, 6);
      ctx.clip();
      drawGun({ ...go, slide, mag, fiber: 0.9, hammer: last ? 1 : 0 });
      if (last && !reloading && st - last.st < 0.05) {
        const [mx, my] = gunPoint(go, GUN.muzzle[0], GUN.muzzle[1]);
        muzzleFlash(mx + 10, my, 54, 1 - (st - last.st) / 0.05, last.i * 3 + 1);
      }
      ctx.restore();
      SHOTS.forEach((s) => brass(go, st - s.st, s.i * 7 + 3));
      ctx.restore();
    }

    // The course card over the walk: what this stage asks of the shooter.
    // STAGE 01 and LONG COURSE land together, then its three numbers, each
    // over its name in the viewer's language (in both, English and the
    // Korean under it); all of it holds still, at 22 px or more, until the
    // card leaves for the slide-cycle panel that fades in at the same corner.
    const COURSE_STATS = [
      [SHOTS.length, ["ROUNDS", "발"]],
      [Object.keys(AREAS).length, ["POSITIONS", "사격 위치"]],
      [
        Object.values(TARGETS).filter((tg) =>
          ["swinger", "turner", "mover"].includes(tg.kind),
        ).length,
        ["MOVING TARGETS", "무빙 타겟"],
      ],
    ];
    // the card's copy and where it sits in the viewer's language: the stats
    // in columns as wide as their names, the panel round all of it
    function cardLayout() {
      const lang = opt.lang;
      const [x0, y0] = CARD_AT;
      const x = x0 + 40;
      const title = { size: 104, tracking: -3 };
      const sub = {
        str: { ko: "롱 코스 · LONG COURSE", both: "LONG COURSE · 롱 코스" }[
          lang
        ],
        o: { size: 26, weight: 700, family: KR, color: C.red },
      };
      if (!sub.str) {
        sub.str = "LONG COURSE";
        sub.o = { size: 24, weight: 800, tracking: 4, color: C.red };
      }
      const num = { size: 72, tracking: -1 };
      const en = { size: 22, weight: 800, tracking: 2.4, color: "#c9ccd1" };
      const ko = {
        size: lang === "ko" ? 26 : 22,
        weight: 700,
        family: KR,
        color: lang === "ko" ? "#c9ccd1" : C.dim,
      };
      const width = (str, o) =>
        layout(str, font(o.weight ?? 800, o.size, o.family), o.tracking ?? 0)
          .width;
      let cx = x;
      const stats = COURSE_STATS.map(([n, [e, k]]) => {
        const lines =
          lang === "ko"
            ? [[k, ko]]
            : lang === "en"
              ? [[e, en]]
              : [
                  [e, en],
                  [k, ko],
                ];
        const w = Math.max(
          width(String(n), num),
          ...lines.map(([s, o]) => width(s, o)),
        );
        const col = { x: cx, n: String(n), lines };
        cx += w + 56;
        return col;
      });
      const right = Math.max(x + width("STAGE 01", title), cx - 56) + 44;
      return {
        x,
        title,
        sub,
        num,
        stats,
        // title, LONG COURSE, the rule, the numbers and their names
        y: [y0 + 110, y0 + 154, y0 + 184, y0 + 272, y0 + 310, y0 + 340],
        rect: [x0, y0, right, y0 + (lang === "both" ? 374 : 348)],
      };
    }

    // how far the course card's panel is up at lt (inside the walk): it
    // stays until its copy has gone, and is down as the walk ends, where the
    // slide-cycle panel fades in at the same corner
    const cardPanel = (lt) =>
      ease.out3(seg(lt, 0, 0.3)) *
      (1 - ease.inOut3(seg(lt, FLY.dur - 0.3, FLY.dur - 0.02)));

    function courseCard(lt) {
      const L = cardLayout();
      const [x0, y0, x1] = L.rect;
      const up = cardPanel(lt);
      if (up <= 0) return;
      // the panel opens down to the stats as they come in
      const y1 = lerp(L.y[1] + 34, L.rect[3], ease.inOut3(seg(lt, 0.14, 0.38)));
      // the copy leaves from the last stat back to the title, the panel last
      const out = FLY.dur - 0.54;
      ctx.save();
      ctx.globalAlpha *= up;
      ctx.translate(0, (1 - up) * 18);
      ctx.fillStyle = "rgba(10,12,15,0.9)";
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x0, y0, x1 - x0, y1 - y0, 6);
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.clip();
      // a soft light sweeps across the panel once the copy has landed
      const sw = seg(lt, 1.0, 2.6);
      if (sw > 0 && sw < 1) {
        const sx = lerp(x0 - 300, x1 + 300, ease.inOut3(sw));
        const g = ctx.createLinearGradient(sx - 160, 0, sx + 160, 0);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, "rgba(255,255,255,0.07)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      // the walk's progress along the panel's foot
      ctx.fillStyle = rgba(C.red, 0.85);
      ctx.fillRect(x0, y1 - 3, (x1 - x0) * seg(lt, 0.3, FLY.dur - 0.3), 3);
      ctx.restore();
      // the red edge, as on the captions
      const bar = ease.outExpo(seg(lt, 0.04, 0.4));
      ctx.fillStyle = C.red;
      ctx.fillRect(x0, y0 + 30, 4, (L.y[1] - y0 - 22) * bar);
      ctx.restore();

      const leave = (k) => out + 0.06 * k; // k counts back from the last stat
      landLine(
        "STAGE 01",
        L.x - 4,
        L.y[0],
        L.title,
        lt,
        0.06,
        0.26,
        leave(4),
        0.2,
      );
      landLine(L.sub.str, L.x, L.y[1], L.sub.o, lt, 0.12, 0.22, leave(4), 0.2);
      ctx.save();
      ctx.globalAlpha *=
        ease.out3(seg(lt, 0.22, 0.52)) *
        (1 - seg(lt, leave(3), leave(3) + 0.2));
      line(
        L.x,
        L.y[2],
        lerp(L.x, x1 - 40, ease.inOut3(seg(lt, 0.22, 0.6))),
        L.y[2],
        "rgba(255,255,255,0.18)",
        1,
      );
      ctx.restore();
      L.stats.forEach(({ x, n, lines }, k) => {
        const at = 0.3 + k * 0.07; // with a tick each (CUES)
        const exit = leave(L.stats.length - 1 - k);
        landLine(n, x - 2, L.y[3], L.num, lt, at, 0.22, exit, 0.2);
        lines.forEach(([str, o], j) =>
          landLine(
            str,
            x,
            L.y[4 + j],
            o,
            lt,
            at + 0.04 * (j + 1),
            0.2,
            exit,
            0.2,
          ),
        );
      });
    }

    function drawStageTarget(cam, key, st) {
      const tg = TARGETS[key];
      const { n, right } = targetFrame(key);
      const hitsOf = (k) =>
        SHOTS.filter((s) => s.target === k && st >= s.st + IMPACT);
      const flashOf = (k, sub) =>
        SHOTS.filter(
          (s) => s.target === k && (sub === undefined || s.hit === sub),
        ).reduce(
          (a, s) =>
            st < s.st + IMPACT
              ? a
              : Math.max(a, 1 - (st - s.st - IMPACT) / 0.12),
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
          true, // the C line is open: it starts and ends on the top edge
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
      // Two wooden laths, 34 cm apart, that the target is stapled to. They
      // run up behind the cardboard to just under its top edge, so the target
      // reads as carried by its stand rather than floating above it.
      const LATH = "rgba(150,120,80,0.9)";
      const stand = (x0, x1) =>
        [x0, x1].forEach((u) =>
          seg3(
            cam,
            add([tg.pos[0], 0, tg.pos[2]], mul(right, u)),
            add([tg.pos[0], 1.5, tg.pos[2]], mul(right, u)),
            LATH,
            2,
          ),
        );
      // the same pair on a moving target, behind its paper (centre, local axes)
      const laths = (centre, r2, up2) =>
        [-0.17, 0.17].forEach((u) =>
          seg3(
            cam,
            add(add(centre, mul(r2, u)), mul(up2, -0.3)),
            add(add(centre, mul(r2, u)), mul(up2, 0.26)),
            LATH,
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
        const { r2, up2 } = p;
        seg3(
          cam,
          p.pivot,
          add(p.centre, mul(up2, 0.29)),
          "rgba(200,205,212,0.9)",
          3,
        );
        laths(p.centre, r2, up2);
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
        if (Math.abs(Math.cos(psi)) > 0.04) {
          laths([tg.pos[0], 1.24, tg.pos[2]], r2, UP);
          paper([tg.pos[0], 1.24, tg.pos[2]], r2, UP, false, flashOf(key));
        } else
          seg3(
            cam,
            [tg.pos[0], 0.95, tg.pos[2]],
            [tg.pos[0], 1.53, tg.pos[2]],
            C.cardEdge,
            3,
          );
        hitsOf(key).forEach((s) => Math.abs(Math.cos(psi)) > 0.2 && hole(s));
        label3(cam, [tg.pos[0], 2.3, tg.pos[2]], "DROP TURNER"); // above its hit pops
      } else if (tg.kind === "plates") {
        // a common base: post, crossbar, two round plates on hinges
        const base = [tg.pos[0], 0, tg.pos[2]];
        const a = add([tg.pos[0], 0.95, tg.pos[2]], mul(right, -0.4));
        const b = add([tg.pos[0], 0.95, tg.pos[2]], mul(right, 0.4));
        seg3(
          cam,
          base,
          [tg.pos[0], 0.95, tg.pos[2]],
          "rgba(170,175,185,0.9)",
          4,
        );
        seg3(cam, a, b, "rgba(170,175,185,0.9)", 4);
        for (let k = 0; k < 2; k++) {
          const s = SHOTS.find((x) => x.target === key && x.hit === k);
          const fall = s
            ? ease.in3(seg(st, s.st + IMPACT, s.st + 0.28)) * 1.5
            : 0;
          const hinge = add(platePos(k), [0, -0.15, 0]);
          const up2 = add(mul(UP, Math.cos(fall)), mul(back, Math.sin(fall)));
          steel(
            disc(add(hinge, mul(up2, 0.1)), right, up2, 0.1),
            flashOf(key, k),
          );
        }
        label3(cam, [tg.pos[0], 1.5, tg.pos[2]], "PLATES");
      } else if (tg.kind === "mover") {
        // the rail, the target on its carriage, then the barricades in front
        const at = (u, y, fwd = 0) =>
          add(add([tg.pos[0], y, tg.pos[2]], mul(right, u)), mul(n, fwd));
        seg3(
          cam,
          at(-MOVER.half - 0.4, 0.12),
          at(MOVER.half + 0.4, 0.12),
          "rgba(170,175,185,0.9)",
          3,
        );
        const u = moverOffset(st);
        seg3(cam, at(u, 0.12), at(u, 0.95), "rgba(150,155,165,0.9)", 3);
        const c = moverCentre(st);
        laths(c, right, UP);
        paper(c, right, UP, false, flashOf(key));
        hitsOf(key).forEach(hole);
        [-1, 1].forEach((sd) => {
          const u0 = sd * MOVER.gap;
          const u1 = sd * (MOVER.half + 0.45);
          poly3(
            cam,
            [
              at(u0, 0, 0.45),
              at(u1, 0, 0.45),
              at(u1, 2.0, 0.45),
              at(u0, 2.0, 0.45),
            ],
            "#2c323c",
            "rgba(255,255,255,0.45)",
          );
        });
        label3(cam, at(0, 2.3, 0.45), "MOVER");
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

    // ---------------------------------------------- the shooter, rigged in 3D
    // A 1.75 m right-handed shooter. shooterRig(st) poses the skeleton in world
    // space (metres) at stage time st; drawShooter() dresses and draws it.
    // Pairs are [left (support side), right (strong side)].
    const BODY = {
      thigh: 0.43,
      shin: 0.42,
      upper: 0.3, // shoulder to elbow
      fore: 0.27, // elbow to wrist
      hip: 0.095, // hip joints either side of the pelvis centre
      shoulder: 0.19,
    };
    const STRIDE = 2.1; // metres per running cycle (two steps)...
    const CADENCE = 2.6; // ...and at most this many cycles a second
    const GROUND = 0.36; // share of the cycle a foot is on the ground
    const yawDir = (a) => [Math.sin(a), 0, Math.cos(a)];
    const yawOf = (v) => Math.atan2(v[0], v[2]);
    const lerpYaw = (a, b, p) =>
      a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * p;
    const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    // o + F·f + R·r, raised by y
    const offs = (o, F, R, f, r, y = 0) =>
      add(add(add(o, mul(F, f)), mul(R, r)), [0, y, 0]);
    // v turned by angle a about the unit axis k
    function rotAbout(v, k, a) {
      const c = Math.cos(a);
      return add(
        add(mul(v, c), mul(cross(k, v), Math.sin(a))),
        mul(k, dot(k, v) * (1 - c)),
      );
    }
    // Two-bone IK: [middle joint, end] of a limb from a reaching for c, with
    // bones l1 and l2, bending towards pole. Near full extension the reach
    // eases off (soft IK, so the knee never snaps straight) and c is pulled in.
    function ik2(a, c, l1, l2, pole, softAt = 0.94) {
      const d = sub(c, a);
      let len = Math.hypot(d[0], d[1], d[2]);
      const max = (l1 + l2) * 0.999;
      const soft = softAt * max;
      if (len > soft) {
        const L =
          soft + (max - soft) * (1 - Math.exp(-(len - soft) / (max - soft)));
        c = add(a, mul(d, L / len));
        len = L;
      }
      len = Math.max(len, Math.abs(l1 - l2) + 0.01);
      const n = norm(d);
      const p = norm(sub(pole, mul(n, dot(pole, n))));
      const x = (l1 * l1 - l2 * l2 + len * len) / (2 * len);
      const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
      return [add(add(a, mul(n, x)), mul(p, h)), c];
    }
    // The ankles of the shooting stance at stage time t: [support, strong].
    function standFeet(t) {
      const p = shooterPos(t);
      const F = yawDir(yawOf(sub(focusAt(t), p)));
      const R = cross(UP, F);
      return [
        offs(p, F, R, 0.06, -0.19, 0.08),
        offs(p, F, R, -0.07, 0.2, 0.08),
      ];
    }
    // The run near stage time st: the stride phase (cycles; the support
    // foot's, the strong foot is half a cycle on) and heading, sampled from
    // shooterPos so they follow any speed profile. A run starts with the
    // forward foot planted, at the phase that matches where it stands, and
    // the other foot lifting. The feet stay planted up to a sprinter's
    // cadence and skate beyond it.
    let runTable = null;
    function runAt(st) {
      runTable ??= EVENTS.moves.map(([a, b, from, to]) => {
        const pos = [];
        for (let k = 0; k <= 64; k++) pos.push(shooterPos(lerp(a, b, k / 64)));
        const c = CTRL[from + to];
        const hd = [yawOf(sub(c, AREAS[from].pos))];
        const reach = (GROUND * STRIDE) / 2;
        const d = standFeet(a).map((p) => dot(sub(p, pos[0]), yawDir(hd[0])));
        const j = d[0] >= d[1] ? 0 : 1;
        const fj = GROUND * clamp((reach - d[j]) / (2 * reach), 0.08, 0.92);
        const ph = [(fj - 0.5 * j + 1) % 1];
        for (let k = 1; k <= 64; k++) {
          const dp = sub(pos[k], pos[k - 1]);
          const dd = Math.hypot(dp[0], dp[2]);
          ph.push(ph[k - 1] + Math.min(dd / STRIDE, (CADENCE * (b - a)) / 64));
          const v =
            k < 64 ? sub(pos[k + 1], pos[k - 1]) : sub(AREAS[to].pos, c);
          hd.push(Math.hypot(v[0], v[2]) > 1e-6 ? yawOf(v) : hd[k - 1]);
        }
        // the stage time at which the phase reaches f (within the run)
        const timeAt = (f) => {
          let i = 0;
          while (i < 63 && ph[i + 1] < f) i++;
          const x = clamp((f - ph[i]) / Math.max(1e-9, ph[i + 1] - ph[i]));
          return lerp(a, b, (i + x) / 64);
        };
        const headingAt = (t) => {
          const x = seg(t, a, b) * 64;
          const i = Math.min(63, Math.floor(x));
          return lerpYaw(hd[i], hd[i + 1], x - i);
        };
        return { a, b, to, start: ph[0], end: ph[64], timeAt, headingAt, ph };
      });
      const k = EVENTS.moves.findIndex(
        ([a, b]) => st > a - 0.6 && st < b + 0.6,
      );
      if (k < 0) return null;
      const r = runTable[k];
      const x = seg(st, r.a, r.b) * 64;
      const i = Math.min(63, Math.floor(x));
      return {
        ...r,
        phase: lerp(r.ph[i], r.ph[i + 1], x - i),
        heading: r.headingAt(st),
      };
    }
    // Recoil of the latest shot: 0 → 1 in 30 ms, recovered by 150 ms.
    function kickAt(st) {
      let k = 0;
      for (const s of SHOTS) {
        const dt = st - s.st;
        if (dt < 0 || dt > 0.15) continue;
        k = Math.max(
          k,
          dt < 0.03
            ? ease.out3(dt / 0.03)
            : 1 - ease.inOut3(seg(dt, 0.03, 0.15)),
        );
      }
      return k;
    }
    // A convex solid lofted between two rings of points, with outward normals.
    function loft(a, b) {
      const v = [...a, ...b];
      const n = a.length;
      const c = mul(v.reduce(add), 1 / v.length);
      const faces = [
        a.map((_, i) => i),
        b.map((_, i) => n + i),
        ...a.map((_, i) => [i, (i + 1) % n, n + ((i + 1) % n), n + i]),
      ].map((idx) => {
        const fc = mul(idx.map((k) => v[k]).reduce(add), 1 / idx.length);
        let fn = norm(
          cross(sub(v[idx[1]], v[idx[0]]), sub(v[idx[2]], v[idx[0]])),
        );
        if (dot(fn, sub(fc, c)) < 0) fn = mul(fn, -1);
        return { idx, n: fn };
      });
      return { v, faces };
    }
    const rectRing = (x, y0, y1, z) => [
      [x, y0, -z],
      [x, y0, z],
      [x, y1, z],
      [x, y1, -z],
    ];
    const block = (x0, x1, y0, y1, z) =>
      loft(rectRing(x0, y0, y1, z), rectRing(x1, y0, y1, z));
    // The pistol in millimetres around the strong hand's grasp (GUN at 32, 88):
    // x forward along the bore, y up, z to the shooter's right.
    const slideRing = (x) => [
      [x, 64.5, -14],
      [x, 64.5, 14],
      [x, 80, 14],
      [x, 85, 10],
      [x, 85, -10],
      [x, 80, -14],
    ];
    const PISTOL = {
      muzzle: [185, 68.7, 0],
      rear: [-1, 89, 0], // top of the rear sight
      magwell: [-6, -52, 0],
      parts: {
        grip: loft(
          [
            [-12, 40, -15],
            [32, 40, -15],
            [32, 40, 15],
            [-12, 40, 15],
          ],
          [
            [-27, -52, -15],
            [12, -52, -15],
            [12, -52, 15],
            [-27, -52, 15],
          ],
        ),
        frame: block(-32, 92, 38, 64.5, 13),
        dust: block(92, 182, 44, 64.5, 12),
        pad: block(-25, 27, -68, -52, 16),
        slide: loft(slideRing(-13), slideRing(185)),
        rear: block(-10, 4, 84, 90, 10),
        front: block(166, 177, 84, 89, 2.5),
        barrel: block(150, 185, 60, 77, 7.5),
      },
      guard: [
        [90, 33],
        [91, 12],
        [72, 8],
        [56, 11],
        [50, 22],
        [54, 33],
        [62, 38],
      ],
      // the two hands: knuckle hulls, wrists, thumbs and the trigger finger
      hand: [
        [
          [2, 32, -20],
          [-18, 22, -32],
          [42, 16, -4],
          [40, -38, 0],
          [12, -48, -16],
          [-20, -40, -30],
          [10, -6, -42],
          [-14, 6, -40],
        ],
        [
          [-30, 42, 6],
          [-24, 38, 24],
          [30, 32, 6],
          [34, 26, -10],
          [24, -40, -6],
          [18, -44, 12],
          [-28, -34, 14],
          [-10, -8, 27],
        ],
      ],
      wrist: [
        [-44, -30, -46],
        [-68, 14, 14],
      ],
      thumb: [
        [
          [-4, 36, -20],
          [54, 46, -16],
        ],
        [
          [-18, 46, 2],
          [32, 52, -12],
        ],
      ],
      index: [
        [24, 36, 15], // knuckle
        [92, 47, 14], // straight along the frame
        [64, 26, 5], // on the trigger
      ],
      // the gaps between the fingers wrapped round the front of the grip
      fingers: [
        [2, -15, -31].map((y) => [
          [8, y, -40],
          [40, y - 3, -8],
        ]),
        [12, -6, -24].map((y) => [
          [6, y, 24],
          [32, y - 3, 8],
        ]),
      ],
    };
    // A magazine: base pad at the origin, up along y, front along x.
    const MAG3 = {
      pad: block(-20, 18, 0, 16, 14),
      body: (top) => block(-16, 16, 16, Math.max(17, top), 11),
    };
    // A local frame (millimetres) at o with axes f, u, s, and its directions.
    const frameAt =
      (o, f, u, s, dx = 0) =>
      (p) => [
        o[0] + (f[0] * (p[0] + dx) + u[0] * p[1] + s[0] * p[2]) / 1000,
        o[1] + (f[1] * (p[0] + dx) + u[1] * p[1] + s[1] * p[2]) / 1000,
        o[2] + (f[2] * (p[0] + dx) + u[2] * p[1] + s[2] * p[2]) / 1000,
      ];
    const dirAt = (f, u, s) => (n) =>
      add(add(mul(f, n[0]), mul(u, n[1])), mul(s, n[2]));

    // The shooter's pose at stage time st, in world space (metres; y up,
    // downrange +z). Pairs are [left (support side), right (strong side)].
    //   pos            ground point, shooterPos(st)
    //   facing         horizontal unit vector the chest faces
    //   feet, heels, toes, knees, hips    ankle joints, shoe ends, joints
    //   pelvis, chest, neck, head         spine points (head: skull centre)
    //   eye            the dominant (right) eye, on the sight line when aiming:
    //                  the first-person camera
    //   eyes           both eyes
    //   shoulders, elbows, wrists, hands  arm joints (hands: centre of each hand)
    //   grip           the strong hand's grasp on the pistol
    //   muzzle         the muzzle crown: where a tracer starts
    //   forward, up, side   the pistol's unit axes (bore, top of the slide, right)
    //   slide          slide travel in mm (cycling, or locked back to reload)
    //   mag            whether a magazine is seated
    //   weights        { aim, move, ready, reload, kneel, recoil }, each 0–1
    //                  (ready: the compressed ready, on the run and dropping
    //                  to the knee)
    // The rest (axes, handPts, fingers, thumbs, index, pouch, pouches, hold)
    // is for drawShooter().
    function shooterRig(st) {
      const sp = shooterPos(st);
      const m = moveAt(st);
      const move = m ? ease.inOut3(env(st, m[0], m[1], 0.15, 0.15)) : 0;
      const run = runAt(st);
      const [rl0, rOut, rIn, rFwd] = EVENTS.reload;
      const reload = ease.inOut3(
        Math.min(
          seg(st, rl0 + 0.02, rl0 + 0.16),
          1 - seg(st, rFwd, rFwd + 0.3),
        ),
      );
      const kn = EVENTS.kneel;
      const kneel = kn ? ease.inOut3(seg(st, kn[0], kn[1])) : 0;
      // the pistol stays in the compressed ready on the run and on the way
      // down to the knee, and presses out as the knee lands
      const ready = Math.max(
        move,
        kn
          ? ease.inOut3(
              Math.min(
                seg(st, kn[0] - 0.35, kn[0] - 0.15),
                1 - seg(st, kn[1] - 0.1, kn[1] + 0.04),
              ),
            )
          : 0,
      );
      const aim = (1 - ready) * (1 - reload);
      const kick = kickAt(st);
      const wp = workPoint(st);

      // Facing: the feet set up on the array, the hips and chest turn to the
      // work; on the run the hips follow the path and the chest turns downrange.
      const feetYaw = yawOf(sub(focusAt(st), sp));
      const aimYaw = yawOf(sub(wp, sp));
      const heading = run ? run.heading : feetYaw;
      const phase = run ? run.phase : 0;
      const sway = Math.sin(phase * 2 * Math.PI) * move;
      const lookYaw = run ? yawOf(sub(FOCUS[run.to], sp)) : aimYaw;
      const hipYaw = lerpYaw(
        lerpYaw(feetYaw, aimYaw, lerp(0.45, 0.2, kneel)),
        lerpYaw(heading, 0, 0.25) + 0.12 * sway,
        move,
      );
      const chestYaw = lerpYaw(
        aimYaw,
        lerpYaw(heading, 0, 0.55) - 0.05 * sway,
        move,
      );
      const headYaw = lerpYaw(aimYaw, lerpYaw(heading, lookYaw, 0.6), move);

      // Legs: an athletic stance, a running gait, or down on one knee.
      const FF = yawDir(feetYaw);
      const FR = cross(UP, FF);
      let ankles = standFeet(st);
      let toes = [yawDir(feetYaw - 0.22), yawDir(feetYaw + 0.32)];
      let pitch = [0, 0];
      let poles = [toes[0], toes[1]];
      let pelvis = offs(sp, FF, FR, -0.07, 0, 0.885);
      if (run) {
        const HF = yawDir(heading);
        const HR = cross(UP, HF);
        const sig = GROUND;
        const reach = (sig * STRIDE) / 2;
        // a foot at its own phase ph, about ground point o heading along F
        const gait = (ph, side, o = sp, F = HF) => {
          let x;
          let y;
          let pt;
          if (ph < sig) {
            const u = ph / sig;
            x = lerp(reach, -reach, u);
            // heel strike, the foot flat, then the heel peels off the ground
            pt = 0.8 * seg(u, 0.45, 1) ** 2 - 0.25 * (1 - seg(u, 0, 0.15));
            y = 0.14 * Math.max(0, Math.sin(pt));
          } else {
            const u = (ph - sig) / (1 - sig);
            x = lerp(-reach, reach, ease.inOut3(u));
            pt = 0.8 * (1 - u) ** 2 - 0.25 * seg(u, 0.7, 1);
            y =
              0.4 * Math.sin(Math.PI * (1 - (1 - u) ** 1.6)) +
              0.14 * Math.max(0, Math.sin(pt));
          }
          return [offs(o, F, cross(UP, F), x, side * 0.09, 0.08 + y), pt];
        };
        const g = [gait(phase % 1, -1), gait((phase + 0.5) % 1, 1)];
        // foot i in the gait when the run's phase is q, in world space
        const gaitAt = (q, i) => {
          const t = run.timeAt(q);
          const F = yawDir(run.headingAt(t));
          return gait((q + 0.5 * i) % 1, i ? 1 : -1, shooterPos(t), F)[0];
        };
        // Each foot joins the gait with a real first step: the planted one
        // stays put until it lifts, the other lifts at once; each swings,
        // carried along with the body, onto the gait. As the run ends, a
        // foot in the air lands on the new stance and a planted one then
        // steps across to it.
        const S = [standFeet(run.a), standFeet(run.b)];
        // a swing from P (lifting at time tP) to Q (landing at time tQ)
        const step = (P, tP, Q, tQ, v, h = 0.3) => {
          const from = sub(P, shooterPos(tP));
          const to = sub(Q, shooterPos(tQ));
          const lift = h * Math.sin(Math.PI * (1 - (1 - v) ** 1.6));
          return add(add(sp, lerp3(from, to, ease.inOut3(v))), [0, lift, 0]);
        };
        const feet = [0, 1].map((i) => {
          const s = run.start + 0.5 * i; // the foot's phase as the run starts
          const e = run.end + 0.5 * i; // ...and as it ends
          const tOf = (q) => run.timeAt(q - 0.5 * i);
          const L = Math.floor(s) + Math.max(s % 1, sig); // first lift-off
          const N = Math.floor(s) + 1; // first landing
          const down = e % 1 < sig; // planted as the run ends
          const L2 = Math.max(Math.floor(e) + sig, L); // last lift-off
          const land = Math.max(run.b + 0.04 + 0.08 * i, tOf(L2) + 0.16);
          return { L, N, down, L2, land, tOf };
        });
        const w = feet.map(({ L, N, down, L2, land, tOf }, i) => {
          const f = phase + 0.5 * i; // the foot's own phase
          if (down) {
            // steps across once the other foot has landed
            const t0 = Math.max(run.b, feet[1 - i].land - 0.04);
            if (st > t0) {
              const P = f < L ? S[0][i] : gaitAt(run.end, i);
              const v = seg(st, t0, t0 + 0.2);
              ankles[i] = step(P, run.b, S[1][i], run.b, v, 0.12);
              return 1 - ease.inOut3(v);
            }
          } else if (f >= L2) {
            // the last swing lands on the new stance
            const P = L2 > L ? gaitAt(L2 - 0.5 * i, i) : S[0][i];
            const v = seg(st, tOf(L2), land);
            ankles[i] = step(P, tOf(L2), S[1][i], land, v);
            return L2 > L ? 1 - ease.inOut3(v) : Math.sin(Math.PI * v);
          }
          if (f < L) {
            ankles[i] = S[0][i];
            return 0;
          }
          if (f < N) {
            const v = (f - L) / (N - L);
            ankles[i] = step(
              S[0][i],
              tOf(L),
              gaitAt(N - 0.5 * i, i),
              tOf(N),
              v,
            );
            return ease.inOut3(v);
          }
          ankles[i] = g[i][0];
          return 1;
        });
        const bob = -0.025 * Math.cos(4 * Math.PI * (phase - sig / 2));
        toes = toes.map((t, i) => norm(lerp3(t, HF, w[i])));
        pitch = pitch.map((p, i) => lerp(p, g[i][1], w[i]));
        poles = poles.map((p, i) =>
          norm(lerp3(p, add(HF, [0, -0.1, 0]), w[i])),
        );
        pelvis = lerp3(pelvis, offs(sp, HF, HR, 0, 0, 0.87 + bob), move);
      }
      if (kneel > 0) {
        // strong knee down, sitting back on the strong heel (toes tucked),
        // support foot forward: low enough to shoot through a low port
        const kPel = offs(sp, FF, FR, -0.16, 0.02, 0.32);
        const kHip = add(kPel, mul(cross(UP, yawDir(hipYaw)), BODY.hip));
        // the knee on the ground a thigh's length from the hip, the shin
        // back along the ground to the raised heel
        const drop = kHip[1] - 0.07;
        const knee = add(
          add(
            kHip,
            mul(
              norm(add(FF, mul(FR, 0.15))),
              Math.sqrt(BODY.thigh ** 2 - drop * drop),
            ),
          ),
          [0, -drop, 0],
        );
        const kAnk = [
          offs(sp, FF, FR, 0.4, -0.21, 0.08),
          add(
            sub(knee, mul(FF, Math.sqrt(BODY.shin ** 2 - 0.01))),
            [0, 0.1, 0],
          ),
        ];
        const mid = lerp3(kHip, kAnk[1], 0.5);
        const kPole = [norm(add(FF, [0, 0.5, 0])), norm(sub(knee, mid))];
        ankles = ankles.map((a, i) => lerp3(a, kAnk[i], kneel));
        // the support foot steps forward rather than sliding
        ankles[0][1] += 0.12 * Math.sin(Math.PI * kneel);
        toes = [
          norm(lerp3(toes[0], yawDir(feetYaw - 0.12), kneel)),
          norm(lerp3(toes[1], FF, kneel)),
        ];
        pitch = [lerp(pitch[0], 0, kneel), lerp(pitch[1], 1.25, kneel)];
        poles = poles.map((p, i) => norm(lerp3(p, kPole[i], kneel)));
        pelvis = lerp3(pelvis, kPel, kneel);
      }
      const PF = yawDir(hipYaw);
      const PR = cross(UP, PF);
      const hips = [-1, 1].map((s) => add(pelvis, mul(PR, s * BODY.hip)));
      const knees = [];
      const heels = [];
      const toeTips = [];
      [0, 1].forEach((i) => {
        const [knee, ankle] = ik2(
          hips[i],
          ankles[i],
          BODY.thigh,
          BODY.shin,
          poles[i],
        );
        knees.push(knee);
        ankles[i] = ankle;
        const fr = cross(UP, toes[i]);
        const d = rotAbout(toes[i], fr, pitch[i]);
        const n = rotAbout(UP, fr, pitch[i]);
        heels.push(sub(sub(ankle, mul(d, 0.05)), mul(n, 0.045)));
        toeTips.push(add(sub(ankle, mul(n, 0.05)), mul(d, 0.16)));
      });

      // Torso: hips back, leaning into the gun (or into the run).
      const lean = lerp(lerp(0.2, 0.33, move), 0.36, kneel);
      const spine = rotAbout(UP, PR, lean);
      const cf0 = yawDir(chestYaw);
      const CF = norm(sub(cf0, mul(spine, dot(cf0, spine))));
      const CR = cross(spine, CF);
      const chest = add(pelvis, mul(spine, 0.36));
      const neck = add(pelvis, mul(spine, 0.53));
      // on the gun the shoulders roll forward, the support shoulder in more
      // so both arms reach out evenly (a true isosceles)
      const shoulders = [-1, 1].map((s) =>
        add(
          add(add(neck, mul(spine, -0.04)), mul(CR, s * BODY.shoulder)),
          mul(CF, 0.01 + 0.07 * aim),
        ),
      );
      shoulders[0] = add(
        shoulders[0],
        add(mul(CF, 0.02 * aim), mul(CR, 0.02 * aim)),
      );
      // Head: upright over the gun, eyes on the work.
      const neckDir = norm(add(spine, UP));
      const hc = add(neck, mul(neckDir, 0.135));
      const toWork = sub(wp, hc);
      const lookY = lerp(
        -0.14,
        (0.8 * toWork[1]) / Math.max(1, Math.hypot(toWork[0], toWork[2])),
        aim,
      );
      const hf = norm(add(yawDir(headYaw), [0, lookY, 0]));
      const hu = norm(sub(UP, mul(hf, hf[1])));
      const hr = cross(hu, hf);
      const head = add(hc, mul(hf, 0.035));
      const eyes = [-1, 1].map((s) =>
        add(add(add(head, mul(hf, 0.082)), mul(hu, 0.012)), mul(hr, s * 0.032)),
      );
      const eye = eyes[1]; // the dominant eye, behind the sights

      // The pistol: on the eye–target line when aiming, compressed at the
      // chest on the move (muzzle downrange and down), in the workspace for
      // the reload, canted so the magwell faces the support hand.
      const gv = (f, u, p) =>
        add(
          add(mul(f, p[0] / 1000), mul(u, p[1] / 1000)),
          mul(cross(u, f), p[2] / 1000),
        );
      let af = norm(sub(wp, eye));
      let au = norm(sub(UP, mul(af, af[1])));
      let aG = sub(add(eye, mul(af, 0.6)), gv(af, au, PISTOL.rear));
      const over =
        Math.max(
          ...[0, 1].map((i) =>
            dist3(shoulders[i], add(aG, gv(af, au, PISTOL.wrist[i]))),
          ),
        ) -
        0.985 * (BODY.upper + BODY.fore);
      if (over > 0) aG = sub(aG, mul(af, over));
      // after the last shot the arms lower the pistol to a low ready
      const last = SHOTS[SHOTS.length - 1].st;
      const done = ease.inOut3(seg(st, last + 0.3, last + 0.7));
      if (done > 0) {
        const k = norm(cross(UP, af));
        const pv = lerp3(shoulders[0], shoulders[1], 0.5);
        aG = add(pv, rotAbout(sub(aG, pv), k, 0.55 * done));
        af = rotAbout(af, k, 0.55 * done);
        au = rotAbout(au, k, 0.55 * done);
      }
      const rf = norm([0, -0.42, 1]);
      const ru = norm(sub(UP, mul(rf, rf[1])));
      const rG = add(
        add(add(chest, mul(CF, 0.21)), mul(CR, -0.03)),
        mul(spine, 0.02),
      );
      const lf = norm([0, -0.1, 1]);
      const lu = rotAbout(norm(sub(UP, mul(lf, lf[1]))), lf, 0.5);
      const lG = add(
        add(add(chest, mul(CF, 0.27)), mul(CR, -0.02)),
        mul(spine, 0.1),
      );
      let G = lerp3(lerp3(aG, rG, ready), lG, reload);
      let gf = norm(lerp3(lerp3(af, rf, ready), lf, reload));
      let gu = lerp3(lerp3(au, ru, ready), lu, reload);
      gu = norm(sub(gu, mul(gf, dot(gu, gf))));
      if (kick > 0) {
        // muzzle flip of about 8°, the hands rising with it
        const s0 = cross(gu, gf);
        gf = rotAbout(gf, s0, -0.14 * kick);
        gu = rotAbout(gu, s0, -0.14 * kick);
        G = add(G, add(mul(gu, 0.014 * kick), mul(gf, -0.012 * kick)));
      }
      const gs = cross(gu, gf);
      const gp = frameAt(G, gf, gu, gs);
      // slide travel (mm): cycling on each shot, locked back on the empty magazine
      let slide = 0;
      for (const s of SHOTS) if (st >= s.st) slide = recoil(st - s.st).slide;
      if (st >= rl0 + 0.03 && st < rFwd)
        slide = 30 + 4 * ease.inOut3(seg(st, rFwd - 0.16, rFwd - 0.03));
      else if (st >= rFwd && st < rFwd + 0.03)
        slide = 34 * (1 - (st - rFwd) / 0.03);

      // Hands: the strong hand never leaves the grip; for the reload the
      // support hand goes to the pouch, seats the magazine, works the slide.
      const hands = [0, 1].map((i) => PISTOL.hand[i].map(gp));
      const wristAt = [0, 1].map((i) => gp(PISTOL.wrist[i]));
      const belt = add(pelvis, [0, 0.075, 0]);
      const pouch = (k) => {
        const th = 0.5 + k * 0.32; // from the front round the support hip
        return {
          p: add(
            add(belt, mul(PF, Math.cos(th) * 0.12)),
            mul(PR, -Math.sin(th) * 0.17),
          ),
          n: norm(
            add(mul(PF, Math.cos(th) / 0.12), mul(PR, -Math.sin(th) / 0.17)),
          ),
        };
      };
      let off = 0;
      let hold = null;
      if (st > rOut - 0.1 && st < rFwd + 0.3) {
        off = ease.inOut3(
          Math.min(
            seg(st, rOut - 0.08, rOut + 0.04),
            1 - seg(st, rFwd + 0.04, rFwd + 0.24),
          ),
        );
        const pz = pouch(0);
        const top = add(add(pz.p, mul(pz.n, 0.016)), [0, 0.02, 0]);
        const mw = gp(PISTOL.magwell);
        const ma = norm(add(mul(gf, 0.15), mul(gu, 0.99)));
        const onGun = [gp([10, -8, -32]), norm(sub(gf, gu)), mul(gs, -1)];
        const K = [
          [rOut + 0.04, ...onGun],
          [rOut + 0.24, add(top, [0, 0.035, 0]), [0, -1, 0], pz.n],
          [
            rOut + 0.34,
            add(add(top, [0, 0.15, 0]), mul(pz.n, 0.05)),
            norm(add([0, -1, 0], mul(PF, 0.7))),
            mul(gs, -1),
          ],
          [rIn - 0.1, sub(mw, mul(ma, 0.17)), ma, mul(gs, -1)],
          [rIn, sub(mw, mul(ma, 0.034)), ma, mul(gs, -1)],
          [rIn + 0.22, gp([6, 112, -4]), gs, gu],
          [rFwd - 0.03, gp([-30, 112, -4]), gs, gu],
          [rFwd + 0.2, ...onGun],
        ];
        let k = 0;
        while (k < K.length - 2 && st > K[k + 1][0]) k++;
        const u = ease.inOut3(seg(st, K[k][0], K[k + 1][0]));
        const c = lerp3(K[k][1], K[k + 1][1], u);
        const a = norm(lerp3(K[k][2], K[k + 1][2], u));
        let b = lerp3(K[k][3], K[k + 1][3], u);
        b = norm(sub(b, mul(a, dot(a, b))));
        const w = cross(a, b);
        const fist = [];
        for (const x of [-0.04, 0.042])
          for (const y of [-0.02, 0.02])
            for (const z of [-0.04, 0.04])
              fist.push(
                add(
                  add(
                    add(c, mul(a, x * (x > 0 && y < 0 ? 0.7 : 1))),
                    mul(b, y),
                  ),
                  mul(w, z),
                ),
              );
        hands[0] = hands[0].map((p, i) => lerp3(p, fist[i], off));
        wristAt[0] = lerp3(wristAt[0], sub(c, mul(a, 0.065)), off);
        // the fresh magazine, from the grab until it is seated
        if (st > rOut + 0.27 && st < rIn) {
          const base = add(c, mul(a, 0.016));
          const front = norm(sub(gf, mul(a, dot(gf, a))));
          hold = {
            base,
            up: a,
            front,
            // the length showing below the magwell, in mm
            top: clamp(dot(sub(mw, base), a) * 1000, 0, 144),
          };
        }
      }
      // Arms: two-bone IK from the shoulders, elbows out on the gun and
      // tucked on the run.
      const tuck = Math.max(ready, reload);
      const poleArm = [-1, 1].map((s) =>
        norm(
          lerp3(
            add(mul(CR, s), [0, -0.8, 0]),
            add(add(mul(CR, 0.45 * s), [0, -1, 0]), mul(CF, -0.35)),
            tuck,
          ),
        ),
      );
      poleArm[0] = norm(
        lerp3(
          poleArm[0],
          add(add(mul(CR, -0.7), [0, -0.6, 0]), mul(CF, -0.6)),
          off,
        ),
      );
      const elbows = [];
      const wrists = [];
      [0, 1].forEach((i) => {
        const [elbow, wrist] = ik2(
          shoulders[i],
          wristAt[i],
          BODY.upper,
          BODY.fore,
          poleArm[i],
          0.99,
        );
        elbows.push(elbow);
        wrists.push(wrist);
      });
      // the finger goes to the trigger only on target, with a shot coming
      let live = 0;
      for (const s of SHOTS)
        live = Math.max(live, env(st, s.st - 0.24, s.st + 0.18, 0.06, 0.08));
      const trigger = clamp((aim - 0.9) / 0.1) * live;
      return {
        pos: sp,
        facing: yawDir(chestYaw),
        feet: ankles,
        heels,
        toes: toeTips,
        knees,
        hips,
        pelvis,
        chest,
        neck,
        head,
        eye,
        eyes,
        shoulders,
        elbows,
        wrists,
        hands: [0, 1].map((i) =>
          mul(hands[i].reduce(add), 1 / hands[i].length),
        ),
        grip: G,
        muzzle: gp(PISTOL.muzzle),
        forward: gf,
        up: gu,
        side: gs,
        slide,
        mag: st < rOut || st >= rIn,
        weights: { aim, move, ready, reload, kneel, recoil: kick },
        // for drawing
        axes: { PF, PR, CF, CR, spine, hf, hu, hr },
        handPts: hands,
        fingers: [
          off < 0.5 ? PISTOL.fingers[0].map((l) => l.map(gp)) : null,
          PISTOL.fingers[1].map((l) => l.map(gp)),
        ],
        thumbs: [
          off < 0.5 ? PISTOL.thumb[0].map(gp) : null,
          PISTOL.thumb[1].map(gp),
        ],
        index: [
          gp(PISTOL.index[0]),
          lerp3(gp(PISTOL.index[1]), gp(PISTOL.index[2]), trigger),
        ],
        pouch,
        pouches: st > rOut + 0.27 ? 2 : 3,
        hold,
      };
    }

    // -------------------------------------------------- drawing the figure
    const FIG = {
      cloth: [35, 40, 48], // #232830, the jersey
      lit: [52, 58, 68], // the jersey's shoulders, lit from above
      pants: [27, 31, 38],
      shoe: [64, 68, 76],
      far: [20, 23, 28],
      skin: [66, 61, 60],
      cap: [20, 23, 28],
      muff: [163, 22, 47],
      metal: [
        [14, 16, 19],
        [96, 103, 114],
      ],
      grip: [
        [12, 20, 40],
        [52, 92, 178],
      ],
      gear: [
        [17, 19, 23],
        [70, 76, 86],
      ],
      sight: [
        [120, 14, 34],
        [236, 34, 66],
      ],
    };
    const LIGHT = norm([-0.3, 0.85, -0.45]);
    // belt gear in millimetres: x along the belt, y up, z out from the body
    const POUCH = block(-17, 17, -100, 6, 14);
    const HOLSTER = block(-60, 45, -190, 12, 20);
    let dropRig = null; // the pose as the empty magazine drops
    const rgbOf = (c) => `rgb(${c.join(",")})`;
    const mixRGB = (a, b, t) =>
      `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(",")})`;
    // Adds a tapered capsule from a to b (radii in metres) to the current path.
    function capsule(cam, a, b, ra, rb) {
      const cl = clipSeg(cam, a, b);
      if (!cl) return;
      const A = project(cam, cl[0]);
      const B = project(cam, cl[1]);
      const r1 = (ra * cam.focal) / A[2];
      const r2 = (rb * cam.focal) / B[2];
      const d = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (d <= Math.abs(r1 - r2) + 0.5) {
        const [x, y, r] = r1 > r2 ? [A[0], A[1], r1] : [B[0], B[1], r2];
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
        return;
      }
      const th = Math.atan2(B[1] - A[1], B[0] - A[0]);
      const ph = Math.acos((r1 - r2) / d);
      ctx.moveTo(A[0] + r1 * Math.cos(th + ph), A[1] + r1 * Math.sin(th + ph));
      ctx.arc(A[0], A[1], r1, th + ph, th + 2 * Math.PI - ph);
      ctx.arc(B[0], B[1], r2, th - ph, th + ph);
      ctx.closePath();
    }
    // Adds the rounded convex hull of the projected points to the current
    // path, cut by the near plane (where an edge may cross it, a point goes in).
    function hullPath(cam, pts) {
      const z = pts.map((p) => dot(sub(p, cam.pos), cam.f));
      const keep = pts.filter((_, k) => z[k] >= 0.3);
      if (keep.length < pts.length)
        pts.forEach((a, i) => {
          if (z[i] < 0.3) return;
          pts.forEach((b, j) => {
            if (z[j] < 0.3)
              keep.push(add(a, mul(sub(b, a), (z[i] - 0.3) / (z[i] - z[j]))));
          });
        });
      if (keep.length < 3) return;
      const q = keep.map((p) => project(cam, p));
      q.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cr = (o, a, b) =>
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const h = [];
      for (const pass of [q, [...q].reverse()]) {
        const start = h.length;
        for (const p of pass) {
          while (
            h.length >= start + 2 &&
            cr(h[h.length - 2], h[h.length - 1], p) <= 0
          )
            h.pop();
          h.push(p);
        }
        h.pop();
      }
      const n = h.length;
      if (n < 3) return;
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const m0 = mid(h[n - 1], h[0]);
      ctx.moveTo(m0[0], m0[1]);
      for (let k = 0; k < n; k++) {
        const m1 = mid(h[k], h[(k + 1) % n]);
        ctx.quadraticCurveTo(h[k][0], h[k][1], m1[0], m1[1]);
      }
      ctx.closePath();
    }
    // Shapes drawn as one figure: a rim-lit outline, then the fill.
    function silhouette(build, fill, rimA, rimW) {
      ctx.beginPath();
      build();
      ctx.lineJoin = "round";
      ctx.strokeStyle = `rgba(244,245,247,${rimA})`;
      ctx.lineWidth = rimW * 2;
      ctx.stroke();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    // A plain fill, for a second tone inside a silhouette.
    function tone(build, fill) {
      ctx.beginPath();
      build();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    // Convex solids ({s, at, n, col}) as one rim-lit silhouette, then their
    // faces lit from above, far to near (or, when flat, one mid tone).
    function drawSolids(cam, items, rimA, rimW, flat = false) {
      const shown = [];
      for (const it of items) {
        const P = it.s.v.map(it.at);
        const Q = P.map((p) => project(cam, p));
        if (Q.some((q) => q[2] < 0.3)) continue;
        const faces = [];
        for (const f of it.s.faces) {
          const n = it.n(f.n);
          if (dot(n, sub(cam.pos, P[f.idx[0]])) <= 0) continue;
          faces.push({
            q: f.idx.map((k) => Q[k]),
            lum: clamp(0.18 + 0.82 * dot(n, LIGHT)),
          });
        }
        shown.push({
          it,
          faces,
          z: Q.reduce((s, q) => s + q[2], 0) / Q.length,
        });
      }
      const face = (q) => {
        let area = 0;
        q.forEach((a, k) => {
          const b = q[(k + 1) % q.length];
          area += a[0] * b[1] - b[0] * a[1];
        });
        const pts = area < 0 ? [...q].reverse() : q;
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
        ctx.closePath();
      };
      if (!shown.length) return;
      silhouette(
        () => shown.forEach((s) => s.faces.forEach((f) => face(f.q))),
        flat ? mixRGB(...shown[0].it.col, 0.35) : "#0e1013",
        rimA,
        rimW,
      );
      if (flat) return;
      shown
        .sort((a, b) => b.z - a.z)
        .forEach((s) =>
          s.faces.forEach((f) => {
            ctx.beginPath();
            face(f.q);
            ctx.fillStyle = mixRGB(s.it.col[0], s.it.col[1], f.lum);
            ctx.fill();
          }),
        );
    }
    // A ring of n points about c in the plane of F and R (half-sizes r, d).
    function ellipse3(c, F, R, r, d, n = 10) {
      const pts = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        pts.push(add(add(c, mul(R, Math.cos(a) * r)), mul(F, Math.sin(a) * d)));
      }
      return pts;
    }
    // Starts a path along the points; their nearest depth, or 0 (and no path)
    // when any of them is too close to the camera.
    function polyPath(cam, pts) {
      const q = pts.map((p) => project(cam, p));
      ctx.beginPath();
      if (q.some((v) => v[2] < 0.3)) return 0;
      q.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      return Math.min(...q.map((v) => v[2]));
    }
    // A polyline of the points whose outward normals face the camera.
    function frontLine(cam, pts, normals, width, color) {
      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      let open = false;
      let z = 0;
      ctx.beginPath();
      pts.forEach((p, k) => {
        const q = project(cam, p);
        const seen = q[2] > 0.3 && dot(normals[k], sub(cam.pos, p)) > 0;
        if (seen) {
          if (open) ctx.lineTo(q[0], q[1]);
          else ctx.moveTo(q[0], q[1]);
          z = q[2];
        }
        open = seen;
      });
      if (z > 0) {
        ctx.lineWidth = Math.max(1, (width * cam.focal) / z);
        ctx.stroke();
      }
      ctx.lineCap = "butt";
    }

    // The head with a cap, shooting glasses and ear muffs.
    function drawHead(cam, rig, rimW, ppm) {
      const { hf, hu, hr } = rig.axes;
      const c = rig.head;
      const P = (f, u, r) =>
        add(add(add(c, mul(hf, f)), mul(hu, u)), mul(hr, r));
      // rings on an ellipsoid (half-sizes: r across, h up, d front to back)
      const shell = (ys, r, h, d, grow = 0) => {
        const pts = [];
        for (const y of ys) {
          const k = Math.sqrt(Math.max(0, 1 - (y / h) ** 2));
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            pts.push(
              P(Math.cos(a) * (d * k + grow), y, Math.sin(a) * (r * k + grow)),
            );
          }
        }
        return pts;
      };
      const seen = (p, n) => dot(n, sub(cam.pos, p)) > 0;
      const cups = [-1, 1].map((s) => {
        const o = P(-0.006, -0.008, s * 0.07);
        const n = mul(hr, s);
        return {
          o,
          n,
          pts: [
            ...ellipse3(o, hf, hu, 0.05, 0.041),
            ...ellipse3(add(o, mul(n, 0.034)), hf, hu, 0.044, 0.035),
          ],
        };
      });
      const cup = (cp) =>
        silhouette(() => hullPath(cam, cp.pts), rgbOf(FIG.muff), 0.8, rimW);
      const brim = () => {
        const pts = [];
        for (let k = 0; k <= 8; k++) {
          const a = lerp(-1.25, 1.25, k / 8);
          pts.push(P(Math.cos(a) * 0.096, 0.034, Math.sin(a) * 0.08));
        }
        for (let k = 8; k >= 0; k--) {
          const a = lerp(-1.25, 1.25, k / 8);
          pts.push(
            P(
              Math.cos(a) * 0.096 + 0.07 * Math.cos(a * 0.9),
              0.026 - 0.024 * Math.cos(a),
              Math.sin(a) * 0.09,
            ),
          );
        }
        poly3(cam, pts, rgbOf(FIG.cap), "rgba(244,245,247,0.4)", rimW);
      };
      const brimFront = seen(P(0.1, 0.03, 0), hf);
      cups.filter((cp) => !seen(cp.o, cp.n)).forEach(cup);
      if (!brimFront) brim();
      silhouette(
        () => {
          capsule(cam, rig.neck, lerp3(rig.neck, c, 0.7), 0.05, 0.047);
          hullPath(cam, [
            ...shell([-0.07, -0.03, 0.015, 0.055, 0.09], 0.074, 0.112, 0.094),
            P(0.07, -0.1, 0),
            P(0.03, -0.103, 0.045),
            P(0.03, -0.103, -0.045),
            P(0.1, 0, 0),
          ]);
        },
        rgbOf(FIG.skin),
        0.85,
        rimW,
      );
      silhouette(
        () =>
          hullPath(cam, [
            ...shell([0.03, 0.065, 0.095, 0.112], 0.078, 0.122, 0.098, 0.004),
            P(0, 0.124, 0),
          ]),
        rgbOf(FIG.cap),
        0.45,
        rimW * 0.7,
      );
      if (brimFront) brim();
      // wraparound glasses, then the muffs' headband over the cap
      const gl = [];
      const gn = [];
      for (let k = 0; k <= 12; k++) {
        const a = lerp(-1.2, 1.2, k / 12);
        gl.push(P(Math.cos(a) * 0.1, 0.012, Math.sin(a) * 0.08));
        gn.push(norm(add(mul(hf, Math.cos(a)), mul(hr, Math.sin(a)))));
      }
      frontLine(cam, gl, gn, 0.026, "#090a0c");
      // the lenses' glint, unless they are seen edge on
      const view = norm(sub(cam.pos, c));
      if (ppm > 350 && Math.abs(dot(hr, view)) < 0.9)
        frontLine(
          cam,
          gl.map((p) => add(p, mul(hu, 0.008))),
          gn,
          0.004,
          "rgba(190,205,220,0.6)",
        );
      // over the crown from cup to cup, hugging the cap
      const arc = [0.035, 0.065, 0.09, 0.105, 0.116].map((y) => [
        y,
        0.078 * Math.sqrt(1 - (y / 0.122) ** 2) + 0.008,
      ]);
      const band = [
        ...arc.map(([y, x]) => P(-0.012, y, x)),
        P(-0.012, 0.128, 0),
        ...arc.reverse().map(([y, x]) => P(-0.012, y, -x)),
      ];
      const bz = polyPath(cam, band);
      if (bz) {
        const w = (0.014 * cam.focal) / bz;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = ppm > 350 ? "#2a2f37" : "rgba(244,245,247,0.45)";
        ctx.lineWidth = w;
        ctx.stroke();
        ctx.lineCap = "butt";
      }
      cups.filter((cp) => seen(cp.o, cp.n)).forEach(cup);
    }

    // The figure fades as one piece: drawn opaque into an offscreen layer
    // (with the current transform), then laid on the canvas at the fade, so
    // its overlapping parts never show through each other.
    let figLayer = null;
    function asOne(alpha, fn) {
      const main = ctx;
      figLayer ??= document.createElement("canvas").getContext("2d");
      const layer = figLayer.canvas;
      if (layer.width !== canvas.width || layer.height !== canvas.height) {
        layer.width = canvas.width;
        layer.height = canvas.height;
      }
      figLayer.save();
      figLayer.setTransform(1, 0, 0, 1, 0, 0);
      figLayer.clearRect(0, 0, layer.width, layer.height);
      figLayer.setTransform(main.getTransform());
      ctx = figLayer;
      try {
        fn();
      } finally {
        ctx = main;
        figLayer.restore();
      }
      main.save();
      main.setTransform(1, 0, 0, 1, 0, 0);
      main.globalAlpha = alpha;
      main.drawImage(layer, 0, 0);
      main.restore();
    }

    function drawFigure(cam, st, rig) {
      const sp = rig.pos;
      const { PF, PR, CF, CR, spine } = rig.axes;
      // ground ring
      const ground = [];
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        ground.push([
          sp[0] + Math.cos(a) * 0.4,
          0.01,
          sp[2] + Math.sin(a) * 0.4,
        ]);
      }
      poly3(cam, ground, rgba(C.white, 0.05), "rgba(255,255,255,0.35)", 1.5);
      const depth = (p) => project(cam, p)[2];
      const zc = depth(rig.chest);
      // pixels per metre, for the rim and the level of detail
      const ppm = cam.focal / Math.max(zc, 0.5);
      const rimW = clamp(0.0045 * ppm, 1.4, 2.2);
      // the far side a shade darker, so the figure reads in depth
      const shade = (z, base) => {
        const k = clamp((z - zc) / 0.25);
        return [mixRGB(base, FIG.far, k * 0.8), 0.85 - 0.3 * k];
      };
      const groups = [];

      // legs: thigh, shin and shoe; behind the hips unless a knee comes
      // well forward of them
      const zp = depth(rig.pelvis);
      [0, 1].forEach((i) => {
        const zk = depth(rig.knees[i]);
        groups.push({
          z: zk - zp < -0.25 ? zk : zc + 0.05 + 0.01 * (zk - zc),
          draw: () => {
            const [fill, a] = shade(zk, FIG.pants);
            const shoe = () =>
              capsule(cam, rig.heels[i], rig.toes[i], 0.046, 0.04);
            silhouette(
              () => {
                capsule(cam, rig.hips[i], rig.knees[i], 0.092, 0.062);
                capsule(cam, rig.knees[i], rig.feet[i], 0.06, 0.043);
                shoe();
              },
              fill,
              a,
              rimW,
            );
            tone(shoe, shade(zk, FIG.shoe)[0]);
          },
        });
      });

      // torso, with the belt, the holster and the magazine pouches
      groups.push({
        z: zc,
        draw: () => {
          const gear = [];
          for (let k = 0; k < 3; k++) {
            const { p, n } = rig.pouch(k);
            const t = cross(UP, n);
            const at = frameAt(add(p, mul(n, 0.016)), t, UP, n);
            const nd = dirAt(t, UP, n);
            gear.push({
              n,
              p,
              items: [{ s: POUCH, at, n: nd, col: FIG.gear }],
            });
            if (k >= 3 - rig.pouches)
              gear[k].items.push({
                s: MAG3.pad,
                at: frameAt(add(p, mul(n, 0.016)), t, UP, n, 0),
                n: nd,
                col: FIG.metal,
              });
          }
          {
            const p = add(add(rig.pelvis, mul(PR, 0.18)), [0, 0.07, 0]);
            const at = frameAt(add(p, mul(PF, -0.02)), PF, UP, PR);
            gear.push({
              n: PR,
              p,
              items: [{ s: HOLSTER, at, n: dirAt(PF, UP, PR), col: FIG.gear }],
            });
          }
          const facing = (g) => dot(g.n, sub(cam.pos, g.p)) > 0;
          const flat = ppm < 450;
          const kit = (front) =>
            gear.filter((g) => facing(g) === front).flatMap((g) => g.items);
          drawSolids(cam, kit(false), 0.5, 1, flat);
          const { pelvis } = rig;
          const MF = norm(add(PF, CF));
          const MR = cross(UP, MF);
          const bc = add(pelvis, [0, 0.075, 0]);
          // pants: the pelvis down to the tops of the thighs
          const pants = () => {
            const pts = [
              ...ellipse3(add(pelvis, [0, -0.07, 0]), PF, PR, 0.14, 0.095, 8),
              ...ellipse3(sub(pelvis, mul(PF, 0.015)), PF, PR, 0.178, 0.12),
              ...ellipse3(bc, PF, PR, 0.172, 0.12),
            ];
            [0, 1].forEach((i) => {
              const ax = norm(sub(rig.knees[i], rig.hips[i]));
              const o = add(rig.hips[i], mul(ax, 0.13));
              const r1 = norm(cross(ax, PR));
              pts.push(...ellipse3(o, cross(ax, r1), r1, 0.085, 0.085, 6));
            });
            silhouette(() => hullPath(cam, pts), rgbOf(FIG.pants), 0.85, rimW);
          };
          // the jersey, lit from above
          const jersey = () => {
            const top = add(rig.neck, mul(spine, 0.035));
            const A = project(cam, bc);
            const B = project(cam, top);
            let fill = rgbOf(FIG.cloth);
            if (
              A[2] > 0.3 &&
              B[2] > 0.3 &&
              Math.hypot(B[0] - A[0], B[1] - A[1]) > 4
            ) {
              fill = ctx.createLinearGradient(A[0], A[1], B[0], B[1]);
              fill.addColorStop(0, rgbOf(FIG.cloth));
              fill.addColorStop(0.55, rgbOf(FIG.cloth));
              fill.addColorStop(1, rgbOf(FIG.lit));
            }
            silhouette(
              () =>
                hullPath(cam, [
                  ...ellipse3(add(pelvis, [0, 0.07, 0]), PF, PR, 0.168, 0.116),
                  ...ellipse3(
                    add(pelvis, mul(spine, 0.2)),
                    MF,
                    MR,
                    0.158,
                    0.11,
                  ),
                  ...ellipse3(
                    add(add(pelvis, mul(spine, 0.37)), mul(CF, 0.012)),
                    CF,
                    CR,
                    0.19,
                    0.135,
                  ),
                  ...ellipse3(
                    add(rig.neck, mul(spine, -0.04)),
                    CF,
                    CR,
                    0.222,
                    0.1,
                  ),
                  ...ellipse3(top, CF, CR, 0.1, 0.07),
                ]),
              fill,
              0.85,
              rimW,
            );
          };
          // whichever lies beyond the belt from the camera goes first
          if (cam.pos[1] > bc[1]) {
            pants();
            jersey();
          } else {
            jersey();
            pants();
          }
          // the belt
          const bp = ellipse3(bc, PF, PR, 0.176, 0.124, 24);
          bp.push(bp[0]);
          const bn = bp.map((p) => norm(sub(p, bc)));
          frontLine(cam, bp, bn, 0.04, "#0f1114");
          if (ppm > 350)
            frontLine(cam, bp, bn, 0.008, "rgba(244,245,247,0.35)");
          drawSolids(cam, kit(true), 0.7, 1, flat);
        },
      });

      // head: neck, cap, eye and ear protection
      groups.push({
        z: depth(rig.head),
        draw: () => drawHead(cam, rig, rimW, ppm),
      });

      // arms: sleeve, bare forearm and hand; the thumbs forward on the frame
      [0, 1].forEach((i) => {
        const z = depth(rig.elbows[i]);
        const [, a] = shade(z, FIG.cloth);
        const k = clamp((z - zc) / 0.25) * 0.8;
        const skin = mixRGB(FIG.skin, FIG.far, k);
        const end = lerp3(rig.shoulders[i], rig.elbows[i], 0.55);
        const sleeve = () => capsule(cam, rig.shoulders[i], end, 0.064, 0.055);
        const upper = () =>
          capsule(cam, rig.shoulders[i], rig.elbows[i], 0.048, 0.042);
        groups.push({
          z: depth(lerp3(rig.shoulders[i], rig.elbows[i], 0.5)),
          draw: () => {
            silhouette(
              () => {
                sleeve();
                upper();
              },
              skin,
              a,
              rimW,
            );
            tone(sleeve, mixRGB(FIG.cloth, FIG.far, k));
          },
        });
        groups.push({
          z: depth(lerp3(rig.elbows[i], rig.hands[i], 0.6)),
          arm: i,
          draw: () => {
            silhouette(
              () => {
                capsule(cam, rig.elbows[i], rig.wrists[i], 0.042, 0.03);
                hullPath(cam, [rig.wrists[i], ...rig.handPts[i]]);
              },
              skin,
              a,
              rimW,
            );
            // close up, the fingers wrapped round the grip
            const outer = i ? rig.side : mul(rig.side, -1);
            if (
              ppm > 600 &&
              rig.fingers[i] &&
              dot(outer, sub(cam.pos, rig.grip)) > 0
            ) {
              ctx.beginPath();
              rig.fingers[i].forEach(([p, q]) => {
                const A = project(cam, p);
                const B = project(cam, q);
                if (A[2] < 0.3 || B[2] < 0.3) return;
                ctx.moveTo(A[0], A[1]);
                ctx.lineTo(B[0], B[1]);
              });
              ctx.lineCap = "round";
              ctx.strokeStyle = "rgba(0,0,0,0.4)";
              ctx.lineWidth = Math.max(1, 0.003 * ppm);
              ctx.stroke();
              ctx.lineCap = "butt";
            }
          },
        });
      });

      // the dropped magazine: out of the magwell, tumbling to the ground
      const [, rOut] = EVENTS.reload;
      if (st > rOut) {
        if (!dropRig || dropRig.st !== rOut)
          dropRig = { st: rOut, rig: shooterRig(rOut) };
        const r0 = dropRig.rig;
        const up0 = norm(add(mul(r0.forward, 0.15), mul(r0.up, 0.99)));
        const b0 = frameAt(r0.grip, r0.forward, r0.up, r0.side)([-6, -68, 0]);
        const v0 = mul(up0, -1.6);
        // solve b0.y + v0.y t − g t²/2 = 0.012
        const g = 9.81;
        const tl =
          (v0[1] + Math.sqrt(v0[1] * v0[1] + 2 * g * (b0[1] - 0.012))) / g;
        const t = Math.min(st - rOut, tl);
        const base = add(add(b0, mul(v0, t)), [0, -0.5 * g * t * t, 0]);
        const th = (Math.PI / 2) * (t / tl);
        const fr = r0.forward;
        const up = rotAbout(up0, fr, th);
        const sd = cross(up, fr);
        groups.push({
          z: depth(base),
          draw: () =>
            drawSolids(
              cam,
              [
                {
                  s: MAG3.body(144),
                  at: frameAt(base, fr, up, sd),
                  n: dirAt(fr, up, sd),
                  col: FIG.metal,
                },
                {
                  s: MAG3.pad,
                  at: frameAt(base, fr, up, sd),
                  n: dirAt(fr, up, sd),
                  col: FIG.metal,
                },
              ],
              0.6,
              1,
            ),
        });
      }

      const gun = {
        draw: () => {
          const { grip: G, forward: f, up: u, side: s } = rig;
          const at = frameAt(G, f, u, s);
          const atS = frameAt(G, f, u, s, -rig.slide);
          const n = dirAt(f, u, s);
          const P = PISTOL.parts;
          // the trigger guard
          const gz = polyPath(
            cam,
            PISTOL.guard.map(([x, y]) => at([x, y, 0])),
          );
          const gw = gz ? (0.0045 * cam.focal) / gz : 0;
          ctx.lineJoin = "round";
          ctx.strokeStyle = "rgba(244,245,247,0.8)";
          ctx.lineWidth = gw + rimW * 2;
          ctx.stroke();
          if (ppm > 350) {
            ctx.strokeStyle = "#16191d";
            ctx.lineWidth = gw;
            ctx.stroke();
          }
          const items = [
            { s: P.grip, at, n, col: FIG.grip },
            { s: P.frame, at, n, col: FIG.metal },
            { s: P.dust, at, n, col: FIG.metal },
            { s: P.slide, at: atS, n, col: FIG.metal },
          ];
          // the sights and the barrel only once they are big enough to see
          if (ppm > 350)
            items.push(
              { s: P.rear, at: atS, n, col: FIG.metal },
              { s: P.front, at: atS, n, col: FIG.sight },
            );
          if (rig.mag) items.push({ s: P.pad, at, n, col: FIG.metal });
          if (rig.slide > 6 && ppm > 350)
            items.push({ s: P.barrel, at, n, col: FIG.metal });
          drawSolids(cam, items, 0.9, Math.max(1.2, rimW * 0.8));
        },
      };
      // The pistol is in front of the torso when the camera is beyond the
      // plane that separates them (tangent to the chest, facing the gun).
      const gc = lerp3(rig.grip, rig.muzzle, 0.35);
      const gv = sub(gc, rig.chest);
      const gn = norm(sub(gv, mul(spine, dot(gv, spine))));
      const gr = 1 / Math.hypot(dot(gn, CF) / 0.135, dot(gn, CR) / 0.19);
      const ahead = dot(sub(cam.pos, add(rig.chest, mul(gn, gr))), gn) > 0;
      const zg = depth(gc);
      gun.z = ahead ? Math.min(zg, zc - 0.002) : Math.max(zg, zc + 0.002);
      // The hands wrap the grip: the one on the camera's side of the pistol
      // goes over it, the other under it. The thumbs lie along the left of
      // the frame, the trigger finger on the right.
      // Seen from behind the gun, both hands are nearer than the grip they
      // wrap, whichever side the camera leans to.
      const toCam = norm(sub(cam.pos, rig.grip));
      const behind = dot(rig.forward, toCam) < -0.5;
      const right = dot(rig.side, toCam) > 0;
      const fore = [0, 1].map((i) => groups.find((g) => g.arm === i));
      const near = right ? 1 : 0;
      const on = [!!rig.thumbs[0], true]; // which hands are on the pistol
      if (on[near]) fore[near].z = Math.min(fore[near].z, gun.z - 0.001);
      if (on[1 - near])
        fore[1 - near].z = behind
          ? Math.min(fore[1 - near].z, gun.z - 0.001)
          : Math.max(fore[1 - near].z, gun.z + 0.001);
      const zHold = [0, 1].filter((i) => on[i]).map((i) => fore[i].z);
      const digits = (pairs) => ({
        draw: () =>
          silhouette(
            () => pairs.forEach(([a, b, r]) => capsule(cam, a, b, r, r * 0.85)),
            rgbOf(FIG.skin),
            0.85,
            rimW,
          ),
      });
      const thumbs = digits(
        rig.thumbs.filter(Boolean).map(([a, b]) => [a, b, 0.0105]),
      );
      const index = digits([[...rig.index, 0.0095]]);
      const extra = [gun];
      if (ppm > 380) {
        (right ? thumbs : index).z = gun.z + 0.0001;
        (right ? index : thumbs).z = Math.min(...zHold) - 0.0001;
        extra.push(thumbs, index);
      }
      groups.push(...extra);
      groups.sort((a, b) => b.z - a.z);
      if (rig.hold) {
        const { base, up, front, top } = rig.hold;
        const sd = cross(up, front);
        const at = frameAt(base, front, up, sd);
        const n = dirAt(front, up, sd);
        groups.splice(
          groups.findIndex((g) => g.arm === 0),
          0,
          {
            draw: () =>
              drawSolids(
                cam,
                [
                  { s: MAG3.pad, at, n, col: FIG.metal },
                  ...(top > 18
                    ? [{ s: MAG3.body(top), at, n, col: FIG.metal }]
                    : []),
                ],
                0.7,
                1,
              ),
          },
        );
      }
      groups.forEach((g) => g.draw());
    }

    function drawShooter(cam, st) {
      const rig = shooterRig(st);
      // flying into the shooter's eyes, the figure is gone before the
      // camera reaches the cap
      const fade =
        ctx.globalAlpha * clamp((dist3(cam.pos, rig.head) - 0.35) / 0.5);
      if (fade <= 0.002) return;
      if (fade < 0.999) asOne(fade, () => drawFigure(cam, st, rig));
      else drawFigure(cam, st, rig);
    }

    // S6 — hit factor: points ÷ time = hit factor, each number under its
    // name (at this stretch a second on screen is 0.556 s of the cut). The
    // equation builds in about 0.75 s on screen (the time flies in from the
    // shot timer, the points roll up, the operators slam on the off-beat, the
    // hit factor rolls in and lands on the beat at 20.3675, 0.84 s in), then
    // holds still, names and all, for 2.8 s while a soft light drifts behind
    // it and a gleam runs along its underline, until it leaves at 21.92,
    // just before the first range command rises at 22.022.
    // Copy: FINALE_COPY.hitFactor.
    function sceneHitFactor(t) {
      if (t < 19.9 || t > 22.05) return;
      const out = ease.in3(seg(t, 21.92, 21.995));
      ctx.save();
      ctx.translate(0, -out * 140);
      ctx.globalAlpha = 1 - out;
      const y = 600;
      const size = 150;
      const land = 20.3675; // the last digit of the hit factor
      // while it holds, a soft light drifts behind it, left to right
      const drift = seg(t, 20.3, 21.99);
      if (drift > 0 && drift < 1) {
        const lx = lerp(200, W - 200, drift);
        const g = ctx.createRadialGradient(lx, y - 70, 0, lx, y - 70, 640);
        g.addColorStop(0, "rgba(255,255,255,0.055)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.save();
        ctx.globalAlpha *= Math.sin(drift * Math.PI);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
      // positions
      const xP = 230;
      const xDiv = 560;
      const xT = 690;
      const xEq = 1140;
      const xHF = 1270;
      // time flies in from the HUD
      const fly = ease.inOut3(seg(t, 19.95, 20.13)); // 0.32 s on screen
      const tsz = lerp(64, size, fly);
      const tx = lerp(W - 96 - timeWidth(fmt2(STAGE_MS)) * 64, xT, fly);
      const ty = lerp(150, y, fly);
      digits(fmt2(STAGE_MS), tx, ty, tsz, { weight: 800 });
      // points roll
      const pp = ease.out3(seg(t, 20.0, 20.15));
      const pts = Math.round(STAGE_POINTS * pp);
      ctx.save();
      ctx.globalAlpha *= ease.out3(seg(t, 20.0, 20.04));
      digits(
        String(pts).padStart(String(STAGE_POINTS).length, "0"),
        xP,
        y,
        size,
        { weight: 800 },
      );
      ctx.restore();
      // the names: English and Korean in both, else the viewer's language
      const lang = opt.lang;
      const L = FINALE_COPY.hitFactor;
      [
        [xP, L.points, 20.0],
        [xT, L.time, 20.1],
        [xHF, L.hf, 20.2],
      ].forEach(([x, [en, kr], at]) => {
        if (lang === "both") {
          landLine(
            en,
            x + 4,
            y - size - 46,
            { size: 24, tracking: 3, color: C.red },
            t,
            at,
            0.14,
          );
          landLine(
            kr,
            x + 4,
            y - size - 10,
            { size: 28, weight: 700, family: KR, color: "#c9ccd1" },
            t,
            at + 0.01,
            0.14,
          );
        } else if (lang === "en")
          landLine(
            en,
            x + 4,
            y - size - 26,
            { size: 26, tracking: 3, color: C.red },
            t,
            at,
            0.14,
          );
        else
          landLine(
            kr,
            x + 4,
            y - size - 24,
            { size: 34, weight: 700, family: KR, color: C.red },
            t,
            at,
            0.14,
          );
      });
      // operators slam
      [
        [xDiv, "÷"],
        [xEq, "="],
      ].forEach(([x, op]) => {
        const p = seg(t, 20.184, 20.23);
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
      // hit factor rolls in, digit by digit, the last one on the beat
      const hf = HIT_FACTOR.toFixed(4);
      if (t > 20.2) {
        const r = rand(Math.floor(t * 40));
        const step = 0.021;
        const chars = [...hf].map((ch, k) => {
          const at = land - (hf.length - 1 - k) * step;
          if (ch === ".") return t > at ? "." : " ";
          return t >= at ? ch : String(Math.floor(r() * 10));
        });
        const settled = t >= land;
        const w = digits(chars.join(""), xHF, y, size, {
          weight: 800,
          color: settled ? C.white : "rgba(255,255,255,0.75)",
        });
        const ul = ease.outExpo(seg(t, land, land + 0.13));
        ctx.fillStyle = C.red;
        ctx.fillRect(xHF, y + 26, w * ul, 8);
        // a gleam runs along the underline, once, as the equation holds
        gleam(xHF, y + 26, w, 8, seg(t, 20.95, 21.5));
        // a ripple round the digits, kept clear of their names
        if (t > land && t < land + 0.38) {
          const rp = seg(t, land, land + 0.38);
          ctx.strokeStyle = rgba(C.red, 1 - rp);
          ctx.lineWidth = 3;
          ctx.strokeRect(
            xHF - 20 - rp * 24,
            y - 0.78 * size - 18 - rp * 24,
            w + 40 + rp * 48,
            0.78 * size + 62 + rp * 48,
          );
        }
      }
      ctx.restore();
    }

    // S7 — range is clear: the three commands one at a time, 2.4 s apart on
    // screen, each in its English words (with the Korean under it in ko and
    // both), still within 0.2 s on screen of its stab and held 2.1 s, while
    // the pistol does what it says: magazine out, slide locked back, chamber
    // shown empty; slide forward, hammer down, holstered. The first command
    // is still in the hit factor's stretch (0.556 s of the cut a second),
    // the others in this one's (0.45). RANGE IS CLEAR holds, a gleam running
    // along its rule, until the end card's iris (END_IRIS) reaches it.
    // Copy: FINALE_COPY.clear.
    const CLEAR_BEATS = [22.022, 23.174, 24.254];
    function sceneClear(t) {
      if (t < CLEAR_BEATS[0] || t > END_IRIS + 0.5 + END_HOLD) return;
      const lang = opt.lang;
      const gloss = lang !== "en";
      FINALE_COPY.clear.forEach(([en, kr], k) => {
        const at = CLEAR_BEATS[k];
        // pushed out over 0.07 s on screen, gone just before the next one
        // rises into its place
        const out = (CLEAR_BEATS[k + 1] ?? Infinity) - 0.036;
        // 0.2 s on screen
        const land = k ? 0.09 : 0.111;
        if (t < at || t > out + 0.032) return;
        const last = k === 2;
        // clear of the screen centre, where the end card's iris opens
        const y = 450;
        landLine(
          en,
          150,
          y,
          last ? { size: 150, tracking: -5 } : { size: 96, tracking: -3 },
          t,
          at,
          land,
          out,
          0.032,
        );
        if (last) {
          const w = ease.outExpo(seg(t, at, at + 0.12)) * 520;
          ctx.fillStyle = C.red;
          ctx.fillRect(150, 486, w, 8);
          // a gleam along the rule as the line holds
          gleam(150, 486, w, 8, seg(t, at + 0.35, at + 0.75));
        }
        if (gloss)
          landLine(
            kr,
            152,
            last ? 570 : 532,
            {
              size: last ? 48 : 44,
              weight: 700,
              family: KR,
              color: "#c9ccd1",
            },
            t,
            at + 0.01,
            land,
            out,
            0.032,
          );
      });
      // the gun, slid in on the first command (0.4 s on screen) and drifting
      // gently while it works: the magazine drops free (22.345) and clears
      // the grip before the slide locks back (22.51–22.58); the chamber is
      // shown empty for 1.2 s; on HAMMER DOWN, HOLSTER the slide goes home
      // (23.19), the hammer follows half a second later (23.435), and the
      // pistol is holstered (23.66–23.975), carried down and turned until
      // all of it is below the frame, and not drawn after that: gone 0.6 s
      // on screen before RANGE IS CLEAR.
      if (t < 23.975) {
        const drop = seg(t, 22.345, 22.58);
        const lock =
          ease.out3(seg(t, 22.513, 22.58)) *
          (1 - ease.in3(seg(t, 23.19, 23.22)));
        const holster = ease.in3(seg(t, 23.66, 23.975));
        const enter = ease.out3(seg(t, CLEAR_BEATS[0], 22.245));
        const drift = seg(t, 22.245, 23.66);
        const go = {
          x: lerp(2280, 1500, enter) - drift * 24,
          y: 790 + holster * 720 - drift * 6,
          s: 2.5,
          rot: holster * 0.9,
        };
        drawGun({
          ...go,
          slide: lock * 27,
          // cocked by the stage's last shot until HAMMER DOWN
          hammer: 1 - ease.in3(seg(t, 23.435, 23.475)),
          mag: { dx: -drop * 18, dy: drop * drop * 900, rot: drop * 0.8 },
        });
        // the empty chamber, ringed while the slide is back
        if (t > 22.58 && t < 23.12) {
          const [cx, cy] = gunPoint(go, GUN.port[0], GUN.port[1]);
          ctx.save();
          ctx.globalAlpha = env(t, 22.58, 23.12, 0.04, 0.04);
          ctx.strokeStyle = C.white;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.arc(cx, cy, 70, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }
    }

    // S8 — end card: the IPSC crest and the KRPSA crest side by side (the
    // Confederation and its Region, no separator), then the lettering: the
    // name as the site gives it (in Korean in ko, under the English in
    // both), IPSC's fifty years and, under them, the motion-design credit
    // (opt.credit). The iris opens at END_IRIS; the lettering is in and
    // still as it uncovers it (by lt 0.02), the credit rises in with it
    // (still by lt 0.25), and all of it holds still together for about six
    // and a half seconds, to the end. The background holds still; only the
    // crests catch a light sweep, every two seconds. The card, its credit,
    // the closing caption and the frame chrome all fade out together over
    // the reel's last 0.3 s. Copy: FINALE_COPY.end.
    const logoLayers = {};
    function sceneEnd(t) {
      if (t < END_IRIS) return;
      const iris = ease.inOut3(seg(t, END_IRIS, END_IRIS + 0.45));
      const r = iris * 1300;
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
      ctx.clip();
      background(t);
      blueprintGrid(0.5);
      const lt = t - (END_IRIS + 0.2);
      const fade = 1 - seg(t, 27.7 + TAIL, 28 + TAIL);
      const fadeAt = 27.7 + TAIL - (END_IRIS + 0.2); // in lt
      ctx.globalAlpha = fade;
      // a crest rises into place, then a light sweeps across it
      const crest = (name, cx, cy, h, d) => {
        const img = images[name];
        if (!img) return;
        const w = (img.width / img.height) * h;
        const p = ease.out5(seg(lt, d, d + 0.7));
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(lerp(0.86, 1, p), lerp(0.86, 1, p));
        ctx.beginPath();
        ctx.rect(-w / 2 - 10, h / 2 - (h + 20) * p, w + 20, (h + 20) * p);
        ctx.clip();
        // The light sweep is composited on the crest's own layer, so it only
        // touches the crest's pixels and never the background around it. It
        // runs as the crest settles and again every two seconds, as long as
        // a sweep ends before the card fades out (three times).
        const k = Math.max(0, Math.floor((lt - d) / 2));
        const sw =
          d + 2 * k + 1.6 < fadeAt
            ? seg(lt, d + 0.4 + 2 * k, d + 1.6 + 2 * k)
            : 0;
        if (sw > 0 && sw < 1) {
          const lc = (logoLayers[name] ||= document
            .createElement("canvas")
            .getContext("2d"));
          const iw = Math.round(w);
          const ih = Math.round(h);
          if (lc.canvas.width !== iw || lc.canvas.height !== ih) {
            lc.canvas.width = iw;
            lc.canvas.height = ih;
          }
          lc.globalCompositeOperation = "source-over";
          lc.clearRect(0, 0, iw, ih);
          lc.drawImage(img, 0, 0, iw, ih);
          const sx = lerp(-0.5, 2.05, sw) * iw; // fully off the crest at both ends
          const g = lc.createLinearGradient(sx - 90, 0, sx + 90, ih * 0.25);
          g.addColorStop(0, "rgba(255,255,255,0)");
          g.addColorStop(0.5, "rgba(255,255,255,0.55)");
          g.addColorStop(1, "rgba(255,255,255,0)");
          lc.globalCompositeOperation = "source-atop";
          lc.fillStyle = g;
          lc.fillRect(0, 0, iw, ih);
          ctx.drawImage(lc.canvas, -w / 2, -h / 2, w, h);
        } else ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
      };
      // The two crests have the same outer height, but the KRPSA crest's black
      // rim vanishes into the dark background, so its perceived outline is the
      // yellow border inside it, about 6 % smaller. It is drawn 6 % taller so
      // the two shields read as the same size.
      crest("ipsc-crest.png", 410, 540, 380, 0);
      crest("krpsa-logo.png", 773, 540, 402, 0.12);
      // the lettering: at rest by lt 0.02 (END_IRIS + 0.22), as the iris
      // uncovers it
      const wm = kinetic("KRPSA", 1023, 545, {
        size: 190,
        t: lt + 0.3,
        tracking: -6,
        stagger: 0.02,
        dur: 0.24,
      });
      const lang = opt.lang;
      const E = FINALE_COPY.end;
      const both = lang === "both";
      ctx.save();
      ctx.globalAlpha *= ease.out3(seg(lt, -0.2, -0.08));
      if (lang === "ko")
        text(E.name[1], 1029, 610, { size: 34, weight: 700, family: KR });
      else text(E.name[0], 1029, 604, { size: 24, weight: 700, tracking: 2.5 });
      if (both)
        text(E.name[1], 1029, 644, {
          size: 28,
          weight: 700,
          family: KR,
          color: "#c9ccd1",
        });
      ctx.restore();
      const ry = both ? 672 : 638;
      const lw = ease.outExpo(seg(lt, -0.15, 0.25)) * (wm - 6);
      ctx.fillStyle = C.red;
      ctx.fillRect(1029, ry, lw, 4);
      ctx.save();
      ctx.globalAlpha *= ease.out3(seg(lt, -0.15, -0.03));
      const yy = ry + 54;
      if (lang === "ko")
        text(E.years[1], 1029, yy, { size: 28, weight: 700, color: C.red });
      else {
        const w = text(E.years[0], 1029, yy, {
          size: 26,
          weight: 800,
          tracking: 4,
          color: C.red,
        });
        if (both)
          text(E.years[2], 1029 + w + 22, yy, {
            size: 26,
            weight: 700,
            family: KR,
            color: "#c9ccd1",
          });
      }
      ctx.restore();
      // the credit, a line of its own under the years, in the lettering's
      // column: it rises in with the lettering (still by lt 0.25) and holds
      // with it to the end. The label and its dash in grey, the name in
      // white; in both, the Korean line under the English one.
      if (opt.credit) {
        const [label, labelKo, name] = E.credit;
        const cy = yy + 72;
        const credit = (lab, who, y, o, at) => {
          const w = landLine(
            `${lab} — `,
            1029,
            y,
            { ...o, color: "#a4a8af" },
            lt,
            at,
            0.25,
          );
          landLine(
            who,
            1029 + w,
            y,
            { ...o, family: undefined, weight: 800, color: C.white },
            lt,
            at + 0.02,
            0.25,
          );
        };
        const kr = { weight: 700, family: KR, tracking: 0 };
        if (lang === "ko") credit(labelKo, name, cy, { ...kr, size: 24 }, 0);
        else {
          const o = { size: 22, weight: 700, tracking: 3 };
          credit(label, name.toUpperCase(), cy, o, 0);
          if (both) credit(labelKo, name, cy + 36, { ...kr, size: 22 }, 0.04);
        }
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
        // the first word of the motto only: the later ones land on words
        // that are already being read
        [OPENING.dvc[0][3], 0.1, 5],
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
        [20.3675 + SHIFT, 0.18, "255,255,255", 0.14], // the hit factor lands
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
      const tf = clamp(time, 0, DURATION); // the final timeline
      const tl = timeline(tf);
      const t = tl.t; // the original cut's time; frozen inside an insert
      const k = canvas.width / W;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      background(t);
      const [sx, sy] = shake(t);
      ctx.save();
      ctx.translate(sx, sy);
      if (tl.insert?.kind === "divisions") {
        drawDivisions(tl.lt);
        // venetian blinds in from the sights beat and out to the targets
        const at = tl.insert.at;
        if (tl.lt < 0.25) blinds(at + tl.lt, at - 0.2, at + 0.2);
        else if (tl.lt > tl.insert.dur - 0.25)
          blinds(at - (tl.insert.dur - tl.lt), at - 0.2, at + 0.2);
      } else if (tl.insert?.kind === "flyover") {
        sceneStage(t, tl.lt);
      } else {
        // the wipe runs over the held motto and uncovers MAKE READY
        const [wa, wb] = OPENING.wipe;
        if (t < wa) sceneDVC(t);
        else if (t < wb) wipe(t, wa, wb, sceneDVC, sceneCommands);
        else sceneCommands(t);
        sceneBeep(t);
        sceneLineOfSight(t);
        if (t < INSERTS[0].at) sceneSights(t);
        sceneTargets(t);
        sceneStage(t);
        sceneHitFactor(t - SHIFT);
        sceneClear(t - SHIFT);
        if (t >= 12.75 && t <= 13.25) blinds(t, 12.75, 13.15);
        sceneEnd(t - SHIFT - END_HOLD);
      }
      ctx.restore();
      overlays(t);
      // the frozen timer blinks on the final timeline's own beat, steady
      // through the inserts and the stretches (phase-locked to the beep)
      timerHud(t, tf - ins(BEEP) + BEEP);
      if (opt.captions) caption(tf);
      hud(tf);
    }
    // The Divisions chapter (sceneDivisions) when it is present in this build.
    function drawDivisions(lt) {
      if (typeof sceneDivisions === "function") sceneDivisions(lt);
      else
        kinetic("DIVISIONS", 150, 560, {
          size: 150,
          t: lt,
          tracking: -5,
          stagger: 0.02,
        });
    }

    // Preview of the divisions chapter alone, at local time lt, framed as in
    // the reel: the frozen shot timer (blinking on the chapter's own beat),
    // the blinds in and out, the chapter's own captions and the chrome, its
    // chapter rail held still.
    function renderDivisions(time) {
      const lt = clamp(time, 0, DIV.dur);
      const t = 7.5 + (lt % 8); // a reel time inside the freeze, clear of its flashes
      const k = canvas.width / W;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      background(t);
      sceneDivisions(lt);
      blinds(lt, -0.2, 0.2);
      blinds(lt, DIV.dur - 0.2, DIV.dur + 0.2);
      overlays(t);
      timerHud(t, BEEP + lt);
      if (opt.captions) divCaption(lt);
      hud(7.5);
    }

    return {
      ready,
      render,
      renderDivisions,
      divisions: DIV,
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
    let held = 0; // how long the picture has waited for the soundtrack
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
        button.querySelector(".reel-chapter-name").textContent =
          chapter.short?.[lang] ?? chapter[lang];
        button.title = chapter[lang];
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
      // the line whose own span holds t, else a neighbour's lead-in or tail
      let ci = CAPTIONS.findIndex(([a, b]) => t >= a && t <= b);
      if (ci < 0)
        ci = CAPTIONS.findIndex(([a, b]) => t >= a - 0.05 && t <= b + 0.25);
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
      audio.play().catch((error) => {
        // pause() while the mp3 is still loading rejects the pending play()
        // with an AbortError; that is not a refusal, so keep the sound choice.
        // Autoplay refusals (NotAllowedError) and a missing or unsupported
        // track (NotSupportedError) still fall back to silence.
        if (error?.name === "AbortError") return;
        sound = false;
        emit("sound");
      });
    }
    function frame(now) {
      raf = 0;
      if (!playing) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // With sound on, the soundtrack keeps the clock: the picture holds while
      // the track loads or seeks (up to 1.5 s), then eases onto it.
      const live = sound && audio && !audio.paused;
      if (live && !audio.seeking && audio.readyState >= 3) {
        held = 0;
        const drift = audio.currentTime - (t + dt);
        if (Math.abs(drift) > 0.5) {
          // a stall or a hidden tab: move the track to the picture instead
          t += dt;
          audio.currentTime = t;
        } else t += dt + drift * 0.25;
      } else if (!live || (held += dt) >= 1.5) t += dt;
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
    // Once it has played, the soundtrack is exposed to OS media controls
    // (media notification, media keys, headset buttons), which call the
    // element's play()/pause() directly. The reel owns the clock, so refuse a
    // play it did not start, and treat an outside pause while the reel runs as
    // the viewer muting it. The player clears `playing` or `sound` before each
    // of its own audio.pause() calls, and the `audio.paused` re-check skips a
    // stale 'pause' event queued just before the player resumed the track.
    audio?.addEventListener("play", () => {
      if (!playing || !sound) audio.pause();
    });
    audio?.addEventListener("pause", () => {
      if (playing && sound && audio.paused && !audio.ended) {
        sound = false;
        emit("sound");
      }
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

  // ------------------------------------------------------------- timeline
  // Chapters inserted into the original cut. Scene code keeps its original
  // times: ins() maps an original time to the final timeline and timeline()
  // maps a final time back. The clock and the shot timer stay frozen inside
  // both inserts: the Divisions chapter after the sights beat, and the course
  // walk just before the clock resumes.
  const DIV_INFO =
    typeof DIV !== "undefined" ? DIV : { dur: 12, captions: [], cues: [] };
  // The final timeline. The original cut plays at its own pace, except where
  // a stretch slows a scene down so its words stay up long enough to read,
  // and where an insert (the divisions chapter, the course walk) plays while
  // it holds still.
  // Stretches are [from, to, seconds on screen] in original-cut time.
  const STRETCH = [
    [0, 2.14, 4.2], // DVC
    [2.14, BEEP, 7.0], // the range commands, up to the start signal
    [6.9, 12.95, 7.5], // the line of sight and the sights
    [13.15, 15.7, 6.6], // targets and scoring (its blinds in play at speed), up to the push
    [19.9 + SHIFT, 22.4 + SHIFT, 4.5], // the hit factor
    [22.4 + SHIFT, 25.1 + SHIFT, 6.0], // range is clear, up to the end card
  ];
  const INSERTS = [
    { at: 12.95, dur: DIV_INFO.dur, kind: "divisions" },
    { at: RESUME, dur: 5.0, kind: "flyover" }, // the course walk
  ];
  const FLY = INSERTS.find((x) => x.kind === "flyover");
  // [o0, o1, f0, f1]: original time o0..o1 plays over final time f0..f1;
  // an insert holds the original cut still (o0 === o1) and carries `insert`
  const SEGS = (() => {
    const marks = [
      ...STRETCH.map(([a, b, d]) => ({ o: a, b, d })),
      ...INSERTS.map((x) => ({ o: x.at, b: x.at, d: x.dur, insert: x })),
    ].sort((p, q) => p.o - q.o || (p.insert ? -1 : 1));
    const segs = [];
    let o = 0;
    let f = 0;
    for (const m of marks) {
      if (m.o > o) segs.push([o, m.o, f, (f += m.o - o)]);
      segs.push(Object.assign([m.o, m.b, f, (f += m.d)], { insert: m.insert }));
      o = m.b;
    }
    segs.push([o, Infinity, f, Infinity]);
    return segs;
  })();
  // map a time in the original cut to the final timeline (an event exactly at
  // an insert's start plays after the insert)
  function ins(t) {
    const [o0, o1, f0, f1] =
      SEGS.find(
        (s) => !s.insert && t >= s[0] && (t < s[1] || s[1] === Infinity),
      ) ?? SEGS[SEGS.length - 1];
    return o1 === Infinity
      ? f0 + (t - o0)
      : f0 + ((t - o0) * (f1 - f0)) / (o1 - o0);
  }
  const insStart = (x) => SEGS.find((s) => s.insert === x)[2];
  // the final time f in the original cut; inside an insert the cut holds
  // still and lt is the insert's own time
  function timeline(f) {
    const s = SEGS.find((s) => f < s[3]) ?? SEGS[SEGS.length - 1];
    const [o0, o1, f0, f1] = s;
    if (s.insert) return { t: o0 - 0.001, insert: s.insert, lt: f - f0 };
    const t =
      o1 === Infinity ? o0 + (f - f0) : o0 + ((f - f0) * (o1 - o0)) / (f1 - f0);
    return { t, insert: null, lt: 0 };
  }
  // the end card holds about 3.3 s past the cut, to a whole second: seven
  // seconds or so in all, for its lettering and its credit to be read
  // together before it fades
  const CUT = ins(BASE_DURATION);
  const DURATION = Math.ceil(CUT + 3.3);
  const TAIL = DURATION - CUT;
  {
    const [div, fly] = INSERTS;
    // chapters: one that starts exactly where an insert begins opens with it
    CHAPTERS.forEach((c) => {
      const at = INSERTS.find((x) => x.at === c.t);
      c.t = at ? insStart(at) : ins(c.t);
    });
    CHAPTERS.splice(
      CHAPTERS.findIndex((c) => c.t > insStart(div)),
      0,
      {
        t: insStart(div),
        ko: "디비전",
        en: "Divisions",
        sub: { ko: "장비별 경쟁", en: "Equipment classes" },
      },
    );
    CAPTIONS.forEach((c) => {
      c[0] = ins(c[0]);
      c[1] = ins(c[1]);
    });
    CAPTIONS.push(
      ...DIV_INFO.captions.map(([a, b, ko, en]) => [
        insStart(div) + a,
        insStart(div) + b,
        ko,
        en,
      ]),
      // one line over the course walk, once its card has been read; it adds
      // what the card does not say, and leaves as the stage resumes
      [
        insStart(fly) + 1.2,
        insStart(fly) + fly.dur - 0.26,
        "먼저 코스를 걸어 봅니다.",
        "First, walk the course.",
      ],
    );
    CAPTIONS.sort((a, b) => a[0] - b[0]);
    CAPTIONS[CAPTIONS.length - 1][1] += TAIL; // the closing line stays with the end card
    CUES.forEach((c) => {
      // a riser or a run of flutter stretches with the scene it plays under
      // (but does not run on through an inserted chapter: it ends where the
      // chapter begins, as the riser into the stage now runs into the walk)
      const across = INSERTS.find((x) => c.t < x.at && c.t + c.dur >= x.at);
      if (c.dur != null)
        c.dur = (across ? insStart(across) : ins(c.t + c.dur)) - ins(c.t);
      c.t = ins(c.t);
    });
    CUES.push(...DIV_INFO.cues.map((c) => ({ ...c, t: insStart(div) + c.lt })));
    // the course walk: a hit landing the riser from the push as the card
    // opens, a riser up to the stage's drop, a tick as each of the course
    // card's numbers lands, and a whoosh peaking as the camera is at its
    // fastest (see flyCamera): the dive from the overview, the two glides
    // along the shooting areas, the climb back
    CUES.push(
      ...[
        { lt: 0, type: "hit", v: 0.5 },
        { lt: 0.05, type: "riser", dur: fly.dur - 0.1 },
        { lt: 0.15, type: "whoosh", v: 0.7 },
        ...[0.3, 0.37, 0.44].map((lt) => ({ lt, type: "tick", v: 0.5 })),
        // the camera's moves scale with the walk (timed for 4 s)
        ...[1.5, 2.2, 3.25].map((lt, i) => ({
          lt: (lt * fly.dur) / 4,
          type: "whoosh",
          v: i < 2 ? 0.45 : 0.55,
        })),
      ].map(({ lt, ...c }) => ({ ...c, t: insStart(fly) + lt })),
    );
    CUES.sort((a, b) => a.t - b.t);
  }

  window.KRPSAReel = {
    W,
    H,
    DURATION,
    player,
    CHAPTERS,
    CUES,
    CAPTIONS,
    SHOTS: SHOTS.map((shot) => ({ ...shot, t: ins(shot.t) })),
    TARGETS,
    // target geometry in cm (centre origin, y down) for the tests
    TARGET: {
      outer: TGT.outer.pts,
      d: TGT.d.pts,
      c: TGT.c.pts,
      a: TGT.a.pts,
      popper: POPPER.pts,
    },
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
      resume: ins(RESUME),
      stageEnd: ins(STAGE_END),
      shift: SHIFT,
      ramps: RAMPS.map(([a, b, rate]) => [ins(vt(a)), ins(vt(b)), rate]),
      // map a time in the original cut to the final timeline
      ins,
      inserts: INSERTS.map((x) => ({
        at: insStart(x),
        dur: x.dur,
        kind: x.kind,
      })),
      // the stretched scenes on the final timeline: [from, to, rate]
      stretch: STRETCH.map(([a, b, d]) => [ins(a), ins(a) + d, (b - a) / d]),
      // For scripts/reel-audio.mjs, which samples the moving targets in stage
      // time: the stage clock at `resume` (s) and EVENTS (stage s).
      stageStart: FREEZE_MS / 1000,
      events: EVENTS,
      swinger: SWING,
      cuts: CUTS.map(([at, dur, rig]) => [ins(at), dur, rig]),
    },
    create,
  };
})();
