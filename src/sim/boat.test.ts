import { describe, expect, it } from 'vitest';
import { CRUISER, DEFAULT_ENV } from './config';
import { initialState, step, type BoatState, type Controls } from './boat';
import { DEG, RAD, wrapPi } from './math';
import { knotsToMs, msToKnots } from './units';

const DT = 1 / 120;
const AUTO: Controls = { rudder: 0, sheet: 0, autoTrim: true };

function run(s: BoatState, seconds: number, ctl: Controls = AUTO, tws = knotsToMs(12)) {
  const env = { ...DEFAULT_ENV, tws };
  let d = step(s, CRUISER, env, ctl, DT);
  for (let i = 1; i < Math.round(seconds / DT); i++) d = step(s, CRUISER, env, ctl, DT);
  return d;
}

describe('sign conventions', () => {
  it('reports wind from starboard as a positive apparent wind angle', () => {
    // Wind from the north, boat heading east: the wind hits the port bow.
    const s = initialState({ heading: 90 * DEG, u: 2 });
    const d = step(s, CRUISER, DEFAULT_ENV, AUTO, DT);
    expect(d.awa).toBeLessThan(0);

    // Boat heading west: now the wind is on the starboard bow.
    const s2 = initialState({ heading: 270 * DEG, u: 2 });
    const d2 = step(s2, CRUISER, DEFAULT_ENV, AUTO, DT);
    expect(d2.awa).toBeGreaterThan(0);
  });

  it('heels away from the wind', () => {
    // Wind from starboard pushes the boat over to port, so heel goes negative.
    const s = initialState({ heading: 315 * DEG, u: 2.5 });
    run(s, 25);
    expect(s.heel).toBeLessThan(-5 * DEG);
  });

  it('slips to leeward, not to windward', () => {
    const s = initialState({ heading: 315 * DEG, u: 2.5 });
    const d = run(s, 30);
    // Wind on the starboard bow means the boat is pushed to port: leeway < 0.
    expect(d.leeway).toBeLessThan(0);
    expect(Math.abs(d.leeway) * RAD).toBeLessThan(10);
  });
});

describe('steering', () => {
  it('turns to starboard on positive rudder', () => {
    const s = initialState({ heading: 90 * DEG, u: 3 });
    const before = s.heading;
    run(s, 6, { rudder: 0.8, sheet: 0, autoTrim: true });
    expect(wrapPi(s.heading - before)).toBeGreaterThan(0);
  });

  /**
   * Regression: the directional-stability term had the wrong sign, so it
   * accelerated the luff-up instead of damping it. The boat rounded into the
   * wind and stalled no matter which way the rudder was pushed.
   */
  it('holds a course roughly steady with the helm centred', () => {
    const s = initialState({ heading: 315 * DEG, u: 3 });
    run(s, 20);
    const settled = s.heading;
    run(s, 30);
    // Some weather helm is correct and desirable; a runaway is not.
    expect(Math.abs(wrapPi(s.heading - settled)) * RAD).toBeLessThan(25);
  });

  /**
   * Regression: yaw moments that scaled with v instead of v^2 overwhelmed the
   * rudder at low speed, which made the boat impossible to tack.
   */
  it('completes a tack through the wind and rebuilds speed', () => {
    const s = initialState({ heading: 315 * DEG, u: 3 });
    run(s, 40);
    const speedBefore = msToKnots(run(s, 1).speed);
    expect(speedBefore).toBeGreaterThan(3);

    // Push the helm over and hold it until the bow crosses the wind.
    run(s, 14, { rudder: 0.9, sheet: 0, autoTrim: true });
    const afterTack = step(s, CRUISER, DEFAULT_ENV, AUTO, DT);
    expect(afterTack.awa).toBeLessThan(0); // now on the other tack
    expect(s.heel).toBeGreaterThan(0); // and heeled the other way

    const recovered = msToKnots(run(s, 60).speed);
    expect(recovered).toBeGreaterThan(speedBefore * 0.6);
  });
});

describe('numerical health', () => {
  it('never produces NaN, even sailing straight into the wind', () => {
    const s = initialState({ heading: 0, u: 0 });
    const d = run(s, 120);
    for (const v of [s.u, s.v, s.r, s.heel, s.pitch, s.heave, s.pos.x, s.pos.y]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(Number.isFinite(d.speed)).toBe(true);
  });

  it('stays bounded in survival conditions', () => {
    const s = initialState({ heading: 300 * DEG, u: 3 });
    run(s, 90, AUTO, knotsToMs(45));
    expect(Math.abs(s.heel)).toBeLessThan(Math.PI / 2);
    expect(msToKnots(Math.hypot(s.u, s.v))).toBeLessThan(15);
  });
});
