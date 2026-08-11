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

/**
 * What the underwater foils do when the water is not coming from ahead.
 *
 * `leeway` is `atan2(v, u)`, so sternway reads ±180 degrees, and `FOIL_CD` is
 * measured over 0–90 with `sample()` clamping above it. Both the keel and the
 * rudder were therefore given 1.32 — the coefficient for water hitting a blade
 * broadside — when they were in fact edge-on, and the rudder's drag was taken
 * off the surge unconditionally, so it pushed her astern while she was already
 * going astern. The two were near enough equal and opposite to look like an
 * equilibrium, which is how they lasted. See `docs/keel-sternway.md`.
 *
 * These drive the real `step()` and assert against the world -- what the water
 * does to a boat going backwards -- rather than against the formulas.
 */
describe('reversed flow', () => {
  const still = { ...DEFAULT_ENV, tws: 0 };
  /** No sails, no wind: only what the water does to her. */
  const drift = (over: Partial<BoatState>, seconds: number, rudder = 0) => {
    const s = initialState({ v: 0, r: 0, heel: 0, stowed: true, ...over });
    const ctl: Controls = { rudder, sheet: 0, twist: 0, autoTrim: false };
    let d = step(s, CRUISER, still, ctl, DT);
    for (let i = 1; i < Math.round(seconds / DT); i++) d = step(s, CRUISER, still, ctl, DT);
    return { s, d };
  };

  /**
   * The property, measured on the boat rather than on a coefficient: water is
   * water whichever way she meets it. A hull going backwards is not the same
   * shape as one going forwards, so this does not ask for equality -- only that
   * the way she loses is the same order either way, which 1.32 against 0.01 is
   * not. Broadside, she gave up seven times as much.
   *
   * Measured as speed lost, because the keel's drag is in no diagnostic and a
   * test that read `hullDrag` would watch the wrong term entirely.
   */
  it('gives up her way at the same sort of rate going backwards', () => {
    const lost = (u: number) => Math.abs(u) - Math.abs(drift({ u }, 5).s.u);
    const ahead = lost(1.5);
    const astern = lost(-1.5);
    expect(ahead).toBeGreaterThan(0);
    expect(astern).toBeGreaterThan(0);
    expect(astern).toBeLessThan(ahead * 2.5);
    expect(astern).toBeGreaterThan(ahead / 2.5);
  });

  /** She slows down going backwards, which is the whole of it. */
  it('takes the way off her instead of driving her further astern', () => {
    const { s } = drift({ u: -1.5 }, 20);
    expect(s.u).toBeGreaterThan(-1.5);
    expect(s.u).toBeLessThanOrEqual(0);
  });

  /**
   * The blade's drag, in both directions, asserted on the surge it actually
   * produces rather than on the diagnostic. It used to come off the surge
   * unconditionally -- `fx -= qR * cdr` -- so going astern it pointed the way
   * she was already travelling, and a test that only read `rudderDrag` would
   * miss a version that reported one thing and applied another.
   *
   * Isolated by taking the keel and the hull out of the boat, because folding
   * the angle makes the coefficient small and either of them would otherwise
   * swamp it.
   */
  it('always works the rudder drag against her way through the water', () => {
    const bare = { ...CRUISER, keelArea: 0, wettedArea: 0, windageArea: 0 };
    const surge = (u: number) => {
      const s = initialState({ u, v: 0, r: 0, heel: 0, stowed: true });
      const ctl: Controls = { rudder: 0, sheet: 0, twist: 0, autoTrim: false };
      for (let i = 0; i < 120; i++) step(s, bare, still, ctl, DT);
      return s.u - u;
    };
    expect(surge(1.5)).toBeLessThan(0); // going ahead, she slows
    expect(surge(-1.5)).toBeGreaterThan(0); // going astern, she slows
    expect(drift({ u: -1.5 }, 0.1).d.rudderDrag).toBeGreaterThan(0);
  });

  /**
   * Nothing moving, nothing happening. The old code reached the same answer by
   * a different route -- its outer gate was the hull's speed, so a boat at a
   * dead stop skipped the rudder entirely -- which is why the floor's real cost
   * is the test below this one rather than this one.
   */
  it('makes no rudder force at all with no water going past the blade', () => {
    const { d } = drift({ u: 0, v: 0 }, 0.1, 0.9);
    expect(d.rudderForce).toBe(0);
    expect(d.rudderDrag).toBe(0);
  });

  /**
   * And the floor's other half, which the case above cannot see: with her
   * barely moving the pressure has to follow the speed she is actually making.
   * `uSafe` clamped |u| up to 0.3 before squaring it, so everything below that
   * got the same force -- at 0.1 m/s, nine times the truth.
   */
  it('scales rudder force with the speed she is really making', () => {
    const at = (u: number) =>
      Math.abs(drift({ u, v: 0 }, 0.1, 0.9).d.rudderForce);
    // Quadratic: twice the speed, four times the force.
    expect(at(0.2)).toBeGreaterThan(at(0.1) * 3.5);
    expect(at(0.2)).toBeLessThan(at(0.1) * 4.5);
  });

  /**
   * The helm works backwards going astern, which is what a boat does and what
   * the old model could not express: it took the angle from a clamped `uSafe`
   * whose sign was the sign of `s.u`, then applied the force the same way round
   * regardless.
   */
  /**
   * The keel's lift, isolated from the rudder and the weathervane so that only
   * its direction is under test: she must be carried to leeward of her track,
   * not to windward, whichever way she is going through the water.
   */
  it('resists the sideslip whichever way she is moving', () => {
    const bare = { ...CRUISER, rudderArea: 0, weathervane: 0 };
    const settled = (u: number) => {
      const s = initialState({ u, v: 0.3, r: 0, heel: 0, heading: 0, stowed: true });
      const ctl: Controls = { rudder: 0, sheet: 0, twist: 0, autoTrim: false };
      for (let i = 0; i < 5 * 120; i++) step(s, bare, still, ctl, DT);
      return s.v;
    };
    // The sideslip is damped, not driven, and never crosses to the other side.
    expect(settled(1.5)).toBeGreaterThan(0);
    expect(settled(1.5)).toBeLessThan(0.3);
    expect(settled(-1.5)).toBeGreaterThan(0);
    expect(settled(-1.5)).toBeLessThan(0.3);
  });

  it('reverses the helm when she has sternway', () => {
    const ahead = drift({ u: 1.5, heading: 90 * DEG }, 4, 0.8).s.heading;
    const astern = drift({ u: -1.5, heading: 90 * DEG }, 4, 0.8).s.heading;
    expect(wrapPi(ahead - 90 * DEG)).toBeGreaterThan(0);
    expect(wrapPi(astern - 90 * DEG)).toBeLessThan(0);
  });

  /**
   * Exact sternway has no side to it. The weathervane term multiplied the full
   * track angle by speed², so ±pi went into a term derived for small forward
   * sideslip and picked its direction from the sign of a numerical zero.
   */
  it('picks no side when she is going exactly straight backwards', () => {
    const { s } = drift({ u: -1.5, v: 0, r: 0 }, 10);
    expect(Math.abs(s.v)).toBeLessThan(1e-9);
    expect(Math.abs(s.r)).toBeLessThan(1e-9);
  });
});
