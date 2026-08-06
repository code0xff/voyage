import { describe, expect, it } from 'vitest';
import { skyState, wrapHour, formatClock } from './sky';
describe('time of day', () => {
  it('puts the sun up during the day and below the horizon at night', () => {
    expect(skyState(12).sunElevation).toBeGreaterThan(0.7);
    expect(skyState(2).sunElevation).toBeLessThan(0);
    expect(skyState(23).sunElevation).toBeLessThan(0);
  });

  it('never goes fully black, because a moonlit night is still sailable', () => {
    const night = skyState(1);
    expect(night.daylight).toBeGreaterThanOrEqual(0);
    expect(night.sunIntensity).toBeGreaterThan(0.1);
    expect(night.ambientIntensity).toBeGreaterThan(0.3);
  });

  it('moves smoothly through dawn instead of snapping', () => {
    let prev = skyState(3).daylight;
    for (let h = 3; h < 10; h += 0.05) {
      const d = skyState(h).daylight;
      expect(Math.abs(d - prev)).toBeLessThan(0.05);
      prev = d;
    }
  });

  it('wraps the clock', () => {
    expect(wrapHour(25)).toBeCloseTo(1);
    expect(wrapHour(-1)).toBeCloseTo(23);
    expect(formatClock(9.5)).toBe('09:30');
    expect(formatClock(23.99)).toBe('23:59');
  });

  it('keeps the sun direction a unit-ish vector pointing the right way', () => {
    const noon = skyState(12);
    const [x, y, z] = noon.sunDir;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 3);
    expect(y).toBeGreaterThan(0.5); // high overhead
  });
});
