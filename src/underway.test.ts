import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearUnderway, loadUnderway, sameWorld, saveUnderway } from './underway';

/**
 * The one row that survives a session.
 *
 * Every test here is about *not trusting it*. The row decides which world the
 * next voyage opens in and where in it, so a hand-edited or half-written one
 * has to fail into "start a new voyage" rather than into a boat inside a
 * continent or a world nobody asked for.
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
const EARTH = { region: 'coast', venue: '', seed: 7, place: { lat: -33.87, lon: 151.21 }, pos: null };
const ISLANDS = { region: '', venue: '', seed: 42, place: null, pos: { x: 1200, y: -800 } };

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

  it('comes back as it went in, in either coordinate', () => {
    saveUnderway(EARTH, 1234);
    const earth = loadUnderway()!;
    expect(earth.region).toBe('coast');
    expect(earth.seed).toBe(7);
    expect(earth.place!.lat).toBeCloseTo(-33.87, 9);
    expect(earth.place!.lon).toBeCloseTo(151.21, 9);
    expect(earth.pos).toBeNull();
    expect(earth.at).toBe(1234);

    // The other kind of world: a plane that never moves, so plane metres are
    // the honest form and there is no latitude at all.
    saveUnderway(ISLANDS);
    const islands = loadUnderway()!;
    expect(islands.place).toBeNull();
    expect(islands.pos).toEqual({ x: 1200, y: -800 });
  });

  it('forgets on request', () => {
    saveUnderway(EARTH);
    clearUnderway();
    expect(loadUnderway()).toBeNull();
  });

  it('holds a stored position inside the world', () => {
    // Written out rather than imported: the claim is that a row can never
    // name a place off the Earth, and asserting the module's own limits back
    // at it would hold at any limit including none.
    store.raw.set(KEY, JSON.stringify({ ...EARTH, place: { lat: 120, lon: 400 }, at: 1 }));
    const back = loadUnderway()!;
    expect(back.place!.lat).toBeLessThanOrEqual(90);
    expect(back.place!.lat).toBeGreaterThan(80);
    expect(back.place!.lon).toBeGreaterThanOrEqual(-180);
    expect(back.place!.lon).toBeLessThanOrEqual(180);
  });

  it('refuses a row that is not a whole voyage', () => {
    // A row needs a world, a seed, a timestamp and one of the two positions.
    // Anything short of that is half-written, and it is not a row this game
    // has ever produced -- so it belongs to something else and adopting it
    // would put the boat somewhere nobody asked for.
    const bad = [
      '{',
      '[]',
      '"coast"',
      '3',
      'null',
      // no world
      JSON.stringify({ seed: 1, place: { lat: 1, lon: 2 }, at: 1 }),
      // no seed, or one that is not a number
      JSON.stringify({ region: 'coast', venue: '', place: { lat: 1, lon: 2 }, at: 1 }),
      JSON.stringify({ region: 'coast', venue: '', seed: 'x', place: { lat: 1, lon: 2 }, at: 1 }),
      // no timestamp
      JSON.stringify({ region: 'coast', venue: '', seed: 1, place: { lat: 1, lon: 2 } }),
      // neither coordinate
      JSON.stringify({ region: 'coast', venue: '', seed: 1, place: null, pos: null, at: 1 }),
      // half a coordinate
      JSON.stringify({ region: 'coast', venue: '', seed: 1, place: { lat: 1 }, at: 1 }),
      JSON.stringify({ region: '', venue: '', seed: 1, pos: { x: 1 }, at: 1 }),
      JSON.stringify({ region: '', venue: '', seed: 1, pos: { x: 1, y: 'north' }, at: 1 }),
    ];
    for (const row of bad) {
      store.raw.set(KEY, row);
      expect(loadUnderway(), row).toBeNull();
    }
  });

  it('knows whether a row is the world these settings would sail', () => {
    // What "sail on" is allowed to resume into. A seed is part of the world,
    // not a detail of it: the same coordinates under another seed are another
    // archipelago, and on the Earth another shoreline.
    saveUnderway(ISLANDS);
    const row = loadUnderway()!;
    expect(sameWorld(row, { region: '', venue: '', seed: 42 })).toBe(true);
    expect(sameWorld(row, { region: '', venue: '', seed: 43 })).toBe(false);
    expect(sameWorld(row, { region: 'coast', venue: '', seed: 42 })).toBe(false);
    expect(sameWorld(row, { region: '', venue: 'somewhere', seed: 42 })).toBe(false);
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
    expect(() => saveUnderway(EARTH)).not.toThrow();
    expect(() => clearUnderway()).not.toThrow();
  });
});
