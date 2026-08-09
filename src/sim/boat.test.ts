import { describe, expect, it } from 'vitest';
import { CRUISER, DEFAULT_ENV } from './config';
import { initialState, step, type BoatState, type Controls } from './boat';
import { DEG, RAD, wrapPi } from './math';
import { knotsToMs, msToKnots } from './units';

const DT = 1 / 120;
const AUTO: Controls = { rudder: 0, sheet: 0, twist: 0, autoTrim: true };

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

  /**
   * Regression: a hull left to itself on a sloping wave leaned *into* the face
   * of it, at twice the slope angle.
   *
   * `rollSlope` is positive starboard-up and `s.heel` is positive
   * starboard-down -- the test above pins that second half -- and the righting
   * moment took the difference of the two as though they ran the same way. The
   * polar could never have caught it: `solvePolar` sets `rollSlope` to zero on
   * purpose, because a rolling boat has no steady state to find.
   *
   * Sailed with no wind and no way on, so the only thing left to move her is
   * the water under her.
   *
   * Asserted as a *stationary point* rather than as a settling time. Where she
   * ends up after forty seconds is a fact about `rollDamp` and `rollInertia`
   * as much as about the sign, and would turn a legitimate retune of either
   * into a failure here. Put her at the attitude the water implies, and she
   * should simply stay: no roll acceleration, from any tuning of a righting
   * moment that is doing its job.
   */
  it('lies along a wave rather than leaning into it', () => {
    const slope = 6 * DEG;
    const sea = { h13: 0, dir: 0, heave: 0, pitchSlope: 0, rollSlope: slope, depth: Infinity };
    const drift: Controls = { rudder: 0, sheet: 0, twist: 0, autoTrim: false };
    const env = { ...DEFAULT_ENV, tws: 0 };

    // Water higher to starboard, so her starboard side rides up with it and she
    // lies over to port. Leaning to starboard would be into the wave face.
    const settled = initialState({ heading: 0, u: 0 });
    settled.heel = -slope;
    step(settled, CRUISER, env, drift, DT, { sea });
    expect(Math.abs(settled.heelRate) * RAD).toBeLessThan(0.05);

    // And she is not merely stationary there but pulled back to it: started
    // upright, the first thing she does is lean to port.
    const upright = initialState({ heading: 0, u: 0 });
    step(upright, CRUISER, env, drift, DT, { sea });
    expect(upright.heelRate).toBeLessThan(0);
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
    run(s, 6, { rudder: 0.8, sheet: 0, twist: 0, autoTrim: true });
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
    run(s, 14, { rudder: 0.9, sheet: 0, twist: 0, autoTrim: true });
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

  /**
   * Regression. The apparent wind angle is an `atan2`, and `atan2` of two zeroes
   * is decided by their *signs*. In a dead calm with the boat stopped the
   * apparent wind is built from `tws * 0`, and the components came out as -0 or
   * +0 depending only on which way the wind had been blowing: measured, a
   * northerly read 0 degrees and a southerly read 180. The gauge swung between
   * dead ahead and dead astern over a difference that does not exist.
   *
   * There is no apparent wind angle when there is no apparent wind. The point is
   * only that the answer must not depend on the sign of a zero.
   */
  it('does not invent an apparent wind angle out of a dead calm', () => {
    for (const twdDeg of [0, 90, 180, 212, 270]) {
      const env = { ...DEFAULT_ENV, tws: 0, twd: twdDeg * DEG };
      const s = initialState({ heading: 40 * DEG, u: 0, v: 0 });
      const d = step(s, CRUISER, env, AUTO, DT, { lockHeading: true });
      expect(d.awa).toBe(0);
      expect(d.awaMast).toBe(0);
      expect(d.aws).toBe(0);
    }
  });

  it('stays bounded in survival conditions', () => {
    const s = initialState({ heading: 300 * DEG, u: 3 });
    run(s, 90, AUTO, knotsToMs(45));
    expect(Math.abs(s.heel)).toBeLessThan(Math.PI / 2);
    expect(msToKnots(Math.hypot(s.u, s.v))).toBeLessThan(15);
  });
});
