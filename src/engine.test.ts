import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The loop, driven headlessly.
 *
 * `engine.ts` is the largest file in the project and had no test at all, for a
 * reason that looked like a good one: it builds a WebGL scene, an audio graph
 * and a keyboard listener, so it cannot be constructed in node. That argument
 * covers those three things and nothing else. What it was also protecting was
 * the per-step wiring -- which quantity is handed to which model, in what order
 * -- and that is simulation, is where the interesting mistakes are, and is
 * exactly what a Codex review found untested when the give-way rule was given
 * the boat's course over ground.
 *
 * So the browser is mocked and nothing else is. Every model the engine drives
 * is the real one, and every assertion below is about what the engine did to
 * them. The mocks are stand-ins for collaborators whose behaviour is not under
 * test; where an assertion needs to see a value cross a boundary it spies on
 * the real class rather than replacing it.
 *
 * No production code was changed to make this possible.
 */

const sceneCalls: { render: number } = { render: 0 };
const regionLoad = vi.hoisted(() => vi.fn());
const earthLoad = vi.hoisted(() => vi.fn());
const logAdd = vi.hoisted(() => vi.fn<(record: unknown) => Promise<void>>());
/**
 * Let the boat anchor where she is, for the two tests about completing a
 * passage.
 *
 * The real judgement runs and is only overridden when a test asks, because what
 * makes an anchorage is `anchorage.test.ts`'s question and not this file's.
 * Without it a passage cannot be completed here at all: anchoring is the only
 * thing that finishes one, and the open ocean is deliberately too deep.
 */
const anchorAnywhere = vi.hoisted(() => ({ on: false }));
/**
 * What the renderer hands back for a screenshot.
 *
 * Settable because the difference between a picture and no picture is the whole
 * of what the logbook is being asked to record, and the mock returned `null`
 * unconditionally -- so the successful half of this had no coverage at all.
 */
const capture = vi.hoisted(() => ({ blob: null as Blob | null }));

vi.mock('./view/scene', () => ({
  createScene: () => ({
    render: () => {
      sceneCalls.render++;
    },
    setTerrain: () => {},
    setRegion: () => {},
    toggleCamera: () => {},
    capture: async () => capture.blob,
    setBinocularPower: () => {},
    binocularPower: () => 5,
    resize: () => {},
    dispose: () => {},
  }),
}));

/**
 * Silence, and deliberately not a hand-written list of the methods the engine
 * happens to call today. Sound is a collaborator whose behaviour nothing here
 * asserts, so the stub answers to whatever it is asked; writing the surface out
 * would mean this file failing whenever `audio.ts` grows a method, which is a
 * tax on an unrelated file for no coverage.
 *
 * `whaleBlow` returns whether a sound was really scheduled, and the engine uses
 * that to decide it has been heard. False, so the path that fires every step is
 * the one exercised.
 */
const silent = () =>
  new Proxy(
    {},
    {
      get: (_t, key) => (key === 'whaleBlow' ? () => false : () => undefined),
    },
  );

vi.mock('./view/audio', () => ({ SoundEngine: class { constructor() { return silent(); } } }));

vi.mock('./view/telemetry', () => ({
  Telemetry: class {
    channels: unknown[] = [];
    push() {}
    forEach() {}
    clear() {}
  },
}));

/**
 * Region rasters and the globe are fetched over the network.
 *
 * `loadEarth` resolves from a real `Earth` built on a *stub* raster, not the
 * shipped 29 MB one: what these tests ask is whether the engine wires a
 * planet into its windows and its readouts, not whether NOAA has the
 * Atlantic in the right place -- `earth.test.ts` asks that, of the real
 * file. The stub is land in the northern half and sea in the southern, so
 * "is there a coast here" has a knowable answer.
 */
vi.mock('./terrain-load', () => ({ loadRegion: regionLoad, loadEarth: earthLoad }));

/** IndexedDB. The passage log is asserted through the engine's own event. */
vi.mock('./sim/anchorage', async (importActual) => {
  const actual = await importActual<typeof import('./sim/anchorage')>();
  return {
    ...actual,
    anchorage: (...args: Parameters<typeof actual.anchorage>) => {
      const real = actual.anchorage(...args);
      return anchorAnywhere.on
        ? { ...real, holding: 'good' as const, slowEnough: true, canAnchor: true }
        : real;
    },
  };
});

vi.mock('./logbook', async (importActual) => ({
  ...(await importActual<typeof import('./logbook')>()),
  logbook: { add: logAdd, all: async () => [], clear: async () => undefined },
}));

/**
 * The hand of calls, real by default and dealt from the test's fingers when a
 * test needs the boat already standing at one -- sailing a real kilometre to a
 * real cove is minutes of wall clock this file does not have. The spy wrapper
 * is what lets the salt be asserted: the fresh-hand-per-completion rule lives
 * entirely in which arguments the engine passes.
 */
const callsOverride = vi.hoisted(() => ({ hand: null as { x: number; y: number }[] | null }));
vi.mock('./sim/calls', async (importActual) => {
  const actual = await importActual<typeof import('./sim/calls')>();
  return {
    ...actual,
    offerCalls: vi.fn((...args: Parameters<typeof actual.offerCalls>) =>
      callsOverride.hand ?? actual.offerCalls(...args),
    ),
  };
});

/**
 * How many whole coast windows have been built, so a test can say that
 * re-anchoring costs one and not three. Counted rather than timed: the
 * number of builds is the property, and a timing assertion would be a
 * different test on every machine.
 */
vi.mock('./sim/coast', async (importActual) => {
  const actual = await importActual<typeof import('./sim/coast')>();
  return {
    ...actual,
    coastHeightField: vi.fn((...args: Parameters<typeof actual.coastHeightField>) =>
      actual.coastHeightField(...args),
    ),
  };
});

import { FLARE_BURN, FLARE_COOLDOWN, FLARE_RISE, REANCHOR_AT, createEngine } from './engine';
import { coastHeightField } from './sim/coast';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { WhaleField } from './sim/whales';
import { SharkField } from './sim/sharks';
import { DEG, wrapPi } from './sim/math';
import { TIDE_PERIOD } from './sim/current';
import { LogStoreUnavailable } from './logbook';
import type { EngineEvent } from './engine';
import { METRES_PER_DEG_LAT } from './sim/globe';
import { ManeuverTracker, type Maneuver } from './sim/maneuver';
import { offerCalls } from './sim/calls';
import { anchorage } from './sim/anchorage';
import { Earth } from './sim/earth';
import { CRUISER } from './sim/config';
import type { PassageRecord } from './sim/passage';
import type { RegionTerrain } from './sim/region-terrain';

/**
 * A whole planet at one degree a cell: land north of 30N, sea everywhere
 * else.
 *
 * Coarse on purpose -- what the engine has to get right is "did a shoreline
 * reach the window", not any real coast -- but not *too* coarse. The first
 * stub was two rows of 90-degree cells, and the sampler's bilinear
 * interpolation duly read 37N as most of the way from the pole to the
 * equator and called it sea, so a correctly wired engine looked broken. A
 * degree a cell is finer than the window and the trap goes away.
 */
function stubEarth(): Earth {
  const grid = { width: 360, height: 180, arcMinutes: 60 };
  const samples = new Int16Array(grid.width * grid.height);
  for (let row = 0; row < grid.height; row++) {
    const lat = 90 - row;
    for (let col = 0; col < grid.width; col++) {
      samples[row * grid.width + col] = lat > 30 ? 500 : -4000;
    }
  }
  return new Earth(samples, grid);
}

/**
 * Enough of a browser for the engine to start: it listens for a gesture to
 * unlock audio, schedules the polar solve, and drives itself off rAF.
 *
 * rAF is captured rather than run. A test that let the engine schedule its own
 * frames would be racing it; instead the callback is held and called with the
 * timestamps the test chooses. Most tests below do not use it at all --
 * `advance()` runs the same physics without a frame in sight -- and only the
 * one that is about the loop needs frames to happen.
 */
let frames: FrameRequestCallback[] = [];
/**
 * Window listeners the engine registered, so a key can actually be pressed.
 *
 * The shim used to swallow them, which quietly put every keyboard-driven
 * behaviour out of reach of this file -- anchoring among them, and anchoring is
 * the only way a passage ever completes.
 */
let listeners = new Map<string, ((e: unknown) => void)[]>();
const saved: Record<string, unknown> = {};
const had: Record<string, true> = {};
const GLOBALS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'];

beforeEach(() => {
  frames = [];
  sceneCalls.render = 0;
  regionLoad.mockReset();
  earthLoad.mockReset();
  earthLoad.mockImplementation(() => Promise.resolve(stubEarth()));
  logAdd.mockReset();
  logAdd.mockResolvedValue(undefined);
  anchorAnywhere.on = false;
  capture.blob = null;
  callsOverride.hand = null;
  (offerCalls as ReturnType<typeof vi.fn>).mockClear();
  for (const key of GLOBALS) {
    if (key in globalThis) {
      had[key] = true;
      saved[key] = (globalThis as Record<string, unknown>)[key];
    }
  }

  listeners = new Map();
  (globalThis as Record<string, unknown>).window = {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      const same = listeners.get(type) ?? [];
      same.push(fn);
      listeners.set(type, same);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    devicePixelRatio: 1,
  };
  // `Input` watches for the tab going away, so that keys are not left held.
  (globalThis as Record<string, unknown>).document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    hidden: false,
  };
  (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  };
  (globalThis as Record<string, unknown>).cancelAnimationFrame = () => {};
});

afterEach(() => {
  vi.restoreAllMocks();
  // Deleted rather than set to undefined where there was nothing before, so a
  // later file's `'window' in globalThis` sees what it would have seen.
  for (const key of GLOBALS) {
    if (key in had) (globalThis as Record<string, unknown>)[key] = saved[key];
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

const canvas = () =>
  ({
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ width: 1280, height: 760, left: 0, top: 0 }),
    clientWidth: 1280,
    clientHeight: 760,
    style: {},
  }) as unknown as HTMLCanvasElement;

const settings = (over: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  randomWorld: false,
  ...over,
});

/** Press and release a key, the way `Input` expects to hear about it. */
function press(key: string): void {
  for (const fn of listeners.get('keydown') ?? []) fn({ key, repeat: false, preventDefault: () => {} });
  for (const fn of listeners.get('keyup') ?? []) fn({ key, preventDefault: () => {} });
}

/**
 * Hand the engine frames the way a browser would.
 *
 * The callback is held rather than scheduled, so the test decides when each
 * frame happens. The engine caps catch-up, so time has to arrive in frames and
 * not in one enormous jump.
 *
 * The timestamps start from `performance.now()` and not from zero, because rAF
 * and `performance.now()` share a clock in a browser and the engine takes its
 * first `last` from the latter. Counting from zero makes the first delta hugely
 * negative -- there is no lower clamp on it, only `MAX_CATCHUP` above -- and
 * the accumulator then owes so much time that the physics does not run for
 * thousands of frames. Which is not something the engine has to defend against;
 * it is the test handing it a timestamp no browser would.
 */
function frame(seconds: number, msPerFrame = 16): void {
  let t = performance.now();
  const steps = Math.round((seconds * 1000) / msPerFrame);
  for (let i = 0; i < steps; i++) {
    const cb = frames.shift();
    if (!cb) return;
    t += msPerFrame;
    cb(t);
  }
}

/** A session under way, which is what every test below needs first. */
function sailing(over: Partial<Settings> = {}) {
  const engine = createEngine(canvas(), settings(over));
  engine.putToSea();
  return engine;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('engine', () => {
  /**
   * Sail somewhere and anchor there, which is the only way a passage completes.
   * Returns every event the engine emitted, in order.
   */
  async function makePassage(
    /** Anything to do between setting out and letting go the anchor. */
    onTheWay?: () => Promise<void> | void,
  ): Promise<EngineEvent['type'][]> {
    anchorAnywhere.on = true;
    const engine = sailing();
    const seen: EngineEvent['type'][] = [];
    engine.onEvent((e) => seen.push(e.type));
    engine.setDestination({ ...engine.snapshot.state.pos });
    await onTheWay?.();
    press('a');
    frame(0.1);
    // The write is a promise; let it settle.
    await Promise.resolve();
    await Promise.resolve();
    engine.dispose();
    return seen;
  }

  /** The record the passage was filed under, which is what the store was handed. */
  const filed = (): PassageRecord => logAdd.mock.calls[0][0] as PassageRecord;

  /**
   * A passage that could not be stored says so, and does not also claim it was
   * stored. The two used to be one `then` with two branches over an event named
   * for arriving, which meant the engine reported reaching your destination
   * only if a database had taken the row.
   */
  it('does not confirm a write that failed', async () => {
    logAdd.mockRejectedValue(new LogStoreUnavailable());
    const seen = await makePassage();
    expect(seen).toContain('logbookError');
    expect(seen).not.toContain('logbookSaved');
  });

  /**
   * And a write that succeeded is confirmed once, which is what the logbook
   * panels reload on. It follows the commit rather than the request: a read
   * that goes out beside the write can come back without the record, and
   * nothing bumps a second time, so the last voyage of a session would simply
   * be missing.
   */
  it('confirms a write that committed', async () => {
    const seen = await makePassage();
    expect(seen.filter((type) => type === 'logbookSaved')).toHaveLength(1);
    expect(seen).not.toContain('logbookError');
  });

  /**
   * That the engine tells the passage about the world at all.
   *
   * `PassageLog` is tested directly and thoroughly next door, and every one of
   * those tests passed with the engine's entire `log.conditions` and `log.sight`
   * block deleted -- which a Codex review found and I had not. A unit test of an
   * accumulator says nothing about whether anything fills it.
   */
  it('records the world the passage was sailed through', async () => {
    await makePassage(() => frame(0.5));
    const r = filed();
    // The world clock, which is the session's start hour plus however much of
    // it half a second of frames has moved at the default time scale.
    expect(r.startHour).toBeCloseTo(DEFAULT_SETTINGS.startHour, 1);
    expect(r.endHour).toBeCloseTo(DEFAULT_SETTINGS.startHour, 1);
    expect(r.weather).toBeDefined();
    // Under way in a working breeze, so she is leaning on it.
    expect(r.maxHeel).toBeGreaterThan(0);
  });

  /**
   * And that a sighting reaches the record. Driven by making the field show one
   * whale on every step rather than by waiting for a real encounter, which is
   * eighty seconds of frames away at the default spacing -- and showing the same
   * whale repeatedly is the more useful shape anyway, because the list says what
   * is in sight *now* and the record has to come out at one.
   */
  it('files an animal seen on the way against the passage', async () => {
    const whale = {
      id: 7,
      pos: { x: 0, y: 0 },
      heading: 0,
      size: 15,
      phase: 'blow',
      phaseT: 0,
      seed: 1,
    } as const;
    vi.spyOn(WhaleField.prototype, 'update').mockImplementation(function (this: WhaleField) {
      this.events.length = 0;
      this.events.push({ ...whale });
    });
    await makePassage(() => frame(0.5));
    expect(filed().sightings).toEqual({ whales: 1, sharks: 0 });
  });

  /**
   * The wiring between the shutter and the logbook, which is the half of this
   * no unit test can reach: the count lives on `PassageLog` and the key that
   * fills it is handled three files away.
   */
  it('files a photograph taken on a passage against that passage', async () => {
    capture.blob = new Blob(['png']);
    await makePassage(async () => {
      press('k');
      frame(0.1);
      // The capture resolves a frame later, by design -- see `SceneView.capture`.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(filed().photographs).toBe(1);
  });

  /**
   * And a shutter that came back with nothing is not a photograph. The encoder
   * is allowed to refuse and does so silently, so a record that counted the
   * press rather than the picture would promise the player a file they have not
   * got -- which is the reason the count is not a list of filenames either.
   */
  it('does not file a photograph the encoder refused to make', async () => {
    capture.blob = null;
    await makePassage(async () => {
      press('k');
      frame(0.1);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(filed().photographs).toBe(0);
  });

  /**
   * Anchoring in the same frame as photographing loses the photograph, and that
   * is the right way round rather than an oversight.
   *
   * The capture resolves a frame later; `arrive()` is synchronous and closes the
   * record first, so the count arrives at a log that has already been read out.
   * Closing the race the other way -- counting the press and rolling back on a
   * refusal -- swaps an incomplete record for a false one, and this project's
   * whole claim is that its records are true. A logbook that says two when three
   * were taken is missing something; one that says three when two exist is
   * wrong, and the player finds out by going to look for a file.
   *
   * Written down because it is a real edge -- photographing an anchorage and
   * then letting go is an ordinary thing to do -- and a behaviour nobody has
   * pinned is a behaviour the next change breaks silently.
   */
  it('does not file a photograph whose picture arrived after the anchor went down', async () => {
    capture.blob = new Blob(['png']);
    // No frame and no settling between the two, so both keys are read by the
    // same `handleKeys` and `arrive()` runs before the encoder answers.
    await makePassage(() => press('k'));
    expect(filed().photographs).toBe(0);
  });

  /**
   * A tack driven through the real physics reaches the snapshot as a report.
   *
   * The tracker's own judgement is tested next door with synthetic traces;
   * this is the wiring, which is the half a unit test cannot see and the half
   * that has actually gone missing in this codebase before. The boat opens on
   * a beam reach with the wind over her port side, so the tack is a turn to
   * port through the wind onto the mirror angle -- mirrored rather than
   * close-hauled, because recovery is measured against the speed she carried
   * in and a reach-to-beat turn legitimately never gets it back.
   */
  it('answers a tack sailed through the real physics', () => {
    const engine = sailing();
    engine.advance(40); // settle on the opening reach
    expect(engine.snapshot.maneuver).toBeNull();
    const before = engine.snapshot.diag!.twa;
    expect(before).toBeLessThan(0); // wind over port, per placeAtStart

    // Helm to port until she is through the wind and well onto starboard.
    for (let i = 0; i < 120 && engine.snapshot.diag!.twa < 60 * DEG; i++) {
      engine.advance(0.5, -0.6);
    }
    expect(engine.snapshot.diag!.twa).toBeGreaterThan(60 * DEG);

    // Sail on until the report lands, sampling as we go: the report only
    // stays up a few seconds, so a single long advance could sail clean
    // through its lifetime and read null off a tack that was counted.
    let seen: Maneuver | null = null;
    for (let i = 0; i < 90 && !seen; i++) {
      engine.advance(1);
      seen = engine.snapshot.maneuver;
    }
    expect(seen?.kind).toBe('tack');
    expect(seen!.entrySpeed).toBeGreaterThan(1);
    expect(seen!.lost).toBeGreaterThanOrEqual(0);
    expect(seen!.seconds).toBeGreaterThan(0);

    // And it comes down on its own: the strip must not carry a ten-minute-old
    // turn.
    engine.advance(10);
    expect(engine.snapshot.maneuver).toBeNull();
    engine.dispose();
  });

  /**
   * The tracker is fed the angle to the mean wind, and not the panel's TWA.
   *
   * The distinction is the fix for a real failure pair a review demonstrated:
   * the local shift can swing the sign of TWA across the bow of a boat holding
   * her course, which armed turns nobody made and read a real tack as an abort
   * when the shift swung back. A maneuver is a thing the boat does, so it is
   * measured in the frame that does not move under her. The two angles differ
   * whenever the local shift is nonzero, which at this seed and position it is
   * -- asserted, so this test cannot silently compare two equal numbers.
   */
  it('measures a maneuver against the mean wind, not the shifting local one', () => {
    const spy = vi.spyOn(ManeuverTracker.prototype, 'update');
    const engine = sailing();
    engine.advance(5);
    const fed = spy.mock.calls.at(-1)![0];
    const s = engine.snapshot;
    expect(fed).toBeCloseTo(wrapPi(s.wind.baseTwd - s.state.heading), 9);
    expect(Math.abs(fed - s.diag!.twa)).toBeGreaterThan(0.001);
    engine.dispose();
  });

  /**
   * A settings change can replace the world under a boat that is never
   * teleported -- resume, not put to sea -- and the new world's wind can stand
   * on the other side of an unmoved bow. That jump is a replaced world, not a
   * turn, and it goes through `rebuildWorld` without `placeAtStart`, so the
   * teleport reset alone does not cover it.
   */
  it('does not read a rebuilt world as a maneuver', () => {
    const engine = sailing();
    engine.advance(40);
    // Newport's prevailing wind stands at 195 degrees; the procedural ocean's
    // at zero. Across an unmoved bow the mean-wind angle jumps from about -100
    // to about +95 -- a sign change through the stern that no gybe made, in
    // the settling band with the speed already recovered, so without the reset
    // it reports as a phantom gybe almost at once. The raster load is left
    // pending on purpose: the boat sails on while it waits, which is exactly
    // the resumed-session path this covers.
    regionLoad.mockReturnValue(deferred<RegionTerrain>().promise);
    engine.applySettings(settings({ region: 'newport', venue: '' }));
    for (let i = 0; i < 30; i++) {
      engine.advance(1);
      expect(engine.snapshot.maneuver).toBeNull();
    }
    engine.dispose();
  });

  /**
   * Putting to sea teleports her, and the swing of the wind angle across that
   * jump must not be read as a turn. The boat has to be got onto the *other*
   * tack first, because the spawn is deterministic: a restart from the opening
   * tack lands on the same side, the angle never flips, and the test passes
   * with the reset deleted -- which is exactly how its first version passed.
   */
  it('does not report the teleport of a restart as a gybe', () => {
    const engine = sailing();
    engine.advance(40);
    // Onto starboard, so the restart's port-side spawn is a sign change. The
    // preconditions are asserted, not assumed: if the turn never got through,
    // or the real tack never reported, the restart lands on the original side
    // and the silence below would prove nothing -- which is how the first
    // version of this test passed with the reset deleted.
    for (let i = 0; i < 120 && engine.snapshot.diag!.twa < 60 * DEG; i++) {
      engine.advance(0.5, -0.6);
    }
    expect(engine.snapshot.diag!.twa).toBeGreaterThan(60 * DEG);
    let reported: Maneuver | null = null;
    for (let i = 0; i < 90 && !reported; i++) {
      engine.advance(1);
      reported = engine.snapshot.maneuver;
    }
    expect(reported?.kind).toBe('tack');
    for (let i = 0; i < 20 && engine.snapshot.maneuver; i++) engine.advance(1);
    expect(engine.snapshot.maneuver).toBeNull();

    engine.putToSea();
    for (let i = 0; i < 30; i++) {
      engine.advance(1);
      expect(engine.snapshot.maneuver).toBeNull();
    }
    engine.dispose();
  });

  /**
   * A store that never opened is a standing condition, not this passage's
   * failure, and the UI needs to tell them apart to stop interrupting the end
   * of every voyage with it. Classified from the error's type rather than its
   * wording -- see `LogStoreUnavailable`.
   */
  it('says whether the logbook is unavailable or the write failed', async () => {
    anchorAnywhere.on = true;
    for (const [error, reason] of [
      [new LogStoreUnavailable(), 'unavailable'],
      [new Error('QuotaExceededError'), 'write'],
    ] as const) {
      logAdd.mockRejectedValue(error);
      const engine = sailing();
      let seen: EngineEvent | null = null;
      engine.onEvent((e) => { if (e.type === 'logbookError') seen = e; });
      engine.setDestination({ ...engine.snapshot.state.pos });
      press('a');
      frame(0.1);
      await Promise.resolve();
      await Promise.resolve();
      expect(seen).not.toBeNull();
      expect(seen!).toMatchObject({ operation: 'add', reason });
      engine.dispose();
    }
  });

  /**
   * The generated coast is a region that is computed instead of fetched, and
   * the wiring is the half its own tests cannot see: that picking the id
   * builds a world at all, that it is ready synchronously with no loader in
   * flight, and that the boat spawns in the water the generator promised.
   */
  it('builds a generated coast without fetching anything', () => {
    const engine = createEngine(canvas(), settings({ region: 'coast', randomWorld: false, seed: 546 }));
    expect(engine.snapshot.regionStatus).toBe('ready');
    expect(engine.snapshot.region?.region.id).toBe('coast');
    expect(regionLoad).not.toHaveBeenCalled();
    engine.advance(2);
    // The spawn clearing, felt through the whole stack: the depth the hull
    // reads is the generator's water, not Infinity and not a shoal.
    expect(engine.snapshot.depth).toBeGreaterThan(10);
    expect(Number.isFinite(engine.snapshot.depth)).toBe(true);
    engine.dispose();
  });

  /**
   * A rolled seed is a new coast and a pinned one is the same coast. The
   * region id cannot carry that distinction -- every generated coast is
   * 'coast' -- which is exactly the cache bug this pins: keyed on the id
   * alone, every session of a random world would serve the first session's
   * shore.
   */
  it('rolls a new coast with the world, and keeps a pinned one', () => {
    const pinned = createEngine(canvas(), settings({ region: 'coast', randomWorld: false, seed: 546 }));
    const before = pinned.snapshot.region;
    pinned.putToSea();
    expect(pinned.snapshot.region).toBe(before);
    pinned.dispose();

    const rolled = createEngine(canvas(), settings({ region: 'coast', randomWorld: true, seed: 546 }));
    const first = rolled.snapshot.region;
    rolled.putToSea();
    expect(rolled.snapshot.region).not.toBe(first);
    expect(rolled.snapshot.region?.region.id).toBe('coast');
    // Identity alone cannot tell a fresh coast from the old one regenerated --
    // a review built a mutation that rebuilt from the stale seed every session
    // and passed. The region records the seed it was generated from in its own
    // provenance string, so the two shores can be told apart by name.
    expect(rolled.snapshot.region?.region.source).not.toBe(first?.region.source);
    rolled.dispose();
  });

  /**
   * The cruise, end to end at the engine's level: a hand dealt where the
   * world is, a click near a call meaning the call, the anchor completing it,
   * and the next hand dealt from a fresh salt. The hand itself is judged in
   * `calls.test.ts`; everything here is the wiring.
   */
  it('deals a real hand on a coast the moment the cruise begins', () => {
    const engine = createEngine(
      canvas(),
      settings({ region: 'coast', cruise: true, randomWorld: false, seed: 546 }),
    );
    const hand = engine.snapshot.calls;
    expect(hand.length).toBeGreaterThan(0);
    // Every offered place passes the same judge the anchor will face.
    for (const call of hand) {
      expect(anchorage(engine.snapshot.region!, CRUISER, call, 0, 0).canAnchor).toBe(true);
    }
    expect(engine.snapshot.callsMade).toBe(0);
    engine.dispose();
  });

  it('reads a click near a call as the call itself', () => {
    const engine = createEngine(
      canvas(),
      settings({ region: 'coast', cruise: true, randomWorld: false, seed: 546 }),
    );
    const call = engine.snapshot.calls[0];
    engine.setDestination({ x: call.x + 180, y: call.y - 120 });
    expect(engine.snapshot.destination).toEqual({ x: call.x, y: call.y });
    // And a click nowhere near one stays a plain destination: the cruise must
    // not swallow ordinary passage-making.
    engine.setDestination({ x: call.x + 2000, y: call.y + 2000 });
    expect(engine.snapshot.destination).toEqual({ x: call.x + 2000, y: call.y + 2000 });
    engine.dispose();
  });

  it('counts the call when the anchor goes down at it, and deals afresh', () => {
    const engine = sailing({ cruise: true });
    // The hand is dealt into the test's palm: one call exactly where she is,
    // because sailing a real kilometre is minutes this file does not have.
    callsOverride.hand = [{ ...engine.snapshot.state.pos }];
    engine.applySettings(settings({ cruise: false }));
    engine.applySettings(settings({ cruise: true }));
    const call = engine.snapshot.calls[0];
    engine.setDestination({ x: call.x + 100, y: call.y });
    expect(engine.snapshot.destination).toEqual(call);

    anchorAnywhere.on = true;
    // A step first, so the anchorage readout the keypress consults has been
    // judged since the override went on -- the key reads the snapshot, and the
    // snapshot is only written by a step.
    engine.advance(0.1);
    const spy = offerCalls as ReturnType<typeof vi.fn>;
    const dealsBefore = spy.mock.calls.length;
    press('a');
    frame(0.1);
    expect(engine.snapshot.callsMade).toBe(1);
    // The anchor itself dealt the next hand -- exactly one, and with the salt
    // moved on. Counting from before the keypress is what pins the deal to the
    // completion; a review showed the salt sequence alone is satisfiable with
    // the post-arrival deal deleted outright.
    expect(spy.mock.calls.length).toBe(dealsBefore + 1);
    const salts = spy.mock.calls.map((c) => c[5]);
    expect(salts.at(-1)).toBe((salts.at(-2) as number) + 1);
    engine.dispose();
  });

  it('clears the hand when the cruise is switched off, and re-deals when it returns', () => {
    const engine = createEngine(
      canvas(),
      settings({ region: 'coast', cruise: true, randomWorld: false, seed: 546 }),
    );
    expect(engine.snapshot.calls.length).toBeGreaterThan(0);
    engine.applySettings(settings({ region: 'coast', cruise: false, randomWorld: false, seed: 546 }));
    expect(engine.snapshot.calls).toEqual([]);
    engine.applySettings(settings({ region: 'coast', cruise: true, randomWorld: false, seed: 546 }));
    expect(engine.snapshot.calls.length).toBeGreaterThan(0);
    engine.dispose();
  });

  /**
   * A restart is a new cruise: the tally returns to nothing and the salt to
   * zero, so a pinned world's first hand is always the same first hand.
   */
  it('starts the tally and the deal over with the session', () => {
    const engine = sailing({ cruise: true });
    callsOverride.hand = [{ ...engine.snapshot.state.pos }];
    engine.applySettings(settings({ cruise: false }));
    engine.applySettings(settings({ cruise: true }));
    anchorAnywhere.on = true;
    engine.setDestination(engine.snapshot.calls[0]);
    engine.advance(0.1);
    press('a');
    frame(0.1);
    expect(engine.snapshot.callsMade).toBe(1);

    engine.putToSea();
    expect(engine.snapshot.callsMade).toBe(0);
    const salts = (offerCalls as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[5]);
    expect(salts.at(-1)).toBe(0);
    engine.dispose();
  });

  /**
   * On the procedural ocean the hand is judged against the chart window, and
   * this seed is the witness for why. The felt window stops at ACTIVE_RANGE
   * and the hand reaches past it, and judged against the window, seed 260
   * offered a call on the unloaded flank of an island -- 4.8 m of water by
   * the window's answer, dry land once the boat sailed near enough to load
   * it. Every offered place must survive the widest window's judgement.
   */
  it('never offers a port the wider chart knows is dry', () => {
    const engine = createEngine(
      canvas(),
      settings({ islandCount: 4, seed: 260, randomWorld: false, cruise: true }),
    );
    const hand = engine.snapshot.calls;
    expect(hand.length).toBeGreaterThan(0);
    for (const call of hand) {
      expect(anchorage(engine.snapshot.chart, CRUISER, call, 0, 0).canAnchor).toBe(true);
    }
    engine.dispose();
  });

  /**
   * A hand dealt while a surveyed region was still loading was judged against
   * the placeholder ocean, and nothing ever dealt again -- a review traced
   * every resume-into-a-loaded-region path arriving with an empty hand. The
   * install handler deals now, and the proof is in the arguments: the deal
   * after the install is judged against the region itself.
   */
  it('re-deals the hand once a surveyed region finishes loading', async () => {
    const pending = deferred<RegionTerrain>();
    regionLoad.mockReturnValue(pending.promise);
    callsOverride.hand = [{ x: 5, y: -95 }];
    const engine = createEngine(
      canvas(),
      settings({ region: 'sf-bay', venue: '', cruise: true }),
    );
    const spy = offerCalls as ReturnType<typeof vi.fn>;
    const before = spy.mock.calls.length;

    pending.resolve({ region: { id: 'sf-bay' } } as RegionTerrain);
    await pending.promise;
    await Promise.resolve();

    expect(spy.mock.calls.length).toBeGreaterThan(before);
    expect(spy.mock.calls.at(-1)![0]).toBe(engine.snapshot.region);
    engine.dispose();
  });

  it('waits for a surveyed region before allowing a new session', async () => {
    const pending = deferred<RegionTerrain>();
    regionLoad.mockReturnValue(pending.promise);

    const engine = createEngine(
      canvas(),
      settings({ region: 'sf-bay', venue: '' }),
    );
    const initialSession = engine.snapshot.session;

    expect(engine.snapshot.regionStatus).toBe('loading');
    engine.putToSea();
    expect(engine.snapshot.session).toBe(initialSession);

    pending.resolve({ region: { id: 'sf-bay' } } as RegionTerrain);
    await pending.promise;
    await Promise.resolve();

    expect(engine.snapshot.regionStatus).toBe('ready');
    expect(engine.snapshot.region).not.toBeNull();
    engine.putToSea();
    expect(engine.snapshot.session).toBe(initialSession + 1);
    expect(regionLoad).toHaveBeenCalledTimes(1);
    engine.dispose();
  });

  it('exposes a failed region load and retries it', async () => {
    const pending = deferred<RegionTerrain>();
    regionLoad
      .mockRejectedValueOnce(new Error('test raster failure'))
      .mockReturnValueOnce(pending.promise);

    const engine = createEngine(
      canvas(),
      settings({ region: 'sf-bay', venue: '' }),
    );
    const statuses: string[] = [];
    engine.onEvent((event) => {
      if (event.type === 'region') statuses.push(event.status);
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(engine.snapshot.regionStatus).toBe('error');
    expect(statuses).toContain('error');
    expect(engine.snapshot.region).toBeNull();

    engine.retryRegion();
    expect(engine.snapshot.regionStatus).toBe('loading');
    expect(regionLoad).toHaveBeenCalledTimes(2);

    pending.resolve({ region: { id: 'sf-bay' } } as RegionTerrain);
    await pending.promise;
    await Promise.resolve();
    expect(engine.snapshot.regionStatus).toBe('ready');
    expect(engine.snapshot.region).not.toBeNull();
    engine.dispose();
  });

  /**
   * The loop itself, driven through rAF rather than through `advance()`, since
   * this is the one thing `advance()` does not do: it steps the physics only.
   */
  it('runs its own frame loop and renders', () => {
    const engine = sailing();
    frame(2);

    expect(sceneCalls.render).toBeGreaterThan(50);
    expect(engine.snapshot.diag).not.toBeNull();
    expect(engine.snapshot.diag!.sog).toBeGreaterThan(0);
    engine.dispose();
  });

  it('puts her to sea in water she can sail in', () => {
    const engine = sailing();
    engine.advance(30);

    const snapshot = engine.snapshot;
    expect(snapshot.diag).not.toBeNull();
    expect(snapshot.diag!.sog).toBeGreaterThan(0);
    // Water under her keel, which is the claim. `clearance < depth` looks like
    // a check and is not: it is `depth - draft` against `depth`, so it holds
    // however aground she is.
    expect(snapshot.clearance).toBeGreaterThan(0);
    // 0 = afloat, 1 = hard aground.
    expect(snapshot.diag!.aground).toBe(0);
    engine.dispose();
  });

  /**
   * Regression, and the reason this file exists.
   *
   * The give-way rule takes the boat's track over the ground, not the way her
   * bow points, because with a current running she crabs and an animal that
   * cleared the way the bow pointed would step into the way the hull is going.
   * `sharks.test.ts` proves `SharkField` can tell the two apart; only this can
   * prove the engine hands it the right one. Reverting the engine to
   * `state.heading` leaves every other test in the repo green.
   *
   * Four knots of stream, the most the settings allow, setting north across a
   * boat that starts out sailing east -- so she crabs hard and the two angles
   * cannot be confused for one another. With the default set of 090 she would
   * have had it dead astern, which is more speed and no crab at all, and this
   * would have asserted nothing.
   */
  it('gives the animals the boat course over the ground, not her heading', () => {
    const whaleSpy = vi.spyOn(WhaleField.prototype, 'update');
    const sharkSpy = vi.spyOn(SharkField.prototype, 'update');

    const engine = sailing({ driftKnots: 4, setDeg: 0 });
    engine.advance(60);
    engine.dispose();

    expect(sharkSpy.mock.calls.length).toBeGreaterThan(100);

    // The last call, by when the boat is under way and set well off her course.
    const sharkCall = sharkSpy.mock.calls.at(-1)!;
    const whaleCall = whaleSpy.mock.calls.at(-1)!;
    const heading = sharkCall[3] as number;
    const course = sharkCall[5] as number;

    // It is the course over the ground the boat is actually making. Within a
    // step, because the animals run before `step()` and so get the last one's.
    expect(course).toBeCloseTo(engine.snapshot.diag!.cog, 2);
    // ...which has to be a different number from her heading here, or the
    // assertion above would hold just as well for the wrong one.
    expect(Math.abs(wrapPi(course - heading))).toBeGreaterThan(0.3);
    // ...and the whale is given the same course, from the same place.
    expect(whaleCall[4]).toBe(course);
  });

  /**
   * The shark is placed clear of whatever is already in the water, so it has to
   * be told what the whales did *this* step. Ordering, which no unit test of
   * either species can see.
   */
  it('runs the whales before the sharks and hands the sharks their sightings', () => {
    const whaleSpy = vi.spyOn(WhaleField.prototype, 'update');
    const sharkSpy = vi.spyOn(SharkField.prototype, 'update');

    const engine = sailing();
    engine.advance(30);
    engine.dispose();

    const steps = whaleSpy.mock.calls.length;
    expect(steps).toBeGreaterThan(1000);
    expect(sharkSpy.mock.calls.length).toBe(steps);

    // Every step, not just the first pair: the claim is that this ordering
    // holds each time round, and a loop that got it right once would satisfy a
    // single comparison.
    for (let i = 0; i < steps; i++) {
      expect(whaleSpy.mock.invocationCallOrder[i]).toBeLessThan(
        sharkSpy.mock.invocationCallOrder[i],
      );
    }

    // The array itself, by identity. `Array.isArray` was the first version of
    // this and asserts nothing: a fresh `[]`, or last step's sightings, or any
    // other array would satisfy it, and each of those is the bug this is here
    // to catch -- a shark placed clear of whales that are not in the water.
    const whaleField = whaleSpy.mock.contexts.at(-1) as WhaleField;
    expect(sharkSpy.mock.calls.at(-1)![4]).toBe(whaleField.events);
  });

  /**
   * A world is reproducible from its seed. Every model has its own test for
   * that; this says the engine assembles them the same way twice.
   *
   * It does *not* catch a generator left unreseeded, and an earlier version of
   * this comment claimed it did. Each run builds a fresh engine, so there is no
   * previous session for anything to survive from -- that is the restart test
   * below, and it is a different question.
   */
  it('sails the same passage twice from a seed, and a different one from another', () => {
    const sail = (seed: number) => {
      const engine = sailing({ seed });
      engine.advance(120);
      const s = engine.snapshot;
      const track = [s.state.pos.x, s.state.pos.y, s.state.heading, s.diag!.sog].join(':');
      const world = [s.depth, s.weather.state.rain, s.env.tws].join(':');
      engine.dispose();
      return { track, world };
    };

    const first = sail(4711);
    expect(first).toEqual(sail(4711));

    // The *track* has to differ, not merely the conditions. Comparing one
    // string of everything at once lets a different sea satisfy the assertion
    // while two seeds sail identical courses, which is the failure worth
    // catching here.
    expect(sail(20260806).track).not.toBe(first.track);
  });

  /**
   * The world clock is the sun's clock. `timeScale` is simulated minutes per
   * real minute, so turning it up has to move the day, not just the boat --
   * and the sea has to keep up with the weather that clock is bringing through.
   */
  it('runs the day on world time, whatever the time scale', () => {
    const spent = (timeScale: number) => {
      const engine = sailing({ timeScale, startHour: 13 });
      engine.advance(1);
      const before = engine.snapshot.darkIn;
      engine.advance(60);
      const after = engine.snapshot.darkIn;
      engine.dispose();
      return { before, after };
    };

    for (const timeScale of [1, 60, 300]) {
      const { before, after } = spent(timeScale);
      expect(Number.isFinite(before)).toBe(true);
      // `darkIn` counts down in *real* seconds -- how long the player has, not
      // how much of the afternoon is left -- so sixty seconds of sailing must
      // spend exactly sixty of it however fast the sun is going. Comparing two
      // time scales against each other would not say this: darkIn divides by
      // the scale, so it shrinks with a faster clock even if the clock is
      // stopped.
      expect(before - after).toBeCloseTo(60, 1);
    }

    // ...and the clock underneath really is running at the scale, which the
    // assertion above deliberately cannot see.
    const slow = sailing({ timeScale: 1, startHour: 13 });
    const fast = sailing({ timeScale: 300, startHour: 13 });
    slow.advance(60);
    fast.advance(60);
    expect(fast.snapshot.darkIn).toBeLessThan(slow.snapshot.darkIn - 3000);
    slow.dispose();
    fast.dispose();
  });

  /**
   * The documented fallback, which only means anything on a restart.
   *
   * The animals run before `step()`, so on the first step of a world there is
   * no course solved yet and they are given the boat's heading instead. That is
   * true of a fresh engine whatever it does; the case that can go wrong is the
   * second session, where the last passage's diagnostics are still in hand and
   * would hand the animals the course *that* boat was making.
   */
  it('falls back to her heading on the first step of a world, not the last one course', () => {
    const sharkSpy = vi.spyOn(SharkField.prototype, 'update');

    // A stream on the beam, so the course she ends the first passage on is
    // nowhere near any heading she could start the second one with.
    const engine = sailing({ driftKnots: 4, setDeg: 0 });
    engine.advance(60);
    const stale = engine.snapshot.diag!.cog;

    sharkSpy.mockClear();
    engine.putToSea();
    engine.advance(1 / 120);

    const first = sharkSpy.mock.calls[0];
    expect(first).toBeDefined();
    const heading = first![3] as number;
    const course = first![5] as number;
    expect(course).toBe(heading);
    expect(Math.abs(wrapPi(course - stale))).toBeGreaterThan(0.3);
    engine.dispose();
  });

  /**
   * Regression: a new session reseeded the wind, the weather and the islands
   * but not every generator, so the same seed could sound different depending
   * on what had been sailed before it. That is a wiring bug by nature -- each
   * model's own reseed test passes while the engine forgets to call one.
   */
  it('starts a new session from the same world, whatever was sailed before it', () => {
    const fresh = sailing({ seed: 4711 });
    fresh.advance(90);
    const expected = `${fresh.snapshot.state.pos.x}:${fresh.snapshot.state.heading}:${fresh.snapshot.weather.state.rain}`;
    fresh.dispose();

    const reused = sailing({ seed: 4711 });
    reused.advance(400); // a long passage first, in this same pinned world
    const before = reused.snapshot.session;
    reused.putToSea(); // ...and then the session that has to match
    // `sailing()` has already put to sea once, and `createEngine` before that,
    // so `session > 0` would have held without the restart above ever happening.
    expect(reused.snapshot.session).toBe(before + 1);
    reused.advance(90);
    const actual = `${reused.snapshot.state.pos.x}:${reused.snapshot.state.heading}:${reused.snapshot.weather.state.rain}`;
    reused.dispose();

    expect(actual).toBe(expected);
  });

  /**
   * The stream turns, and everything that reads it turns with it.
   *
   * `currents.peak` is rebuilt from the world hour every physics step, so this
   * is really an assertion about the wiring. Three of the consumers are checked
   * here -- the stream itself, the water under the boat, and the displacement
   * the waves and the wake are carried by. The chart reads the same field and
   * is checked by looking. Driven at a high time scale so half a cycle passes
   * in a few seconds of sailing.
   */
  it('turns the stream, and carries the boat and the sea round with it', () => {
    const engine = sailing({ driftKnots: 4, setDeg: 0, startHour: 9, timeScale: 900 });

    engine.advance(1);
    const atStart = engine.snapshot.currents.peak.y;
    const seaAtStart = engine.snapshot.waves.drift.y;
    const currentAtStart = engine.snapshot.env.current!.y;

    // A quarter of a cycle at 900x is about 12 seconds of sailing.
    engine.advance((TIDE_PERIOD / 4) * 3600 / 900 - 1);
    const atSlack = engine.snapshot.currents.peak.y;

    engine.advance((TIDE_PERIOD / 4) * 3600 / 900);
    const atEbb = engine.snapshot.currents.peak.y;
    const seaAtEbb = engine.snapshot.waves.drift.y;
    const currentAtEbb = engine.snapshot.env.current!.y;
    engine.dispose();

    // Full run at the start, slack a quarter in, running back at the half.
    expect(atStart).toBeGreaterThan(1.9);
    expect(Math.abs(atSlack)).toBeLessThan(0.2);
    expect(atEbb).toBeLessThan(-1.9);
    // ...and the sea was carried one way and then back, rather than on and on.
    expect(seaAtStart).toBeGreaterThan(0);
    expect(seaAtEbb).toBeLessThan(seaAtStart);
    // ...and the water under the boat turned with it, which is the consumer
    // that actually moves her. The others are asserted where they live.
    expect(currentAtStart).toBeGreaterThan(0);
    expect(currentAtEbb).toBeLessThan(0);
  });

  it('leaves a steady stream steady when the cycle is switched off', () => {
    const engine = sailing({ driftKnots: 4, setDeg: 0, tideHours: 0, timeScale: 900 });
    engine.advance(1);
    const first = engine.snapshot.currents.peak.y;
    engine.advance(60);
    expect(engine.snapshot.currents.peak.y).toBeCloseTo(first, 12);
    engine.dispose();
  });

  /**
   * Regression: the sea is built from the wind relative to the moving water,
   * and `newSession` builds it before the first physics step. With the stream
   * turning, `currents.peak` still held whatever the last session's tide had
   * reached, so a restart could raise its sea on a stream that is not running.
   */
  it('starts a session on the stream the tide is actually at', () => {
    const engine = sailing({ driftKnots: 4, setDeg: 0, startHour: 9, timeScale: 900 });
    // Sail past the turn, so the stream is running the other way.
    engine.advance((TIDE_PERIOD / 2) * 3600 / 900);
    expect(engine.snapshot.currents.peak.y).toBeLessThan(-1.9);

    engine.putToSea();
    // Back to the start hour, so back to the full flood -- before any step.
    expect(engine.snapshot.currents.peak.y).toBeGreaterThan(1.9);
    engine.dispose();
  });


  /**
   * The slider reaches the animals. Read off the fields themselves rather than
   * from anything they produce: the sightings are rare by design now, so a test
   * that waited for one would have to run for simulated hours to say anything.
   */
  it('sets how often the sea has something in it, from nothing to often', () => {
    const spacingAt = (wildlife: number) => {
      const spy = vi.spyOn(WhaleField.prototype, 'update');
      const sharkSpy = vi.spyOn(SharkField.prototype, 'update');
      const engine = sailing({ wildlife });
      engine.advance(1);
      const whale = (spy.mock.contexts.at(-1) as WhaleField).spacing;
      const shark = (sharkSpy.mock.contexts.at(-1) as SharkField).spacing;
      engine.dispose();
      spy.mockRestore();
      sharkSpy.mockRestore();
      return { whale, shark };
    };

    expect(spacingAt(0).whale).toBe(Infinity);
    expect(spacingAt(0).shark).toBe(Infinity);
    // Wider gaps the lower the setting, and both animals get the same one.
    const few = spacingAt(1);
    const many = spacingAt(10);
    expect(few.whale).toBeGreaterThan(many.whale);
    expect(few.whale).toBe(few.shark);
    expect(Number.isFinite(many.whale)).toBe(true);
  });
});

/**
 * The departure, as the engine actually wires it. The choice itself is
 * departure.ts's business and is tested there; what these pin is that
 * `placeAtStart` asks it -- with the session's own wind -- and writes the
 * whole answer into the boat, not just the parts that show.
 */
describe('putting to sea prepared', () => {
  it('leaves reefed, trimmed and heeled in a gale', () => {
    const engine = sailing({ windKnots: 35, weatherMode: 'fair' });
    const s = engine.snapshot.state;
    expect(s.reef).toBeGreaterThanOrEqual(1);
    // The whole answer, not just the showy half: at 35 knots the ladder has
    // rolled some jib away as well as reefed the main.
    expect(s.jibFurl).toBeGreaterThan(0);
    // Not the close-hauled 20 degrees the bare start pinned: trimmed for the
    // beam-reach departure heading.
    expect(s.sheet).toBeGreaterThan(30 * DEG);
    // Under way at her sailing heel, not bolt upright about to flop over.
    expect(Math.abs(s.heel)).toBeGreaterThan(10 * DEG);
    expect(s.heelAvg).toBe(s.heel);
    // The reef controller was seeded too, not only the boat: unseeded, the
    // very first physics step writes the controller's zeros back over the
    // prepared state, and the reef is gone before the second frame.
    engine.advance(2);
    expect(engine.snapshot.state.reef).toBeGreaterThanOrEqual(1);
    engine.dispose();
  });

  it('prepares for the wind the weather actually delivers', () => {
    // 20 knots set, but a pinned squall scales the mean to 35: she must
    // leave reefed. (This holds even without placeAtStart's own re-derive,
    // because applySettings runs between construction and putting to sea and
    // corrects the mean for a *pinned* mode; the test below is the one that
    // needs the re-derive.)
    const engine = sailing({ windKnots: 20, weatherMode: 'squall' });
    expect(engine.snapshot.state.reef).toBeGreaterThanOrEqual(1);
    engine.dispose();
  });

  it("does not prepare for the last session's weather", () => {
    // The stale-mean path placeAtStart's re-derive exists for: applySettings
    // recomputes the mean wind with the weather scale it finds *before*
    // changing the weather, so squall-to-auto leaves baseTws carrying the
    // squall's 1.75x -- and the new session's reseed then opens with clear,
    // fair or overcast, none above 1.1x. Prepared from the stale mean, she
    // would leave reefed for a squall that is no longer overhead.
    const engine = sailing({ windKnots: 20, weatherMode: 'squall' });
    engine.applySettings(settings({ windKnots: 20, weatherMode: 'auto' }));
    engine.putToSea();
    expect(engine.snapshot.state.reef).toBe(0);
    engine.dispose();
  });

  it('leaves under full sail in a light breeze', () => {
    const engine = sailing({ windKnots: 8, weatherMode: 'fair' });
    expect(engine.snapshot.state.reef).toBe(0);
    expect(engine.snapshot.state.jibFurl).toBe(0);
    engine.dispose();
  });
});

/**
 * The coast's sliding window, driven the only honest way: by sailing there.
 * The sim tests prove any two windows agree; what only the engine can prove
 * is that the window actually moves -- that a boat following the shore never
 * reaches the place where the mainland used to dissolve into the edge fade.
 */
describe('the coast window follows the boat', () => {
  it('re-bakes the window a few kilometres down the shore, seamlessly', { timeout: 120_000 }, () => {
    const engine = sailing({ region: 'coast', randomWorld: false, seed: 13 });
    const first = engine.snapshot.region;
    expect(first?.height.originX).toBe(0);
    // 199 degrees runs alongshore for this seed, clear of the headland that
    // stands a kilometre east of the spawn -- found by sailing it, the same
    // way the witness seeds were found by scanning. The claim under test is
    // not the bearing; it is the window that follows whoever holds one.
    const course = (199 * Math.PI) / 180;
    engine.advance(0.1);
    for (let i = 0; i < 240 && Math.abs(wrapPi(engine.snapshot.state.heading - course)) > 0.06; i++) {
      engine.advance(0.5, Math.sign(wrapPi(course - engine.snapshot.state.heading)) * 0.6);
    }
    engine.press('h'); // the autopilot holds it from here
    let sailed = 0;
    while (sailed < 1800 && engine.snapshot.region === first) {
      engine.advance(30);
      sailed += 30;
    }
    const slid = engine.snapshot.region;
    expect(slid).not.toBe(first);
    expect(slid?.region.id).toBe('coast');
    // The new window is centred where she is, give or take the re-bake's
    // head start -- not back at the origin, and not at some stale corner.
    const pos = engine.snapshot.state.pos;
    const away = Math.max(
      Math.abs(pos.x - (slid?.height.originX ?? 0)),
      Math.abs(pos.y - (slid?.height.originY ?? 0)),
    );
    expect(away).toBeLessThan(600);
    // Seamless underfoot: the boat is still in sailable water, reading a
    // finite depth from the new window, and the world did not move -- the
    // session and her position carried straight across the swap.
    expect(engine.snapshot.depth).toBeGreaterThan(0);
    expect(Number.isFinite(engine.snapshot.depth)).toBe(true);
    engine.dispose();
  });

  it('a restart mid-fill does not install the window the last session ordered', { timeout: 120_000 }, () => {
    // The stale-pending case a review constructed: cross the re-window
    // trigger, and put to sea again while the few seconds of incremental
    // fill are still running. The teleport home lands the boat about 2.9 km
    // from the pending centre -- same side, inside a naive distance test --
    // and an orphaned fill would install a window centred down the coast of
    // a session that no longer exists.
    const engine = sailing({ region: 'coast', randomWorld: false, seed: 13 });
    const course = (199 * Math.PI) / 180;
    engine.advance(0.1);
    for (let i = 0; i < 240 && Math.abs(wrapPi(engine.snapshot.state.heading - course)) > 0.06; i++) {
      engine.advance(0.5, Math.sign(wrapPi(course - engine.snapshot.state.heading)) * 0.6);
    }
    engine.press('h');
    // Sail up to the trigger in 0.2 s bites and stop within a boat-length of
    // crossing it: at three metres a second the fill is two hundred steps --
    // 1.7 s -- from done, so the restart below reliably lands mid-fill. A
    // coarser probe here raced the fill and sometimes tested a window that
    // had already, legitimately, been installed.
    const past = () => {
      const p = engine.snapshot.state.pos;
      return Math.max(Math.abs(p.x), Math.abs(p.y)) > 3001;
    };
    for (let t = 0; t < 1800 && !past(); t += 0.2) engine.advance(0.2);
    expect(past()).toBe(true);
    engine.putToSea();
    engine.advance(3); // long enough for any orphaned fill to have installed
    const region = engine.snapshot.region;
    const away = Math.max(
      Math.abs(region?.height.originX ?? 0),
      Math.abs(region?.height.originY ?? 0),
    );
    // The session starts at the origin, and so must its window.
    expect(away).toBeLessThan(200);
    expect(engine.snapshot.depth).toBeGreaterThan(10);
    engine.dispose();
  });
});

/**
 * The flare: a rocket, half a minute of light, and a two-minute wait for the
 * next one. Durations imported, not restated -- the burn and the cooldown are
 * exactly the kind of retunable numbers whose hardcoded copies quietly stop
 * covering anything (the shark's dive did it twice). The *envelope* is the
 * claim under test: dark on the way up, full once it pops, gone when it dies.
 */
describe('the flare', () => {
  // Keys are consumed by the frame loop, not the physics loop, so each press
  // is followed by a sliver of frames before `advance` carries the clock.
  it('goes up dark, pops into light, and burns out', () => {
    const engine = sailing({});
    engine.advance(0.1);
    press('u');
    frame(0.05);
    engine.advance(0.5);
    const climbing = engine.snapshot.flare;
    expect(climbing).not.toBeNull();
    expect(climbing!.intensity).toBeLessThan(0.5);
    expect(climbing!.alt).toBeGreaterThan(10);
    // The pop is a flash: an overshoot standing well above the steady burn
    // for a couple of tenths. Scanned for its peak across a window rather
    // than sampled at one instant -- the press-to-physics offset rides on
    // the harness's first real frame delta, and a review measured a slow
    // runner drifting a single sample right off the flash's shoulder.
    engine.advance(FLARE_RISE - 0.85);
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      engine.advance(0.05);
      peak = Math.max(peak, engine.snapshot.flare?.intensity ?? 0);
    }
    expect(peak).toBeGreaterThan(1.25);
    expect(peak).toBeLessThan(1.8);
    engine.advance(0.85);
    const lit = engine.snapshot.flare;
    expect(lit).not.toBeNull();
    expect(lit!.intensity).toBeGreaterThan(0.9);
    // And back on the steady burn: the flash is a moment, not a new level.
    expect(lit!.intensity).toBeLessThan(1.05);
    expect(lit!.alt).toBeGreaterThan(180);
    // Half the burn later she is still up and still at full light -- review
    // showed an expiry cut to a tenth of the burn passing the old version of
    // this test, which only ever looked at the two ends.
    engine.advance(FLARE_BURN / 2 - 2);
    const midburn = engine.snapshot.flare;
    expect(midburn).not.toBeNull();
    expect(midburn!.intensity).toBeGreaterThan(0.9);
    // Two thirds into the dying seconds: fading, not out and not full --
    // the probe that catches the fade being deleted outright.
    engine.advance(FLARE_BURN / 2 - 2.65);
    const dying = engine.snapshot.flare;
    expect(dying).not.toBeNull();
    expect(dying!.intensity).toBeGreaterThan(0.05);
    expect(dying!.intensity).toBeLessThan(0.6);
    engine.advance(6);
    expect(engine.snapshot.flare).toBeNull();
    engine.dispose();
  });

  it('is one every couple of minutes, not a pocketful', () => {
    const engine = sailing({});
    engine.advance(0.1);
    press('u');
    frame(0.05);
    // The locker empties the moment it fires; the touch row dims off this.
    engine.advance(0.1);
    expect(engine.snapshot.flareReady).toBe(false);
    engine.advance(FLARE_RISE + FLARE_BURN + 5.9);
    expect(engine.snapshot.flare).toBeNull();
    expect(engine.snapshot.flareReady).toBe(false);
    // A breath short of the cooldown: the press is simply not taken. Probed
    // at the boundary rather than mid-wait, so a cooldown quietly shortened
    // by a second cannot pass -- review showed the mid-wait probe accepting
    // exactly that.
    engine.advance(FLARE_COOLDOWN - (FLARE_RISE + FLARE_BURN + 6) - 1);
    press('u');
    frame(0.05);
    engine.advance(0.2);
    expect(engine.snapshot.flare).toBeNull();
    // But the refusal is answered: the hint bar gets the wait for a few
    // seconds -- a silently dead key reads as a broken one -- and the line
    // clears once its moment has passed.
    expect(engine.snapshot.flareWait).toBe(1);
    engine.advance(4);
    expect(engine.snapshot.flareWait).toBeNull();
    // Waited out: the locker has another, and says so.
    engine.advance(2);
    expect(engine.snapshot.flareReady).toBe(true);
    press('u');
    frame(0.05);
    engine.advance(1);
    expect(engine.snapshot.flare).not.toBeNull();
    engine.dispose();
  });

  it('does not survive a restart, and neither does the wait', () => {
    const engine = sailing({});
    engine.advance(0.1);
    press('u');
    frame(0.05);
    engine.advance(2);
    expect(engine.snapshot.flare).not.toBeNull();
    engine.putToSea();
    expect(engine.snapshot.flare).toBeNull();
    expect(engine.snapshot.flareReady).toBe(true);
    engine.advance(0.1);
    press('u');
    frame(0.05);
    engine.advance(1);
    expect(engine.snapshot.flare).not.toBeNull();
    engine.dispose();
  });
});

/**
 * Put her at a latitude, through the engine's own re-anchoring.
 *
 * One jump rather than a walk, and due *north or south* rather than along
 * a diagonal, which is what makes it honest: `+y` is a pure change of
 * latitude -- `toLatLon` divides it by the metres in a degree and leaves
 * the longitude alone -- so none of the tangent plane's east-west stretch
 * enters, however far the jump is. It crosses `REANCHOR_AT`, so the engine
 * re-pins to wherever she lands, exactly as it would after a long passage.
 * Walking her there in 200-km steps was the first version and it took
 * fifty coast rebuilds to cross a hemisphere.
 */
function carryTo(engine: ReturnType<typeof sailing>, lat: number): void {
  const dy = (lat - engine.snapshot.place.lat) * METRES_PER_DEG_LAT;
  engine.snapshot.state.pos = { x: 0, y: dy };
  engine.advance(0.02);
  expect(engine.snapshot.place.lat).toBeCloseTo(lat, 3);
}


/**
 * The Earth, as the engine uses it.
 *
 * Four claims, and they are the engine's rather than the sim's: that the
 * boat has a place on the planet and it moves as she sails, that the plane
 * is re-pinned before it stops being honest and nothing the session holds is
 * left behind when it happens, that the window reads the Earth beneath
 * itself however far it has slid from the pin, and that the coast is built
 * on the Earth's shoreline once the raster has landed.
 */
describe('sailing on the Earth', () => {
  it('knows where she is, and moves her there as she sails', () => {
    const engine = sailing({ region: 'coast', randomWorld: false, seed: 13 });
    const start = { ...engine.snapshot.place };
    // The default anchor is off the Golden Gate; a session that opened
    // somewhere else entirely would mean the anchor never reached the
    // snapshot.
    expect(start.lat).toBeGreaterThan(30);
    expect(start.lat).toBeLessThan(45);
    expect(start.lon).toBeLessThan(-100);
    engine.advance(0.1);
    engine.press('h');
    engine.advance(600);
    const now = engine.snapshot.place;
    // Ten minutes of sailing is a mile or so: the position has to have
    // moved, and by a plausible amount rather than a degree.
    const moved = Math.hypot(now.lat - start.lat, now.lon - start.lon);
    expect(moved).toBeGreaterThan(0.005);
    expect(moved).toBeLessThan(0.5);
    engine.dispose();
  });

  it('re-pins the plane without moving anything on the Earth', () => {
    // The re-anchoring rule: plane metres are measured from a pin that
    // moves, so everything the session holds in them must be carried across
    // -- and the way to check that is that nothing *on the Earth* moved.
    const engine = sailing({ region: 'coast', randomWorld: false, seed: 13 });
    engine.advance(0.1);
    const before = { ...engine.snapshot.place };
    // Put her most of the way to the trigger rather than sailing it: two
    // hundred kilometres is half a day. The position is *assigned* rather
    // than mutated in place because the physics replaces `pos` with a fresh
    // object every step -- a captured reference goes stale on the next one,
    // which is what the first draft of this test did and why it saw the
    // boat never move.
    engine.snapshot.state.pos = { x: 199_000, y: 0 };
    engine.advance(1);
    const mid = { ...engine.snapshot.place };
    // Still the same place on Earth, in new plane coordinates: the position
    // she was carried to is roughly 199 km east of where she started.
    expect(mid.lon).toBeGreaterThan(before.lon + 1.5);
    expect(Math.abs(mid.lat - before.lat)).toBeLessThan(0.5);
    // Crossing the trigger re-pins the plane, and the test of that is
    // *continuity*: two metres of easting either side of the boundary must
    // read as two metres on the Earth, not as a jump. Comparing two points
    // hundreds of metres apart -- which the first draft did -- measures the
    // distance between them and calls it error.
    engine.snapshot.state.pos = { x: REANCHOR_AT - 1, y: 0 };
    engine.advance(0.02);
    const justBefore = { ...engine.snapshot.place };
    const planeBefore = Math.hypot(engine.snapshot.state.pos.x, engine.snapshot.state.pos.y);
    engine.snapshot.state.pos = { x: REANCHOR_AT + 1, y: 0 };
    engine.advance(0.02);
    const justAfter = engine.snapshot.place;
    // The pin moved: the plane collapsed from 200 km to nothing.
    expect(planeBefore).toBeGreaterThan(REANCHOR_AT - 100);
    expect(Math.hypot(engine.snapshot.state.pos.x, engine.snapshot.state.pos.y)).toBeLessThan(100);
    // And she did not: two metres east is two metres east, which at this
    // latitude is a couple of hundred-thousandths of a degree.
    expect(Math.abs(justAfter.lat - justBefore.lat)).toBeLessThan(1e-4);
    expect(Math.abs(justAfter.lon - justBefore.lon)).toBeLessThan(1e-4);
    expect(justAfter.lon).toBeGreaterThan(justBefore.lon);
    engine.dispose();
  });

  it('reads the Earth under the window, not under the pin', async () => {
    // The frame bug this locks down: a shore patch measures from its own
    // centre and the coast fill works in plane metres, so a window that had
    // slid away from the pin read the Earth its own offset away -- right at
    // the start of a session, when the two coincide, and a mile out for
    // every mile she sailed. Every window the tests built before this one
    // sat on the pin, which is why a clean self-review passed it.
    const engine = sailing({ region: 'coast', randomWorld: false, seed: 13 });
    // The planet arrives on a promise. Without this the window is built from
    // the seed alone and the test is about nothing -- which is exactly what
    // the first draft did, and it reported the same land either way.
    await Promise.resolve();
    await Promise.resolve();
    engine.advance(0.1);

    // Where the stub's coast actually is, asked of the stub rather than read
    // off its source: it is land north of 30N by *sample*, and a bilinear
    // read puts the waterline most of a degree further on.
    const planet = stubEarth();
    let shoreLat = 29;
    while (!planet.isLand({ lat: shoreLat, lon: -122.65 }) && shoreLat < 33) shoreLat += 0.005;
    expect(shoreLat).toBeLessThan(33);

    // Pin her 55 km south of that shore and slide the window 30 km north of
    // the pin. Correctly translated, the window spans 20-40 km north of the
    // pin and is open sea by 15 km. Untranslated, it reads the patch at 20-40
    // km from the *patch's* centre, which is 50-65 km north of the pin --
    // straight through the shoreline.
    carryTo(engine, shoreLat - 55_000 / METRES_PER_DEG_LAT);
    engine.snapshot.state.pos = { x: 0, y: 30_000 };
    engine.advance(0.02);
    let land = 0;
    for (let x = -9000; x <= 9000; x += 500) {
      for (let y = 21_000; y <= 39_000; y += 500) {
        if (engine.snapshot.region!.elevationAt(x, y) > 0) land++;
      }
    }
    // Not zero: the generator still scatters its own islands offshore, and
    // they are invented rather than the Earth's. A continent is another
    // matter -- untranslated this window measures four fifths land.
    expect(land / (37 * 37)).toBeLessThan(0.05);
    engine.dispose();
  });

  it('rebuilds the coast once when the plane is re-pinned, not three times', async () => {
    const engine = sailing({ region: 'coast', randomWorld: false, seed: 13 });
    await Promise.resolve();
    await Promise.resolve();
    engine.advance(1);
    const builds = coastHeightField as ReturnType<typeof vi.fn>;
    builds.mockClear();
    // Across the trigger, then one more step to catch a window left centred
    // where she used to be.
    engine.snapshot.state.pos = { x: REANCHOR_AT + 1, y: 0 };
    engine.advance(0.02);
    engine.advance(0.02);
    // One: the re-anchor's own. Passing the *old* plane's metres on to the
    // slide added a second window around a point 200 km away and a third to
    // put it back -- three builds of 640,000 samples each, all synchronous.
    expect(builds.mock.calls.length).toBe(1);
    engine.dispose();
  });

  it('builds the coast on the Earth once the planet lands', async () => {
    // The stub is land north of the equator and sea south of it, and the
    // default anchor is at 37N -- so a window there must hold land, and one
    // moved deep into the southern ocean must hold none. That is the whole
    // claim: the shoreline the generator used came from the planet.
    const engine = sailing({ region: 'coast', randomWorld: false, seed: 13 });
    await Promise.resolve();
    await Promise.resolve();
    engine.advance(1);
    const region = engine.snapshot.region;
    expect(region).not.toBeNull();
    let land = 0;
    for (let x = -9000; x <= 9000; x += 500) {
      for (let y = -9000; y <= 9000; y += 500) {
        if (region!.elevationAt(x, y) > 0) land++;
      }
    }
    expect(land).toBeGreaterThan(0);
    engine.dispose();
  });
});

/**
 * The wind belts, as the engine applies them.
 *
 * `climate.test.ts` already asserts that the belts are the ones a pilot chart
 * carries; what is left to the engine is that the boat is *in* one, that
 * moving her across the planet moves her between them, and that the wind she
 * feels changes accordingly rather than staying whatever the settings slider
 * last said.
 */
describe('the wind belts', () => {
  const deg = (r: number) => ((r * 180) / Math.PI + 360) % 360;

  it('blows from the east in the trades and from the west down south', () => {
    const engine = sailing({ region: 'coast', randomWorld: false, seed: 13 });
    engine.advance(0.1);
    carryTo(engine, 15);
    // Put to sea again where she now is: a session opens in the belt it opens
    // in, without a four-minute swing.
    engine.putToSea();
    engine.advance(0.1);
    expect(engine.snapshot.belt).toBe('trades');
    // The north-east trades: from between north and east, which is the fact
    // the trade routes were built on.
    const trades = deg(engine.snapshot.wind.baseTwd);
    expect(trades).toBeGreaterThan(20);
    expect(trades).toBeLessThan(90);
    const tradeTws = engine.snapshot.wind.baseTws;

    carryTo(engine, -50);
    engine.putToSea();
    engine.advance(0.1);
    expect(engine.snapshot.belt).toBe('westerlies');
    // The roaring forties: from between west and north-west, and harder than
    // the trades on the same setting -- which is the whole reason a passage
    // plan is a latitude plan.
    const roaring = deg(engine.snapshot.wind.baseTwd);
    expect(roaring).toBeGreaterThan(250);
    expect(roaring).toBeLessThan(330);
    expect(engine.snapshot.wind.baseTws).toBeGreaterThan(tradeTws * 1.3);
    engine.dispose();
  });

  it('goes soft in the doldrums', () => {
    const engine = sailing({ region: 'coast', randomWorld: false, seed: 13 });
    engine.advance(0.1);
    const away = engine.snapshot.wind.baseTws;
    carryTo(engine, 0);
    engine.putToSea();
    engine.advance(0.1);
    expect(engine.snapshot.belt).toBe('doldrums');
    // Calm, not dead: a doldrum with no wind in it is a wall rather than a
    // passage, and she still has to be able to crawl out of it.
    expect(engine.snapshot.wind.baseTws).toBeLessThan(away * 0.5);
    expect(engine.snapshot.wind.baseTws).toBeGreaterThan(0.4);
    engine.dispose();
  });

  it('swings into the next belt over a watch, not in a step', () => {
    const engine = sailing({ region: 'coast', randomWorld: false, seed: 13 });
    engine.advance(0.1);
    carryTo(engine, 12);
    engine.putToSea();
    engine.advance(0.1);
    const started = deg(engine.snapshot.wind.baseTwd);
    // Carried into the southern westerlies without a restart: the wind must
    // now be wrong for where she is, and must correct itself gradually.
    carryTo(engine, -45);
    engine.advance(60);
    const soon = deg(engine.snapshot.wind.baseTwd);
    // A minute in, most of the way still to go. Asserted as "has not
    // arrived" rather than as a number, because the constant is a tuning
    // value and the claim is that there is a lag at all.
    expect(Math.abs(soon - started)).toBeLessThan(120);
    engine.advance(900);
    const arrived = deg(engine.snapshot.wind.baseTwd);
    expect(arrived).toBeGreaterThan(250);
    expect(arrived).toBeLessThan(330);
    engine.dispose();
  });

  it('leaves a surveyed region alone', () => {
    // Those places were laid out around a particular breeze; a belt reaching
    // in to turn it would undo the thing that makes them worth sailing. Shown
    // by taking a session that *does* have a belt and moving it, so that a
    // deleted branch cannot pass on the strength of the field starting null.
    const engine = sailing({ region: 'coast', randomWorld: false, seed: 13 });
    engine.advance(0.5);
    expect(engine.snapshot.belt).not.toBeNull();
    regionLoad.mockReturnValue(deferred<RegionTerrain>().promise);
    engine.applySettings(settings({ region: 'sf-bay', venue: '' }));
    engine.advance(0.5);
    expect(engine.snapshot.belt).toBeNull();
    engine.dispose();
  });
});
