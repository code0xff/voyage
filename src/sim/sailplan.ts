import { DEG, clamp } from './math';
import { cgHeight, type BoatConfig } from './config';

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
  /** m above the centre of gravity: the bottom of the sail's area. */
  footHeight: number;
  /** m above the centre of gravity: the top of it. */
  headHeight: number;
}

/**
 * Height of the full-sail centre of effort above the centre of gravity.
 *
 * Kept out of `sailPlan()` because it must *not* move when the boat reefs: it
 * is a property of the rig, not of today's sail area.
 */
function fullCeHeight(cfg: BoatConfig): number {
  const a = cfg.mainArea + cfg.jibArea;
  return a < 1e-3
    ? cfg.mainCeHeight
    : (cfg.mainArea * cfg.mainCeHeight + cfg.jibArea * cfg.jibCeHeight) / a;
}

/**
 * m above the water, the height the true wind speed is quoted at.
 *
 * Deliberately *not* the 10 m meteorological standard. The gradient has to be
 * referenced somewhere, and referencing it above the sail would mean every sail
 * on the boat suddenly saw less wind than before: the boat would be slower
 * everywhere, `CRUISER` would simply be retuned until the polar came back to
 * where it started, and the whole exercise would have been motion without
 * progress. Quoting the wind at the height its force acts leaves the gradient
 * doing the one thing it is here to do -- redistributing wind over the sail, so
 * that twist starts to matter.
 */
export const windRefHeight = (cfg: BoatConfig): number => fullCeHeight(cfg) + cgHeight(cfg);

export function sailPlan(cfg: BoatConfig, reef: number, jibFurl: number): SailPlan {
  const r = clamp(Math.round(reef), 0, MAX_REEF);
  const furl = clamp(jibFurl, 0, 1);

  const am = cfg.mainArea * REEF_AREA[r];
  const aj = cfg.jibArea * (1 - furl);
  const area = am + aj;

  // The main sets the top of the rig, so only reefing shortens the plan --
  // rolling the jib away takes area out of the middle and leaves the mainsail
  // standing to the masthead. Geometrically similar triangles, hence the root.
  const span = cfg.sailSpan * Math.sqrt(REEF_AREA[r]);

  if (area < 1e-3) {
    // Bare poles. Guard the division below.
    return {
      area: 0,
      ceHeight: cfg.mainCeHeight,
      ceX: cfg.mainCeX,
      fraction: 0,
      footHeight: cfg.mainCeHeight,
      headHeight: cfg.mainCeHeight,
    };
  }

  // A partly furled jib loses its forward area first, so its CE creeps aft.
  const jibX = cfg.jibCeX * (1 - furl * 0.25);
  const ceHeight = (am * cfg.mainCeHeight * REEF_CE[r] + aj * cfg.jibCeHeight) / area;

  return {
    area,
    ceHeight,
    ceX: (am * cfg.mainCeX * REEF_X[r] + aj * jibX) / area,
    fraction: area / (cfg.mainArea + cfg.jibArea),
    // The centroid of a triangle sits a third of the way up it, so the foot and
    // the head follow from the centre of effort and the span.
    footHeight: ceHeight - span / 3,
    headHeight: ceHeight + (2 * span) / 3,
  };
}

/**
 * How many horizontal strips the sail is integrated in.
 *
 * Not a free number: the loop runs at 120 Hz and doubles the cost of a step.
 * Measured over nine settled operating points, five against nine strips differs
 * by under 0.01 kn everywhere except hard on the wind in 25 knots, where the
 * heel-driven depowering makes the fixed point sensitive and the gap is 0.02 kn
 * (0.3%). Three strips costs 1% at that same point, which is too much to give
 * away for a saving that nothing needs.
 */
export const SAIL_STRIPS = 5;

/**
 * Where each strip sits between foot (0) and head (1), and what fraction of the
 * area it carries.
 *
 * A Bermudan sail is a triangle, so its chord -- and hence its area per metre of
 * height -- falls off linearly towards the head: density `2(1-u)`. That matters
 * more than it looks. Under a uniform distribution the head would carry as much
 * area as the foot, the twist that keeps it attached would be worth far more
 * than it really is, and heel would come out badly overstated.
 *
 * Integrated once, here, rather than in the physics loop.
 */
function stripGeometry(): { u: number[]; area: number[] } {
  const u: number[] = [];
  const area: number[] = [];
  for (let i = 0; i < SAIL_STRIPS; i++) {
    const a = i / SAIL_STRIPS;
    const b = (i + 1) / SAIL_STRIPS;
    const w = 2 * (b - a) - (b * b - a * a); // integral of 2(1-u)
    const m = b * b - a * a - (2 / 3) * (b * b * b - a * a * a); // integral of 2u(1-u)
    u.push(m / w); // the strip's own centroid, not its midpoint
    area.push(w);
  }
  return { u, area };
}

const STRIPS = stripGeometry();
export const STRIP_U: readonly number[] = STRIPS.u;
export const STRIP_AREA: readonly number[] = STRIPS.area;

/** Heel angle the auto-reef aims to hold. */
export const TARGET_HEEL = 24 * DEG;
const REEF_UP = 30 * DEG; // shorten sail above this
const REEF_DOWN = 15 * DEG; // shake out below this
const DWELL = 6; // s of hysteresis; without it the reef chatters

export interface ReefState {
  reef: number;
  jibFurl: number;
  timer: number;
}

/**
 * Heel-average time constant. Must exceed the 3.6 s roll period to ride out
 * gusts. Shared with the auto-trim's depowering, which needs it for a second
 * reason: see `heelAvg` in `boat.ts`.
 */
export const HEEL_TAU = 6;

/**
 * Automatic reefing. This is crew judgement, not physics, so it lives outside
 * step() and is driven from the game loop and the polar solver alike.
 *
 * `heelAvg` is the filtered |heel| that `step()` already maintains, and `heel`
 * is this instant's value. Both are needed, and they are arguments rather than
 * a filter of its own because the reef and the auto-trim's depowering are two
 * halves of one decision about how overpowered the boat is: running a second
 * copy of the same lag here meant they could disagree about how far over she
 * was staying, which is a difference with no physical meaning.
 */
export function autoReef(rs: ReefState, heelAvg: number, heel: number, dt: number): void {
  // Judging on instantaneous heel is wrong. Roll is a second-order system, so
  // it overshoots on every gust, and reacting to one peak reefs the boat in
  // 12 knots. Real crews look at how far over it *stays*.
  const h = Math.abs(heelAvg);
  const inst = Math.abs(heel);

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
