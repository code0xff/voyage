import { describe, expect, it } from 'vitest';
import { CRUISER, DEFAULT_ENV } from './config';
import { solvePolar } from './polar';
import { knotsToMs, msToKnots } from './units';
import { RAD } from './math';

/**
 * The polar diagram is the only objective yardstick for "is the physics right".
 * Every regression that mattered in this project showed up here first:
 * a missing induced-drag term produced a 60-degree tacking angle, which is
 * physically impossible and completely invisible while flying the boat around.
 */
describe('polar diagram', () => {
  const polar = solvePolar(CRUISER, { ...DEFAULT_ENV, tws: knotsToMs(12) });

  /**
   * Asserted on what she makes to windward, not on how fast she is moving.
   *
   * This used to require the speed itself to be under 1.5 kn, and passed for
   * the wrong reason: head to wind with her sails flogging she is blown
   * *astern*, and what held that to a crawl was a keel and rudder given the
   * broadside drag coefficient because the flow angle read 180 degrees and the
   * table stops at 90 (see `docs/keel-sternway.md`). With those corrected she
   * blows back at 2.3 kn, which is what a boat with sail up does head to wind
   * -- and the no-go zone is no less closed for it. `leeway` reads 180 and the
   * VMG is negative, which is the claim.
   */
  it('cannot sail into the no-go zone', () => {
    // A sector rather than one angle: the claim is that nothing close enough to
    // the wind makes ground to windward, and dead ahead alone cannot say it.
    // Fifteen degrees with room to spare -- measured, the VMG turns positive
    // between 20 and 25, where she is close-hauled and sailing badly rather
    // than pinned.
    const noGo = polar.points.filter((p) => p.twa * RAD <= 15);
    expect(noGo.length).toBeGreaterThan(3);
    for (const p of noGo) expect(msToKnots(p.vmg)).toBeLessThanOrEqual(0);
    // ...and dead ahead she is going backwards to earn it, not lying still.
    const deadUpwind = polar.points.find((p) => p.twa * RAD === 0)!;
    expect(Math.abs(deadUpwind.leeway * RAD)).toBeGreaterThan(90);
  });

  it('has its best upwind VMG at a realistic angle', () => {
    // A 10 m cruiser points at 42-48 degrees true wind angle. Anything much
    // lower means a drag term is missing; much higher means too much drag.
    const twa = polar.bestUpwind!.twa * RAD;
    expect(twa).toBeGreaterThanOrEqual(40);
    expect(twa).toBeLessThanOrEqual(50);
  });

  it('reaches top speed on a beam-to-broad reach, not downwind', () => {
    const fastest = polar.points.reduce((a, b) => (b.speed > a.speed ? b : a));
    const twa = fastest.twa * RAD;
    expect(twa).toBeGreaterThanOrEqual(75);
    expect(twa).toBeLessThanOrEqual(125);

    const dead = polar.points.at(-1)!;
    // Running dead downwind is slower than reaching: the boat sails away from
    // the wind, so apparent wind speed collapses.
    expect(dead.speed).toBeLessThan(fastest.speed);
  });

  it('stays below hull speed in moderate air', () => {
    // 1.25 * sqrt(9 m) = 3.75 m/s = 7.29 kn
    expect(msToKnots(polar.maxSpeed)).toBeLessThan(7.3);
    expect(msToKnots(polar.maxSpeed)).toBeGreaterThan(5.0);
  });

  it('makes a few degrees of leeway upwind', () => {
    const upwind = polar.bestUpwind!;
    const leeway = Math.abs(upwind.leeway) * RAD;
    expect(leeway).toBeGreaterThan(1.5);
    expect(leeway).toBeLessThan(6);
  });

  // Three full polars, which is 111 steady-state solves and about 1.6 million
  // physics steps. It genuinely takes this long; it is not hanging.
  it('points highest in medium air and worse at both extremes', { timeout: 30_000 }, () => {
    const angleAt = (kn: number) =>
      solvePolar(CRUISER, { ...DEFAULT_ENV, tws: knotsToMs(kn) }, 5).bestUpwind!.twa * RAD;
    const light = angleAt(6);
    const medium = angleAt(12);
    const heavy = angleAt(30);
    // Light air lacks the power to drive through drag; heavy air means reefed
    // sails and a head sea. Both force you to crack off.
    expect(medium).toBeLessThan(light);
    expect(medium).toBeLessThan(heavy);
  });

  it('reefs down as the wind builds', () => {
    const strong = solvePolar(CRUISER, { ...DEFAULT_ENV, tws: knotsToMs(30) }, 5);
    expect(strong.bestUpwind!.sailFraction).toBeLessThan(0.75);
    expect(polar.bestUpwind!.sailFraction).toBe(1);
  });
});
