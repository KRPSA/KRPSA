// Renders reel.js frame by frame in headless Chromium and encodes it with ffmpeg.
//
//   node scripts/reel-render.mjs --out reel.mp4 [--audio reel.wav] [--lang both|ko|en]
//                                 [--fps 60] [--blur 4] [--credit]
//   node scripts/reel-render.mjs --stills 0.5,6.1,9.5 --dir stills/
//
// Stops before rendering if Inter or Noto Sans KR fail to load, rather than
// quietly setting the reel in system fallback fonts; pass --allow-fallback-fonts
// to render anyway.
//
// Requires Playwright (`npm i --no-save playwright`, or a global install) and ffmpeg.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const run = promisify(execFile);

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const { values: args } = parseArgs({
  options: {
    out: { type: 'string' },
    audio: { type: 'string' },
    lang: { type: 'string', default: 'both' },
    fps: { type: 'string', default: '60' },
    blur: { type: 'string', default: '1' },
    credit: { type: 'boolean', default: false },
    stills: { type: 'string' },
    dir: { type: 'string', default: '.' },
    from: { type: 'string', default: '0' },
    to: { type: 'string' },
    'allow-fallback-fonts': { type: 'boolean', default: false },
  },
});

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    return createRequire(path.join(globalRoot, 'noop.js'))('playwright');
  }
}

const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+KR:wght@400;500;700;800&display=swap';
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FONTS}">
<style>html,body{margin:0;background:#000}canvas{display:block}</style></head>
<body><canvas id="c" width="1920" height="1080"></canvas><canvas id="w" width="1920" height="1080" hidden></canvas>
<script src="/reel.js"></script><script>
  const out = document.getElementById('c');
  const work = document.getElementById('w');
  const opts = ${JSON.stringify({ lang: args.lang, credit: args.credit, assetBase: '/assets/' })};
  const reel = KRPSAReel.create(work, opts);
  const octx = out.getContext('2d');
  // Average a few sub-frames across a 180° shutter for natural motion blur.
  window.frame = (t, samples, fps) => {
    for (let k = 0; k < samples; k++) {
      const dt = samples > 1 ? ((k + 0.5) / samples - 0.5) * (0.5 / fps) : 0;
      reel.render(Math.max(0, t + dt));
      octx.globalAlpha = 1 / (k + 1);
      octx.drawImage(work, 0, 0);
    }
    octx.globalAlpha = 1;
    return out.toDataURL('image/png').slice(22);
  };
  window.reelReady = reel.ready.then(() => document.fonts.ready);
</script></body></html>`;

const TYPES = { '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
      return;
    }
    const file = path.join(ROOT, path.normalize(decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT)) throw new Error('outside root');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
// Fetch web fonts with curl so they follow the system's proxy and CA settings.
const userAgent = await page.evaluate(() => navigator.userAgent);
const failedFonts = [];
await page.route(/fonts\.(googleapis|gstatic)\.com/, async (route) => {
  const url = route.request().url();
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { stdout } = await run('curl', ['-sSLf', '--max-time', '60', '-A', userAgent, url], { encoding: 'buffer', maxBuffer: 1 << 26 });
      return route.fulfill({ status: 200, body: stdout, contentType: url.includes('googleapis') ? 'text/css' : 'font/woff2', headers: { 'access-control-allow-origin': '*' } });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  failedFonts.push(url);
  console.error(`Font fetch failed after 4 attempts: ${url}\n  ${String(lastError?.stderr || lastError?.message || lastError).trim()}`);
  return route.abort();
});
page.on('pageerror', (error) => console.error(error));
await page.goto(base);
await page.evaluate(() => window.reelReady);

// reel.js swallows font errors so the site never stalls on them, which here
// would mean frames quietly set in system fallback fonts. Every weight the reel
// preloads must have a loaded face, and no face may have failed (a failed
// stylesheet leaves no faces at all; a failed woff2 subset leaves one in
// 'error'). document.fonts.check() cannot tell: Chromium answers true for a
// family it has no faces for.
async function fontProblems() {
  const { missing, errored } = await page.evaluate(() => {
    const faces = [...document.fonts];
    const name = (face) => face.family.replace(/["']/g, '');
    const wanted = [...['400', '500', '600', '700', '800'].map((w) => ['Inter', w]), ['Noto Sans KR', '500'], ['Noto Sans KR', '700']];
    return {
      missing: wanted
        .filter(([family, weight]) => !faces.some((f) => name(f) === family && String(f.weight) === weight && f.status === 'loaded'))
        .map(([family, weight]) => `${family} ${weight}`),
      errored: faces.filter((f) => f.status === 'error').map((f) => `${name(f)} ${f.weight} (${f.unicodeRange})`),
    };
  });
  return [...new Set([...failedFonts.map((url) => `fetch failed: ${url}`), ...missing.map((face) => `not loaded: ${face}`), ...errored.map((face) => `failed to load: ${face}`)])];
}
const allowFallback = args['allow-fallback-fonts'];
const listProblems = (problems) => problems.map((line) => `  ${line}`).join('\n');
const fontsBefore = await fontProblems();
if (fontsBefore.length && !allowFallback) {
  console.error(`Error: web fonts did not load, so the reel would be set in fallback fonts:\n${listProblems(fontsBefore)}\nCheck the network or proxy and retry, or pass --allow-fallback-fonts to render anyway.`);
  await browser.close();
  server.close();
  process.exit(1);
}
if (fontsBefore.length) console.warn(`Warning: rendering with fallback fonts (--allow-fallback-fonts):\n${listProblems(fontsBefore)}`);
const duration = await page.evaluate(() => KRPSAReel.DURATION);
const fps = Number(args.fps);
const blur = Number(args.blur);

if (args.stills) {
  await mkdir(args.dir, { recursive: true });
  for (const t of args.stills.split(',').map(Number)) {
    const png = await page.evaluate(([time, b, f]) => window.frame(time, b, f), [t, blur, fps]);
    const file = path.join(args.dir, `frame-${t.toFixed(2).padStart(5, '0')}.png`);
    await writeFile(file, Buffer.from(png, 'base64'));
    console.log(file);
  }
} else {
  if (!args.out) throw new Error('--out is required');
  const from = Number(args.from);
  const to = args.to ? Number(args.to) : duration;
  const count = Math.round((to - from) * fps);
  const ffArgs = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-'];
  if (args.audio) ffArgs.push('-ss', String(from), '-i', args.audio);
  ffArgs.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  if (args.audio) ffArgs.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  ffArgs.push(args.out);
  const ffmpeg = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  const started = Date.now();
  for (let k = 0; k < count; k++) {
    const png = await page.evaluate(([time, b, f]) => window.frame(time, b, f), [from + k / fps, blur, fps]);
    if (!ffmpeg.stdin.write(Buffer.from(png, 'base64'))) await new Promise((r) => ffmpeg.stdin.once('drain', r));
    if (k % fps === 0) console.log(`frame ${k}/${count} · ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
  ffmpeg.stdin.end();
  await new Promise((resolve, reject) => ffmpeg.on('close', (code) => (code ? reject(new Error(`ffmpeg exited ${code}`)) : resolve())));
  console.log(`Wrote ${args.out}`);
}
// A face first used mid-render loads lazily; report one that failed after the check.
const fontsAfter = (await fontProblems()).filter((problem) => !fontsBefore.includes(problem));
if (fontsAfter.length) {
  console.error(`${allowFallback ? 'Warning' : 'Error'}: web fonts failed during rendering, so some frames use fallback fonts:\n${listProblems(fontsAfter)}`);
  if (!allowFallback) process.exitCode = 1;
}
await browser.close();
server.close();
