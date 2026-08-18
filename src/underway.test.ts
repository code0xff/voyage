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
const SYDNEY = { seed: 7, place: { lat: -33.87, lon: 151.21 } };

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
