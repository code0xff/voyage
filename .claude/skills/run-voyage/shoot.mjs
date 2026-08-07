#!/usr/bin/env node
/**
 * Screenshot the simulator under chosen conditions.
 *
 *   node shoot.mjs '<json>' [outDir]
 *
 * The JSON is an array of cases, each `{ label, settings, pitch, seconds }`:
 *
 *   label     file name stem for the two PNGs this writes
 *   settings  overrides merged into DEFAULT_SETTINGS (see src/settings.ts)
 *   pitch     pixels to drag the camera by. Negative looks up, at the sky.
 *   seconds   how long to let the world run before the shot. Default 2.5.
 *
 * Writes `<label>.png` (the whole window) and `<label>-sky.png` (a crop of the
 * sky above the horizon, which is where the small stuff lives and is not
 * legible in a full-frame shot).
 *
 * Deliberately drives the app through localStorage rather than the settings
 * dialog. Every condition worth testing -- hour, weather, wind, tide -- is a
 * persisted setting, and clicking through the menu for each one is a lot of
 * fragile selector work to arrive at the same place.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/*
 * Playwright is resolved by path, not by name.
 *
 * It is deliberately not a dependency of this project -- it is a screenshot
 * tool, not something the simulator needs to build or ship -- so it gets
 * installed outside the repo. A bare `import 'playwright'` then fails, because
 * ESM resolves from the importing file's directory upwards and never sees it.
 * NODE_PATH does not help either: that is a CommonJS mechanism and ESM ignores
 * it, which is worth knowing because it fails in a way that looks like a bad
 * install rather than like the wrong lookup.
 */
const external = process.env.PLAYWRIGHT_HOME;
const pw = await import(
  external
    ? pathToFileURL(path.join(external, 'node_modules/playwright/index.js')).href
    : 'playwright'
);
// Imported by file path, the package is CommonJS and its named exports do not
// always survive the interop -- so take the default's `chromium` when the
// namespace has none of its own, rather than failing on `undefined.launch`.
const chromium = pw.chromium ?? pw.default?.chromium;
if (!chromium) throw new Error('playwright resolved but exports no chromium');

const URL = process.env.VOYAGE_URL ?? 'http://localhost:1852/';
const cases = JSON.parse(process.argv[2] ?? '[]');
const outDir = process.argv[3] ?? './shots';

if (!cases.length) {
  console.error('nothing to shoot: pass a JSON array of cases');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

/**
 * The Playwright package and the browser build in the cache are versioned
 * separately, and a package that wants a build the cache does not have refuses
 * to launch rather than using the one that is there. Take whatever is cached.
 */
function browserPath() {
  try {
    const own = chromium.executablePath();
    if (existsSync(own)) return own;
  } catch {
    // No bundled browser at all; fall through to the cache.
  }
  const roots = [
    path.join(homedir(), 'Library/Caches/ms-playwright'),
    path.join(homedir(), '.cache/ms-playwright'),
  ].filter(existsSync);
  for (const root of roots) {
    const builds = readdirSync(root)
      .filter((d) => d.startsWith('chromium-'))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const b of builds) {
      const candidates = [
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-linux/chrome',
      ];
      for (const c of candidates) {
        const p = path.join(root, b, c);
        if (existsSync(p)) return p;
      }
    }
  }
  throw new Error('no chromium found; run `npx playwright install chromium`');
}

/** Mirrors DEFAULT_SETTINGS, with the clock stopped and the world pinned. */
const BASE = {
  windKnots: 12,
  gustiness: 0.45,
  seaScale: 1,
  driftKnots: 0,
  setDeg: 90,
  // Off, or every run makes noise at whoever is watching.
  sound: false,
  startHour: 13,
  // Zero, so the shot is of the conditions asked for and not of whatever the
  // world had drifted into by the time the camera was pointed.
  timeScale: 0,
  weatherMode: 'clear',
  islandCount: 0,
  seed: 20260806,
  randomWorld: false,
};

const browser = await chromium.launch({
  executablePath: browserPath(),
  // SwiftShader: there is no GPU in a headless run, and the water and sky are
  // both custom shaders. Without this the canvas comes back blank.
  args: ['--use-angle=default', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

let failed = 0;
for (const c of cases) {
  const { label, settings = {}, pitch = 0, seconds = 2.5, keys = [] } = c;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  await ctx.addInitScript((s) => {
    localStorage.setItem('voyage.settings.v2', JSON.stringify(s));
  }, { ...BASE, ...settings });

  const page = await ctx.newPage();
  const errors = [];
  // /favicon.ico is a 404 in dev and always will be; it is not a symptom.
  // Matched on the location rather than the text: a failed request logs
  // "Failed to load resource: ... 404", which names no URL at all, and a filter
  // reading only the text lets it through as if it were a real error.
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const where = m.location()?.url ?? '';
    if (/favicon\.ico/.test(where)) return;
    errors.push(`${m.text()} ${where}`.trim());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 20000 });

  // The opening menu does not take Escape -- it wants a choice.
  await page.getByRole('button', { name: /Put to sea/ }).click();
  await page.waitForTimeout(1200);

  // Anything the keyboard drives and no setting does: `c` for the top-down
  // camera, `n` for the chart range, `h` for the autopilot.
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(250);
  }

  // The chase camera looks along the boat's heading, which puts the horizon
  // low and the sky mostly out of frame. Orbit it up.
  if (pitch) {
    await page.mouse.move(640, 400);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(640, 400 + (pitch * i) / 10);
    await page.mouse.up();
  }
  await page.waitForTimeout(seconds * 1000);

  await page.screenshot({ path: path.join(outDir, `${label}.png`) });
  await page.screenshot({
    path: path.join(outDir, `${label}-sky.png`),
    clip: { x: 300, y: 0, width: 640, height: 320 },
  });

  if (errors.length) failed++;
  console.log(`${label}  ${errors.length ? `FAILED: ${errors.slice(0, 3).join(' | ')}` : 'ok'}`);
  await ctx.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
