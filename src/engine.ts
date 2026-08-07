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
import { CurrentField, DEFAULT_FULL_DEPTH } from './sim/current';
import { venueById } from './sim/venues';
import { passageInfo, type PassageInfo, type PassageRecord } from './sim/passage';
import { anchorage, type Anchorage } from './sim/anchorage';
import { PassageLog } from './sim/passage';
import { logbook } from './logbook';
import { WaveField, sampleHull, type HullWaveSample } from './sim/waves';
import { MAX_REEF, autoReef, type ReefState } from './sim/sailplan';
import { cyclePilot, initialPilot, pilotRudder, type PilotState } from './sim/autopilot';
import { DEG, RAD, approach, clamp, compassVec, wrap2Pi, wrapPi, type Vec2 } from './sim/math';
import { msToKnots } from './sim/units';
import { buildCourse, initialRaceState, updateRace, type Course, type RaceState } from './sim/race';
import {
  EMPTY_TERRAIN,
  IslandField,
  MAX_DENSITY,
  Terrain,
  sameIslands,
  type Island,
} from './sim/terrain';
import { hoursUntilSunset, skyState, type SkyState } from './sim/sky';
import { Wildlife } from './sim/wildlife';
import { Weather } from './sim/weather';
import {
  Ghost,
  Recorder,
  loadBest,
  loadGhost,
  saveBest,
  saveGhost,
  type GhostSample,
} from './sim/replay';
import { currentVec, windMs, type Settings } from './settings';
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
  /**
   * The tidal streams. Published whole rather than as a flag, because the two
   * readouts that switch themselves off in a tide have to ask about the world
   * and not about the water under the boat: `env.current` goes slack every time
   * she crosses into the shallows, and a polar marker blinking on and off as
   * she does would be worse than either answer.
   */
  currents: CurrentField;
  waves: WaveField;
  terrain: Terrain;
  course: Course;
  race: RaceState;
  sky: SkyState;
  weather: Weather;
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
  /** Where the ghost is right now, or null when there is nothing to chase. */
  ghost: GhostSample | null;
  /** Distance sailed over the ground since this session began, m. */
  run: number;
  /** Increments whenever a new session starts. A view can reset its own state on it. */
  session: number;
  pilot: PilotState;
  /** Whether the boat is showing her lights. */
  lightsOn: boolean;
  /**
   * Real seconds until sunset, or Infinity with the clock stopped.
   *
   * Real seconds, not world ones, so it can be compared with an arrival time
   * directly. The boat moves in real time and the sun at the time scale, so the
   * two are only the same number at 1x -- and "do I get there before dark" is
   * meaningless until they are in the same units.
   */
  darkIn: number;
  /** Whether the anchor is down. */
  anchored: boolean;
  /** Where she could lie here, and what is stopping her if she cannot. */
  anchorage: Anchorage | null;
  /** Where she is bound, or null when she is just out sailing. */
  destination: Vec2 | null;
  /**
   * The navigation to that destination, recomputed every step.
   *
   * Null when there is nowhere to be, which is a state worth having rather than
   * a gap to fill: sailing about with no destination is the default, and the
   * readouts hide themselves rather than showing zeroes.
   */
  passage: PassageInfo | null;
}

export type EngineEvent =
  | { type: 'toggleMenu' }
  | { type: 'polar' }
  | { type: 'sound'; on: boolean }
  /** A fresh world was rolled. The settings hold the seed so it can be sailed again. */
  | { type: 'world'; seed: number }
  /** `N` was pressed: the chart should step to its next range. */
  | { type: 'chartRange' }
  /** A passage was completed and written to the logbook. */
  | { type: 'arrived'; record: PassageRecord }
  | { type: 'finished'; time: number; isBest: boolean };

export interface Engine {
  readonly snapshot: Snapshot;
  onFrame(cb: (s: Snapshot) => void): () => void;
  onEvent(cb: (e: EngineEvent) => void): () => void;
  startRace(): void;
  freeSail(): void;
  /** Point her at somewhere, or pass null to just go sailing. */
  setDestination(pos: Vec2 | null): void;
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
/**
 * How far the boat must travel before the island window is re-collected, m.
 * The window reaches kilometres, so being a hundred metres late to load an
 * island is invisible, and it keeps the cell scan off the per-step path.
 */
const STREAM_STEP = 100;
/** How far the mean wind must turn before the island window is re-ranked, rad. */
const STREAM_TURN = 8 * DEG;
/**
 * How fast the keys move the helm, in fractions of full deflection per second:
 * slowly near amidships, faster the further over it already is.
 *
 * The two jobs the helm has are four decibels apart. Holding a course against
 * this boat's round-up needs about half a degree of rudder -- steady weather
 * helm, carried all day. Tacking needs thirty-five. At any one rate the short
 * tap a hand can actually produce is either eight times too much for the first
 * or the throw takes far too long for the second.
 *
 * So the rate grows with the angle already on. From amidships a tap is a
 * fraction of a degree, which is the trim the old momentary helm could not
 * express at all; once it is over, it keeps moving, and hard over takes under
 * two seconds.
 */
const HELM_CREEP = 0.12;
const HELM_GAIN = 1.5;
/**
 * How long the sea takes to catch up with a change in the wind, in world
 * seconds. Twenty minutes of world time -- twenty seconds of play at the
 * default scale -- which is quick for a real sea and slow enough that a squall
 * arrives as wind first and waves after, in that order, as it should.
 */
const SEA_BUILD_TAU = 1200;
const MAX_CATCHUP = 0.25;

export function createEngine(canvas: HTMLCanvasElement, settings: Settings): Engine {
  const cfg = CRUISER;
  const env: Environment = { ...DEFAULT_ENV };
  const wind = new WindField(windMs(settings), 0, settings.gustiness);
  const currents = new CurrentField({ peak: currentVec(settings) });
  const waves = new WaveField(windMs(settings), 0);
  const weather = new Weather(settings.seed, 'fair');
  const wildlife = new Wildlife(settings.seed);

  // Reused every physics step; allocating per step would keep the GC busy at 120 Hz.
  const hullWave: HullWaveSample = { heave: 0, pitchSlope: 0, rollSlope: 0 };
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
  let hour = settings.startHour;
  let run = 0;
  /** Bumped on every new session, so view-side caches know to start over. */
  let session = 0;
  /** The wind the wave field is currently built from; it lags the real one. */
  let seaTws = windMs(settings);
  const pilot = initialPilot();
  let destination: Vec2 | null = null;
  let anchored = false;
  /** The passage under way, or null when she is just out sailing. */
  let log: PassageLog | null = null;
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
    anchored: false,
    anchorage: null,
    darkIn: Infinity,
    destination: null,
    passage: null,
    env,
    wind,
    currents,
    waves,
    terrain: EMPTY_TERRAIN,
    course,
    race,
    sky: skyState(hour),
    weather,
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
    ghost: null,
    run: 0,
    session: 0,
    pilot,
    lightsOn: true,
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

  // --- Course and terrain ---------------------------------------------------
  /** The endless ocean this session is sailing in, or null for open water. */
  let field: IslandField | null = null;
  /** The islands currently loaded, so a refresh that changes nothing costs nothing. */
  let activeIslands: readonly Island[] = [];
  let visibleIslands: readonly Island[] = [];
  /** The venue's land, or EMPTY_TERRAIN in the open ocean. Fixed for a session. */
  let venueTerrain: Terrain = EMPTY_TERRAIN;
  let streamedFrom = { x: Infinity, y: Infinity };
  let streamedTwd = Infinity;
  /**
   * Whether the current field has ever been published.
   *
   * Without it, a rebuilt world whose first window happens to be empty compares
   * equal to the cleared lists -- two empty arrays always match -- and the
   * early-out below leaves the *previous* world's terrain installed in the
   * snapshot, the wind and the scene. Sailing a new low-density seed then meant
   * feeling and seeing islands from the race before.
   */
  let published = false;

  function rebuildWorld(): void {
    // The world she was sailing in is being replaced, so the passage through it
    // is over whether or not she moved. `arrive()` stamps a record with the
    // venue that is current when the anchor goes down, so a passage carried
    // across a venue change would be filed under a place most of it did not
    // happen in.
    setDestination(null);

    course = buildCourse(raceCfg(current), wind.baseTwd);
    race = initialRaceState(raceCfg(current));
    snapshot.course = course;
    snapshot.race = race;

    // The sea is endless and the same everywhere, so islands are as likely to
    // be on the course as anywhere else -- which is the point. An island two
    // kilometres away is scenery; one a few hundred metres off the layline is a
    // decision. Only the marks themselves and the starting position are kept
    // clear, so that a race is always sailable.
    // A venue brings its own land, fixed and known, so there is nothing to
    // stream: the whole place is always loaded. The procedural field is the
    // other case, an endless ocean that has to be looked at through a window.
    const venue = venueById(current.venue);
    venueTerrain = venue ? new Terrain(venue.islands) : EMPTY_TERRAIN;
    currents.fullDepth = venue ? venue.fullDepth : DEFAULT_FULL_DEPTH;

    const up = compassVec(wind.baseTwd);
    field =
      !venue && current.islandCount > 0
        ? new IslandField({
            seed: current.seed,
            // The slider is 0..10 islands' worth of thickness, not a count: in
            // an endless ocean there is no total to set. Ten is MAX_DENSITY,
            // which is not a round number but the thickest sea the island
            // window is measured to handle without leaving anything out.
            density: (current.islandCount / 10) * MAX_DENSITY,
            keepClear: [
              course.start.a,
              course.start.b,
              course.windward.pos,
              course.leeward.pos,
              { x: -up.x * 90, y: -up.y * 90 },
            ],
            clearance: 130,
          })
        : null;

    activeIslands = [];
    visibleIslands = [];
    published = false;
    streamedFrom = { x: Infinity, y: Infinity };
    streamWorld(state.pos.x, state.pos.y);
  }

  /**
   * Slide the loaded window of islands along with the boat.
   *
   * Re-collecting on every step would be wasted work -- the window only changes
   * when the boat has actually gone somewhere -- and rebuilding the meshes when
   * the same islands come back would hitch the frame. So this runs on distance
   * travelled, and then only does anything if the island set really differs.
   */
  function streamWorld(x: number, y: number): void {
    if (!field) {
      // Either open water or a venue, and both are the same job: one fixed
      // terrain, installed once and never slid along.
      if (!published || snapshot.terrain !== venueTerrain) {
        activeIslands = [];
        visibleIslands = [];
        published = true;
        wind.terrain = venueTerrain;
        // The stream needs the same land the wind does: it is the depth that
        // decides where it runs, and it must never be reading last world's.
        currents.terrain = venueTerrain;
        snapshot.terrain = venueTerrain;
        view.setTerrain(venueTerrain, venueTerrain);
      }
      return;
    }
    // Distance is the usual trigger, but the window also depends on the wind:
    // which land is worth keeping when the window is full is a question about
    // where the wakes point. Turn the wind far enough and it has to be asked
    // again even if the boat has not moved a metre.
    const turned = Math.abs(wrapPi(wind.baseTwd - streamedTwd));
    if (Math.hypot(x - streamedFrom.x, y - streamedFrom.y) < STREAM_STEP && turned < STREAM_TURN) {
      return;
    }
    streamedFrom = { x, y };
    streamedTwd = wind.baseTwd;

    // The two windows are checked separately. The drawn one is the larger, so
    // land can enter it -- and has to be built -- long before it is close
    // enough to be felt, and equally land can drop out of the physics window
    // while still very much in sight.
    const active = field.active(x, y, wind.baseTwd);
    const visible = field.visible(x, y);
    if (published && sameIslands(active, activeIslands) && sameIslands(visible, visibleIslands)) {
      return;
    }
    activeIslands = active;
    visibleIslands = visible;
    published = true;

    const terrain = new Terrain(active);
    wind.terrain = terrain;
    currents.terrain = terrain;
    snapshot.terrain = terrain;
    view.setTerrain(terrain, new Terrain(visible));
  }

  const ctl: Controls = { rudder: 0, sheet: 0, twist: 0, autoTrim: true };
  const reefState: ReefState = { reef: 0, jibFurl: 0, timer: 0 };
  let autoReefOn = true;
  let accumulator = 0;
  let last = performance.now();
  let diag: Diagnostics | null = null;

  function applySettings(s: Settings): void {
    const venueChanged = s.venue !== current.venue;
    const worldChanged =
      s.islandCount !== current.islandCount ||
      venueChanged ||
      s.seed !== current.seed ||
      s.legLength !== current.legLength ||
      s.laps !== current.laps;
    current = s;

    // Arriving at a venue brings its breeze with it, and it has to land before
    // the world is rebuilt below: the land is laid out around that direction,
    // and rebuildWorld() builds the course from whatever `baseTwd` says. Left
    // to the new-session path alone, picking a venue mid-session laid its shore
    // out for one wind and set the beat by another. Only on arrival, so that
    // Q/E still work afterwards and editing the leg length does not undo them.
    if (venueChanged) {
      const arriving = venueById(s.venue);
      if (arriving) wind.baseTwd = arriving.windTwd;
    }

    wind.baseTws = windMs(s) * weather.state.windScale;
    // The tide is not weather: it runs at the rate it runs whatever the front
    // overhead is doing, so it is set straight from the player's number and
    // never scaled by `weather.state`. This is the rate in deep water; where
    // the boat actually is, the field decides.
    currents.peak = currentVec(s);
    wind.gustiness = s.gustiness * weather.state.gustScale;
    wind.shiftAmplitude = 0.19 * s.gustiness * 2.2;
    waves.setFromWind(wind.baseTws * s.seaScale, wind.baseTwd);
    weather.evolve = s.weatherMode === 'auto';
    if (s.weatherMode !== 'auto') weather.set(s.weatherMode);
    sound.setEnabled(s.sound);
    snapshot.soundOn = s.sound;
    if (worldChanged) {
      // rebuildWorld() puts the course and the race back to the prestart, but
      // the boat stays where she was. Carrying on from there is not the race
      // that was interrupted and not a fresh one either, so the edit ends it
      // and what is left is a free sail in the new world.
      racing = false;
      snapshot.racing = false;
      rebuildWorld();
    }
    schedulePolar();
  }

  /** Put the boat on station below the start line. */
  function placeAtStart(): void {
    // She is about to be picked up and put somewhere else, and a passage cannot
    // survive that: the log integrates the distance she sails, so a teleport
    // would write a record whose track is shorter than the straight line
    // between its own two ends. Abandoning is the only honest answer -- the
    // passage did not happen.
    setDestination(null);
    // And the anchor comes up with her. It is engine state rather than boat
    // state, so a fresh `initialState()` does not clear it -- leaving her held
    // fast on the start line of a race she had just been put on, with the hint
    // bar cheerfully reporting that she was at anchor.
    anchored = false;
    snapshot.anchored = false;

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
    // The helm persists now, so a race must not start with the last one's
    // correction still wound on -- nor with the pilot steering to a course
    // from a world that no longer exists.
    ctl.rudder = 0;
    pilot.mode = 'off';
    accumulator = 0;
    telemetry.clear();
    run = 0;
    snapshot.run = 0;
    // The boat has just teleported. Load the sea it landed in before the next
    // frame draws the one it came from.
    streamWorld(state.pos.x, state.pos.y);
  }

  /**
   * A new sea for a new race, unless the player has pinned one.
   *
   * Sailing the identical archipelago every time was the single thing that made
   * an endless ocean feel small: whatever the boat did, the same island was
   * always off the same layline. The rolled seed is written back to the
   * settings, so a world worth keeping can be pinned and sailed again.
   *
   * The weather restarts from the seed whether it was rolled or pinned. It is
   * as much a part of the world as the land -- more, on a day when a front
   * comes through -- and a seed that reproduced the islands but not the fronts
   * would be reproducible to look at rather than to sail.
   */
  function newSession(): void {
    if (current.randomWorld) {
      const seed = Math.floor(Math.random() * 1e8) + 1;
      current = { ...current, seed };
      emit({ type: 'world', seed });
    }
    // The clock belongs to the session too. `hour` was read once when the
    // engine was built, so the Start hour setting did nothing after the first
    // load and every race began wherever the last one's clock had wandered to.
    hour = current.startHour;
    // So does the wind's direction at a venue. It has no slider -- the land is
    // laid out around it, and a beat that started on a random bearing would put
    // the course somewhere the place was not designed for. Free to shift with
    // Q/E afterwards, like anywhere else.
    const venue = venueById(current.venue);
    if (venue) wind.baseTwd = venue.windTwd;
    session++;
    snapshot.session = session;
    weather.reseed(current.seed);
    // A new session starts with the sea its weather implies, not the one the
    // last race left behind.
    seaTws = windMs(current) * weather.state.windScale;
    weather.evolve = current.weatherMode === 'auto';
    if (current.weatherMode !== 'auto') weather.set(current.weatherMode);
    rebuildWorld();
  }

  function setDestination(pos: Vec2 | null): void {
    // A passage begins the moment she is pointed at somewhere, and is abandoned
    // rather than recorded if the destination is cleared or moved. Half a
    // passage to somewhere the player changed their mind about is not a passage,
    // and a logbook of them would be worth nothing.
    log = pos ? new PassageLog({ ...state.pos }, pos, Date.now()) : null;
    destination = pos;
    snapshot.destination = pos;
    // Cleared immediately rather than left to the next step, so a readout that
    // reads between now and then does not show the passage to a place the boat
    // is no longer bound for.
    if (!pos) snapshot.passage = null;
  }

  /**
   * How near the destination the anchor has to go down for the passage to count
   * as made, m.
   *
   * Generous, because an anchorage is a place and not a point: the player picks
   * a spot on a chart and then finds the water that will actually hold her,
   * which is never the pixel they clicked. Anchoring further off than this is
   * simply anchoring -- the passage stays open and she can weigh and carry on.
   */
  const ARRIVED = 150;

  /** Close the passage if this is where it was going, and write it down. */
  function arrive(): void {
    if (!log || !destination) return;
    if (Math.hypot(state.pos.x - destination.x, state.pos.y - destination.y) > ARRIVED) return;

    const record = log.finish(
      // crypto.randomUUID is the browser's, so it stays out of the sim core --
      // which is also why PassageLog takes an id rather than making one.
      crypto.randomUUID(),
      { ...state.pos },
      current.venue,
    );
    log = null;
    setDestination(null);
    // Written without waiting: a failed write must not stall the physics loop,
    // and a logbook that quietly lost one passage is better than a frame hitch.
    void logbook.add(record).catch(() => undefined);
    emit({ type: 'arrived', record });
  }

  function startRace(): void {
    newSession();
    racing = true;
    snapshot.racing = true;
    recorder.reset();
    placeAtStart();
  }

  function freeSail(): void {
    newSession();
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
    // Load the land around wherever the boat is now, before anything asks what
    // is under it. Restarting teleports the boat, and reading the depth from
    // the window belonging to the last position would ground it on land it has
    // already left.
    streamWorld(state.pos.x, state.pos.y);

    // Time of day. timeScale is "simulated minutes per real minute".
    hour += (PHYS_DT / 3600) * current.timeScale;
    // Weather keeps world time, not wall-clock time: a front takes hours to
    // come through, and those are the same hours the sun is moving through.
    // Its transitions are eased in real seconds, though -- how fast a squall
    // *looks* like it arrives is a matter of what reads as weather rather than
    // as a glitch, and that does not speed up just because the clock does.
    weather.update(PHYS_DT, PHYS_DT * current.timeScale);

    // Weather drives the mean wind, so re-derive it every step rather than
    // only when a setting changes.
    wind.baseTws = windMs(current) * weather.state.windScale;
    wind.gustiness = current.gustiness * weather.state.gustScale;

    // ...and the sea has to follow the wind that is now blowing over it. The
    // wave field was only rebuilt when a setting moved, so once the weather
    // started turning inside a session a squall raised the wind, the whitecaps
    // and the ripple while the swell, the added resistance and the depth of
    // water the hull sampled all stayed at the last condition's height.
    //
    // Not instantly, though. A sea is fetch- and duration-limited: it takes a
    // long while to get up and longer to lie down, and swell that tracked every
    // gust would be a worse lie than swell that ignored the front. So the wind
    // the waves are built from lags the real one, on world time, because
    // building a sea is a thing the world does and not the screen.
    seaTws = approach(seaTws, wind.baseTws, SEA_BUILD_TAU, PHYS_DT * current.timeScale);
    waves.setFromWind(seaTws * current.seaScale, wind.baseTwd);

    wind.update(PHYS_DT);
    // Wind is a function of position: sample it where the boat actually is.
    const w = wind.sample(state.pos);
    env.tws = w.tws;
    env.twd = w.twd;
    // And the stream where she is, for the same reason: it is not the same
    // across the course, and sampling it anywhere but under the boat would
    // hand her a tide she is not in.
    env.current = currents.sample(state.pos);

    // The pilot steers at the physics rate, from the wind where the boat is,
    // so in wind mode it follows the shift she is actually in.
    if (pilot.mode !== 'off') {
      ctl.rudder = pilotRudder(pilot, state.heading, env.twd, state.r);
    }

    if (autoReefOn) autoReef(reefState, state.heelAvg, state.heel, PHYS_DT);
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

    const wasX = state.pos.x;
    const wasY = state.pos.y;
    // Gulls run on the physics clock, so a boat that is standing in towards a
    // shore hears them come up at the rate she is closing it.
    wildlife.update(PHYS_DT, state.pos, snapshot.terrain);
    for (const ev of wildlife.events) {
      const d = Math.hypot(ev.pos.x - state.pos.x, ev.pos.y - state.pos.y);
      sound.gullCall(d, ev.strength);
    }

    diag = step(state, cfg, env, ctl, PHYS_DT, { sea, anchored });
    snapshot.diag = diag;

    // Judged where she is, every step, because the answer is what the player is
    // reading while deciding whether to round up here or carry on a bit further.
    snapshot.anchorage = anchorage(snapshot.terrain, cfg, state.pos, diag.sog, wind.baseTwd);
    // Real seconds, not world ones: a passage took as long as it took to sail,
    // and the time scale is a convenience for watching the sun rather than a
    // claim about how long the boat was at sea.
    if (log && !anchored) log.advance(diag.sog, msToKnots(env.tws), PHYS_DT);

    // Worked from what the boat is actually doing over the ground, so it costs
    // one call a step rather than being recomputed by every readout that wants
    // a piece of it.
    snapshot.darkIn =
      current.timeScale > 1e-6 ? (hoursUntilSunset(hour) * 3600) / current.timeScale : Infinity;
    snapshot.passage = destination
      ? passageInfo(
          state.pos,
          destination,
          { x: diag.sog * Math.sin(diag.cog), y: diag.sog * Math.cos(diag.cog) },
          diag.speed,
          env.current ?? { x: 0, y: 0 },
          env.twd,
        )
      : null;

    // Distance over the ground, which is not distance through the water: it
    // includes leeway, and it is the number that answers "how far have I
    // actually got".
    run += Math.hypot(state.pos.x - wasX, state.pos.y - wasY);
    snapshot.run = run;

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

      // The helm holds the angle it is left at.
      //
      // It used to be the key state itself, so it sprang back to centre the
      // moment you let go: in practice the rudder was only ever hard over or
      // amidships, because the two are 0.3 s apart and nothing holds it in
      // between. There is no way to carry three degrees of weather helm that
      // way, and this boat needs some -- left alone at fifteen degrees of heel
      // she rounds up about five degrees a minute -- so holding a straight
      // line meant pulsing the key and overshooting on every correction.
      //
      // Now the keys move the helm and it stays put, which is what a tiller
      // does. The physics is untouched; the rudder still slews at its own rate
      // and the boat still carries her way round after the helm is centred.
      // A hand on the tiller takes the boat back off the pilot, which is both
      // what a pilot does and the only safe answer to "why is it not steering
      // where I am pointing it".
      if (pilot.mode !== 'off' && (input.rudder !== 0 || input.centreHelm)) pilot.mode = 'off';

      if (pilot.mode === 'off') {
        if (input.centreHelm) {
          ctl.rudder = 0;
        } else if (input.rudder !== 0) {
          const rate = HELM_CREEP + HELM_GAIN * Math.abs(ctl.rudder);
          ctl.rudder = clamp(ctl.rudder + input.rudder * rate * wall, -1, 1);
        }
      }
      ctl.sheet = input.sheet;
      ctl.twist = input.twist;
      // Touching either trim control takes the sail off auto-trim, the same way
      // a hand on the tiller takes the boat off the pilot. Twist has to count:
      // otherwise the auto-trim would quietly wind the vang straight back to
      // where it wanted it, and the key would look broken.
      ctl.autoTrim = input.autoTrim && ctl.sheet === 0 && ctl.twist === 0;
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
        sound.update(state, diag, waves, wall);
      }
    }

    snapshot.sky = skyState(hour);
    render(wall);
    input.endFrame();
    frameSubs.forEach((f) => f(snapshot));
  }

  function handleKeys(wall: number): void {
    if (input.wasPressed('t')) input.autoTrim = !input.autoTrim;
    // Engage on the course being sailed: you steady up first, then press it.
    if (input.wasPressed('h')) cyclePilot(pilot, state.heading, wrapPi(env.twd - state.heading));
    if (input.wasPressed('c')) view.toggleCamera();
    if (input.wasPressed('l')) snapshot.lightsOn = !snapshot.lightsOn;
    // Weighing is always allowed; letting go is not. A refusal that says why is
    // the whole of the anchoring decision, so it goes through the same judgement
    // the readout is showing rather than a second copy of the rules.
    if (input.wasPressed('a')) {
      if (anchored) anchored = false;
      else if (snapshot.anchorage?.canAnchor) {
        anchored = true;
        arrive();
      }
      snapshot.anchored = anchored;
    }
    if (input.wasPressed('n')) emit({ type: 'chartRange' });
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
  }

  function render(dt: number): void {
    if (!diag) return;
    const showGhost =
      racing && ghost !== null && race.phase === 'racing' && ghost.sampleAt(race.clock, ghostSample);
    // Published as well as drawn: the chart wants the same ghost the scene has,
    // and sampling it twice would be two answers to one question.
    snapshot.ghost = showGhost ? ghostSample : null;
    view.render({
      state,
      diag,
      wind,
      waves,
      course,
      race,
      sky: snapshot.sky,
      weather: weather.state,
      // `hour` is unwrapped and counts on from the session's start hour, which
      // is exactly the monotonic world clock the sky effects want.
      elapsedHours: hour,
      visibility: weather.visibility,
      ghost: showGhost ? ghostSample : null,
      lightsOn: snapshot.lightsOn,
      session,
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
    setDestination,
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
