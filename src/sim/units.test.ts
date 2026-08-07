import { describe, expect, it } from 'vitest';
import { formatDistance, formatDuration, hullSpeed, knotsToMs, msToKnots } from './units';

describe('speed conversion', () => {
  it('round-trips', () => {
    expect(msToKnots(knotsToMs(6.4))).toBeCloseTo(6.4, 10);
  });

  it('puts a knot a little over half a metre per second', () => {
    expect(knotsToMs(1)).toBeGreaterThan(0.5);
    expect(knotsToMs(1)).toBeLessThan(0.52);
  });
});

describe('hull speed', () => {
  // The rule of thumb every yacht is measured against: 1.34 knots per root foot
  // of waterline, which for the 9 m waterline of this boat is about 7.4 knots.
  it('lands on the rule of thumb for a 9 m waterline', () => {
    expect(msToKnots(hullSpeed(9))).toBeGreaterThan(7);
    expect(msToKnots(hullSpeed(9))).toBeLessThan(7.8);
  });

  it('rises with waterline', () => {
    expect(hullSpeed(12)).toBeGreaterThan(hullSpeed(9));
  });
});

describe('formatDistance', () => {
  it('counts in metres below a kilometre and kilometres above', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(940)).toBe('940 m');
    expect(formatDistance(1000)).toBe('1.00 km');
    expect(formatDistance(8410)).toBe('8.41 km');
  });
});

describe('formatDuration', () => {
  /*
   * The bug this locks down: this was a race clock, `m:ss.t`, and every caller
   * now measures a passage instead. It carried no hours at all, so a two and a
   * quarter hour passage -- an ordinary one, and the scale docs/real-map.md is
   * aiming at -- read as `135:00.0`.
   */
  it('carries hours', () => {
    expect(formatDuration(2 * 3600 + 15 * 60)).toBe('2h 15m');
    expect(formatDuration(3600)).toBe('1h 0m');
  });

  it('counts seconds only under a minute, where an approach wants them', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(48)).toBe('48s');
    expect(formatDuration(59.9)).toBe('59s');
    expect(formatDuration(60)).toBe('1m');
  });

  it('drops the seconds above a minute', () => {
    expect(formatDuration(41 * 60 + 12.8)).toBe('41m');
    expect(formatDuration(3599)).toBe('59m');
  });

  // Rounds down, both ways it matters: an ETA that has not arrived must never
  // read as arrived, and a passage must not claim a minute it did not sail.
  it('never rounds up into a unit it has not reached', () => {
    expect(formatDuration(59.999)).toBe('59s');
    expect(formatDuration(3599.999)).toBe('59m');
    expect(formatDuration(7199.999)).toBe('1h 59m');
  });

  it('signs a negative span rather than printing it as elapsed', () => {
    expect(formatDuration(-30)).toBe('-30s');
    expect(formatDuration(-90)).toBe('-1m');
  });
});
