import { CRUISER, DEFAULT_ENV, type Environment } from './sim/config';
import {
  initialState,
  step,
  type BoatState,
  type Controls,
  type Diagnostics,
  type SeaState,
} from './sim/boat';
import { solvePolar, type Polar } from './sim/polar';
import { WindField } from './sim/wind';
import { WaveField, sampleHull, type HullWaveSample } from './sim/waves';
import { MAX_REEF, autoReef, type ReefState } from './sim/sailplan';
import { DEG, RAD, clamp, compassVec, wrap2Pi } from './sim/math';
import { msToKnots } from './sim/units';
import { buildCourse, initialRaceState, updateRace, type Course, type RaceState } from './sim/race';
import { EMPTY_TERRAIN, Terrain, generateArchipelago } from './sim/terrain';
import {
  Ghost,
  Recorder,
  loadBest,
  loadGhost,
  saveBest,
  saveGhost,
  type GhostSample,
} from './sim/replay';
import { windMs, type Settings } from './settings';
import { Input } from './input';
import { createScene, type SceneView } from './view/scene';
import { SoundEngine } from './view/audio';
import { Telemetry } from './view/telemetry';

/**
 * The simulation, the render loop and everything imperative.
 *
 * The UI is React, but this is not: a 120 Hz physics loop has no business going
 * through a reconciler. The engine owns the loop and publishes a single mutable
 * snapshot; the UI reads it every frame and writes numbers straight into the
 * DOM. React is only used for structure and for state that actually changes
 * rarely -- menus, race results, settings.
 */

export interface Snapshot {
  state: BoatState;
  diag: Diagnostics | null;
  env: Environment;
  wind: WindField;
  waves: WaveField;
  terrain: Terrain;
  course: Course;
  race: RaceState;
  polar: Polar | null;
  telemetry: Telemetry;
  best: number | null;
  racing: boolean;
  paused: boolean;
  autoTrim: boolean;
  autoReef: boolean;
  soundOn: boolean;
  polarBusy: boolean;
  /** Water depth here, m. Infinity in deep water. */
  depth: number;
  /** Depth under the keel, m. Negative means aground. */
  clearance: number;
}

export type EngineEvent =
  | { type: 'toggleMenu' }
  | { type: 'polar' }
  | { type: 'sound'; on: boolean }
  | { type: 'finished'; time: number; isBest: boolean };

export interface Engine {
  readonly snapshot: Snapshot;
  onFrame(cb: (s: Snapshot) => void): () => void;
  onEvent(cb: (e: EngineEvent) => void): () => void;
  startRace(): void;
  freeSail(): void;
  setPaused(paused: boolean): void;
  applySettings(s: Settings): void;
  toggleCamera(): void;
  recomputePolar(): void;
  resize(): void;
  dispose(): void;
  /** Development hook, exposed on window. */
  advance(seconds: number, rudder?: number): void;
}

const PHYS_DT = 1 / 120;
const MAX_CATCHUP = 0.25;

export function createEngine(canvas: HTMLCanvasElement, settings: Settings): Engine {
  const cfg = CRUISER;
  const env: Environment = { ...DEFAULT_ENV };
  const wind = new WindField(windMs(settings), 0, settings.gustiness);
  const waves = new WaveField(windMs(settings), 0);

  // Reused every physics step; allocating per step would keep the GC busy at 120 Hz.
  const hullWave: HullWaveSample = { heave: 0, pitchSlope: 0, rollSlope: 0, bowRise: 0 };
  const sea: SeaState = {
    h13: 0,
    heave: 0,
    pitchSlope: 0,
    rollSlope: 0,
    dir: 0,
    depth: Infinity,
  };

  let state = initialState();
  let course = buildCourse(raceCfg(settings), wind.baseTwd);
  let race = initialRaceState(raceCfg(settings));
  let racing = false;
  let paused = false;
  let current = settings;

  const view: SceneView = createScene(canvas, cfg);
  const input = new Input();
  const sound = new SoundEngine();
  const recorder = new Recorder();
  const telemetry = new Telemetry(
    [
      { label: 'BSP', color: '#4fd1c5', min: 0, max: 10 },
      { label: 'VMG', color: '#f6c667', min: -8, max: 8 },
      { label: 'HEEL', color: '#e07a8b', min: 0, max: 45 },
      { label: 'TWS', color: '#8fa8c0', min: 0, max: 35 },
    ],
    50,
  );

  let ghost: Ghost | null = loadGhost()?.ghost ?? null;
  let best = loadBest();
  const ghostSample: GhostSample = { x: 0, y: 0, heading: 0, heel: 0 };

  const snapshot: Snapshot = {
    state,
    diag: null,
    env,
    wind,
    waves,
    terrain: EMPTY_TERRAIN,
    course,
    race,
    polar: null,
    telemetry,
    best,
    racing,
    paused,
    autoTrim: true,
    autoReef: true,
    soundOn: settings.sound,
    polarBusy: false,
    depth: Infinity,
    clearance: Infinity,
  };

  const frameSubs = new Set<(s: Snapshot) => void>();
  const eventSubs = new Set<(e: EngineEvent) => void>();
  const emit = (e: EngineEvent) => eventSubs.forEach((f) => f(e));

  function raceCfg(s: Settings) {
    return {
      legLength: s.legLength,
      lineLength: 110,
      laps: s.laps,
      countdown: s.countdown,
    };
  }

  // Browsers block audio until a user gesture. The context must be created here
  // even when sound is off in settings: switching it on later happens inside a
  // requestAnimationFrame callback, which is not a gesture context, and a
  // context created there stays suspended.
  const kickAudio = () => {
    void sound.start();
    window.removeEventListener('keydown', kickAudio);
    window.removeEventListener('pointerdown', kickAudio);
  };
  window.addEventListener('keydown', kickAudio);
  window.addEventListener('pointerdown', kickAudio);
  sound.enabled = settings.sound;

  // --- Polar ----------------------------------------------------------------
  let polarTimer: number | null = null;
  function schedulePolar(delay = 400): void {
    if (polarTimer !== null) clearTimeout(polarTimer);
    snapshot.polarBusy = true;
    emit({ type: 'polar' });
    polarTimer = window.setTimeout(() => {
      polarTimer = null;
      // A polar must be based on the mean wind, not the instantaneous gust.
      snapshot.polar = solvePolar(cfg, wind.meanEnv(DEFAULT_ENV));
      snapshot.polarBusy = false;
      emit({ type: 'polar' });
    }, delay);
  }

  function rebuildWorld(): void {
    course = buildCourse(raceCfg(current), wind.baseTwd);
    race = initialRaceState(raceCfg(current));
    snapshot.course = course;
    snapshot.race = race;

    // Islands are deliberately placed near the course, not safely far from it.
    // An island two kilometres away is scenery; one a few hundred metres off
    // the layline is a decision.
    const terrain =
      current.islandCount > 0
        ? generateArchipelago({
            seed: current.seed,
            count: current.islandCount,
            keepClear: [course.start.a, course.start.b, course.windward.pos, course.leeward.pos],
            clearance: 130,
            minRange: current.legLength * 0.55,
            maxRange: current.legLength * 2.1,
            origin: { x: 0, y: current.legLength * 0.4 },
          })
        : EMPTY_TERRAIN;
    wind.terrain = terrain;
    snapshot.terrain = terrain;
    view.setTerrain(terrain);
  }

  const ctl: Controls = { rudder: 0, sheet: 0, autoTrim: true };
  const reefState: ReefState = { reef: 0, jibFurl: 0, timer: 0 };
  let autoReefOn = true;
  let accumulator = 0;
  let last = performance.now();
  let diag: Diagnostics | null = null;

  function applySettings(s: Settings): void {
    const worldChanged =
      s.islandCount !== current.islandCount ||
      s.seed !== current.seed ||
      s.legLength !== current.legLength ||
      s.laps !== current.laps;
    current = s;

    wind.baseTws = windMs(s);
    wind.gustiness = s.gustiness;
    wind.shiftAmplitude = 0.19 * s.gustiness * 2.2;
    waves.setFromWind(wind.baseTws * s.seaScale, wind.baseTwd);
    sound.setEnabled(s.sound);
    snapshot.soundOn = s.sound;
    if (worldChanged) rebuildWorld();
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
    snapshot.state = state;
    reefState.reef = 0;
    reefState.jibFurl = 0;
    reefState.timer = 0;
    accumulator = 0;
    telemetry.clear();
  }

  function startRace(): void {
    rebuildWorld();
    racing = true;
    snapshot.racing = true;
    recorder.reset();
    placeAtStart();
  }

  function freeSail(): void {
    rebuildWorld();
    racing = false;
    snapshot.racing = false;
    recorder.reset();
    placeAtStart();
  }

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
    // Land shelters the sea in its lee, so waves are scaled by the same shelter
    // term the water shader uses.
    waves.update(PHYS_DT);
    const shelter = snapshot.terrain.waveShelter(state.pos.x, state.pos.y, wind.baseTwd);
    sampleHull(
      waves,
      state.pos.x,
      state.pos.y,
      state.heading,
      cfg.loa,
      cfg.beam,
      hullWave,
      shelter,
    );
    sea.h13 = waves.sigWaveHeight * shelter;
    sea.heave = hullWave.heave;
    sea.pitchSlope = hullWave.pitchSlope;
    sea.rollSlope = hullWave.rollSlope;
    sea.dir = wind.baseTwd + Math.PI;
    sea.depth = snapshot.terrain.depthAt(state.pos.x, state.pos.y);
    snapshot.depth = sea.depth;
    snapshot.clearance = sea.depth - cfg.draft;

    diag = step(state, cfg, env, ctl, PHYS_DT, { sea });
    snapshot.diag = diag;

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
        snapshot.best = best;
        saveBest(best);
        const data = recorder.toArray();
        saveGhost(data, race.finishTime);
        ghost = new Ghost(data);
      }
      emit({ type: 'finished', time: race.finishTime, isBest });
    }
  }

  let raf = 0;
  function frame(now: number): void {
    raf = requestAnimationFrame(frame);

    const wall = Math.min((now - last) / 1000, MAX_CATCHUP);
    last = now;

    // Escape opens the menu, but only while the world is running: once the
    // dialog is up it owns Escape, and handling it in both places would toggle
    // twice and immediately reopen what the player just closed.
    if (!paused && input.wasPressed('escape')) emit({ type: 'toggleMenu' });

    if (!paused) {
      handleKeys(wall);

      ctl.rudder = input.rudder;
      ctl.sheet = input.sheet;
      ctl.autoTrim = input.autoTrim && ctl.sheet === 0;
      snapshot.autoTrim = ctl.autoTrim;

      accumulator += wall;
      while (accumulator >= PHYS_DT) {
        physicsStep();
        accumulator -= PHYS_DT;
      }

      if (diag) {
        telemetry.push(wall, [
          msToKnots(diag.speed),
          msToKnots(diag.vmg),
          Math.abs(state.heel) * RAD,
          msToKnots(env.tws),
        ]);
        sound.update(state, diag, env.tws, hullWave.bowRise, wall);
      }
    }

    render(wall);
    input.endFrame();
    frameSubs.forEach((f) => f(snapshot));
  }

  function handleKeys(wall: number): void {
    if (input.wasPressed('t')) input.autoTrim = !input.autoTrim;
    if (input.wasPressed('c')) view.toggleCamera();
    if (input.wasPressed('p')) schedulePolar(0);
    if (input.wasPressed('r')) (racing ? startRace : freeSail)();
    if (input.wasPressed('y')) {
      autoReefOn = !autoReefOn;
      snapshot.autoReef = autoReefOn;
    }
    if (input.wasPressed('m')) {
      const on = !snapshot.soundOn;
      snapshot.soundOn = on;
      sound.setEnabled(on);
      // Tell React so the change is persisted with the rest of the settings.
      emit({ type: 'sound', on });
    }
    for (let i = 0; i <= MAX_REEF; i++) {
      if (input.wasPressed(String(i + 1))) {
        reefState.reef = i;
        autoReefOn = false;
        snapshot.autoReef = false;
      }
    }
    if (input.wasPressed('f')) {
      reefState.jibFurl = clamp(reefState.jibFurl + 0.25, 0, 1);
      autoReefOn = false;
      snapshot.autoReef = false;
    }
    if (input.wasPressed('g')) {
      reefState.jibFurl = clamp(reefState.jibFurl - 0.25, 0, 1);
      autoReefOn = false;
      snapshot.autoReef = false;
    }

    if (input.windShift !== 0) {
      wind.baseTwd = wrap2Pi(wind.baseTwd + input.windShift * 25 * DEG * wall);
      waves.setFromWind(wind.baseTws * current.seaScale, wind.baseTwd);
    }
    if (input.windGust !== 0) {
      current = {
        ...current,
        windKnots: clamp(current.windKnots + input.windGust * 12 * wall, 3, 40),
      };
      applySettings(current);
    }
  }

  function render(dt: number): void {
    if (!diag) return;
    const showGhost =
      racing && ghost !== null && race.phase === 'racing' && ghost.sampleAt(race.clock, ghostSample);
    view.render({
      state,
      diag,
      wind,
      waves,
      course,
      race,
      ghost: showGhost ? ghostSample : null,
      dt,
    });
  }

  applySettings(settings);
  rebuildWorld();
  startRace();
  // Prime the diagnostics with a single step. The game opens with the menu up,
  // which pauses the physics -- without this the scene has nothing to draw and
  // the player is greeted by a black canvas behind the dialog.
  physicsStep();
  schedulePolar(50);
  raf = requestAnimationFrame(frame);

  return {
    snapshot,
    onFrame(cb) {
      frameSubs.add(cb);
      return () => frameSubs.delete(cb);
    },
    onEvent(cb) {
      eventSubs.add(cb);
      return () => eventSubs.delete(cb);
    },
    startRace,
    freeSail,
    setPaused(p) {
      paused = p;
      snapshot.paused = p;
      // Reset the clock so unpausing does not jump the world forward.
      last = performance.now();
      accumulator = 0;
    },
    applySettings,
    toggleCamera: () => view.toggleCamera(),
    recomputePolar: () => schedulePolar(0),
    resize: () => view.resize(),
    dispose() {
      cancelAnimationFrame(raf);
      input.dispose();
      sound.dispose();
      view.dispose();
      if (polarTimer !== null) clearTimeout(polarTimer);
    },
    advance(seconds, rudder = 0) {
      const saved = ctl.rudder;
      ctl.rudder = rudder;
      const n = Math.min(Math.round(seconds / PHYS_DT), 120 * 900);
      for (let i = 0; i < n; i++) physicsStep();
      ctl.rudder = saved;
    },
  };
}
