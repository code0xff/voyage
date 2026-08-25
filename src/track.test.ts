import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearTrack, loadTrack, saveTrack } from './track';

/**
 * The track a resumed voyage draws.
 *
 * Like `underway.test.ts`, most of this is about *not trusting the row*. It
 * costs less when it goes wrong -- a bad track is a wrong line on a chart
 * rather than a boat inside a continent -- but it is read at the moment a
 * session opens, and a row that threw there would cost the session.
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

const KEY = 'voyage.track.v1';
const LEG = [
  { lat: 37.78, lon: -122.65 },
  { lat: 37.79, lon: -122.66 },
  { lat: 37.8, lon: -122.67 },
];

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

describe('the track she has sailed', () => {
  it('is nothing at all until she has sailed', () => {
    expect(loadTrack()).toBeNull();
  });

  it('comes back in the order it went in', () => {
    // The order is the claim, not just the contents: the chart strokes these
    // as one path, and a track read back reversed or shuffled is a line
    // through water she never crossed.
    saveTrack(7, LEG, 1234);
    const row = loadTrack()!;
    expect(row.seed).toBe(7);
    expect(row.at).toBe(1234);
    expect(row.points).toHaveLength(3);
    row.points.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(LEG[i].lat, 5);
      expect(p.lon).toBeCloseTo(LEG[i].lon, 5);
    });
  });

  it('keeps a point to about a metre', () => {
    // 1e-5 of a degree is 1.1 m of latitude, against a track sampled every
    // twelve. Written out rather than imported from the module: the claim is
    // that a stored point is good to a metre, and asserting the module's own
    // rounding back at it would hold at any rounding including none.
    saveTrack(1, [{ lat: 12.3456789, lon: -98.7654321 }]);
    const p = loadTrack()!.points[0];
    expect(Math.abs(p.lat - 12.3456789) * 111_195).toBeLessThan(1);
    expect(Math.abs(p.lon - -98.7654321) * 111_195).toBeLessThan(1);
  });

  it('forgets on request', () => {
    saveTrack(7, LEG);
    clearTrack();
    expect(loadTrack()).toBeNull();
  });

  it('carries an empty track without inventing one', () => {
    // She has put to sea and not yet moved twelve metres. That is a real
    // state and it must not read back as "no row", which means something
    // else -- a voyage with no track behind it at all.
    saveTrack(7, []);
    expect(loadTrack()!.points).toEqual([]);
  });

  it('refuses a row that is not a whole track', () => {
    const bad = [
      '{',
      '[]',
      '"track"',
      '3',
      'null',
      // no seed, or one that is not a number
      JSON.stringify({ at: 1, p: [1, 2] }),
      JSON.stringify({ seed: 'x', at: 1, p: [1, 2] }),
      // no timestamp
      JSON.stringify({ seed: 1, p: [1, 2] }),
      // no points, or points that are not a list
      JSON.stringify({ seed: 1, at: 1 }),
      JSON.stringify({ seed: 1, at: 1, p: { 0: 1, 1: 2 } }),
      // cut in the middle of a point: there is no honest way to read the last
      JSON.stringify({ seed: 1, at: 1, p: [1, 2, 3] }),
      // and a coordinate that is not one
      JSON.stringify({ seed: 1, at: 1, p: [1, 2, 'north', 4] }),
      JSON.stringify({ seed: 1, at: 1, p: [1, 2, null, 4] }),
    ];
    for (const row of bad) {
      store.raw.set(KEY, row);
      expect(loadTrack(), row).toBeNull();
    }
  });

  it('holds every stored point inside the world', () => {
    // Written out rather than imported, on `underway.test.ts`'s reasoning:
    // asserting the module's own limits back at it would hold at any limit.
    store.raw.set(KEY, JSON.stringify({ seed: 1, at: 1, p: [120, 400, -95, -540] }));
    for (const p of loadTrack()!.points) {
      expect(p.lat).toBeGreaterThanOrEqual(-90);
      expect(p.lat).toBeLessThanOrEqual(90);
      expect(p.lon).toBeGreaterThanOrEqual(-180);
      expect(p.lon).toBeLessThanOrEqual(180);
    }
  });

  it('survives storage refusing to work at all', () => {
    // Private browsing throws on write and sometimes on read. A track that
    // cannot be stored costs a line on a chart, never a session.
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
    expect(() => saveTrack(1, LEG)).not.toThrow();
    expect(() => clearTrack()).not.toThrow();
    expect(loadTrack()).toBeNull();
  });
});
