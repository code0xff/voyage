import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, currentVec } from './settings';

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
