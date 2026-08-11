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

vi.mock('./view/scene', () => ({
  createScene: () => ({
    render: () => {
      sceneCalls.render++;
    },
    setTerrain: () => {},
    setRegion: () => {},
    toggleCamera: () => {},
    capture: async () => null,
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

/** Region rasters are fetched over the network; no test here sails one. */
vi.mock('./terrain-load', () => ({ loadRegion: async () => null }));

/** IndexedDB. The passage log is asserted through the engine's own event. */
vi.mock('./logbook', () => ({
  logbook: { add: async () => undefined, all: async () => [], clear: async () => undefined },
}));

import { createEngine } from './engine';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { WhaleField } from './sim/whales';
import { SharkField } from './sim/sharks';
import { wrapPi } from './sim/math';
import { TIDE_PERIOD } from './sim/current';

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
const saved: Record<string, unknown> = {};
const had: Record<string, true> = {};
const GLOBALS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'];

beforeEach(() => {
  frames = [];
  sceneCalls.render = 0;
  for (const key of GLOBALS) {
    if (key in globalThis) {
      had[key] = true;
      saved[key] = (globalThis as Record<string, unknown>)[key];
    }
  }

  (globalThis as Record<string, unknown>).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
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

describe('engine', () => {
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
   * A world is reproducible from its seed all the way through. Two engines on
   * one seed given the same frames must sail the same passage; a third on
   * another seed must not.
   */
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
   * is really an assertion about the wiring: the boat's drift, the sea built
   * from the wind over moving water, and the displacement the waves and the
   * wake are carried by all come off that one vector. Driven at a high time
   * scale so half a cycle passes in a few seconds of sailing.
   */
  it('turns the stream, and carries the boat and the sea round with it', () => {
    const engine = sailing({ driftKnots: 4, setDeg: 0, startHour: 9, timeScale: 900 });

    engine.advance(1);
    const atStart = engine.snapshot.currents.peak.y;
    const seaAtStart = engine.snapshot.waves.drift.y;

    // A quarter of a cycle at 900x is about 12 seconds of sailing.
    engine.advance((TIDE_PERIOD / 4) * 3600 / 900 - 1);
    const atSlack = engine.snapshot.currents.peak.y;

    engine.advance((TIDE_PERIOD / 4) * 3600 / 900);
    const atEbb = engine.snapshot.currents.peak.y;
    const seaAtEbb = engine.snapshot.waves.drift.y;
    engine.dispose();

    // Full run at the start, slack a quarter in, running back at the half.
    expect(atStart).toBeGreaterThan(1.9);
    expect(Math.abs(atSlack)).toBeLessThan(0.2);
    expect(atEbb).toBeLessThan(-1.9);
    // ...and the sea was carried one way and then back, rather than on and on.
    expect(seaAtStart).toBeGreaterThan(0);
    expect(seaAtEbb).toBeLessThan(seaAtStart);
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
});
