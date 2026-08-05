import { CRUISER, DEFAULT_ENV, type Environment } from './sim/config';
import { initialState, step, type Controls, type Diagnostics, type SeaState } from './sim/boat';
import { solvePolar, type Polar } from './sim/polar';
import { WindField } from './sim/wind';
import { WaveField, sampleHull, type HullWaveSample } from './sim/waves';
import { MAX_REEF, autoReef, type ReefState } from './sim/sailplan';
import { DEG, RAD, clamp, compassVec, wrap2Pi } from './sim/math';
import { msToKnots } from './sim/units';
import { buildCourse, initialRaceState, updateRace, type RaceConfig } from './sim/race';
import {
  Ghost,
  Recorder,
  loadBest,
  loadGhost,
  saveBest,
  saveGhost,
  type GhostSample,
} from './sim/replay';
import { loadSettings, saveSettings, windMs } from './settings';
import { Input } from './input';
import { createScene } from './view/scene';
import { createHud } from './view/hud';
import { createRaceHud } from './view/racehud';
import { createMenu } from './view/menu';
import { SoundEngine } from './view/audio';

const cfg = CRUISER;
const settings = loadSettings();

/** The wind here and now, handed to step(). Resampled from the field each step. */
const env: Environment = { ...DEFAULT_ENV };
const wind = new WindField(windMs(settings), 0, settings.gustiness);
const waves = new WaveField(windMs(settings), 0);

// Buffers reused every physics step. Allocating per step would keep the GC busy
// at 120 Hz.
const hullWave: HullWaveSample = { heave: 0, pitchSlope: 0, rollSlope: 0, bowRise: 0 };
const sea: SeaState = { h13: 0, heave: 0, pitchSlope: 0, rollSlope: 0, dir: 0 };
let state = initialState();

const canvas = document.getElementById('view') as HTMLCanvasElement;
const view = createScene(canvas, cfg);
const ui = document.getElementById('ui')!;
const hud = createHud(ui);
const raceHud = createRaceHud(ui);
const menu = createMenu(ui, settings);
const input = new Input();
const sound = new SoundEngine();

// --- Race ------------------------------------------------------------------
const raceCfg = (): RaceConfig => ({
  legLength: settings.legLength,
  lineLength: 110,
  laps: settings.laps,
  countdown: settings.countdown,
});

let course = buildCourse(raceCfg(), wind.baseTwd);
let race = initialRaceState(raceCfg());
/** Free-sail mode skips race judging entirely. */
let racing = false;
const recorder = new Recorder();
let ghost: Ghost | null = loadGhost()?.ghost ?? null;
let best = loadBest();
const ghostSample: GhostSample = { x: 0, y: 0, heading: 0, heel: 0 };

// Browsers block audio until a user gesture, so start it on the first key or
// click.
//
// The AudioContext must be created here even when sound is switched off in
// settings. Turning it on later with M happens inside a requestAnimationFrame
// callback, which is not a gesture context, and a context created there stays
// suspended.
const kickAudio = () => {
  window.removeEventListener('keydown', kickAudio);
  window.removeEventListener('pointerdown', kickAudio);
};
window.addEventListener('keydown', kickAudio);
window.addEventListener('pointerdown', kickAudio);
sound.enabled = settings.sound;

window.addEventListener('resize', () => view.resize());

// --- Polar -----------------------------------------------------------------
// The browser runs the very same physics core to compute this. It takes a few
// hundred milliseconds, so it is debounced after a wind change.
let polar: Polar | null = null;
let polarTimer: number | null = null;

function schedulePolar(delay = 400): void {
  if (polarTimer !== null) clearTimeout(polarTimer);
  hud.setBusy(true);
  polarTimer = window.setTimeout(() => {
    polarTimer = null;
    // A polar must be based on the mean wind, not the instantaneous gust.
    polar = solvePolar(cfg, wind.meanEnv(DEFAULT_ENV));
    hud.setBusy(false);
  }, delay);
}

// --- Fixed timestep loop ---------------------------------------------------
// Physics only ever advances in PHYS_DT increments. Tie it to the render frame
// rate instead and every tuned number produces different results per machine.
const PHYS_DT = 1 / 120;
const MAX_CATCHUP = 0.25; // s, cap after a long stall such as a tab switch

let accumulator = 0;
let last = performance.now();
let diag: Diagnostics | null = null;

const ctl: Controls = { rudder: 0, sheet: 0, autoTrim: true };
const reefState: ReefState = { reef: 0, jibFurl: 0, timer: 0 };
let autoReefOn = true;

/** Rebuild wind, waves and course after a settings change. */
function applySettings(): void {
  wind.baseTws = windMs(settings);
  wind.gustiness = settings.gustiness;
  wind.shiftAmplitude = 0.19 * settings.gustiness * 2.2;
  waves.setFromWind(wind.baseTws * settings.seaScale, wind.baseTwd);
  saveSettings(settings);
  schedulePolar();
}

/** Put the boat on station below the start line. */
function placeAtStart(): void {
  const up = compassVec(wind.baseTwd);
  state = initialState({
    pos: { x: -up.x * 90, y: -up.y * 90 },
    heading: wrap2Pi(wind.baseTwd + 100 * DEG),
    u: 2.2,
  });
  reefState.reef = 0;
  reefState.jibFurl = 0;
  reefState.timer = 0;
  accumulator = 0;
  hud.telemetry.clear();
}

function startRace(): void {
  // Re-lay the course for the current wind, exactly as a race committee would.
  course = buildCourse(raceCfg(), wind.baseTwd);
  race = initialRaceState(raceCfg());
  racing = true;
  recorder.reset();
  placeAtStart();
}

function freeSail(): void {
  course = buildCourse(raceCfg(), wind.baseTwd);
  race = initialRaceState(raceCfg());
  racing = false;
  recorder.reset();
  placeAtStart();
}

menu.onAction((a) => {
  if (a === 'race') startRace();
  else if (a === 'freesail') freeSail();
});
menu.onSettingsChange(applySettings);

applySettings();
startRace();

/**
 * One physics step, shared by the frame loop and the debug hook. If they
 * diverged, what the console produces and what you actually play would differ.
 */
function physicsStep(): void {
  wind.update(PHYS_DT);
  // Wind is a function of position: sample it where the boat actually is.
  const w = wind.sample(state.pos);
  env.tws = w.tws;
  env.twd = w.twd;

  if (autoReefOn) autoReef(reefState, state.heel, PHYS_DT);
  state.reef = reefState.reef;
  state.jibFurl = reefState.jibFurl;

  // Sample four points on the hull to get the local water surface slope.
  waves.update(PHYS_DT);
  sampleHull(waves, state.pos.x, state.pos.y, state.heading, cfg.loa, cfg.beam, hullWave);
  sea.h13 = waves.sigWaveHeight;
  sea.heave = hullWave.heave;
  sea.pitchSlope = hullWave.pitchSlope;
  sea.rollSlope = hullWave.rollSlope;
  sea.dir = wind.baseTwd + Math.PI;

  diag = step(state, cfg, env, ctl, PHYS_DT, { sea });

  if (!racing) return;

  const wasFinished = race.phase === 'finished';
  updateRace(race, course, state.pos, PHYS_DT);
  if (race.phase === 'racing') {
    recorder.record(race.clock, state.pos.x, state.pos.y, state.heading, state.heel, PHYS_DT);
  }
  if (!wasFinished && race.phase === 'finished' && race.finishTime !== null) {
    // Only overwrite the ghost on a personal best. Replacing it with a slower
    // run would leave nothing worth chasing next time.
    const isBest = best === null || race.finishTime < best;
    if (isBest) {
      best = race.finishTime;
      saveBest(best);
      const data = recorder.toArray();
      saveGhost(data, race.finishTime);
      ghost = new Ghost(data);
    }
    menu.showResult(race, course, best, isBest);
  }
}

function frame(now: number): void {
  requestAnimationFrame(frame);

  const wall = Math.min((now - last) / 1000, MAX_CATCHUP);
  last = now;

  // --- One-shot keys ---
  // Only Esc is always live. If reefs changed or the race reset behind an open
  // menu, closing it would leave the player with no idea what happened.
  if (input.wasPressed('escape')) menu.toggle();
  if (menu.isOpen) {
    input.endFrame();
    render();
    return;
  }

  if (input.wasPressed('t')) input.autoTrim = !input.autoTrim;
  if (input.wasPressed('c')) view.toggleCamera();
  if (input.wasPressed('p')) schedulePolar(0);
  if (input.wasPressed('r')) (racing ? startRace : freeSail)();
  if (input.wasPressed('y')) autoReefOn = !autoReefOn;
  if (input.wasPressed('m')) {
    settings.sound = !settings.sound;
    sound.setEnabled(settings.sound);
    saveSettings(settings);
  }
  for (let i = 0; i <= MAX_REEF; i++) {
    if (input.wasPressed(String(i + 1))) {
      reefState.reef = i;
      autoReefOn = false;
    }
  }
  if (input.wasPressed('f')) {
    reefState.jibFurl = clamp(reefState.jibFurl + 0.25, 0, 1);
    autoReefOn = false;
  }
  if (input.wasPressed('g')) {
    reefState.jibFurl = clamp(reefState.jibFurl - 0.25, 0, 1);
    autoReefOn = false;
  }

  // --- Environment controls (mean wind) ---
  if (input.windShift !== 0) {
    wind.baseTwd = wrap2Pi(wind.baseTwd + input.windShift * 25 * DEG * wall);
    waves.setFromWind(wind.baseTws * settings.seaScale, wind.baseTwd);
  }
  if (input.windGust !== 0) {
    settings.windKnots = clamp(settings.windKnots + input.windGust * 12 * wall, 3, 40);
    applySettings();
  }

  ctl.rudder = input.rudder;
  ctl.sheet = input.sheet;
  ctl.autoTrim = input.autoTrim && ctl.sheet === 0;

  // --- Physics ---
  accumulator += wall;
  while (accumulator >= PHYS_DT) {
    physicsStep();
    accumulator -= PHYS_DT;
  }

  if (diag) {
    hud.telemetry.push(wall, [
      msToKnots(diag.speed),
      msToKnots(diag.vmg),
      Math.abs(state.heel) * RAD,
      msToKnots(env.tws),
    ]);
    sound.update(state, diag, env.tws, hullWave.bowRise, wall);
  }
  render();

  input.endFrame();
}

/** Drawing only. The scene must keep rendering even while the menu pauses time. */
function render(): void {
  if (diag) {
    const showGhost =
      racing &&
      ghost !== null &&
      race.phase === 'racing' &&
      ghost.sampleAt(race.clock, ghostSample);
    view.render({
      state,
      diag,
      wind,
      waves,
      course,
      race,
      ghost: showGhost ? ghostSample : null,
      dt: 1 / 60,
    });
    hud.update(state, diag, env, wind, waves, polar, {
      autoTrim: ctl.autoTrim,
      autoReef: autoReefOn,
      sound: settings.sound,
    });
    raceHud.update(
      race,
      course,
      state,
      diag,
      polar?.bestUpwind?.twa ?? null,
      best,
      racing,
    );
  }
}

// Development hook: poke wind, waves and boat state from the console.
declare global {
  interface Window {
    voyage: {
      readonly state: typeof state;
      cfg: typeof cfg;
      wind: typeof wind;
      waves: typeof waves;
      settings: typeof settings;
      setWind(knots: number, dirDeg?: number): void;
      advance(seconds: number, rudder?: number): void;
    };
  }
}

window.voyage = {
  get state() {
    return state;
  },
  cfg,
  wind,
  waves,
  settings,
  setWind(knots: number, dirDeg?: number) {
    settings.windKnots = knots;
    if (dirDeg !== undefined) wind.baseTwd = dirDeg * DEG;
    applySettings();
  },
  /**
   * Advance the physics by N seconds without rendering.
   * A backgrounded tab stops receiving requestAnimationFrame callbacks and the
   * simulation freezes, so this is how a specific moment -- a boat mid-tack,
   * say -- can be set up for a screenshot.
   */
  advance(seconds: number, rudder = 0) {
    const saved = ctl.rudder;
    ctl.rudder = rudder;
    const n = Math.min(Math.round(seconds / PHYS_DT), 120 * 900);
    for (let i = 0; i < n; i++) physicsStep();
    ctl.rudder = saved;
  },
};

requestAnimationFrame(frame);
