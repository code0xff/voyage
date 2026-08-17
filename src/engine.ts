import { CRUISER, DEFAULT_ENV, type Environment } from './sim/config';
import {
  initialState,
  step,
  type BoatState,
  type Controls,
  type Diagnostics,
  type SeaState,
} from './sim/boat';
import { polarStale, type Polar } from './sim/polar';
import { createPolarSolver } from './polar-solver';
import { WindField } from './sim/wind';
import { CurrentField, DEFAULT_FULL_DEPTH, tideRate } from './sim/current';
import { venueById } from './sim/venues';
import { regionById, type Region } from './sim/regions';
import { RegionTerrain } from './sim/region-terrain';
import { loadEarth, loadRegion } from './terrain-load';
import { clearReckoning, loadReckoning, saveReckoning } from './reckoning';
import { passageInfo, type PassageInfo, type PassageRecord } from './sim/passage';
import { anchorage, type Anchorage } from './sim/anchorage';
import {
  COAST_ID,
  coastHeightField,
  coastRegion,
  fillCoastRows,
  snapCoastOrigin,
  type ShoreSource,
} from './sim/coast';
import type { Earth } from './sim/earth';
import { DEFAULT_ANCHOR, reproject, toLatLon, type LatLon } from './sim/globe';
import { climateAt, climateSpeed, type Belt, type Climate } from './sim/climate';
import { HeightField } from './sim/heightfield';
import { ManeuverTracker, type Maneuver } from './sim/maneuver';
import { offerCalls } from './sim/calls';
import { PassageLog } from './sim/passage';
import { LogStoreUnavailable, logbook } from './logbook';
import { WaveField, sampleHull, seaBearing, windOverWater, type HullWaveSample } from './sim/waves';
import { MAX_REEF, autoReef, type ReefState } from './sim/sailplan';
import { prepareDeparture } from './sim/departure';
import { cyclePilot, initialPilot, pilotRudder, type PilotState } from './sim/autopilot';
import {
  DEG,
  RAD,
  approach,
  clamp,
  compassVec,
  smoothstep,
  len,
  scale,
  sub,
  wrap2Pi,
  wrapPi,
  approachAngle,
  type Vec2,
} from './sim/math';
import { msToKnots } from './sim/units';
import {
  EMPTY_TERRAIN,
  IslandField,
  MAX_DENSITY,
  Terrain,
  type TerrainQuery,
  sameIslands,
  type Island,
} from './sim/terrain';
import { hoursUntilSunset, skyState, type SkyState } from './sim/sky';
import { Wildlife } from './sim/wildlife';
import { WhaleField } from './sim/whales';
import { SharkField } from './sim/sharks';
import { Weather } from './sim/weather';
import { currentVec, wildlifeSpacing, windMs, type Settings } from './settings';
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
 * rarely -- menus and settings.
 */

export type RegionLoadStatus = 'none' | 'loading' | 'ready' | 'error';

export interface Snapshot {
  state: BoatState;
  diag: Diagnostics | null;
  env: Environment;
  wind: WindField;
  /**
   * The tidal streams. Published whole rather than as a flag, because the
   * readout that switches itself off in a tide -- the polar marker; racing's
   * layline was the other and went with racing -- has to ask about the world
   * and not about the water under the boat: `env.current` goes slack every time
   * she crosses into the shallows, and a polar marker blinking on and off as
   * she does would be worse than either answer.
   */
  currents: CurrentField;
  waves: WaveField;
  terrain: Terrain;
  /**
   * The same sea, out as far as the chart can be zoomed.
   *
   * `terrain` is the physics window and stops at ACTIVE_RANGE, which is less
   * than half the radius of the widest chart -- so a chart drawn from it showed
   * five islands where fifty-four were, and open water for the rest. This is
   * the chart's own window and nothing else may read it: it holds land that is
   * provably too far to be felt, which is exactly what makes it useless to the
   * physics and necessary to a passage-scale chart.
   *
   * Equal to `terrain` when a region or venue is loaded, because a surveyed
   * coast is not windowed at all -- the whole place is already known.
   */
  chart: Terrain;
  /**
   * The surveyed region being sailed, or null in the procedural ocean.
   *
   * Alongside `terrain` rather than replacing it, because the two are read by
   * different things: the physics asks whichever of them is installed through
   * `TerrainQuery`, while the chart and the island meshes want the circle list
   * that only `Terrain` has. When a region is loaded, `terrain` is empty.
   */
  region: RegionTerrain | null;
  /** Whether the selected surveyed region is ready to sail. */
  regionStatus: RegionLoadStatus;
  sky: SkyState;
  weather: Weather;
  polar: Polar | null;
  telemetry: Telemetry;
  paused: boolean;
  autoTrim: boolean;
  autoReef: boolean;
  soundOn: boolean;
  polarBusy: boolean;
  /** Water depth here, m. Infinity in deep water. */
  depth: number;
  /** Depth under the keel, m. Negative means aground. */
  clearance: number;
  /** Distance sailed over the ground since this session began, m. */
  run: number;
  /** Increments whenever a new session starts. A view can reset its own state on it. */
  session: number;
  pilot: PilotState;
  /**
   * Where she is on the Earth.
   *
   * The plane's own coordinates are metres from a pin that moves, so they
   * are meaningless to a player and to a logbook; this is the position that
   * means something. Published rather than derived at the call site because
   * the anchor is the engine's, and a readout recomputing it from a stale
   * one would be wrong exactly when it mattered -- after a re-anchoring.
   */
  place: LatLon | null;
  /**
   * Which wind belt she is in, or null where the belts do not apply -- a
   * surveyed region and a venue keep their own conditions, so naming a belt
   * there would be a claim about a wind nobody is feeling.
   */
  belt: Belt | null;
  /** Whether the boat is showing her lights. */
  lightsOn: boolean;
  /**
   * The flare in the air, or null.
   *
   * Position in sim metres, altitude in metres, intensity -- 0 while the
   * rocket climbs, leaping past 1 (peaking near 1.5 -- the gate and the
   * overshoot cross) in the flash of the pop, settling to 1 through the
   * burn and fading out over the last seconds.
   * The view and the water pool scale off it directly, which is what makes
   * the whole scene blink at ignition.
   * Published rather than derived in the view so the burn's meaning lives in
   * one place and the tests can hold it.
   */
  flare: { x: number; y: number; alt: number; intensity: number } | null;
  /**
   * Whether the locker has a flare ready -- false while the cooldown runs.
   * Published for the touch row, whose flare button dims during the wait;
   * the keyboard path just has its press not taken.
   */
  flareReady: boolean;
  /**
   * Seconds until the next flare, published only for a few seconds after a
   * press that the cooldown refused -- the keyboard's answer to the touch
   * row's dimmed key. A silently ignored key reads as a broken one; null
   * the rest of the time, so the hint bar is not nagged for two minutes.
   */
  flareWait: number | null;
  /** Whether the helmsman has the glasses up. */
  binoculars: boolean;
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
  /**
   * The last completed tack or gybe, held for a few seconds so the alert strip
   * can answer the turn -- then null again. The engine owns the clock on it,
   * because the strip is stateless by design and redraws from this snapshot
   * every frame.
   */
  maneuver: Maneuver | null;
  /**
   * The hand of ports of call on offer, or empty -- because cruising mode is
   * off, or because there is honestly nowhere: open water with no islands has
   * no anchorable ground anywhere. The chart draws them; clicking near one
   * makes it the destination; anchoring there completes it and deals afresh.
   */
  calls: readonly Vec2[];
  /** Ports called at this session, which is the cruise's whole tally. */
  callsMade: number;
}

export type EngineEvent =
  | { type: 'toggleMenu' }
  | { type: 'sound'; on: boolean }
  /**
   * The glasses came down, carrying whatever power they were left at.
   *
   * Emitted on the way down rather than on every wheel notch: the power moves
   * continuously while they are up, and a settings write per notch would push
   * a React render through at wheel speed for a number nothing is reading yet.
   */
  | { type: 'binocularPower'; power: number }
  /**
   * A photograph of the sea, taken on the next drawn frame.
   *
   * Handed out as a blob rather than saved here, because naming a file is a
   * question about words and the words live in the UI: the place she is in has
   * a translated name there and none here.
   */
  | { type: 'photo'; blob: Blob }
  /** A fresh world was rolled. The settings hold the seed so it can be sailed again. */
  | { type: 'world'; seed: number }
  /** The surveyed region changed loading state. */
  | { type: 'region'; id: string; status: RegionLoadStatus }
  /**
   * A completed passage could not be persisted locally.
   *
   * `unavailable` is a standing condition -- the store never opened -- and is
   * therefore true of every passage this session; `write` is about this one
   * record. Carried on the event because only the engine holds the rejection,
   * and the UI cannot ask the store afterwards which it was.
   */
  | { type: 'logbookError'; operation: 'add'; reason: 'unavailable' | 'write' }
  /** The passage reached the store and its transaction committed. */
  | { type: 'logbookSaved'; record: PassageRecord }
  /** `N` was pressed: the chart should step to its next range. */
  | { type: 'chartRange' };

export interface Engine {
  readonly snapshot: Snapshot;
  onFrame(cb: (s: Snapshot) => void): () => void;
  onEvent(cb: (e: EngineEvent) => void): () => void;
  /** Start the sound graph after the view has captured a user gesture. */
  startAudio(): void;
  /** Start a fresh session: a new world, and the boat put to sea in it. */
  putToSea(): void;
  /** Retry loading the selected surveyed region after a failed request. */
  retryRegion(): void;
  /** Point her at somewhere, or pass null to just go sailing. */
  setDestination(pos: Vec2 | null): void;
  setPaused(paused: boolean): void;
  applySettings(s: Settings): void;
  toggleCamera(): void;
  /**
   * Put the helm somewhere, -1 to 1.
   *
   * For a tiller you drag rather than a key you hold. The keys move the helm at
   * a rate and it stays where they leave it; a slider *is* where it was left,
   * so it sets the angle instead of nudging it. Taking the pilot off is the
   * same rule the keys follow -- a hand on the helm is a hand on the helm.
   */
  setHelm(v: number): void;
  /** Press a binding from something that is not a keyboard. See `Input.inject`. */
  press(key: string): void;
  recomputePolar(): void;
  resize(): void;
  dispose(): void;
  /** Development hook, exposed on window. */
  advance(seconds: number, rudder?: number): void;
  /**
   * Choose where the next departure opens: one of the world's waters, or
   * null to forget the remembered position and open where the game opens.
   *
   * Deliberately not a teleport. She is still where she is until she next
   * puts to sea -- a menu that moved the boat under the player while they
   * were reading it would be a worse answer than one that waits -- and the
   * menu that offers this says so.
   */
  setDeparture(place: LatLon | null): void;
}

const PHYS_DT = 1 / 120;
/**
 * m of plane travel before the anchor is re-pinned under the boat.
 *
 * Generous rather than tight: `planeError` puts two hundred kilometres far
 * inside the honest range, and re-anchoring costs a handful of conversions
 * plus the window re-bake the slide already does. Exported so a test can
 * probe the boundary without writing the number down beside it.
 */
export const REANCHOR_AT = 200_000;
/**
 * s. How fast the mean wind eases toward the belt it is sailing into.
 *
 * Real seconds, and long: a boat crossing from the trades into the horse
 * latitudes should find the wind going soft over a watch, not over a
 * minute. Short enough that a re-anchoring or a jump does not leave her
 * sailing last ocean's breeze for the rest of the session.
 */
const CLIMATE_TAU = 240;
/**
 * s of sailing between writes of her position. At six knots that is a
 * hundred metres, which is finer than the thing being remembered -- which
 * sea she is in -- and rare enough that a synchronous localStorage write is
 * never in a frame's way.
 */
const KEEP_PLACE_EVERY = 30;
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

/**
 * The flare's numbers. Real seconds; see the state's note in createEngine.
 * The cooldown and burn are exported because tests must outlast them and a
 * hardcoded copy would quietly stop covering the burn the day it is retuned
 * -- the shark's dive taught that lesson twice.
 */
export const FLARE_COOLDOWN = 120;
export const FLARE_RISE = 3;
export const FLARE_BURN = 32;
/**
 * m, where the rocket pops. A real parachute rocket makes 300 m; this one
 * stops lower on purpose -- measured in the chase framing, a 300 m star
 * 340 m out hangs at 39 degrees of elevation, two degrees above the top of
 * the frame, and a light whose source can never be seen reads as a bug. At
 * 230 m over 420 m it stands about 26 degrees up: in frame, over the sea
 * she is sailing into.
 */
const FLARE_APEX = 230;
/**
 * m the rocket carries ahead of the bow before it pops. Fired straight up it
 * hung at the zenith for its whole burn -- lighting everything and visible in
 * no camera, since the chase view cannot look higher than the masthead. Sent
 * ahead, the star stands about forty degrees up in the view she is sailing
 * into, which is also the sea worth lighting.
 */
const FLARE_REACH = 420;
/** m/s down under the parachute. */
const FLARE_SINK = 5.5;
/** Fraction of the mean wind the parachute drifts at. */
const FLARE_DRIFT = 0.35;
/**
 * The pop's flash: how far the ignition overshoots the steady burn, and how
 * fast it settles. A star that faded in over most of a second read as a
 * lamp warming up; the flash is what makes it a *pop* -- the overshoot term
 * is 1 + FLARE_FLASH, the sixty-millisecond gate rises through it, and the
 * published envelope peaks near 1.5 where the two cross before decaying
 * onto the steady burn with this time constant.
 */
const FLARE_FLASH = 0.7;
const FLARE_FLASH_TAU = 0.25;

export function createEngine(canvas: HTMLCanvasElement, settings: Settings): Engine {
  const cfg = CRUISER;
  const env: Environment = { ...DEFAULT_ENV };
  // Seeded, which it was not. The fifth argument has a default and nobody was
  // passing it, so the gusts and the shifts were laid out identically in every
  // session anyone has ever sailed -- the same puff in the same place off the
  // same headland, for ever. In a surveyed region, where the land cannot vary,
  // that left the seed with nothing to change but the weather's rolls.
  const wind = new WindField(windMs(settings), 0, settings.gustiness, undefined, settings.seed);
  const currents = new CurrentField({ peak: currentVec(settings) });
  const waves = new WaveField(windMs(settings), 0);
  const weather = new Weather(settings.seed, 'fair');
  const wildlife = new Wildlife(settings.seed);
  const whales = new WhaleField(settings.seed);
  /**
   * The encounter whose blow has already been heard.
   *
   * The sighting is republished every physics step, so without an edge the
   * blow would fire 120 times a second for the four seconds the phase lasts.
   * Held as the id rather than as a flag because ids are never reissued, which
   * makes "this one has sounded" the whole of the test.
   */
  let blownFor = 0;
  const sharks = new SharkField(settings.seed);
  const maneuvers = new ManeuverTracker();
  /** Real seconds the last maneuver report stays on screen. */
  const MANEUVER_SHOWN = 8;
  let maneuverTtl = 0;
  /**
   * Which deal of the session the next hand of calls is. Folded into the
   * offer's salt so completing a call turns a fresh hand, while re-opening a
   * pinned world at its start deals the very same one.
   */
  let callSalt = 0;
  /**
   * m, how close a chart click must land to an offered call to mean it. Judged
   * here rather than in the chart, so the one rule serves every chart scale --
   * at the passage ranges a fingertip is hundreds of metres wide.
   */
  const CALL_SNAP = 400;

  /**
   * Deal (or clear) the hand from wherever she is now.
   *
   * Judged against the *chart* window on the procedural ocean, not the felt
   * one. The active window stops at ACTIVE_RANGE (~2.2 km) and the hand
   * reaches 4.2, and the gap was not hypothetical: a review found seed 260
   * offering a call on the unloaded flank of an island -- 4.8 m of water by
   * the window, dry land once the boat sailed near -- which is precisely the
   * un-completable-goal bug the anchorage oracle exists to prevent. The chart
   * window exists to undo the windowing (its own docblock's words) and
   * reaches 8.3 km. A region or a venue is never windowed, so `query` is
   * already the whole place there.
   */
  function dealCalls(): void {
    const world = field ? snapshot.chart : query;
    snapshot.calls = current.cruise
      ? offerCalls(world, CRUISER, state.pos, wind.baseTwd, current.seed, callSalt++)
      : [];
  }

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
  let paused = false;
  let hour = settings.startHour;
  let run = 0;
  /** Bumped on every new session, so view-side caches know to start over. */
  let session = 0;
  /** The wind the wave field is currently built from; it lags the real one. */
  let seaTws = windMs(settings);
  /** The bearing the sea is running from -- the wind over the moving water. */
  let seaTwd = 0;
  /** The set at its full run, before the tide takes it down to slack. */
  let fullStream: Vec2 = currentVec(settings);
  /**
   * `currents.peak` is rewritten every physics step, so it is one object rather
   * than a fresh one 120 times a second. Nothing downstream keeps a reference
   * past the step it was handed in.
   */
  const streamNow: Vec2 = { x: fullStream.x, y: fullStream.y };
  const pilot = initialPilot();
  let destination: Vec2 | null = null;
  let anchored = false;

  /**
   * The illumination flare: a rocket, a pop, half a minute of light swinging
   * down under its parachute. Real seconds throughout -- like the wildlife
   * clocks, it is something the player watches happen, and the world's time
   * scale must not turn a thirty-second burn into a blink.
   */
  let flareState: {
    age: number;
    x: number;
    y: number;
    alt: number;
    /** The bow direction at launch, which the rocket arcs away along. */
    bowX: number;
    bowY: number;
  } | null = null;
  let flareCooldown = 0;
  /** Seconds left of showing the refused-press hint; see Snapshot.flareWait. */
  let flareDeniedFor = 0;
  /**
   * Thunder that struck before the audio could take it; see the drain above.
   * Bounded by the drop rule -- nothing waits longer than its own flight
   * time -- so a muted hour cannot pile up a storm to play at once.
   */
  const pendingThunder: { distance: number; power: number; waited: number }[] = [];
  /** The passage under way, or null when she is just out sailing. */
  let log: PassageLog | null = null;
  /** Whether this session has already said the local logbook will not open. */
  let reportedUnavailable = false;
  let current = settings;
  let disposed = false;

  const view: SceneView = createScene(canvas, cfg);
  const input = new Input();
  const sound = new SoundEngine();
  const telemetry = new Telemetry(
    [
      { label: 'BSP', color: '#4fd1c5', min: 0, max: 10 },
      { label: 'VMG', color: '#f6c667', min: -8, max: 8 },
      { label: 'HEEL', color: '#e07a8b', min: 0, max: 45 },
      { label: 'TWS', color: '#8fa8c0', min: 0, max: 35 },
    ],
    50,
  );


  const snapshot: Snapshot = {
    state,
    diag: null,
    anchored: false,
    anchorage: null,
    darkIn: Infinity,
    destination: null,
    passage: null,
    maneuver: null,
    calls: [],
    callsMade: 0,
    env,
    wind,
    currents,
    waves,
    terrain: EMPTY_TERRAIN,
    chart: EMPTY_TERRAIN,
    region: null,
    regionStatus: 'none',
    sky: skyState(hour),
    weather,
    polar: null,
    telemetry,
    paused,
    autoTrim: true,
    autoReef: true,
    soundOn: settings.sound,
    polarBusy: false,
    depth: Infinity,
    clearance: Infinity,
    run: 0,
    session: 0,
    pilot,
    // Null rather than the default anchor: the first `applySettings` below
    // publishes the real one before anything can read this, and a world that
    // is not on the Earth must never carry a position at all.
    place: null,
    belt: null,
    lightsOn: true,
    flare: null,
    flareReady: true,
    flareWait: null,
    binoculars: false,
  };

  const frameSubs = new Set<(s: Snapshot) => void>();
  const eventSubs = new Set<(e: EngineEvent) => void>();
  const emit = (e: EngineEvent) => eventSubs.forEach((f) => f(e));

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
  //
  // Solved on a worker. It takes about 1.2 seconds, measured, and used to take
  // that on this thread -- which is 1.2 seconds of frozen frames every time a
  // setting moved. Null where the platform has no worker, and then there is
  // simply no polar, which every readout already copes with.
  const polarSolver = createPolarSolver((polar) => {
    // Null means that solve is not coming. Keep whatever curve is already up --
    // a stale polar beats none, and it is what would have been shown anyway --
    // and above all stop being busy, because busy is what stops us asking.
    if (polar) snapshot.polar = polar;
    snapshot.polarBusy = false;
  });
  // The debounce stays, and is now the only thing it ever really was: a slider
  // being dragged asks for a polar per pixel, and there is no sense starting a
  // solve for a wind speed the player is still moving through.
  let polarTimer: number | null = null;
  function schedulePolar(delay = 400): void {
    // `alive` and not just existence: a worker that has died answers nothing,
    // and asking anyway would set `polarBusy` on a promise no one can keep.
    if (!polarSolver?.alive) return;
    if (polarTimer !== null) clearTimeout(polarTimer);
    snapshot.polarBusy = true;
    polarTimer = window.setTimeout(() => {
      polarTimer = null;
      // A polar must be based on the mean wind, not the instantaneous gust.
      polarSolver.solve(cfg, wind.meanEnv(DEFAULT_ENV));
    }, delay);
  }

  // --- Course and terrain ---------------------------------------------------
  /** The endless ocean this session is sailing in, or null for open water. */
  let field: IslandField | null = null;
  /** The islands currently loaded, so a refresh that changes nothing costs nothing. */
  let activeIslands: readonly Island[] = [];
  let visibleIslands: readonly Island[] = [];
  let chartIslands: readonly Island[] = [];
  /** The venue's land, or EMPTY_TERRAIN in the open ocean. Fixed for a session. */
  let venueTerrain: Terrain = EMPTY_TERRAIN;
  /**
   * The region installed, and the one asked for.
   *
   * Two variables because loading is asynchronous: the raster is a megabyte
   * fetched over the network, and a player who changes their mind while it is
   * in flight must not have the old choice arrive and install itself. Whatever
   * comes back is dropped unless it is still the one wanted.
   */
  let regionTerrain: RegionTerrain | null = null;
  let wantedRegion = '';
  /**
   * Which seed the installed coast was generated from. The region id alone
   * cannot say: every generated coast is `COAST_ID`, so without this a rolled
   * seed would be served last session's shore.
   */
  let coastSeed = 0;
  /**
   * The coast's sliding window.
   *
   * The generated coast is a pure function of world position, so the 20 km
   * field it is sampled into is a *window*, not the world -- and a window that
   * never moved was the whole of why the "mainland" ended: sail ten kilometres
   * along the shore and the continent faded into the edge blend, dissolving in
   * plain sight of the chart. So the window follows the boat. `coastOrigin` is
   * where the installed field is centred; when the boat has sailed
   * `COAST_REWINDOW` from it, `pendingCoast` starts re-baking the same seed
   * about the boat, a few rows per physics step -- the full field is a
   * measured ~190 ms since the three-octave coast, far too much for one
   * frame, and at four rows
   * a step it disappears into the budget and completes in under two seconds
   * of a crossing that takes a quarter of an hour. Overlapping samples agree
   * exactly (see snapCoastOrigin), so the swap moves the horizon, never the
   * water under the keel.
   *
   * Past `COAST_JUMP` the boat cannot have sailed there -- she was put there,
   * by a restart with the window left down the coast -- and the water she is
   * standing in belongs to the old window's faded edge. That one is rebuilt
   * whole, synchronously, behind the same put-to-sea the initial build hides
   * behind.
   */
  const COAST_REWINDOW = 3000;
  const COAST_JUMP = 7000;
  const COAST_ROWS_PER_STEP = 4;
  let coastOrigin = { x: 0, y: 0 };
  /**
   * Where the plane is pinned to the Earth, and the Earth itself once it has
   * arrived.
   *
   * The sim's metres are measured from `anchor`; globe.ts says why that has
   * to be a moving pin, and `planeError` says how far it may drift -- a
   * working window costs under a part in a million and a thousand kilometres
   * 0.06%, so the re-anchor below is generous rather than tight.
   *
   * `earth` is null until the raster lands, and nothing waits for it: a
   * coast keeps being generated from the seed alone until the planet
   * arrives, and the window is re-baked the moment it does. The alternative
   * is a loading screen for 29 MB before anything can be sailed.
   *
   * It opens where she got to, if she has been anywhere: read once here and
   * then owned by the engine, so that a browser which refuses to store --
   * private mode throws on write -- still keeps the boat where she is for
   * the rest of the session instead of teleporting her home on every
   * restart. `forgetPlace` is the only thing that puts it back.
   */
  const remembered = loadReckoning();
  /** A fresh copy each time: two pins that shared one object would be one pin. */
  const opening = (): LatLon =>
    remembered ? { lat: remembered.lat, lon: remembered.lon } : { ...DEFAULT_ANCHOR };
  let anchor: LatLon = opening();
  /**
   * Where the endless coast's plane is pinned, held apart from `anchor` so
   * that it survives a visit to a surveyed region. Sailing to the Azores and
   * then looking at Newport for a minute should not put her back off San
   * Francisco.
   */
  let oceanAnchor: LatLon = opening();
  /** Where she was on the ocean when she last left it; see `rebuildWorld`. */
  let oceanPos: Vec2 = { x: 0, y: 0 };
  /** Whether the world she is in now is a surveyed one. */
  let inSurveyed = false;
  /** s of sailing since the position was last written down; see `keepPlace`. */
  let sinceSaved = 0;
  /**
   * Where the player has asked the *next* departure to open, if they have
   * asked at all. Held apart from `oceanAnchor`, which is where the plane is
   * pinned for the session she is sailing now: writing the choice straight
   * into the pin meant the next thing that rebuilt the world -- a seed roll,
   * any settings edit -- read it and moved her there without a departure,
   * which is a silent teleport of several thousand kilometres in the one
   * path whose comment promises it is not a teleport.
   */
  let departure: LatLon | null = null;
  /**
   * Whether her position is still being written down.
   *
   * False from the moment a departure is chosen until the next one is taken.
   * Without it the choice does not survive the session it was made in: the
   * throttle below, or quitting, writes wherever she happens to be over the
   * top of it -- so "start over" put her back where she was thirty seconds
   * later, and choosing the Cape while sailing off Antigua quietly became
   * Antigua again. Proven with a probe before it was fixed.
   */
  let keeping = true;
  /**
   * Where this session began, in plane metres, so the coast generator can
   * keep that one spot clear of its own inventions. Carried across a
   * re-anchoring like every other plane position, which is the whole point:
   * pinned to the plane's origin instead, the clearing followed the boat out
   * to sea and bit a nine-hundred-metre notch out of the real coast at every
   * re-pin.
   */
  let spawn: Vec2 = { x: 0, y: 0 };
  /**
   * rad the player has turned the wind with Q/E, held apart from the wind
   * itself so the belt's ease cannot undo it. Cleared with the world: a new
   * sea is a new wind, and a shift asked for in the last one is not an
   * opinion about this one.
   */
  let windShift = 0;
  let earth: Earth | null = null;
  /** True while the planet is on the wire, so a retry cannot start a second one. */
  let fetchingEarth = false;

  let pendingCoast: {
    origin: { x: number; y: number };
    /** The Earth's shoreline for this window, or null for a seed-only coast. */
    shore: ShoreSource | null;
    /** Frozen with the window for the same reason as `shore`. */
    spawn: Vec2;
    samples: Int16Array;
    row: number;
  } | null = null;
  /** Prevent a rebuild during one request from starting a second fetch. */
  let loadingRegion = '';
  /**
   * What the physics actually asks. Whichever of the region and the island
   * terrain is in force, so that no query site has to know which world it is
   * in.
   */
  let query: TerrainQuery = EMPTY_TERRAIN;
  let streamedFrom = { x: Infinity, y: Infinity };
  let streamedTwd = Infinity;
  /**
   * Whether the current field has ever been published.
   *
   * Without it, a rebuilt world whose first window happens to be empty compares
   * equal to the cleared lists -- two empty arrays always match -- and the
   * early-out below leaves the *previous* world's terrain installed in the
   * snapshot, the wind and the scene. Sailing a new low-density seed then meant
   * feeling and seeing islands from the session before.
   */
  let published = false;

  function rebuildWorld(): void {
    // The world she was sailing in is being replaced, so the passage through it
    // is over whether or not she moved. `arrive()` stamps a record with the
    // venue that is current when the anchor goes down, so a passage carried
    // across a venue change would be filed under a place most of it did not
    // happen in.
    setDestination(null);
    // And she cannot still be lying to an anchor she let go in a world that no
    // longer exists. The other half of the same bug: `placeAtStart` was taught
    // to weigh it and this path was not, so changing a venue while anchored
    // left the new world held fast by the old ground.
    anchored = false;
    snapshot.anchored = false;
    // A half-made tack dies with the world too. This path runs on a settings
    // change *without* `placeAtStart` behind it -- resume, not put to sea --
    // and a new venue's wind can stand on the other side of an unmoved bow,
    // which must read as a replaced world and not as a turn. A Codex round
    // caught this route around the teleport reset.
    maneuvers.reset();
    snapshot.maneuver = null;
    // A flare does not survive the world being replaced, and neither does
    // the wait for the next one. Its *sound* is deliberately not chased
    // down on this path: newSession silences everything pending, but a
    // settings change mid-session replaces the world without one, and the
    // hiss of a rocket that really was fired finishing its two seconds is
    // true in a way that cutting it mid-breath is not.
    flareState = null;
    flareCooldown = 0;
    flareDeniedFor = 0;
    snapshot.flare = null;
    snapshot.flareReady = true;
    snapshot.flareWait = null;

    // A venue brings its own land, fixed and known, so there is nothing to
    // stream: the whole place is always loaded. The procedural field is the
    // other case, an endless ocean that has to be looked at through a window.
    const venue = venueById(current.venue);
    venueTerrain = venue ? new Terrain(venue.islands) : EMPTY_TERRAIN;
    // A region sets the tidal band too. Its stream is as much a part of the
    // place as its coast -- at San Francisco it is the whole game -- and
    // leaving fullDepth at the open-ocean default would run the tide flat out
    // right up to the beach and delete the inshore lane.
    const conditioned = regionById(current.region)?.conditions ?? venue;
    currents.fullDepth = conditioned ? conditioned.fullDepth : DEFAULT_FULL_DEPTH;

    // A surveyed region is the third kind of world, and the only one that has
    // to be fetched. It is installed when it arrives; until then the session
    // stays paused and the menu explains why it cannot yet be sailed.
    //
    // The generated coast is the fourth, and it goes through this same gate as
    // a region that is computed instead of fetched: everything downstream --
    // the shelter sweep, the field texture, the meshes, the chart -- reads a
    // RegionTerrain and never asks where its samples came from. Ready
    // synchronously, since about 190 ms of generation at Put to sea needs no
    // loading screen. Cached against the seed that built it, not merely against being
    // a coast: with the seed pinned a settings change must not regenerate the
    // place, and with it rolled the same id would otherwise serve last
    // session's shore.
    /*
     * Where plane zero is on the Earth, which is a property of the world and
     * not of the session. See `pinForWorld`.
     *
     * A surveyed region is a real place with a surveyed centre, and its grid
     * is laid out about that centre -- so a session at Newport must read out
     * as Rhode Island. It reported San Francisco for every region, because
     * the anchor was set once at construction and only ever moved by the
     * endless coast's own re-pinning. Found by a Codex review, which is the
     * kind of thing only a reader comparing two subsystems catches: nothing
     * inside either one was wrong.
     */
    const surveyed =
      current.region && current.region !== COAST_ID ? regionById(current.region) : null;
    /*
     * Leaving the ocean, her place in it is put away with the pin; coming
     * back, both are taken out again.
     *
     * Plane metres mean different things in the two worlds -- one is
     * measured from a pin that follows her round the planet, the other from
     * a surveyed grid's centre -- so a position carried across unchanged is
     * a different place on the Earth at each end. Without this, an hour in
     * the ocean followed by a look at Newport and back put her some
     * kilometres from where she had left off, silently. The pin alone was
     * not enough, which is what a review pointed out.
     */
    if (surveyed && !inSurveyed) oceanPos = { ...state.pos };
    if (!surveyed && inSurveyed) state.pos = { ...oceanPos };
    inSurveyed = !!surveyed;
    pinForWorld();

    if (current.region === COAST_ID) {
      wantedRegion = COAST_ID;
      wantEarth();
      if (regionTerrain?.region.id !== COAST_ID || coastSeed !== current.seed) {
        // Windowed about the boat, not the origin: a rebuild can happen
        // mid-session (a settings edit while far down the shore), and the
        // window must be where she is. At construction and at put-to-sea the
        // boat is at the origin anyway, so the first window is unchanged.
        const snapped = snapCoastOrigin(state.pos);
        const coast = coastHeightField(current.seed, snapped, shoreFor(snapped), spawn);
        regionTerrain = new RegionTerrain(coast.region, coast.height);
        coastSeed = current.seed;
        coastOrigin = coast.origin;
        pendingCoast = null;
      }
      loadingRegion = '';
      publishRegionStatus(COAST_ID, 'ready');
    } else {
      const region = regionById(current.region);
      wantedRegion = region ? region.id : '';
      if (!region) {
        regionTerrain = null;
        loadingRegion = '';
        publishRegionStatus('', 'none');
      } else if (regionTerrain?.region.id === region.id) {
        loadingRegion = '';
        publishRegionStatus(region.id, 'ready');
      } else {
        requestRegion(region);
      }
    }

    const up = compassVec(wind.baseTwd);
    field =
      !venue && !current.region && current.islandCount > 0
        ? new IslandField({
            seed: current.seed,
            // The slider is 0..10 islands' worth of thickness, not a count: in
            // an endless ocean there is no total to set. Ten is MAX_DENSITY,
            // which is not a round number but the thickest sea the island
            // window is measured to handle without leaving anything out.
            density: (current.islandCount / 10) * MAX_DENSITY,
            // Only where the boat starts is kept clear. An island two
            // kilometres off is scenery and one a few hundred metres away is a
            // decision, so the sea is otherwise left to put land wherever it
            // falls -- that is the point of an endless one.
            keepClear: [{ x: -up.x * 90, y: -up.y * 90 }],
            clearance: 130,
          })
        : null;

    activeIslands = [];
    visibleIslands = [];
    published = false;
    streamedFrom = { x: Infinity, y: Infinity };
    streamWorld(state.pos.x, state.pos.y);
  }

  function publishRegionStatus(id: string, status: RegionLoadStatus): void {
    if (wantedRegion !== id) return;
    snapshot.regionStatus = status;
    emit({ type: 'region', id, status });
  }

  function requestRegion(region: Region): void {
    if (loadingRegion === region.id && snapshot.regionStatus === 'loading') return;

    loadingRegion = region.id;
    regionTerrain = null;
    published = false;
    publishRegionStatus(region.id, 'loading');

    void loadRegion(region).then(
      (loaded) => {
        // Dropped unless it is still the region wanted: a megabyte in flight
        // is long enough for the player to have changed their mind, and the
        // late arrival would otherwise overwrite the choice they made second.
        if (disposed || wantedRegion !== loaded.region.id) return;
        loadingRegion = '';
        regionTerrain = loaded;
        published = false;
        // Install it before announcing readiness. Closing the menu in response
        // to the event must never reveal one frame of the placeholder ocean.
        streamWorld(state.pos.x, state.pos.y);
        // And the cruise's hand with it. The deal that ran when this load
        // began was judged against the placeholder ocean -- a review traced
        // every path that resumes into a freshly loaded region arriving with
        // an empty hand that nothing ever re-dealt.
        dealCalls();
        publishRegionStatus(region.id, 'ready');
      },
      (err) => {
        if (disposed || wantedRegion !== region.id) return;
        loadingRegion = '';
        regionTerrain = null;
        published = false;
        streamWorld(state.pos.x, state.pos.y);
        console.error('could not load the region', err);
        publishRegionStatus(region.id, 'error');
      },
    );
  }

  /**
   * The Earth's own shoreline for a window centred at this plane position,
   * or null while the planet is still on the wire.
   *
   * The translation is the whole job and it is not incidental. A patch
   * measures from *its own centre*; the coast fill works in plane metres,
   * which run from wherever the anchor happens to be pinned. Handing the
   * patch the fill's coordinates directly reads the Earth `origin` away from
   * the point being asked about -- correct at the start of a session, when
   * the window sits on the pin, and increasingly wrong with every mile she
   * sails from it. It survived a clean self-review because the only window
   * the tests built was the one at zero, where the bug is invisible.
   */
  function shoreFor(origin: { x: number; y: number }): ShoreSource | null {
    if (!earth) return null;
    const patch = earth.shorePatch(toLatLon(anchor, origin.x, origin.y), 10_000);
    return {
      at: (x, y) => patch.at(x - origin.x, y - origin.y),
      floor: (x, y) => patch.floor(x - origin.x, y - origin.y),
    };
  }

  /**
   * Write down where she is, now and then.
   *
   * Every 30 seconds of sailing, which at six knots is a hundred metres --
   * fine enough that closing the tab loses nothing worth having, and rare
   * enough that a synchronous localStorage write is not in the way of the
   * frame. Also on the way out, so quitting deliberately keeps the last of
   * it.
   *
   * Only where there is a position to keep: a surveyed region and the island
   * field are not places on the Earth, and writing one from either would
   * move the ocean under a boat that was never in it.
   */
  function keepPlace(): void {
    if (!keeping || current.region !== COAST_ID || !snapshot.place) return;
    saveReckoning(snapshot.place);
    sinceSaved = 0;
  }

  /**
   * Point the plane's pin at the world she is in.
   *
   * A surveyed region is laid out about its own surveyed centre; the endless
   * Earth is pinned wherever she got to. Called from `rebuildWorld`, which
   * is late -- and from `newSession` *before* it reads the opening wind,
   * which is the whole reason it is a function: choosing a departure and
   * putting to sea gave her the belt of the place she had just left, because
   * the wind was worked out against a pin that had not moved yet. Sailing
   * from the Cape in the Caribbean's trades, and only until the ease crept
   * round over the next four minutes.
   */
  function pinForWorld(): void {
    const surveyed =
      current.region && current.region !== COAST_ID ? regionById(current.region) : null;
    anchor = surveyed ? { ...surveyed.centre } : { ...oceanAnchor };
  }

  /**
   * Where she is on the Earth, or null in a world that is not on it.
   *
   * The island field is an invented ocean and a venue is an invented place:
   * printing a real latitude and longitude over either is a false claim of
   * exactly the kind this project does not make elsewhere. The endless coast
   * is the planet and a surveyed region is a real place, and those two get a
   * position.
   */
  function placeOf(x: number, y: number): LatLon | null {
    const real = current.region === COAST_ID || !!regionById(current.region);
    return real ? toLatLon(anchor, x, y) : null;
  }

  /**
   * Fetch the planet, if the world she is in is one it applies to.
   *
   * Not at construction and not unconditionally, which is how it started:
   * that is 29 MB on the wire for a session in Newport, whose ground is
   * surveyed and which never asks the globe anything. Only the endless coast
   * takes its shoreline from the Earth.
   *
   * Nothing waits for it -- the seed's own coast is a working world, and the
   * window is rebuilt when the planet lands. A failure is logged and left,
   * but it is no longer permanent: the fetch is attempted again the next
   * time the coast is built, so a dropped connection costs this session's
   * geography rather than the engine's whole lifetime.
   */
  function wantEarth(): void {
    if (earth || fetchingEarth || current.region !== COAST_ID) return;
    fetchingEarth = true;
    void loadEarth().then(
      (loaded) => {
        fetchingEarth = false;
        if (disposed) return;
        earth = loaded;
        rebuildCoastWindow();
      },
      (err) => {
        fetchingEarth = false;
        console.error('could not load the globe', err);
      },
    );
  }

  /** Rebuild the coast window about the boat, on the anchor as it stands now. */
  function rebuildCoastWindow(): void {
    if (regionTerrain?.region.id !== COAST_ID) return;
    const snapped = snapCoastOrigin(state.pos);
    const coast = coastHeightField(coastSeed, snapped, shoreFor(snapped), spawn);
    regionTerrain = new RegionTerrain(coast.region, coast.height);
    coastOrigin = coast.origin;
    pendingCoast = null;
    published = false;
  }

  /**
   * The belt at a plane position, or null in a world the belts do not reach.
   *
   * Takes the position rather than reading the boat's, because the three
   * callers ask about three different moments: the physics step asks where
   * she *is*, and a session opening or a settings change asks about the
   * plane's origin, which is where `placeAtStart` is about to put her. The
   * first version read `state.pos` in all three, so a restart from 166 km
   * north prepared the boat for the latitude she was leaving and then
   * dropped her at the one she was not. A review found it.
   */
  function beltFor(x: number, y: number): Climate | null {
    if (current.region !== COAST_ID) return null;
    return climateAt(toLatLon(anchor, x, y).lat);
  }

  /**
   * The mean wind at a plane position: the belt's where there is one, and the
   * player's slider where there is not, with the weather's scale on top.
   *
   * The one answer every path uses. The physics step had it and nothing else
   * did, so the departure was trimmed from the raw slider and -- worse -- the
   * sea was *built* from it: a session opening in the doldrums began under a
   * twelve-knot sea over a three-knot wind, and could only decay towards the
   * truth over the following few minutes.
   */
  function meanTws(x: number, y: number): number {
    const setting = windMs(current) * weather.state.windScale;
    const belt = beltFor(x, y);
    return belt ? climateSpeed(setting, belt) : setting;
  }

  /**
   * Keep the plane pinned near the boat.
   *
   * A tangent plane is only honest near its pin, so the pin moves -- and
   * everything holding a *plane* position moves with it: the boat, where she
   * is bound, the coast window, the hand of calls. That list is the risk,
   * which is why it is written out here rather than hidden behind a helper:
   * a position left behind would be silently somewhere else on the Earth,
   * and nothing would say so.
   */
  function reanchorIfFar(x: number, y: number): void {
    // Only the endless coast may be re-pinned. A venue and a surveyed region
    // are fixed terrain laid out in plane metres about their own centre, so
    // moving the pin under one would leave the survey where it was and carry
    // the boat back into the middle of it -- a teleport, several miles, in
    // the one part of the game whose whole claim is that the ground is real.
    if (current.region !== COAST_ID) return;
    if (Math.hypot(x, y) < REANCHOR_AT) return;
    const from = anchor;
    const to = toLatLon(from, x, y);
    const move = (p: { x: number; y: number }) => reproject(from, to, p.x, p.y);

    const boat = move(state.pos);
    state.pos = boat;
    spawn = move(spawn);
    if (destination) destination = move(destination);
    // The *published* one as well as the private one. They were allowed to
    // disagree, so the minimap went on drawing the mark where it had been
    // 200 km ago while the arrival check used the moved one.
    snapshot.destination = destination;
    // A passage in progress is measured between two points, and those points
    // outlive the plane they were written in: left behind, the logbook's
    // straight-line distance came out longer than the track that made it.
    if (log) log.reframe(move(log.from), move(log.to));
    // And anything else standing in the water. A flare is a light hanging in
    // the sky at a plane position; it was left where the old plane had it,
    // which on the next frame drew it a couple of hundred kilometres away.
    if (flareState) {
      const lit = move(flareState);
      flareState.x = lit.x;
      flareState.y = lit.y;
    }
    // Not moved but forgotten: it is only a "how far since we last looked",
    // and a stale one in the old plane reads as a 200 km jump.
    streamedFrom = { x: Infinity, y: Infinity };
    coastOrigin = move(coastOrigin);
    // Dropped rather than moved: its rows were filled about the old plane
    // and the rest would be filled about the new one, which would leave a
    // seam through the middle of the window.
    pendingCoast = null;
    snapshot.calls = snapshot.calls.map(move);
    anchor = to;
    // The ocean's own pin, kept so that visiting a surveyed region and coming
    // back does not undo the passage that got her here. Its own copy, so the
    // two can never be moved by one assignment.
    oceanAnchor = { ...to };
    snapshot.place = placeOf(state.pos.x, state.pos.y);
    rebuildCoastWindow();
  }

  /**
   * Keep the generated coast's window under the boat; see `coastOrigin`.
   *
   * Runs ahead of the publish block below, so the frame that completes a
   * re-bake is also the frame that installs it -- the guard there watches
   * `snapshot.region !== regionTerrain` and does the whole hand-over: physics
   * query, wind and current terrain, chart, view meshes, field texture. The
   * install frame pays the RegionTerrain build (a measured 39 ms) and the
   * next wind query re-sweeps the shelter (18 ms); once per few kilometres of
   * coast, that is the price of a mainland that does not end, and both halves
   * were measured before being accepted rather than assumed small.
   */
  function slideCoast(x: number, y: number): void {
    if (regionTerrain?.region.id !== COAST_ID) return;
    const away = Math.max(Math.abs(x - coastOrigin.x), Math.abs(y - coastOrigin.y));
    if (away > COAST_JUMP) {
      const jumped = snapCoastOrigin({ x, y });
      const coast = coastHeightField(coastSeed, jumped, shoreFor(jumped), spawn);
      regionTerrain = new RegionTerrain(coast.region, coast.height);
      coastOrigin = coast.origin;
      pendingCoast = null;
      return;
    }
    // A fill is only worth finishing while the boat still stands where it
    // was ordered: outside the installed window's comfort zone, and near the
    // pending centre. `away` back under the trigger means no re-window is
    // needed at all -- she turned back, or a restart teleported her home --
    // and a fill that outlived either would install a window centred on
    // where she was going, not where she is. The distance guard alone missed
    // exactly that: a restart from a trigger at 3.0 km lands the boat 2.9 km
    // from the pending centre, same side, still inside the distance test.
    if (
      pendingCoast &&
      (away <= COAST_REWINDOW ||
        Math.max(Math.abs(x - pendingCoast.origin.x), Math.abs(y - pendingCoast.origin.y)) >
          COAST_REWINDOW)
    ) {
      pendingCoast = null;
    }
    if (!pendingCoast && away > COAST_REWINDOW) {
      const { width, height } = regionTerrain.region.grid;
      const origin = snapCoastOrigin({ x, y });
      pendingCoast = {
        origin,
        // Built once with the window rather than per row: it is a chamfer,
        // and it must be the same shoreline for every row of one field or
        // the coast would step where the fill was interrupted.
        shore: shoreFor(origin),
        spawn,
        samples: new Int16Array(width * height),
        row: 0,
      };
    }
    if (!pendingCoast) return;
    const rows = regionTerrain.region.grid.height;
    const next = Math.min(pendingCoast.row + COAST_ROWS_PER_STEP, rows);
    fillCoastRows(
      pendingCoast.samples,
      coastSeed,
      pendingCoast.origin,
      pendingCoast.row,
      next,
      pendingCoast.shore,
      pendingCoast.spawn,
    );
    pendingCoast.row = next;
    if (next < rows) return;
    const region = coastRegion(coastSeed);
    regionTerrain = new RegionTerrain(
      region,
      new HeightField(pendingCoast.samples, region, pendingCoast.origin),
    );
    coastOrigin = pendingCoast.origin;
    pendingCoast = null;
  }

  /**
   * Slide the loaded window of islands along with the boat.
   *
   * Re-collecting on every step would be wasted work -- the window only changes
   * when the boat has actually gone somewhere -- and rebuilding the meshes when
   * the same islands come back would hitch the frame. So this runs on distance
   * travelled, and then only does anything if the island set really differs.
   */
  function streamWorld(atX: number, atY: number): void {
    reanchorIfFar(atX, atY);
    // Re-read rather than carried on. A re-anchor rewrites `state.pos` into
    // the new plane, and the arguments are the old plane's metres -- so
    // everything below was told the boat was still 200 km out. The coast was
    // rebuilt once correctly by the re-anchor, immediately again around that
    // stale point, and a third time by the next physics step putting it back:
    // three synchronous window builds, about half a second of stalled main
    // thread, at the one moment in a passage when it is guaranteed to happen.
    const { x, y } = state.pos;
    // Published here as well as after the step below, because this runs on
    // every path that *puts* her somewhere -- a restart, a settings change, a
    // region finishing its load -- and each of those left `place` describing
    // the world she had just left until the next physics step ran.
    snapshot.place = placeOf(x, y);
    slideCoast(x, y);
    if (!field) {
      // Either open water, a venue or a region, and all three are the same job:
      // one fixed terrain, installed once and never slid along. The whole place
      // is known, which is what makes a bounded region easier than the endless
      // ocean rather than harder.
      if (!published || snapshot.terrain !== venueTerrain || snapshot.region !== regionTerrain) {
        activeIslands = [];
        visibleIslands = [];
        chartIslands = [];
        published = true;
        query = regionTerrain ?? venueTerrain;
        wind.terrain = query;
        // The stream needs the same land the wind does: it is the depth that
        // decides where it runs, and it must never be reading last world's.
        currents.terrain = query;
        snapshot.terrain = venueTerrain;
        // A surveyed coast is not windowed, so the chart wants the same thing
        // the physics has. The wider window only exists to undo a windowing.
        snapshot.chart = venueTerrain;
        snapshot.region = regionTerrain;
        // The circle meshes and the region tiles are mutually exclusive, so the
        // one not in use is handed nothing and draws nothing.
        view.setTerrain(regionTerrain ? EMPTY_TERRAIN : venueTerrain, regionTerrain ? EMPTY_TERRAIN : venueTerrain);
        view.setRegion(regionTerrain);
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
    // Checked alongside the other two rather than on its own timer. It is the
    // widest window and therefore the slowest to change, so it costs a
    // comparison and saves rebuilding a hundred-island Terrain.
    const charted = field.chart(x, y);
    if (
      published &&
      sameIslands(active, activeIslands) &&
      sameIslands(visible, visibleIslands) &&
      sameIslands(charted, chartIslands)
    ) {
      return;
    }
    activeIslands = active;
    visibleIslands = visible;
    chartIslands = charted;
    published = true;

    const terrain = new Terrain(active);
    query = terrain;
    wind.terrain = terrain;
    currents.terrain = terrain;
    snapshot.terrain = terrain;
    snapshot.chart = new Terrain(charted);
    snapshot.region = null;
    view.setRegion(null);
    view.setTerrain(terrain, new Terrain(visible));
  }

  function retryRegion(): void {
    // The planet counts as part of the world to retry: it is fetched on the
    // same connection and fails for the same reasons.
    wantEarth();
    const region = regionById(current.region);
    if (!region) return;
    wantedRegion = region.id;
    requestRegion(region);
    streamWorld(state.pos.x, state.pos.y);
  }

  const ctl: Controls = { rudder: 0, sheet: 0, twist: 0, autoTrim: true };
  const reefState: ReefState = { reef: 0, jibFurl: 0, timer: 0 };
  let autoReefOn = true;
  let accumulator = 0;
  let last = performance.now();
  let diag: Diagnostics | null = null;

  /** The last binocular power handed to the view. See `applySettings`. */
  let pushedPower = NaN;

  function applySettings(s: Settings): void {
    const venueChanged = s.venue !== current.venue || s.region !== current.region;
    const worldChanged =
      s.islandCount !== current.islandCount ||
      venueChanged ||
      s.region !== current.region ||
      s.seed !== current.seed;
    const cruiseChanged = s.cruise !== current.cruise;
    current = s;
    /*
     * Pushed only when the stored power has actually moved, never on every
     * settings write.
     *
     * The wheel changes the power out in the view and it is only written down
     * when the glasses come down, so between those two moments the view holds
     * a newer number than the settings do. Pushing unconditionally meant that
     * touching any unrelated slider -- opening the menu with the glasses up and
     * nudging the wind -- shoved the old stored power back over it. NaN to
     * start with, so the first call always seeds.
     */
    if (s.binocularPower !== pushedPower) {
      pushedPower = s.binocularPower;
      view.setBinocularPower(s.binocularPower);
    }

    // Arriving at a venue brings its breeze with it: its land is laid out
    // around that direction, so a venue picked mid-session was otherwise
    // arranged for one wind and sailed in another. Only on arrival, so that
    // Q/E still work afterwards and a later edit does not undo them.
    if (venueChanged) {
      windShift = 0;
      const arriving = regionById(s.region)?.conditions ?? venueById(s.venue);
      if (arriving) wind.baseTwd = arriving.windTwd;
      // And arriving on the Earth brings the belt's, on exactly the same
      // argument. Without this, switching to the planet mid-session left her
      // sailing the last world's breeze while the ease crept toward the belt
      // over four minutes -- the panel naming the westerlies over a wind
      // still blowing from the north. Guarded by `venueChanged` like the
      // line above, so Q/E and a later slider edit are not undone.
      else if (s.region === COAST_ID) {
        wind.baseTwd = climateAt(toLatLon(oceanAnchor, state.pos.x, state.pos.y).lat).twd;
      }
    }

    wind.baseTws = meanTws(state.pos.x, state.pos.y);
    // The tide is not weather: it runs at the rate it runs whatever the front
    // overhead is doing, so it is set straight from the player's number and
    // never scaled by `weather.state`. This is the rate in deep water; where
    // the boat actually is, the field decides.
    //
    // The rate at its full run, now that the stream turns -- `tideRate` below
    // takes it down to slack and back the other way on the world clock.
    fullStream = currentVec(s);
    streamNow.x = fullStream.x;
    streamNow.y = fullStream.y;
    currents.peak = streamNow;
    // How often the sea has something in it. Set on both, because the player
    // sets one slider and they are two fields.
    whales.spacing = wildlifeSpacing(s);
    sharks.spacing = whales.spacing;
    wind.gustiness = s.gustiness * weather.state.gustScale;
    wind.shiftAmplitude = 0.19 * s.gustiness * 2.2;
    waves.setFromWind(wind.baseTws * s.seaScale, wind.baseTwd);
    weather.evolve = s.weatherMode === 'auto';
    if (s.weatherMode !== 'auto') weather.set(s.weatherMode);
    sound.setEnabled(s.sound);
    snapshot.soundOn = s.sound;
    if (worldChanged) rebuildWorld();
    // Toggled mid-session, the hand appears or goes without a restart. After a
    // rebuild the world under the old hand is gone, so it is dealt again too --
    // `placeAtStart` does the same for the paths that come through it, and a
    // settings-only rebuild (resume, not put to sea) does not.
    if (cruiseChanged || worldChanged) dealCalls();
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
    // fast wherever she had just been put to sea, with the hint
    // bar cheerfully reporting that she was at anchor.
    anchored = false;
    snapshot.anchored = false;
    // A teleport swings the wind angle however it lands, and the tracker must
    // not read that jump as the bow going through the wind.
    maneuvers.reset();
    snapshot.maneuver = null;
    // A flare does not survive the teleport, and neither does the wait for
    // the next one: a fresh session starts with a full locker.
    flareState = null;
    flareCooldown = 0;
    flareDeniedFor = 0;
    snapshot.flare = null;
    snapshot.flareReady = true;
    snapshot.flareWait = null;

    const up = compassVec(wind.baseTwd);
    const heading = wrap2Pi(wind.baseTwd + 100 * DEG);
    // Re-derived here because the physics loop's own refresh has not run yet:
    // `newSession` reseeds the weather, and a departure prepared for the old
    // session's wind scale would be trimmed for weather she is not in.
    wind.baseTws = meanTws(0, 0);
    // Trimmed and reefed for the conditions before the lines are slipped,
    // and heeled to her sailing angle -- she is under way, not at a dock.
    // See departure.ts for why this is a settle and not a wind table. The
    // *mean* wind on purpose, not the first local sample: a crew reefs for
    // the day, not for the puff blowing through at the moment they leave.
    // The gust field can sit a reef-threshold to either side of the mean,
    // and the auto-reef, starting from an honest average, takes it from
    // there.
    const ready = prepareDeparture(CRUISER, wind.meanEnv(DEFAULT_ENV), heading);
    spawn = { x: -up.x * 90, y: -up.y * 90 };
    state = initialState({
      pos: { ...spawn },
      heading,
      u: 2.2,
      sheet: ready.sheet,
      twist: ready.twist,
      reef: ready.reef,
      jibFurl: ready.jibFurl,
      heel: ready.heel,
      // The auto-reef judges the average; starting it at zero would describe
      // a boat that is not there. See Departure.heel for the measured margin
      // this avoids depending on.
      heelAvg: ready.heel,
    });
    snapshot.state = state;
    reefState.reef = ready.reef;
    reefState.jibFurl = ready.jibFurl;
    reefState.timer = 0;
    // The helm persists now, so a session must not start with the last one's
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
    // And the cruise starts over with it: the tally is a session's, and the
    // salt returns to zero so a pinned world's first hand is always the same
    // hand. Dealt only now, after the world above is installed -- an offer
    // judged against the previous world's water would be judged against
    // nothing.
    callSalt = 0;
    snapshot.callsMade = 0;
    dealCalls();
  }

  /**
   * A new sea every time she puts to sea, unless the player has pinned one.
   *
   * Sailing the identical archipelago every time was the single thing that made
   * an endless ocean feel small: whatever the boat did, the same island was
   * always the same water. The rolled seed is written back to the
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
      // Announced on a microtask, not now. The engine rolls its first world
      // during construction, before the caller has had a chance to subscribe --
      // so a synchronous emit was heard by nobody and the settings kept, and
      // showed, a seed the boat was not sailing in.
      queueMicrotask(() => emit({ type: 'world', seed }));
    }
    // The clock belongs to the session too. `hour` was read once when the
    // engine was built, so the Start hour setting did nothing after the first
    // load and every session began wherever the last one's clock had wandered to.
    hour = current.startHour;
    // So does the wind's direction at a venue. It has no slider -- the land is
    // laid out around it, and a beat that started on a random bearing would put
    // the course somewhere the place was not designed for. Free to shift with
    // Q/E afterwards, like anywhere else.
    const place = regionById(current.region)?.conditions ?? venueById(current.venue);
    if (place) wind.baseTwd = place.windTwd;
    // And so does the belt's, out on the open coast, where there is no venue
    // to say what the wind does. *Snapped* here rather than eased: the ease
    // below exists so a boat sailing north into the westerlies finds them
    // gradually, but a session opening in the trades must open with the
    // trades blowing -- otherwise she is trimmed and reefed at the dock for
    // a wind that spends the next four minutes swinging out from under her.
    windShift = 0;
    // The departure the player chose, taken now and only now.
    if (departure) {
      oceanAnchor = { ...departure };
      departure = null;
    }
    // And her position is worth writing down again, from here.
    keeping = true;
    // The pin first: the belt below is read at the plane's origin, and the
    // origin means nothing until the pin is where this session's world says.
    pinForWorld();
    // The plane's origin, not where she is: `placeAtStart` is about to put
    // her within ninety metres of it.
    const opening = beltFor(0, 0);
    if (opening) wind.baseTwd = opening.twd;
    session++;
    snapshot.session = session;
    weather.reseed(current.seed);
    wind.reseed(current.seed);
    wildlife.reseed(current.seed);
    whales.reseed(current.seed);
    // Ids restart with the world, so a stale one would silence the first blow.
    blownFor = 0;
    // Nothing has been solved in this world yet, and the animals below read
    // `diag.cog` before the first step of it. Left set, the first step of a
    // restart handed them the course the *last* passage was making, which is
    // the same carried-over-state mistake as the sea's clock and the wildlife
    // generators before it. No sighting is ever open on step one -- they have
    // just been reseeded -- so this fixes a wrong number rather than a wrong
    // encounter, but it also makes the fallback below say what it means.
    diag = null;
    snapshot.diag = null;
    // And a blow already scheduled belongs to an ocean that no longer exists.
    sound.silencePending();
    sharks.reseed(current.seed);
    // The stream is at its full run again: `hour` has just been put back to the
    // start hour, which is what the tide is measured from. Set here as well as
    // in the step below, because the sea is built from it three lines down and
    // would otherwise be raised on whatever the last session's tide had reached.
    streamNow.x = fullStream.x;
    streamNow.y = fullStream.y;
    // A new session starts with the sea its weather implies, not the one the
    // last session left behind.
    // Seeded from the same relative wind the step uses, not from the breeze
    // alone. With the clock stopped the easing below never runs, so a session
    // that started on the wrong number would have shown that sea for ever.
    // The weather is settled *before* the sea is raised on it. Pinned to a
    // mode, `set` moves the wind scale, and the sea was being built a line
    // earlier from whatever scale the seeded opener happened to have.
    weather.evolve = current.weatherMode === 'auto';
    if (current.weatherMode !== 'auto') weather.set(current.weatherMode);
    seaTws = len(
      sub(scale(compassVec(wind.baseTwd), -meanTws(0, 0)), currents.peak),
    );
    // ...and the sea's own clock with it. `seaTws` decides how big the waves
    // are; this decides where in them she starts, and it was the one piece of
    // world state a new session inherited from the last.
    waves.restart();
    rebuildWorld();
  }

  function setDestination(pos: Vec2 | null): void {
    // A click near an offered call means the call, exactly. Judged here rather
    // than in the chart so one rule serves every chart scale, and snapped to
    // the call's own coordinates because completion is judged by them: a
    // destination a fingertip's width off would sail the passage and then not
    // count it.
    if (pos && current.cruise) {
      let nearest: Vec2 | null = null;
      let best = CALL_SNAP;
      for (const call of snapshot.calls) {
        const d = Math.hypot(call.x - pos.x, call.y - pos.y);
        if (d < best) {
          best = d;
          nearest = call;
        }
      }
      if (nearest) pos = { ...nearest };
    }
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
      // Where she was, whichever kind of place it is. The field is named for
      // the venue that used to be the only answer; the id it holds is now a
      // region's as often as not, and `placeName` resolves either.
      current.region || current.venue,
    );
    log = null;
    // Was that a port of call? Judged before the destination is cleared, on
    // the coordinates the click snapped to -- the tolerance here is for float
    // copies, not for nearness, which the snap already settled.
    const called = current.cruise
      ? snapshot.calls.some(
          (c) => Math.hypot(c.x - destination!.x, c.y - destination!.y) < 1,
        )
      : false;
    setDestination(null);
    if (called) {
      snapshot.callsMade += 1;
      // A fresh hand from where she now lies, so the cruise walks the coast
      // rather than orbiting the first anchorage.
      dealCalls();
    }
    // Written without waiting: a failed write must not stall the physics loop.
    //
    // `logbookSaved` follows the commit rather than the request, and it is what
    // the panels reload on. Announcing it any earlier -- when the record is
    // handed over rather than when the transaction lands -- would let the read
    // go out beside the write and come back without it, and nothing bumps a
    // second time, so the last passage of a session would simply be missing.
    void logbook.add(record).then(
      () => emit({ type: 'logbookSaved', record }),
      (err) => {
        const unavailable = err instanceof LogStoreUnavailable;
        // Said once. It is one standing fact about this session, and repeating
        // it at the end of every passage is noise in the console for the same
        // reason it was an interruption on screen.
        if (!unavailable || !reportedUnavailable) {
          console.error('could not save the passage', err);
          reportedUnavailable ||= unavailable;
        }
        emit({ type: 'logbookError', operation: 'add', reason: unavailable ? 'unavailable' : 'write' });
      },
    );
  }

  function putToSea(): void {
    if (current.region && snapshot.regionStatus !== 'ready') return;
    newSession();
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
    /*
     * The stream turns.
     *
     * Set from the world hour every step rather than held anywhere, so every
     * consumer follows without being told: the boat's drift, the chart's
     * arrows, the sea built from the wind over moving water, and the
     * displacement the waves and the wake are carried by. Nothing here has a
     * clock of its own to leave running across a restart.
     */
    const tide = tideRate(hour, current.startHour, current.tideHours);
    streamNow.x = fullStream.x * tide;
    streamNow.y = fullStream.y * tide;
    // Weather keeps world time, not wall-clock time: a front takes hours to
    // come through, and those are the same hours the sun is moving through.
    // Its transitions are eased in real seconds, though -- how fast a squall
    // *looks* like it arrives is a matter of what reads as weather rather than
    // as a glitch, and that does not speed up just because the clock does.
    weather.update(PHYS_DT, PHYS_DT * current.timeScale);
    // Thunder belongs to the strike, not to any frame after it: scheduled
    // once, on the step the bolt goes off, and heard when the sound of it
    // has crossed the distance -- the same speed-of-sound honesty as the
    // whale's blow and the flare's pop.
    if (weather.state.struck && weather.state.lightning) {
      // Held rather than played straight through: the audio context is
      // asleep until the first gesture and simply refuses while suspended,
      // and `struck` is true for one step -- so a bolt that struck a moment
      // before the player touched anything used to be silent forever. The
      // queue is drained below, and a strike whose thunder never became
      // audible is dropped once it is older than its own sound could be.
      pendingThunder.push({
        distance: weather.state.lightning.distance,
        power: weather.state.lightning.power,
        waited: 0,
      });
    }
    for (let i = pendingThunder.length - 1; i >= 0; i--) {
      const th = pendingThunder[i];
      th.waited += PHYS_DT;
      if (sound.thunder(th.distance, th.power) || th.waited > th.distance / 343) {
        pendingThunder.splice(i, 1);
      }
    }

    /*
     * Weather drives the mean wind, so re-derive it every step rather than
     * only when a setting changes -- and on the generated Earth the
     * *latitude* drives it too.
     *
     * The belts are the point of the planet: the trades, the westerlies and
     * the two calms between them are why one sea is not another, and why a
     * passage plan is a latitude plan. So where the world is the Earth, the
     * climatology sets the direction outright -- a compass bearing has no
     * slider to respect -- and scales the player's own wind speed rather
     * than replacing it, so a setting of 25 knots is still a hard sail
     * wherever she is.
     *
     * A surveyed region keeps its own conditions and a venue keeps the
     * player's: those places were laid out around a particular breeze, and
     * a belt reaching in to turn it would undo the thing that makes them
     * worth sailing.
     */
    const climate = beltFor(state.pos.x, state.pos.y);
    if (climate) {
      wind.baseTws = meanTws(state.pos.x, state.pos.y);
      // Eased rather than set: the wind must swing as she sails into the
      // next belt, not snap when a smoothstep crosses a half.
      wind.baseTwd = approachAngle(
        wind.baseTwd,
        wrap2Pi(climate.twd + windShift),
        CLIMATE_TAU,
        PHYS_DT,
      );
      wind.gustiness = climate.gustiness * weather.state.gustScale;
      snapshot.belt = climate.belt;
    } else {
      wind.baseTws = meanTws(state.pos.x, state.pos.y);
      wind.gustiness = current.gustiness * weather.state.gustScale;
      snapshot.belt = null;
    }

    // And the polar has to follow it too, for the same reason and by the same
    // argument as the sea below. It was solved for one wind speed and only ever
    // re-solved when a setting moved, so a front coming through left the curve
    // -- and the card's header, which quotes the wind it was solved at -- drawn
    // for a breeze that was no longer blowing.
    //
    // Only when nothing is already on its way. `schedulePolar` restarts its own
    // debounce, so calling it every step would push the timer out for ever and
    // the solve would never start at all. This is affordable now and was not
    // before: it costs a second of a worker rather than a second of the frame.
    if (snapshot.polar && !snapshot.polarBusy && polarStale(snapshot.polar, wind.baseTws)) {
      schedulePolar();
    }

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
    // The sea is raised by wind blowing *over the water*, so what builds it is
    // the wind relative to a surface that is itself moving. Wind against tide
    // therefore makes a bigger sea and wind with tide a smaller one -- which is
    // exactly what these places are known for, and it costs one subtraction
    // rather than a model. Two and a half knots of foul stream under a
    // twenty-knot breeze is a twenty-two-knot sea.
    const overWater = windOverWater(wind.baseTwd, wind.baseTws, currents.peak);
    seaTws = approach(seaTws, len(overWater), SEA_BUILD_TAU, PHYS_DT * current.timeScale);
    // The direction goes with the speed. Taking the magnitude of the relative
    // wind and then building the sea on the *true* wind's bearing was half the
    // change: a stream running across the breeze turns the sea as well as
    // raising it, and the boat would have met waves from a direction nothing
    // was blowing from. `seaBearing` reverses the travel direction to give the
    // bearing it is coming from.
    // Where the sea is coming from: the wind over the *water*, which a stream
    // turns as well as raising. Kept so the added resistance below is told the
    // same bearing the waves were built from.
    seaTwd = seaBearing(overWater);
    waves.setFromWind(seaTws * current.seaScale, seaTwd);

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
      ctl.rudder = pilotRudder(pilot, state.heading, env.twd, state.r, state.u);
    }

    if (autoReefOn) autoReef(reefState, state.heelAvg, state.heel, PHYS_DT);
    state.reef = reefState.reef;
    state.jibFurl = reefState.jibFurl;

    // Sample four points on the hull to get the local water surface slope.
    // Land shelters the sea in its lee, so waves are scaled by the same shelter
    // term the water shader uses.
    // Given the stream, so the wave pattern is carried along by the water it is
    // made of instead of staying pinned to the ground. `peak` rather than the
    // sample under the boat: one vector for the whole field is what the shader
    // can be handed, and the stream only varies with depth.
    waves.update(PHYS_DT, currents.peak);
    const shelter = query.waveShelter(state.pos.x, state.pos.y, wind.baseTwd);
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
    // The way the waves actually travel, from the bearing they were built on
    // rather than from the true wind. Those are the same in still water and
    // part company the moment a stream runs across the breeze -- and with the
    // stream turning they part company by more, and differently, through a
    // passage. Taking the true wind here meant the boat felt her head sea
    // coming from somewhere the water was not.
    sea.dir = seaTwd + Math.PI;
    sea.depth = query.depthAt(state.pos.x, state.pos.y);
    snapshot.depth = sea.depth;
    snapshot.clearance = sea.depth - cfg.draft;

    const wasX = state.pos.x;
    const wasY = state.pos.y;
    // Gulls run on the physics clock, so a boat that is standing in towards a
    // shore hears them come up at the rate she is closing it.
    wildlife.update(PHYS_DT, state.pos, query);


    flareCooldown = Math.max(0, flareCooldown - PHYS_DT);
    snapshot.flareReady = flareCooldown <= 0;
    flareDeniedFor = Math.max(0, flareDeniedFor - PHYS_DT);
    // Live while shown: the count runs down in front of the player rather
    // than freezing at the number the press happened to catch.
    snapshot.flareWait =
      flareDeniedFor > 0 && flareCooldown > 0 ? Math.ceil(flareCooldown) : null;
    if (flareState) {
      const fl = flareState;
      fl.age += PHYS_DT;
      if (fl.age <= FLARE_RISE) {
        // Ease-out arc: fast off the rail, slowing to an apex ahead of the
        // bow she had at launch.
        const t = fl.age / FLARE_RISE;
        const ease = t * (2 - t);
        const step = ease - ((fl.age - PHYS_DT) / FLARE_RISE) * (2 - (fl.age - PHYS_DT) / FLARE_RISE);
        fl.alt = FLARE_APEX * ease;
        fl.x += fl.bowX * FLARE_REACH * step;
        fl.y += fl.bowY * FLARE_REACH * step;
      } else {
        // Under the parachute: sinking slowly, carried down the mean wind.
        fl.alt -= FLARE_SINK * PHYS_DT;
        const down = compassVec(wind.baseTwd);
        fl.x -= down.x * wind.baseTws * FLARE_DRIFT * PHYS_DT;
        fl.y -= down.y * wind.baseTws * FLARE_DRIFT * PHYS_DT;
      }
      // Splashdown is a parachute affair: judged only after the rise, or the
      // first metres off the rail read as landing and the rocket dies on it.
      // At today's numbers it never fires -- the burn ends with the star
      // still fifty metres up, as the real thing's does -- so this guards the
      // retune that makes the sink faster or the burn longer, not a case.
      const splashed = fl.age > FLARE_RISE && fl.alt < 4;
      if (fl.age > FLARE_RISE + FLARE_BURN || splashed) flareState = null;
    }
    // Dark on the way up; the pop is a flash, not a fade-in -- a sixty
    // millisecond gate, an overshoot that decays onto the steady burn --
    // and the last seconds die away.
    snapshot.flare = flareState
      ? {
          x: flareState.x,
          y: flareState.y,
          alt: flareState.alt,
          intensity:
            smoothstep(FLARE_RISE, FLARE_RISE + 0.06, flareState.age) *
            (1 +
              FLARE_FLASH *
                Math.exp(-Math.max(0, flareState.age - FLARE_RISE) / FLARE_FLASH_TAU)) *
            smoothstep(FLARE_RISE + FLARE_BURN, FLARE_RISE + FLARE_BURN - 5, flareState.age),
        }
      : null;
    for (const ev of wildlife.events) {
      const d = Math.hypot(ev.pos.x - state.pos.x, ev.pos.y - state.pos.y);
      sound.gullCall(d, ev.strength, weather.state.fog);
    }
    // Last step's course over ground: the animals run before `step()`, so this
    // step's is not solved yet. That is 8 ms of lag at 120 Hz on a quantity the
    // give-way rule uses only to pick which beam to lean towards, and it is a
    // lag rather than a reason -- running the animals after the physics would
    // give them the current course just as well. Left alone because reordering
    // shifts every seeded wildlife stream by a step for no gain.
    //
    // Before the first step there is no course at all, and `heading` is the
    // same fallback `boat.ts` uses below 0.05 m/s.
    const course = diag ? diag.cog : state.heading;
    whales.update(PHYS_DT, state.pos, query, state.heading, course);
    for (const whale of whales.events) {
      if (whale.phase !== 'blow' || whale.id === blownFor) continue;
      // Heard, and heard late: whaleBlow schedules itself for when the sound
      // would actually arrive. At these ranges that is a second or more after
      // the spout is drawn, which is the right way round and is most of why
      // the blow is worth having -- it is how a whale is found.
      const d = Math.hypot(whale.pos.x - state.pos.x, whale.pos.y - state.pos.y);
      // Marked only if something was really scheduled. Nothing is built while
      // the audio context is suspended, and the phase runs for four seconds --
      // long enough for the browser to hand the context back inside it.
      if (sound.whaleBlow(d, whale.size, weather.state.fog)) blownFor = whale.id;
    }
    // After the whales, and given them: a shark is placed clear of whatever is
    // already in the water this step.
    sharks.update(PHYS_DT, state.pos, query, state.heading, whales.events, course);

    diag = step(state, cfg, env, ctl, PHYS_DT, { sea, anchored });
    snapshot.diag = diag;

    // Where she is, in the only coordinates that survive a re-anchoring, and
    // after the step rather than before it: written first, it described where
    // she had been at the start of the step, which is the same one-step lie
    // the diagnostics avoid by being read out here too.
    snapshot.place = placeOf(state.pos.x, state.pos.y);
    sinceSaved += PHYS_DT;
    if (sinceSaved >= KEEP_PLACE_EVERY) keepPlace();

    // Was that a tack, and what did it cost? Fed after `step()` for the same
    // reason the passage's conditions are: this step's angle and speed exist
    // only once the step has written them. The report is held on the snapshot
    // for a few seconds because the alert strip is stateless and redraws from
    // it every frame -- the engine is the only place with a clock.
    //
    // The angle to the *mean* wind, deliberately not `diag.twa`. The panel's
    // TWA is read off the local wind, and the local shift can swing that sign
    // across the bow of a boat holding her course -- a Codex round showed a
    // pinched boat in shifty air arming phantom turns, and a real tack being
    // read as an abort when the shift swung back mid-turn. A maneuver is a
    // thing the boat does, so it is measured against the frame that does not
    // move under her.
    const finished = maneuvers.update(
      wrapPi(wind.baseTwd - state.heading),
      diag.speed,
      PHYS_DT,
    );
    if (finished) {
      snapshot.maneuver = finished;
      maneuverTtl = MANEUVER_SHOWN;
    } else if (snapshot.maneuver !== null) {
      maneuverTtl -= PHYS_DT;
      if (maneuverTtl <= 0) snapshot.maneuver = null;
    }

    // Judged where she is, every step, because the answer is what the player is
    // reading while deciding whether to round up here or carry on a bit further.
    snapshot.anchorage = anchorage(query, cfg, state.pos, diag.sog, wind.baseTwd);
    // Real seconds, not world ones: a passage took as long as it took to sail,
    // and the time scale is a convenience for watching the sun rather than a
    // claim about how long the boat was at sea.
    if (log && !anchored) log.advance(diag.sog, msToKnots(env.tws), PHYS_DT);

    // What the passage was like, as against how far it got.
    //
    // After `step()` rather than up with the animals that fill the sighting
    // lists, and that is not tidiness: `state.heel` is only this step's heel
    // once `step()` has written it, and read before it the running maximum
    // would sample every step one late and drop the last one altogether. The
    // event lists stand until the next `update()`, so they are just as readable
    // from here.
    //
    // None of it is gated on `anchored`, which the line above is. Distance and
    // seconds measure how the miles were made and lying to an anchor makes none
    // of them; these say what happened, and a whale that surfaced while she
    // waited out a squall halfway to somewhere was still seen on that passage
    // -- as was the squall.
    if (log) {
      log.conditions(
        { weather: weather.state.kind, hour, heel: state.heel, seaHeight: sea.h13 },
        PHYS_DT,
      );
      for (const whale of whales.events) log.sight('whales', whale.id);
      for (const shark of sharks.events) log.sight('sharks', shark.id);
    }

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
        sound.update(state, diag, waves, weather.state, wall, currents.peak);
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
    // One flare every couple of minutes. The press during the wait is not
    // taken -- a flare is not a thing a locker holds hundreds of -- but it
    // is *answered*: three seconds of the hint bar saying how long, because
    // a key that does nothing silently reads as a key that is broken.
    if (input.wasPressed('u') && flareCooldown > 0) flareDeniedFor = 3;
    if (input.wasPressed('u') && flareCooldown <= 0) {
      const bow = compassVec(state.heading);
      flareState = { age: 0, x: state.pos.x, y: state.pos.y, alt: 0, bowX: bow.x, bowY: bow.y };
      flareCooldown = FLARE_COOLDOWN;
      // Told to the snapshot here as well as in the physics step: a frame
      // that accumulates less than one step would otherwise leave the touch
      // key lit a frame after the locker emptied. Cosmetic -- the cooldown
      // itself already refuses a second press -- but a lit key that does
      // nothing is a broken key to the finger on it.
      snapshot.flareReady = false;
      // The pop is heard when the sound of it arrives from the apex -- the
      // slant range, since the star stands ahead as well as up: review
      // measured the altitude-only delay arriving three quarters of a
      // second early.
      sound.flare(FLARE_RISE + Math.hypot(FLARE_REACH, FLARE_APEX) / 343);
    }
    // Resolves a frame later -- see SceneView.capture -- so this cannot be
    // written as a plain call. A refusal from the encoder is silent on purpose:
    // there is nothing the player could do about it and nothing worth stopping
    // a passage for.
    if (input.wasPressed('k')) {
      // The passage as it stands now, and not as it stands when the capture
      // comes back a frame later: a picture taken on this passage belongs to it
      // even if the destination is cleared in the meantime.
      //
      // It does not close the race, and that is deliberate. `arrive()` is
      // synchronous and the encoder is not, so anchoring in the same frame as
      // photographing -- which is an ordinary thing to do at the end of a
      // passage -- finishes the record before the count lands, and the count
      // then reaches a log already read out into a plain row. The photograph is
      // lost. Closing it the other way, by counting the press and rolling back
      // on a refusal, trades an incomplete record for a false one: a logbook
      // saying two when three were taken is missing something, while one saying
      // three when two exist is wrong, and the player finds out by going to look
      // for a file. Under-counting is the right direction to fail in, and
      // `engine.test.ts` pins it so the next change cannot flip it by accident.
      const onPassage = log;
      void view.capture().then((blob) => {
        if (!blob) return;
        onPassage?.photographed();
        emit({ type: 'photo', blob });
      });
    }
    if (input.wasPressed('b')) {
      snapshot.binoculars = !snapshot.binoculars;
      // Only on the way down. Up, the stored power is what they open at; down,
      // whatever the wheel left is what they should open at next time.
      if (!snapshot.binoculars) emit({ type: 'binocularPower', power: view.binocularPower() });
    }
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
    if (input.wasPressed('r')) putToSea();
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
    // `0` hands every stitch, which is what a crew does to stop rather than to
    // sail slower. It sits with the reef keys because that is where a player
    // looks for how much sail is up, and it turns the auto-reef off: leaving it
    // on would have the crew setting sail again the moment she heeled.
    if (input.wasPressed('0')) {
      state.stowed = !state.stowed;
      if (state.stowed) {
        autoReefOn = false;
        snapshot.autoReef = false;
      }
    }
    for (let i = 0; i <= MAX_REEF; i++) {
      if (input.wasPressed(String(i + 1))) {
        // Asking for a reef is asking for sail, so it puts her back to work.
        state.stowed = false;
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
      const turn = input.windShift * 25 * DEG * wall;
      wind.baseTwd = wrap2Pi(wind.baseTwd + turn);
      // Remembered, not just applied. On the Earth the mean wind is eased
      // toward the belt's every step, so a shift written straight into
      // `baseTwd` was quietly wound back out again -- four time constants
      // after the key came up, 98% of it was gone. Q/E now moves the boat's
      // wind *relative to* the belt, which is what a player asking for a
      // different beat means by it, and the belt still decides the rest.
      windShift = wrapPi(windShift + turn);
      waves.setFromWind(wind.baseTws * current.seaScale, wind.baseTwd);
    }
  }

  function render(dt: number): void {
    if (!diag) return;
    view.render({
      state,
      diag,
      wind,
      waves,
          sky: snapshot.sky,
      weather: weather.state,
      // `hour` is unwrapped and counts on from the session's start hour, which
      // is exactly the monotonic world clock the sky effects want.
      elapsedHours: hour,
      visibility: weather.visibility,
      lightsOn: snapshot.lightsOn,
      flare: snapshot.flare,
      binoculars: snapshot.binoculars,
      session,
      whales: whales.events,
      sharks: sharks.events,
      gullFlocks: wildlife.flocks,
      dt,
    });
  }

  applySettings(settings);
  rebuildWorld();
  // Build the initial paused scene even when a surveyed raster is still in
  // flight. The public `putToSea` path remains guarded so a click cannot turn
  // that placeholder into a playable world.
  newSession();
  placeAtStart();
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
    startAudio() {
      void sound.start();
    },
    putToSea,
    retryRegion,
    setDestination,
    setPaused(p) {
      paused = p;
      snapshot.paused = p;
      // A flash does not wait behind the menu. The physics stops while
      // paused, so a bolt caught mid-stutter used to hang lit on the frozen
      // scene -- and its thunder, already scheduled, would arrive over a
      // photograph. Cleared on the way in; the storm carries on when the
      // world does.
      if (p) {
        weather.state.lightning = null;
        weather.state.flash = 0;
        weather.state.struck = false;
      }
      /*
       * And drop whatever was pressed on the way through the boundary.
       *
       * Escape is the case that made this necessary. Closing the menu with it
       * did nothing visible, because it did two things: the dialog's own
       * handler closed it, and the same press was still sitting in `pressed`
       * when React unpaused the engine -- so the very next frame read it, ran
       * the branch below, and reopened the menu.
       *
       * The `!paused` guard on that branch cannot prevent this. It is evaluated
       * at frame time and the unpause happens first; the press has to be
       * discarded at the boundary itself, which is here.
       */
      input.clearPending();
      // Reset the clock so unpausing does not jump the world forward.
      last = performance.now();
      accumulator = 0;
    },
    applySettings,
    toggleCamera: () => view.toggleCamera(),
    setHelm(v) {
      // A hand on the helm takes her off the pilot, exactly as the keys do.
      if (pilot.mode !== 'off') pilot.mode = 'off';
      ctl.rudder = clamp(v, -1, 1);
    },
    press: (key) => input.inject(key),
    recomputePolar: () => schedulePolar(0),
    resize: () => view.resize(),
    setDeparture(place) {
      if (place) saveReckoning(place);
      else clearReckoning();
      // Held for the next departure rather than applied to this session's
      // pin: she is still where she is, which is what the menu says.
      departure = place ? { lat: place.lat, lon: place.lon } : { ...DEFAULT_ANCHOR };
      // And nothing more is written down until she takes it. The record is
      // one row, so going on recording this session would put her current
      // position back over the choice within the half minute.
      keeping = false;
      sinceSaved = 0;
    },

    dispose() {
      // Quitting deliberately keeps the last of it; the throttle above may
      // be twenty-nine seconds from its next write.
      keepPlace();
      disposed = true;
      cancelAnimationFrame(raf);
      input.dispose();
      sound.dispose();
      view.dispose();
      if (polarTimer !== null) clearTimeout(polarTimer);
      // The thread as well as the timer. A solve already running would
      // otherwise finish against a session that has gone, and it is more than a
      // second of CPU that nothing is waiting for.
      polarSolver?.dispose();
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
