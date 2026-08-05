import { DEG, clamp } from './math';
import type { BoatConfig } from './config';

/**
 * Sail plan: turns a reef count and a jib furl fraction into effective sail
 * geometry.
 *
 * The important part is not the area, it is where the **centre of effort**
 * ends up:
 *  - reefing the main moves CE forward -> lee helm (the boat wants to bear away)
 *  - furling the jib moves CE aft -> weather helm
 * Shorten only the main in a blow and the boat has to be held straight with the
 * rudder, and rudder angle is drag, which is slow. That is where the real
 * decision to reduce both together comes from.
 */

/** Mainsail area factor per reef. The renderer shrinks the sail with this too. */
export const REEF_AREA_FACTOR = [1.0, 0.78, 0.58, 0.4];
const REEF_AREA = REEF_AREA_FACTOR;
/** CE height factor per reef. Reefing lowers the centre of effort, so heel drops. */
const REEF_CE = [1.0, 0.87, 0.76, 0.66];
/** CE moves forward as the effective boom shortens. */
const REEF_X = [1.0, 0.8, 0.62, 0.48];

export const MAX_REEF = REEF_AREA.length - 1;

export interface SailPlan {
  area: number; // m^2, effective sail area
  ceHeight: number; // m, effective centre of effort height
  ceX: number; // m, effective longitudinal centre of effort
  /** Area as a fraction of full sail, for the HUD. */
  fraction: number;
}

export function sailPlan(cfg: BoatConfig, reef: number, jibFurl: number): SailPlan {
  const r = clamp(Math.round(reef), 0, MAX_REEF);
  const furl = clamp(jibFurl, 0, 1);

  const am = cfg.mainArea * REEF_AREA[r];
  const aj = cfg.jibArea * (1 - furl);
  const area = am + aj;

  if (area < 1e-3) {
    // Bare poles. Guard the division below.
    return { area: 0, ceHeight: cfg.mainCeHeight, ceX: cfg.mainCeX, fraction: 0 };
  }

  // A partly furled jib loses its forward area first, so its CE creeps aft.
  const jibX = cfg.jibCeX * (1 - furl * 0.25);

  return {
    area,
    ceHeight: (am * cfg.mainCeHeight * REEF_CE[r] + aj * cfg.jibCeHeight) / area,
    ceX: (am * cfg.mainCeX * REEF_X[r] + aj * jibX) / area,
    fraction: area / (cfg.mainArea + cfg.jibArea),
  };
}

/** Heel angle the auto-reef aims to hold. */
export const TARGET_HEEL = 24 * DEG;
const REEF_UP = 30 * DEG; // shorten sail above this
const REEF_DOWN = 15 * DEG; // shake out below this
const DWELL = 6; // s of hysteresis; without it the reef chatters

export interface ReefState {
  reef: number;
  jibFurl: number;
  timer: number;
  /** Low-pass filtered heel, so single gusts do not trigger a reef. */
  avgHeel?: number;
}

/** Heel-average time constant. Must exceed the 3.6 s roll period to ride out gusts. */
const HEEL_TAU = 6;

/**
 * Automatic reefing. This is crew judgement, not physics, so it lives outside
 * step() and is driven from the game loop and the polar solver alike.
 */
export function autoReef(rs: ReefState, heel: number, dt: number): void {
  const inst = Math.abs(heel);

  // Judging on instantaneous heel is wrong. Roll is a second-order system, so
  // it overshoots on every gust, and reacting to one peak reefs the boat in
  // 12 knots. Real crews look at how far over it *stays*.
  rs.avgHeel = (rs.avgHeel ?? inst) + (inst - (rs.avgHeel ?? inst)) * (1 - Math.exp(-dt / HEEL_TAU));
  const h = rs.avgHeel;

  rs.timer += dt;
  // A knockdown past 45 degrees is an emergency: there is no time to wait for
  // an average to catch up, so react to the instantaneous value.
  const emergency = inst > 45 * DEG;
  if (rs.timer < (emergency ? 1.2 : DWELL)) return;
  if (emergency) {
    if (rs.jibFurl < rs.reef / MAX_REEF) rs.jibFurl = clamp(rs.jibFurl + 0.25, 0, 0.75);
    else if (rs.reef < MAX_REEF) rs.reef++;
    else rs.jibFurl = clamp(rs.jibFurl + 0.25, 0, 0.9);
    rs.timer = 0;
    return;
  }

  if (h > REEF_UP) {
    // Alternate between main and jib so the centre of effort does not run away
    // to one end of the boat.
    if (rs.jibFurl < rs.reef / MAX_REEF) rs.jibFurl = clamp(rs.jibFurl + 0.25, 0, 0.75);
    else if (rs.reef < MAX_REEF) rs.reef++;
    else rs.jibFurl = clamp(rs.jibFurl + 0.25, 0, 0.9);
    rs.timer = 0;
  } else if (h < REEF_DOWN) {
    if (rs.jibFurl > rs.reef / MAX_REEF) rs.jibFurl = clamp(rs.jibFurl - 0.25, 0, 1);
    else if (rs.reef > 0) rs.reef--;
    else rs.jibFurl = clamp(rs.jibFurl - 0.25, 0, 1);
    rs.timer = 0;
  }
}
