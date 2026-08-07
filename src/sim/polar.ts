import { DEG, RAD } from './math';
import { initialState, step, type Controls, type SeaState } from './boat';
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

/** Run with the heading frozen until the boat settles. */
export function solveOne(
  cfg: BoatConfig,
  environment: Environment,
  twaDeg: number,
  settleSeconds = 240,
  dt = 1 / 60,
): PolarPoint {
  // A polar is a still-water measurement by definition -- the speed the boat can
  // hold, not the rate the ground goes past -- so any current is dropped here
  // rather than trusted not to have been passed. `Environment.current` being
  // optional keeps a caller from acquiring one by accident; this keeps the
  // guarantee even from a caller who hands over the live sailing environment.
  const env: Environment = { ...environment, current: undefined };

  // To hold a given true wind angle with the wind coming from twd, point the
  // bow at twd - twa.
  const heading = env.twd - twaDeg * DEG;
  // Do not start from rest. Sailing is bistable -- with no speed the apparent
  // wind swings aft and the boat cannot climb to an angle it could otherwise
  // hold -- so starting slow reports angles as unattainable when they are not.
  // The polar measures sustainable speed, so start at cruising speed.
  const s = initialState({ heading, u: hullSpeed(cfg.lwl) * 0.7, sheet: 20 * DEG });

  // Only the *mean* effect of waves (added resistance) belongs in a polar.
  // Feeding in the roll and pitch oscillation as well would mean there is no
  // steady state to find, and the polar would just be noise.
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
    // A polar is "the speed you could hold if you sailed it well". Lying on
    // your ear at 60 degrees of heel under full sail in a gale is not a number
    // worth recording, so reefing is optimised alongside.
    autoReef(rs, s.heelAvg, s.heel, dt);
    s.reef = rs.reef;
    s.jibFurl = rs.jibFurl;
    d = step(s, cfg, env, AUTO, dt, opts);
  }

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
