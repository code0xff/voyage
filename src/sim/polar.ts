import { DEG, RAD, lerp } from './math';
import {
  initialState,
  step,
  type BoatState,
  type Controls,
  type Diagnostics,
  type SeaState,
} from './boat';
import { autoReef, type ReefState } from './sailplan';
import type { BoatConfig, Environment } from './config';
import { hullSpeed, msToKnots } from './units';
import { waveHeightFromWind } from './waves';

/**
 * A polar diagram: steady-state boat speed at every true wind angle.
 *
 * This is the only objective yardstick in the project for "is the physics
 * right". Compared against a real yacht polar it must reproduce:
 *   - no speed at all around 0-30 degrees (the no-go zone)
 *   - top speed on a beam to broad reach, 90-120 degrees
 *   - dead downwind slower than reaching (apparent wind collapses)
 *   - best upwind VMG somewhere near 40-45 degrees
 */
export interface PolarPoint {
  twa: number; // rad
  speed: number; // m/s
  vmg: number; // m/s (positive = to windward)
  heel: number; // rad
  leeway: number; // rad
  sheet: number; // rad
  /** rad, twist the auto-trim settled on. This is what the gradient is asking for. */
  twist: number;
  awa: number; // rad
  sailFraction: number; // effective area vs full sail, after auto-reefing
}

export interface Polar {
  tws: number;
  points: PolarPoint[];
  bestUpwind: PolarPoint | null;
  bestDownwind: PolarPoint | null;
  maxSpeed: number;
}

const AUTO: Controls = { rudder: 0, sheet: 0, twist: 0, autoTrim: true };

/**
 * Sail the boat on a frozen heading in still water until she settles, and
 * report everything the settle arrived at: the state, the reef the auto-reef
 * chose, and the last diagnostics.
 *
 * This is the core of `solveOne`, exported on its own because it answers a
 * second question besides the polar's: not only how fast the boat goes on a
 * heading, but what trim, what reef and what heel she carries once she has
 * been sailed properly on it -- which is what a competent crew has ready
 * before they put to sea (see departure.ts). One settle serving both keeps
 * the two answers from drifting apart when the reef thresholds are tuned.
 */
export function settleOnHeading(
  cfg: BoatConfig,
  environment: Environment,
  heading: number,
  settleSeconds = 240,
  dt = 1 / 60,
): { s: BoatState; rs: ReefState; d: Diagnostics } {
  // A settle is a still-water measurement by definition -- the speed the boat
  // can hold, not the rate the ground goes past -- so any current is dropped
  // here rather than trusted not to have been passed. `Environment.current`
  // being optional keeps a caller from acquiring one by accident; this keeps
  // the guarantee even from a caller who hands over the live environment.
  const env: Environment = { ...environment, current: undefined };

  // Do not start from rest. Sailing is bistable -- with no speed the apparent
  // wind swings aft and the boat cannot climb to an angle it could otherwise
  // hold -- so starting slow reports angles as unattainable when they are not.
  // The settle measures sustainable state, so start at cruising speed.
  const s = initialState({ heading, u: hullSpeed(cfg.lwl) * 0.7, sheet: 20 * DEG });

  // Only the *mean* effect of waves (added resistance) belongs in a settle.
  // Feeding in the roll and pitch oscillation as well would mean there is no
  // steady state to find, and the answer would just be noise.
  const sea: SeaState = {
    h13: waveHeightFromWind(env.tws),
    dir: env.twd + Math.PI, // waves travel with the wind
    heave: 0,
    pitchSlope: 0,
    rollSlope: 0,
    depth: Infinity,
  };
  const opts = { lockHeading: true, sea };

  const steps = Math.round(settleSeconds / dt);
  const rs: ReefState = { reef: 0, jibFurl: 0, timer: 0 };
  let d = step(s, cfg, env, AUTO, dt, opts);
  for (let i = 1; i < steps; i++) {
    // The settled state is "the boat sailed well". Lying on your ear at 60
    // degrees of heel under full sail in a gale is not a state worth
    // recording, so reefing is optimised alongside.
    autoReef(rs, s.heelAvg, s.heel, dt);
    s.reef = rs.reef;
    s.jibFurl = rs.jibFurl;
    d = step(s, cfg, env, AUTO, dt, opts);
  }
  return { s, rs, d };
}

/** Run with the heading frozen until the boat settles. */
export function solveOne(
  cfg: BoatConfig,
  environment: Environment,
  twaDeg: number,
  settleSeconds = 240,
  dt = 1 / 60,
): PolarPoint {
  // To hold a given true wind angle with the wind coming from twd, point the
  // bow at twd - twa.
  const { s, d } = settleOnHeading(
    cfg,
    environment,
    environment.twd - twaDeg * DEG,
    settleSeconds,
    dt,
  );

  return {
    twa: twaDeg * DEG,
    speed: d.speed,
    vmg: d.vmg,
    heel: s.heel,
    leeway: d.leeway,
    sheet: s.sheet,
    twist: s.twist,
    awa: d.awa,
    sailFraction: d.sailFraction,
  };
}

export function solvePolar(cfg: BoatConfig, env: Environment, stepDeg = 5): Polar {
  const points: PolarPoint[] = [];
  for (let a = 0; a <= 180; a += stepDeg) {
    points.push(solveOne(cfg, env, a));
  }

  let bestUpwind: PolarPoint | null = null;
  let bestDownwind: PolarPoint | null = null;
  let maxSpeed = 0;
  for (const p of points) {
    if (p.speed > maxSpeed) maxSpeed = p.speed;
    if (!bestUpwind || p.vmg > bestUpwind.vmg) bestUpwind = p;
    if (!bestDownwind || p.vmg < bestDownwind.vmg) bestDownwind = p;
  }

  return { tws: env.tws, points, bestUpwind, bestDownwind, maxSpeed };
}

/** Text report for the terminal. */
export function formatPolar(polar: Polar, cfg: BoatConfig): string {
  const lines: string[] = [];
  lines.push(`${cfg.name}  |  TWS ${msToKnots(polar.tws).toFixed(1)} kn`);
  lines.push('');
  lines.push(' TWA    BSP    VMG    AWA   heel  leeway  sheet  twist   sail');
  lines.push(' deg     kn     kn    deg    deg     deg    deg    deg      %');
  lines.push('--------------------------------------------------------------');
  for (const p of polar.points) {
    lines.push(
      [
        (p.twa * RAD).toFixed(0).padStart(4),
        msToKnots(p.speed).toFixed(2).padStart(7),
        msToKnots(p.vmg).toFixed(2).padStart(7),
        (Math.abs(p.awa) * RAD).toFixed(0).padStart(7),
        (Math.abs(p.heel) * RAD).toFixed(1).padStart(7),
        (Math.abs(p.leeway) * RAD).toFixed(1).padStart(8),
        (p.sheet * RAD).toFixed(0).padStart(7),
        (p.twist * RAD).toFixed(0).padStart(7),
        (p.sailFraction * 100).toFixed(0).padStart(7),
      ].join(''),
    );
  }
  lines.push('--------------------------------------------------------------');
  if (polar.bestUpwind) {
    const b = polar.bestUpwind;
    lines.push(
      `Best upwind VMG   : TWA ${(b.twa * RAD).toFixed(0)} deg, ` +
        `${msToKnots(b.speed).toFixed(2)} kn, VMG ${msToKnots(b.vmg).toFixed(2)} kn ` +
        `(tacking angle ${(b.twa * RAD * 2).toFixed(0)} deg)`,
    );
  }
  if (polar.bestDownwind) {
    const b = polar.bestDownwind;
    lines.push(
      `Best downwind VMG : TWA ${(b.twa * RAD).toFixed(0)} deg, ` +
        `${msToKnots(b.speed).toFixed(2)} kn, VMG ${msToKnots(-b.vmg).toFixed(2)} kn`,
    );
  }
  lines.push(`Top speed         : ${msToKnots(polar.maxSpeed).toFixed(2)} kn`);
  return lines.join('\n');
}

/**
 * The speed the polar says she should make at a true wind angle, m/s.
 *
 * Linear between the solved angles, which are five degrees apart by default --
 * far finer than the curve's own curvature, so the straight line between two of
 * them is not a source of error worth a spline.
 *
 * Unsigned in the angle: the boat is symmetrical and the polar is solved for
 * one side only, so port and starboard read from the same half. Null only when
 * there is nothing to read from.
 */
export function targetSpeed(polar: Polar, twa: number): number | null {
  const points = polar.points;
  if (points.length === 0) return null;

  const angle = Math.abs(twa);
  // Off either end, take the end. The solved range is 0 to 180 and a true wind
  // angle cannot leave it, so this is a guard rather than a case.
  if (angle <= points[0].twa) return points[0].speed;

  for (let i = 1; i < points.length; i++) {
    if (angle > points[i].twa) continue;
    const lo = points[i - 1];
    const hi = points[i];
    // No divide-by-nothing guard, because for a real angle the span cannot be
    // zero: this is the first point at or past it, so `lo` is strictly before
    // and `hi` at or past, and two points sharing an angle both fail that test
    // or both pass it and never pair up. One was written anyway, and two
    // rounds of review found first that its test could not reach it and then
    // that only a NaN angle can -- and a NaN angle, from a caller that has
    // already lost the plot, is better answered with a NaN than with a
    // plausible-looking speed. A branch that only garbage reaches is worse than
    // none: it reads as a hazard someone has handled.
    return lerp(lo.speed, hi.speed, (angle - lo.twa) / (hi.twa - lo.twa));
  }
  return points[points.length - 1].speed;
}

/** How she is going, against what this boat can do here. */
export interface Pace {
  /** What the polar says is available at this angle, m/s. */
  target: number;
  /** What she is making as a fraction of it. 1 is on the pace. */
  fraction: number;
}

/**
 * The one number that turns a trim into a verdict, or null where it would lie.
 *
 * Boat speed alone cannot tell a helmsman whether five and a half knots was
 * well sailed, because it says nothing about what was available. This does, and
 * it is honest here in a way a score never is: the target comes out of the same
 * solver, the same `CRUISER` and the same physics the boat is being sailed by.
 *
 * Null inside the no-go zone, and that is the important refusal. The ratio is
 * still arithmetically true in there -- ninety-odd per cent of a target of one
 * knot -- but it reads as "well sailed" at the exact moment the boat is pinched
 * and going nowhere, which is the worst thing an instrument can do. Outside it
 * the number is worth trusting, so inside it there must be no number at all.
 *
 * Null everywhere, too, for a polar that makes no ground to windward at any
 * angle: there is then no boundary to be inside or outside of, and a curve that
 * cannot get her upwind at all is not one to be quoting percentages off. Not
 * reachable from the settings -- the wind tops out at 40 knots and she still
 * works to windward at 60 degrees there -- but `pace` is given a polar rather
 * than making one, and a degenerate one has to have an answer.
 *
 * @param speed her speed *through the water*, since that is what a polar is.
 */
export function pace(polar: Polar, twa: number, speed: number): Pace | null {
  const noGo = noGoAngle(polar);
  if (noGo === null || Math.abs(twa) < noGo) return null;
  const target = targetSpeed(polar, twa);
  if (target === null || target <= 0) return null;
  return { target, fraction: speed / target };
}

/**
 * How far the mean wind may drift from the one a polar was solved for before
 * the polar stops describing the boat.
 *
 * Five per cent, chosen from what is built on top: a target speed the helmsman
 * steers to within a point or two. A baseline several per cent adrift makes
 * that number meaningless while still looking precise, which is the worst way
 * for an instrument to be wrong.
 */
export const POLAR_TOLERANCE = 0.05;

/**
 * Whether a polar still describes the boat she is sailing.
 *
 * A polar is solved for one wind speed, and the weather does not hold still:
 * `windScale` runs from 0.55 in fog to 1.75 in a squall, so a polar left alone
 * ends up drawn for a breeze that is not blowing. Nothing said so, and the
 * card's own header went on quoting the wind it was solved at as though it were
 * the wind outside.
 *
 * Compared against the *mean* wind, which is what a polar is: gusts are
 * deliberately excluded from `baseTws` and re-solving for each one would be
 * both wrong and endless.
 */
export const polarStale = (polar: Polar, tws: number): boolean =>
  Math.abs(tws - polar.tws) > POLAR_TOLERANCE * polar.tws;

/**
 * The closest to the true wind she can still make ground, rad, or null when the
 * polar cannot say.
 *
 * The first angle whose VMG is positive, which is what "inside the no-go zone"
 * has to mean: not the angle she sails *best* at. Those are far apart -- at
 * twelve knots she works to windward best at 45 degrees but is still gaining at
 * 25 -- and using the optimum tells a helmsman to tack for a mark he can lay.
 *
 * It moves a great deal with the wind: 20 degrees in three knots, 25 through
 * the middle of the range, 50 at thirty-five and 60 at forty, as she reefs and
 * meets a head sea. A constant cannot stand in for it, which is what a fixed
 * 40 degrees in `PassageBar` was doing.
 *
 * Sampled, so it is the first *solved* angle that gains -- the true crossing is
 * somewhere in the five degrees below it. Everything that reads this treats it
 * the same way, so they agree with each other, which matters more here than
 * agreeing with a boundary none of them can see.
 */
export function noGoAngle(polar: Polar): number | null {
  let best: number | null = null;
  for (const p of polar.points) {
    if (p.vmg > 0 && (best === null || p.twa < best)) best = p.twa;
  }
  return best;
}
