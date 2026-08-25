import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearUnderway, loadUnderway, sameWorld, saveUnderway } from './underway';

/**
 * The one row that survives a session.
 *
 * Every test here is about *not trusting it*. The row decides where the next
 * voyage opens, so a hand-edited or half-written one has to fail into "start a
 * new voyage" rather than into a boat inside a continent.
 */

/** Enough localStorage for the module: it uses three methods and no events. */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    /** For a test that needs to write nonsense past the module. */
    raw: map,
  };
}

const KEY = 'voyage.underway.v1';
const SYDNEY = { seed: 7, place: { lat: -33.87, lon: 151.21 }, hour: 20.5, began: 9 };

let store: ReturnType<typeof fakeStorage>;
const had = 'localStorage' in globalThis;
const saved = had ? globalThis.localStorage : undefined;

beforeEach(() => {
  store = fakeStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
});

afterEach(() => {
  if (had) Object.defineProperty(globalThis, 'localStorage', { value: saved, configurable: true });
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('the voyage she is on', () => {
  it('is nothing at all until she has sailed', () => {
    expect(loadUnderway()).toBeNull();
  });

  it('comes back as it went in', () => {
    saveUnderway(SYDNEY, 1234);
    const row = loadUnderway()!;
    expect(row.seed).toBe(7);
    expect(row.place.lat).toBeCloseTo(-33.87, 9);
    expect(row.place.lon).toBeCloseTo(151.21, 9);
    expect(row.hour).toBeCloseTo(20.5, 9);
    expect(row.began).toBeCloseTo(9, 9);
    expect(row.at).toBe(1234);
  });

  it('forgets on request', () => {
    saveUnderway(SYDNEY);
    clearUnderway();
    expect(loadUnderway()).toBeNull();
  });

  it('holds a stored position inside the world', () => {
    // Written out rather than imported: the claim is that a row can never
    // name a place off the Earth, and asserting the module's own limits back
    // at it would hold at any limit including none.
    store.raw.set(KEY, JSON.stringify({ seed: 1, place: { lat: 120, lon: 400 }, at: 1 }));
    const back = loadUnderway()!;
    expect(back.place.lat).toBeLessThanOrEqual(90);
    expect(back.place.lat).toBeGreaterThan(80);
    expect(back.place.lon).toBeGreaterThanOrEqual(-180);
    expect(back.place.lon).toBeLessThanOrEqual(180);
  });

  it('refuses a row that is not a whole voyage', () => {
    // A row needs a seed, a timestamp and a place. Anything short of that is
    // half-written, and it is not a row this game has ever produced -- so it
    // belongs to something else and adopting it would put the boat somewhere
    // nobody asked for.
    const bad = [
      '{',
      '[]',
      '"coast"',
      '3',
      'null',
      // no seed, or one that is not a number
      JSON.stringify({ place: { lat: 1, lon: 2 }, at: 1 }),
      JSON.stringify({ seed: 'x', place: { lat: 1, lon: 2 }, at: 1 }),
      // no timestamp
      JSON.stringify({ seed: 1, place: { lat: 1, lon: 2 } }),
      // no place at all, or half of one
      JSON.stringify({ seed: 1, place: null, at: 1 }),
      JSON.stringify({ seed: 1, place: { lat: 1 }, at: 1 }),
      // And the shape the island field used to write: plane metres and no
      // latitude. That world is gone, so there is nowhere to put her.
      JSON.stringify({ region: '', seed: 1, pos: { x: 1200, y: -800 }, at: 1 }),
    ];
    for (const row of bad) {
      store.raw.set(KEY, row);
      expect(loadUnderway(), row).toBeNull();
    }
  });

  it('still reads a row written when there was more than one world', () => {
    // The extra keys are ignored rather than refused: it is the same voyage,
    // written by a build that had a world to name.
    store.raw.set(
      KEY,
      JSON.stringify({
        region: 'coast',
        venue: '',
        seed: 7,
        place: { lat: 10, lon: 20 },
        pos: null,
        at: 5,
      }),
    );
    const row = loadUnderway()!;
    expect(row.seed).toBe(7);
    expect(row.place.lat).toBeCloseTo(10, 9);
  });

  it('carries no hour for a row written before the clock was', () => {
    // Every row this game wrote for its first weeks has no `hour`, and each
    // one is a good voyage. Null and not a number, because the number a
    // caller would want is the Start time setting and this module has never
    // heard of it -- guessed as zero it would open a resumed voyage at
    // midnight, which is a worse answer than the reset it replaces.
    store.raw.set(KEY, JSON.stringify({ seed: 7, place: { lat: 1, lon: 2 }, at: 1 }));
    const row = loadUnderway()!;
    expect(row.seed).toBe(7);
    expect(row.hour).toBeNull();
  });

  it('carries no hour rather than an unreadable one', () => {
    // The rest of the row is a voyage and stands. An hour that is not a
    // number is one fact missing, not a row from somewhere else.
    for (const hour of ['midday', null, {}, NaN, Infinity]) {
      store.raw.set(KEY, JSON.stringify({ seed: 7, place: { lat: 1, lon: 2 }, hour, at: 1 }));
      const row = loadUnderway();
      expect(row, String(hour)).not.toBeNull();
      expect(row!.hour, String(hour)).toBeNull();
    }
  });

  it('refuses a carried clock it could not have written', () => {
    // Refused rather than clamped, both ends, and the caller falls back to
    // the start hour -- which is the answer it already takes for an hour that
    // is missing or not a number. Clamped instead, each of these comes back
    // as a perfectly readable clock that the voyage then opens on: midnight
    // at one end, and at the other an hour the sky cannot draw smoothly.
    for (const hour of [-5, -1e-6, 1e300, 5e5]) {
      store.raw.set(KEY, JSON.stringify({ seed: 7, place: { lat: 1, lon: 2 }, hour, at: 1 }));
      const row = loadUnderway();
      expect(row, String(hour)).not.toBeNull();
      expect(row!.hour, `${hour} was taken as a clock`).toBeNull();
    }
  });

  it('writes a clock the sun and the sky can both still move', () => {
    // The other side of the same bound: what the game *writes* is clamped, so
    // a voyage whose clock somehow ran past the limit is written at it and
    // comes back at it -- a pinned calendar at a steady time of day -- rather
    // than written past it and refused on the next open.
    //
    // Every number written out, because they are the claim: asserting the
    // module's own bound back at it would hold at any bound including none --
    // and a bound of zero would satisfy the two upper claims below on its
    // own, which is what the lower one is here to stop.
    saveUnderway({ ...SYDNEY, hour: 1e300 });
    const hour = loadUnderway()!.hour!;
    // Far enough for any voyage: ten thousand world hours is a year and a
    // half of weather, and a clock clamped short of that would be pinning
    // calendars on voyages people actually sail.
    expect(hour, 'the clock is pinned inside a voyage anyone might sail').toBeGreaterThan(1e4);
    // The clock is stepped by about 1e-5 of an hour, and one too large to add
    // that to is a stopped sun that nothing reports.
    expect(hour + 1e-5, 'the clock is too large to advance').toBeGreaterThan(hour);
    // And the renderer multiplies it up into float32 uniforms -- the cloud
    // deck's drift at 0.5 an hour, scaled again in the shader and sampled by
    // five noise octaves. Past about 3e5 the octave carrying half the sky
    // starts stepping in visible fractions of a noise cell.
    expect(hour, 'the carried clock reaches the sky as a stuttering float').toBeLessThan(3e5);
  });

  it('takes any hour the Start time setting can hand it as an origin', () => {
    // `began` is an hour of the day, and the day it has to cover is the one
    // `loadSettings` allows: it clamps `startHour` to 0..24 inclusive, so 24
    // is a hour a voyage can have begun at. Written exclusive first, which
    // refused exactly that one and quietly put its tide back on the setting.
    for (const began of [0, 9, 23.5, 24]) {
      saveUnderway({ ...SYDNEY, began });
      const back = loadUnderway()!.began;
      // Asserted non-null *before* the number, and not as a formality:
      // `expect(null).toBeCloseTo(0)` passes, because null coerces to zero in
      // the subtraction. Written the short way, the midnight case blessed a
      // bound that refused it.
      expect(back, `${began} was refused as an origin`).not.toBeNull();
      expect(back, `${began} came back as something else`).toBeCloseTo(began, 9);
    }
    // And not an hour of some other day.
    for (const began of [-0.5, 24.5, NaN, 'nine']) {
      store.raw.set(
        KEY,
        JSON.stringify({ seed: 7, place: { lat: 1, lon: 2 }, hour: 20, began, at: 1 }),
      );
      expect(loadUnderway()!.began, `${began} was taken as an origin`).toBeNull();
    }
  });

  it('knows whether a row is the world these settings would sail', () => {
    // A seed *is* the world now: the same coordinates under another seed are
    // another shoreline.
    saveUnderway(SYDNEY);
    const row = loadUnderway()!;
    expect(sameWorld(row, { seed: 7 })).toBe(true);
    expect(sameWorld(row, { seed: 8 })).toBe(false);
  });

  it('survives storage refusing to work at all', () => {
    // Private browsing throws on write and sometimes on read. Losing the
    // voyage must cost a passage, never a session.
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
        removeItem: () => {
          throw new Error('denied');
        },
      },
      configurable: true,
    });
    expect(loadUnderway()).toBeNull();
    expect(() => saveUnderway(SYDNEY)).not.toThrow();
    expect(() => clearUnderway()).not.toThrow();
  });
});
