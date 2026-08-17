import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearReckoning, loadReckoning, saveReckoning } from './reckoning';

/**
 * The one row that survives a session.
 *
 * Every test here is about *not trusting it*. The row is two numbers that
 * decide which sea the next departure opens in, so a hand-edited or
 * half-written one has to fail into "open where the game opens" rather than
 * into a boat inside a continent.
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

describe('the remembered position', () => {
  it('is nothing at all until she has sailed', () => {
    expect(loadReckoning()).toBeNull();
  });

  it('comes back as it went in', () => {
    saveReckoning({ lat: -33.87, lon: 151.21 }, 1234);
    const back = loadReckoning();
    expect(back?.lat).toBeCloseTo(-33.87, 9);
    expect(back?.lon).toBeCloseTo(151.21, 9);
    expect(back?.at).toBe(1234);
  });

  it('forgets on request', () => {
    saveReckoning({ lat: 10, lon: 20 });
    clearReckoning();
    expect(loadReckoning()).toBeNull();
  });

  it('holds a stored position inside the world', () => {
    // Written out rather than imported: the claim is that a row can never
    // name a place off the Earth, and asserting the module's own limits back
    // at it would hold at any limit including none.
    store.raw.set('voyage.reckoning.v1', JSON.stringify({ lat: 120, lon: 400, at: 1 }));
    const back = loadReckoning();
    expect(back!.lat).toBeLessThanOrEqual(90);
    expect(back!.lat).toBeGreaterThan(80);
    expect(back!.lon).toBeGreaterThanOrEqual(-180);
    expect(back!.lon).toBeLessThanOrEqual(180);
  });

  it('refuses a row that is not a whole position', () => {
    // Not only the shapes that are obviously wrong: a row with two good
    // numbers and no usable timestamp is half-written, and it is not a row
    // this game has ever produced. It used to be accepted with `at` quietly
    // defaulted to zero, which turned someone else's data into ours.
    const bad = [
      '{',
      '[]',
      '"12,34"',
      '3',
      'null',
      '{"lat":null}',
      '{"lat":"north","lon":3,"at":1}',
      '{"lon":3,"at":1}',
      '{"lat":12,"lon":34}',
      '{"lat":12,"lon":34,"at":"bad"}',
      '{"lat":12,"lon":34,"at":null}',
      '{"lat":12,"lon":34,"at":{}}',
      '{"lat":12,"lon":null,"at":1}',
      `{"lat":12,"lon":${Number.MAX_VALUE * 2},"at":1}`,
    ];
    for (const row of bad) {
      store.raw.set('voyage.reckoning.v1', row);
      expect(loadReckoning(), row).toBeNull();
    }
  });

  it('survives storage refusing to work at all', () => {
    // Private browsing throws on write and sometimes on read. Losing the
    // position must cost a passage, never a session.
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
    expect(loadReckoning()).toBeNull();
    expect(() => saveReckoning({ lat: 1, lon: 2 })).not.toThrow();
    expect(() => clearReckoning()).not.toThrow();
  });
});
