import { describe, expect, it } from 'vitest';
import { SHEAR_EXPONENT, shearFactor } from './shear';
import { DEPOWER_HEEL, SAIL_STRIPS, STRIP_AREA, STRIP_U, sailPlan, windRefHeight } from './sailplan';
import { CRUISER, DEFAULT_ENV, cgHeight } from './config';
import { initialState, step, type Controls } from './boat';
import { DEG, RAD } from './math';
import { knotsToMs } from './units';

describe('wind gradient', () => {
  const zRef = windRefHeight(CRUISER);

  it('is exactly the quoted wind at the reference height', () => {
    // The whole point of referencing the profile to the sail's own centre of
    // effort rather than the 10 m standard: the gradient redistributes wind
    // over the sail instead of scaling the boat's power up or down. If this
    // ever drifts, CRUISER has to be retuned and the polar means nothing.
    expect(shearFactor(zRef, zRef)).toBeCloseTo(1, 12);
  });

  it('blows harder higher up', () => {
    let last = 0;
    for (let z = 1; z <= 20; z += 0.5) {
      const f = shearFactor(z, zRef);
      expect(f).toBeGreaterThan(last);
      last = f;
    }
  });

  it('stays finite and positive right down at the water', () => {
    // z^0.14 has an infinite slope at zero, so the profile is floored rather
    // than evaluated there.
    for (const z of [0, -1, 1e-9]) {
      const f = shearFactor(z, zRef);
      expect(Number.isFinite(f)).toBe(true);
      expect(f).toBeGreaterThan(0);
    }
  });

  it('spans a believable fraction across a real rig', () => {
    const plan = sailPlan(CRUISER, 0, 0);
    const zc = cgHeight(CRUISER);
    const foot = shearFactor(plan.footHeight + zc, zRef);
    const head = shearFactor(plan.headHeight + zc, zRef);
    expect(foot).toBeLessThan(1);
    expect(head).toBeGreaterThan(1);
    // Measurements over water put the head of a rig this size in 25-40% more
    // wind than the foot. Much less and twist would not be worth modelling;
    // much more and the exponent has been mistaken for a land value.
    expect(head / foot).toBeGreaterThan(1.2);
    expect(head / foot).toBeLessThan(1.45);
    expect(SHEAR_EXPONENT).toBeLessThan(0.25);
  });
});

describe('sail strips', () => {
  it('accounts for the whole sail exactly once', () => {
    const total = STRIP_AREA.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 12);
    expect(STRIP_AREA).toHaveLength(SAIL_STRIPS);
  });

  /**
   * The invariant that keeps the strip model honest. Integrating the sail in
   * bands must not move its centre of effort, or heel and yaw would quietly
   * disagree with the single-force model they replaced, and every number in
   * `CRUISER` tuned against it would be wrong by an unknown amount.
   */
  it('has its area centroid exactly at the centre of effort', () => {
    for (const [reef, furl] of [
      [0, 0],
      [1, 0.5],
      [3, 0.9],
    ]) {
      const plan = sailPlan(CRUISER, reef, furl);
      const span = plan.headHeight - plan.footHeight;
      let z = 0;
      for (let i = 0; i < SAIL_STRIPS; i++) {
        z += STRIP_AREA[i] * (plan.footHeight + STRIP_U[i] * span);
      }
      expect(z).toBeCloseTo(plan.ceHeight, 9);
    }
  });

  it('puts more area low down than high up, as a triangular sail does', () => {
    expect(STRIP_AREA[0]).toBeGreaterThan(STRIP_AREA[SAIL_STRIPS - 1]);
  });

  it('keeps the foot above the water and the head below the masthead', () => {
    for (let r = 0; r <= 3; r++) {
      const plan = sailPlan(CRUISER, r, 0);
      expect(plan.footHeight + cgHeight(CRUISER)).toBeGreaterThan(0);
      expect(plan.headHeight).toBeLessThan(CRUISER.sailSpan + 3);
      expect(plan.headHeight).toBeGreaterThan(plan.footHeight);
    }
  });

  it('survives bare poles without a degenerate span', () => {
    const bare = sailPlan({ ...CRUISER, mainArea: 0, jibArea: 0 }, 0, 1);
    expect(Number.isFinite(bare.footHeight)).toBe(true);
    expect(Number.isFinite(bare.headHeight)).toBe(true);
  });
});

const DT = 1 / 120;
const AUTO: Controls = { rudder: 0, sheet: 0, twist: 0, autoTrim: true };

function settle(headingDeg: number, tws: number, seconds: number, reef = 0) {
  const env = { ...DEFAULT_ENV, tws };
  const s = initialState({ heading: headingDeg * DEG, u: 3, reef });
  let d = step(s, CRUISER, env, AUTO, DT);
  for (let i = 1; i < Math.round(seconds / DT); i++) d = step(s, CRUISER, env, AUTO, DT, {
    lockHeading: true,
  });
  return { s, d };
}

/**
 * Settle at a fixed true wind angle. `force` null lets the auto-trim choose the
 * twist; a number holds that twist instead, with the sheet still trimmed
 * automatically, so the two can be compared at the same operating point.
 */
function settleTwist(twsKn: number, twaDeg: number, force: number | null) {
  const env = { ...DEFAULT_ENV, tws: knotsToMs(twsKn) };
  const s = initialState({ heading: env.twd - twaDeg * DEG, u: 3 });
  const opts = { lockHeading: true };
  let d = step(s, CRUISER, env, AUTO, DT, opts);
  for (let i = 1; i < Math.round(120 / DT); i++) {
    d = step(s, CRUISER, env, AUTO, DT, opts);
    if (force !== null) s.twist = force;
  }
  return { speed: d.speed, heelAvg: s.heelAvg };
}

describe('sail twist', () => {
  /**
   * The gradient is the reason twist exists. Upwind the boat's own speed
   * dominates the apparent wind and compresses the angular spread over the
   * rig; on a broad reach it does not, and the head ends up a long way aft of
   * the foot. That is why sails are trimmed nearly flat upwind and let right
   * open downwind, and it has to fall out of the model rather than be asserted.
   *
   * Asserted on the trim target rather than on the raw spread, because that is
   * the number the boat and the player both act on. The two are the same thing
   * while the boom is clear of the shrouds, which on these two headings it is.
   */
  it('asks for far more twist off the wind than on it', () => {
    const beat = settle(315, knotsToMs(12), 60).d;
    const reach = settle(225, knotsToMs(12), 60).d;
    expect(reach.twistWanted).toBeGreaterThan(beat.twistWanted * 2);
    expect(beat.twistWanted * RAD).toBeLessThan(6);
  });

  /**
   * The masthead vane is drawn 14 m up and must be given the wind from 14 m up.
   * Handing it `awa` -- the wind at the sail's centre of effort, half that
   * height -- would draw an instrument pointing somewhere nothing at its own
   * height is pointing, which is exactly the sort of renderer-physics
   * disagreement this project cannot afford: the vane is steered by.
   */
  it('reads the masthead wind further aft than the sail feels', () => {
    for (const heading of [315, 270, 225]) {
      const d = settle(heading, knotsToMs(12), 60).d;
      expect(Math.abs(d.awaMast)).toBeGreaterThan(Math.abs(d.awa));
      // Same wind, so the two only differ by the gradient -- a few degrees on
      // a beat, more as the boat bears away. Never a different quadrant.
      expect(Math.abs(d.awaMast - d.awa) * RAD).toBeLessThan(25);
      expect(Math.sign(d.awaMast)).toBe(Math.sign(d.awa));
    }
  });

  it('twists the head open when the boat is overpowered', () => {
    // Full sail in 28 knots is far too much. A crew reaches for the vang before
    // the reef pennant, so the auto-trim must be well beyond what the gradient
    // alone asks for.
    const { s, d } = settle(315, knotsToMs(28), 90);
    expect(s.twist).toBeGreaterThan(d.twistWanted + 8 * DEG);
    expect(s.heelAvg * RAD).toBeGreaterThan(20);
  });

  it('trims for power, not heel, when there is nothing to depower', () => {
    const { s, d } = settle(315, knotsToMs(8), 90);
    expect(s.heelAvg * RAD).toBeLessThan(24);
    expect(s.twist).toBeCloseTo(d.twistWanted, 2);
  });

  /**
   * Close-hauled the boom is already against its inhaul, so the sheet cannot
   * come in far enough and the foot ends up at *less* angle of attack than it
   * wants. The head must then be trimmed to the angle the foot actually has,
   * not to the angle it was aiming for -- otherwise the sail comes out flat,
   * with the head over-trimmed relative to a foot that is itself under-trimmed.
   *
   * The cost of getting this wrong is only about 0.2%, too small for the
   * optimality sweep below to resolve, so it is pinned here as a value instead:
   * the twist must be the couple of degrees of apparent wind spread across the
   * rig, and a rule that aims the head at the target angle regardless collapses
   * it to zero.
   */
  it('still twists to the gradient when the boom is on its inhaul', () => {
    const { s } = settle(315, knotsToMs(8), 90);
    expect(s.sheet).toBeCloseTo(CRUISER.minSheet, 4); // the premise: sheet pinned
    expect(s.twist * RAD).toBeGreaterThan(1.5);
    expect(s.twist * RAD).toBeLessThan(5);
  });

  /**
   * The auto-trim must actually be a good helmsman, not merely a plausible one.
   *
   * This is the check that was missing the first time round, and the gap is not
   * hypothetical: a rule that read perfectly well in the source -- set the twist
   * to the gradient's spread -- gave away 2.3% dead downwind, because once the
   * boom is on the shrouds the foot is stalled and the head should not be
   * dragged down there with it. That is invisible from reading the code, and
   * invisible in a polar unless you have something to compare the polar against.
   *
   * The comparison is a brute-force sweep of fixed twist angles at the same
   * operating point. Auto-trim has to land within 1% of the best of them; the
   * correct rule is within 0.43%, and that worst case is a broad reach where
   * reattaching the head and leaving it stalled are so nearly equal that which
   * one wins is genuinely marginal.
   *
   * The deep angles are in the grid on purpose. A first attempt at this passed
   * a grid that stopped at 150 degrees while being 0.8% slow dead downwind,
   * where the rule it had been given demanded full twist and a running sail
   * wants none: a test whose grid excludes the case it gets wrong is not a test.
   *
   * One percent does not catch everything. The opposite error -- aiming the head
   * at the target angle even when the boom cannot come in far enough for the
   * foot to reach it -- costs 0.2% and slips through here. What catches that one
   * is the gradient test above: while the boom is free, twist must equal the
   * spread exactly.
   */
  it('trims within one percent of the best twist available', { timeout: 60_000 }, () => {
    let checked = 0;
    for (const tws of [6, 10, 14]) {
      for (const twa of [40, 70, 110, 150, 180]) {
        const auto = settleTwist(tws, twa, null);
        // Overpowered is a different question and is deliberately not a speed
        // optimum: there the auto-trim is spilling wind to hold the boat on her
        // feet, and giving speed away is the whole point of doing it. Those
        // points are covered by the depowering test above.
        if (auto.heelAvg >= DEPOWER_HEEL) continue;
        checked++;

        let best = 0;
        for (let t = 0; t <= CRUISER.maxTwist + 1e-9; t += 5 * DEG) {
          best = Math.max(best, settleTwist(tws, twa, t).speed);
        }
        expect(auto.speed / best).toBeGreaterThan(0.99);
      }
    }
    // Without this the test would quietly pass if every point became
    // heel-limited, which is exactly how a check like this rots.
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  /**
   * Regression. The depowering first ran off the instantaneous heel. Roll is a
   * lightly damped 3.6 s oscillation, so a control chasing it arrives about a
   * quarter of a period late -- antiphase with roll *rate*, which is negative
   * damping. The boat stopped settling at all and wallowed between 20 and 36
   * degrees of heel for as long as it was sailed, and the polar solver happily
   * reported whichever point of that swing it stopped on.
   */
  it('settles instead of wallowing when the depowering is working', () => {
    const env = { ...DEFAULT_ENV, tws: knotsToMs(25) };
    const s = initialState({ heading: 315 * DEG, u: 3, reef: 2 });
    const opts = { lockHeading: true };
    for (let i = 0; i < Math.round(200 / DT); i++) step(s, CRUISER, env, AUTO, DT, opts);

    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < Math.round(30 / DT); i++) {
      step(s, CRUISER, env, AUTO, DT, opts);
      lo = Math.min(lo, s.heel);
      hi = Math.max(hi, s.heel);
    }
    // Three minutes in on flat water there is nothing left to excite roll, so
    // any swing at all is the trim loop feeding it.
    expect((hi - lo) * RAD).toBeLessThan(1);
  });
});
