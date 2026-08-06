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

  it('cannot sail into the no-go zone', () => {
    const deadUpwind = polar.points.find((p) => p.twa * RAD === 0)!;
    expect(msToKnots(deadUpwind.speed)).toBeLessThan(1.5);
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
