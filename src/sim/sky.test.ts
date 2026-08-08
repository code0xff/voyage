import { describe, expect, it } from 'vitest';
import { skyState, wrapHour, formatClock, rainbowStrength, RAINBOW_RADIUS } from './sky';
import { DEG } from './math';
import { Weather } from './weather';
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

describe('rainbow', () => {
  /** A shower: drops falling with the sky broken behind them. */
  const SHOWER = { rain: 0.4, cloud: 0.5 };

  it('needs drops, a gap in the cloud and a low sun, all three', () => {
    const low = 12 * DEG;
    expect(rainbowStrength(SHOWER.rain, SHOWER.cloud, low)).toBeGreaterThan(0.3);
    // Any one of the three missing and there is nothing to draw.
    expect(rainbowStrength(0, SHOWER.cloud, low)).toBe(0);
    expect(rainbowStrength(SHOWER.rain, 0.95, low)).toBe(0);
    expect(rainbowStrength(SHOWER.rain, SHOWER.cloud, -2 * DEG)).toBe(0);
  });

  it('sinks below the horizon as the sun climbs past 42 degrees', () => {
    // The arc is centred as far below the horizon as the sun is above it, so
    // there is no such thing as a midday rainbow. This sun peaks at 62.
    expect(rainbowStrength(SHOWER.rain, SHOWER.cloud, RAINBOW_RADIUS + DEG)).toBe(0);
    expect(rainbowStrength(SHOWER.rain, SHOWER.cloud, skyState(12).sunElevation)).toBe(0);
    // ...and it is at its best when the sun is barely up, which is when the
    // whole arc stands highest.
    const morning = rainbowStrength(SHOWER.rain, SHOWER.cloud, 10 * DEG);
    const noonish = rainbowStrength(SHOWER.rain, SHOWER.cloud, 40 * DEG);
    expect(morning).toBeGreaterThan(noonish);
  });

  it('actually happens, at a rate worth building for', () => {
    // The measurement that decided this was worth having at all. Against the
    // weather as it stood before `shower` existed the answer was one minute in
    // 720 hours of world time -- a feature nobody would ever have seen. This
    // holds the rate above dead and below wallpaper.
    let daylight = 0;
    let bow = 0;
    const w = new Weather(20260808);
    let hour = 6;
    for (let i = 0; i < 259200; i++) {
      w.update(10 / 60, 10); // ten world seconds, at the default time scale
      hour += 10 / 3600;
      const sun = skyState(hour).sunElevation;
      if (sun <= 0) continue;
      daylight++;
      if (rainbowStrength(w.state.rain, w.state.cloud, sun) > 0.05) bow++;
    }
    const share = bow / daylight;
    expect(share).toBeGreaterThan(0.002); // it happens
    expect(share).toBeLessThan(0.06); // and is still an occasion when it does
  });

  it('never reports a bow at night', () => {
    for (let h = 20; h < 29; h += 0.25) {
      expect(rainbowStrength(0.9, 0.3, skyState(h).sunElevation)).toBe(0);
    }
  });
});
