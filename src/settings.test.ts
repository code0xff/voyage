import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, currentVec, loadSettings } from './settings';
import { MAX_MAGNIFY, MIN_MAGNIFY } from './view/orbit';

/**
 * The set is quoted as the direction the water is going *to*, the opposite of
 * the convention for wind direction, and this function is the one place that
 * fact turns into a vector. Getting it backwards would send every boat uptide,
 * which looks entirely plausible until you check it against a compass -- so it
 * is checked against a compass.
 */
describe('set and drift', () => {
  const at = (setDeg: number, driftKnots: number) =>
    currentVec({ ...DEFAULT_SETTINGS, setDeg, driftKnots });

  it('sends the water the way the set points, not the way it comes from', () => {
    // World frame is x = East, y = North.
    const east = at(90, 2);
    expect(east.x).toBeGreaterThan(0);
    expect(east.y).toBeCloseTo(0, 9);

    const north = at(0, 2);
    expect(north.y).toBeGreaterThan(0);
    expect(north.x).toBeCloseTo(0, 9);

    const west = at(270, 2);
    expect(west.x).toBeLessThan(0);
  });

  it('is slack water at zero drift, whatever the set says', () => {
    for (const deg of [0, 90, 180, 270]) {
      const v = at(deg, 0);
      expect(Math.hypot(v.x, v.y)).toBe(0);
    }
  });

  it('scales with the drift, in metres per second', () => {
    const rate = (driftKnots: number) => {
      const v = at(45, driftKnots);
      return Math.hypot(v.x, v.y);
    };
    // Two knots is 1.03 m/s. A drift that reached the physics still in knots
    // would be a factor of two fast and would still look like a tide.
    expect(rate(2)).toBeCloseTo(1.0289, 3);
    expect(rate(4)).toBeCloseTo(2 * 1.0289, 3);
  });
});

/**
 * The binocular power survives a reload, and a stored file cannot open the
 * game at a power the wheel could never reach.
 *
 * Kept here rather than left to a screenshot because it is a boundary, not a
 * look: the wheel already clamps, and the whole risk of persisting the value
 * is that the file becomes a second, unclamped door into the same number.
 */
describe('binocular power', () => {
  /*
   * A local store, rather than jsdom. The suite runs headless on purpose --
   * that is the whole point of the physics core -- and pulling a DOM in for
   * four assertions about a number would be the wrong trade. This is the only
   * browser API `loadSettings` touches.
   */
  const shim = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => shim.get(k) ?? null,
    setItem: (k: string, v: string) => void shim.set(k, v),
    removeItem: (k: string) => void shim.delete(k),
    clear: () => shim.clear(),
    key: () => null,
    length: 0,
  };

  const stored = (v: unknown) => {
    localStorage.setItem(
      'voyage.settings.v2',
      JSON.stringify({ ...DEFAULT_SETTINGS, binocularPower: v }),
    );
    return loadSettings().binocularPower;
  };

  it('comes back as it was left', () => {
    expect(stored(9.5)).toBeCloseTo(9.5, 9);
  });

  it('is held to the range the wheel allows', () => {
    expect(stored(1000)).toBe(MAX_MAGNIFY);
    expect(stored(-4)).toBe(MIN_MAGNIFY);
  });

  it('falls back to the default when the file is nonsense', () => {
    expect(stored('very')).toBe(DEFAULT_SETTINGS.binocularPower);
    expect(stored(NaN)).toBe(DEFAULT_SETTINGS.binocularPower);
    expect(stored(undefined)).toBe(DEFAULT_SETTINGS.binocularPower);
  });

  /**
   * The default has to be a power the control can actually reach, or the
   * glasses would open somewhere the wheel can never return them to.
   */
  it('defaults inside the range', () => {
    expect(DEFAULT_SETTINGS.binocularPower).toBeGreaterThanOrEqual(MIN_MAGNIFY);
    expect(DEFAULT_SETTINGS.binocularPower).toBeLessThanOrEqual(MAX_MAGNIFY);
  });
});
