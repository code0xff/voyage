import { describe, expect, it } from 'vitest';
import { CRUISER, DEFAULT_ENV } from './config';
import { POLAR_TOLERANCE, noGoAngle, pace, polarStale, solvePolar, targetSpeed } from './polar';
import { knotsToMs, msToKnots } from './units';
import { DEG, RAD } from './math';

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

/**
 * What "inside the no-go zone" means, which is not what she sails best at.
 *
 * A fixed 40 degrees used to stand in for this in `PassageBar`, and the polar
 * says it cannot: the boundary runs from 20 degrees in a drifter to 60 in a
 * gale. `bestUpwind` cannot stand in for it either -- at twelve knots that is
 * 45 while she is still gaining ground at 25 -- and using it tells a helmsman
 * to tack for a mark he can lay.
 */
describe('the no-go boundary', () => {
  const at = (kn: number) => {
    const p = solvePolar(CRUISER, { ...DEFAULT_ENV, tws: knotsToMs(kn) });
    return { polar: p, noGo: noGoAngle(p)! * RAD };
  };

  it('is where she stops making ground, not where she makes it best', () => {
    const { polar, noGo } = at(12);
    expect(noGo).toBeLessThan(polar.bestUpwind!.twa * RAD);
    // Everything inside it loses ground, and the boundary itself gains.
    for (const p of polar.points) {
      if (p.twa * RAD < noGo) expect(p.vmg).toBeLessThanOrEqual(0);
    }
    expect(polar.points.find((p) => p.twa * RAD === noGo)!.vmg).toBeGreaterThan(0);
  });

  /**
   * It widens with the wind, and hard at the top of the range: reefed sails and
   * a head sea. Measured, 20 degrees in three knots, 25 through the middle, 60
   * at forty -- which is the whole reason a constant will not do.
   *
   * Note it does *not* open up in light air, where `bestUpwind` does. The angle
   * she works to windward best at and the angle she stops gaining at are two
   * different curves, and only one of them is what "no-go" means.
   */
  it('widens with the wind, hardest in a gale', { timeout: 20000 }, () => {
    const light = at(3).noGo;
    const middle = at(12).noGo;
    const heavy = at(40).noGo;
    expect(light).toBeLessThanOrEqual(middle);
    expect(middle).toBeLessThan(heavy);
    expect(middle).toBeLessThan(30);
    expect(heavy).toBeGreaterThan(45);
  });
});

/**
 * A polar goes out of date on its own, because the weather moves the mean wind
 * underneath it. Nothing said so until this existed: the curve, and the header
 * quoting the wind it was solved at, went on being drawn for a breeze that had
 * stopped blowing.
 */
describe('a stale polar', () => {
  const solvedFor = (tws: number) => ({ tws, points: [], bestUpwind: null, bestDownwind: null, maxSpeed: 0 });

  it('is not stale in the wind it was solved for', () => {
    expect(polarStale(solvedFor(6), 6)).toBe(false);
  });

  /**
   * Derived from the tolerance rather than written out, so retuning it does not
   * quietly turn these into assertions about nothing.
   */
  it('tolerates a drift inside the tolerance and not one outside it', () => {
    expect(polarStale(solvedFor(6), 6 * (1 + POLAR_TOLERANCE * 0.8))).toBe(false);
    expect(polarStale(solvedFor(6), 6 * (1 + POLAR_TOLERANCE * 1.2))).toBe(true);
  });

  /**
   * Both ways. The wind dropping leaves a polar exactly as wrong as the wind
   * rising, and an unsigned comparison would have said a boat becalmed under a
   * gale's polar was fine.
   */
  it('is stale whichever way the wind went', () => {
    const up = 6 * (1 + POLAR_TOLERANCE * 2);
    const down = 6 * (1 - POLAR_TOLERANCE * 2);
    expect(polarStale(solvedFor(6), up)).toBe(true);
    expect(polarStale(solvedFor(6), down)).toBe(true);
  });

  /**
   * The claim, and so written out rather than derived: the tolerance has to be
   * tight enough to notice a real change in the weather. `windScale` runs from
   * 0.55 in fog to 1.75 in a squall, and its smallest single step -- fair to
   * overcast, 1.0 to 1.1 -- is ten per cent. A tolerance that slept through
   * that would leave the polar wrong for most of a session in `auto` weather,
   * which is the default.
   */
  it('notices the smallest step the weather can take', () => {
    const fair = 6;
    const overcast = fair * 1.1;
    expect(polarStale(solvedFor(fair), overcast)).toBe(true);
    // And the whole range, which is where it stops being a detail: a polar for
    // fog describes nothing at all about a boat in a squall.
    expect(polarStale(solvedFor(6 * 0.55), 6 * 1.75)).toBe(true);
  });
});

/**
 * The target, and the pace against it.
 *
 * Boat speed on its own cannot tell a helmsman whether five and a half knots
 * was well sailed: it says nothing about what was available. These are what
 * turn a trim into a verdict, so they have to be right about the easy cases as
 * well as the hard ones.
 */
describe('target speed', () => {
  const polar = solvePolar(CRUISER, { ...DEFAULT_ENV, tws: knotsToMs(12) });

  it('returns the solved speed at an angle that was solved', () => {
    const at90 = polar.points.find((p) => Math.round(p.twa * RAD) === 90)!;
    expect(targetSpeed(polar, at90.twa)).toBeCloseTo(at90.speed, 9);
  });

  it('interpolates between two solved angles', () => {
    const lo = polar.points.find((p) => Math.round(p.twa * RAD) === 90)!;
    const hi = polar.points.find((p) => Math.round(p.twa * RAD) === 95)!;
    const middle = targetSpeed(polar, (lo.twa + hi.twa) / 2)!;
    expect(middle).toBeCloseTo((lo.speed + hi.speed) / 2, 6);
    // And it really is between them, which a botched index would not be.
    expect(middle).toBeGreaterThan(Math.min(lo.speed, hi.speed) - 1e-9);
    expect(middle).toBeLessThan(Math.max(lo.speed, hi.speed) + 1e-9);
  });

  /**
   * The boat is symmetrical and the polar is solved for one side, so both
   * tacks read from the same half. Signed angles are where this project makes
   * its mistakes, and an unsigned lookup would have returned the light-air end
   * of the curve for every port tack.
   */
  it('reads a port tack the same as a starboard one', () => {
    for (const deg of [35, 60, 90, 140, 175]) {
      expect(targetSpeed(polar, -deg * DEG)).toBe(targetSpeed(polar, deg * DEG));
    }
  });

  it('has nothing to say about a polar with no points in it', () => {
    expect(targetSpeed({ ...polar, points: [] }, 90 * DEG)).toBeNull();
  });

  /** A hand-edited polar can repeat an angle; `solvePolar` cannot. */
  it('does not divide by two points at the same angle', () => {
    const twin = polar.points[10];
    const target = targetSpeed({ ...polar, points: [twin, { ...twin }] }, twin.twa)!;
    expect(Number.isFinite(target)).toBe(true);
  });
});

describe('pace against the polar', () => {
  const polar = solvePolar(CRUISER, { ...DEFAULT_ENV, tws: knotsToMs(12) });
  const reach = 90 * DEG;

  it('is one when she is doing exactly what the polar says', () => {
    const target = targetSpeed(polar, reach)!;
    expect(pace(polar, reach, target)!.fraction).toBeCloseTo(1, 9);
  });

  it('falls below one when she is slow and rises above it when she is not', () => {
    const target = targetSpeed(polar, reach)!;
    expect(pace(polar, reach, target * 0.9)!.fraction).toBeCloseTo(0.9, 6);
    // Above one is a real reading and not an error: the polar is solved for the
    // mean wind, so a gust genuinely puts her over it. An instrument that
    // clamped at 100% would be hiding the most useful moment of the day.
    expect(pace(polar, reach, target * 1.1)!.fraction).toBeCloseTo(1.1, 6);
  });

  /**
   * The refusal that matters. In the no-go zone the ratio stays arithmetically
   * true -- ninety-odd per cent of a target of about a knot -- while reading as
   * "well sailed" at the exact moment the boat is pinched and going nowhere.
   */
  it('says nothing at all inside the no-go zone', () => {
    const noGo = noGoAngle(polar)!;
    const pinched = noGo * 0.5;
    // Not because there is no target there: there is, and it is what makes the
    // ratio so misleading.
    expect(targetSpeed(polar, pinched)).toBeGreaterThan(0);
    expect(pace(polar, pinched, targetSpeed(polar, pinched)! * 0.95)).toBeNull();
    // And it starts speaking again the moment she is sailing.
    expect(pace(polar, noGo * 1.2, 2)).not.toBeNull();
  });

  it('reads a port tack the same as a starboard one', () => {
    expect(pace(polar, -reach, 3)!.fraction).toBeCloseTo(pace(polar, reach, 3)!.fraction, 9);
  });

  /**
   * A polar that makes no ground to windward anywhere has no boundary to be
   * inside or outside of, so there is nowhere it can be quoted from. Not
   * reachable from the settings, but `pace` is handed a polar rather than
   * making one and the branch has to mean something.
   */
  it('has nothing to say about a polar that cannot get her to windward at all', () => {
    const becalmed = { ...polar, points: polar.points.map((p) => ({ ...p, vmg: -1 })) };
    expect(pace(becalmed, reach, 3)).toBeNull();
  });
});
