import { clamp, type Vec2 } from './math';
import type { BoatConfig } from './config';
import type { Terrain } from './terrain';

/**
 * Whether this is a place to stop.
 *
 * The end of a passage is not arriving at a coordinate, it is bringing the boat
 * to rest somewhere she will stay -- and that is a judgement, which makes it
 * worth having. Three things decide it, and a real anchorage is a compromise
 * between them:
 *
 *  - **Depth.** Too little and she takes the ground when the boat swings; too
 *    much and there is not enough cable to lie to. The band is narrow and it is
 *    the reason an anchorage is a *place* rather than anywhere.
 *  - **Shelter.** In the lee of the land the water is flat, which is the whole
 *    difference between a night's sleep and a night awake.
 *  - **Way.** Letting go while still sailing does not anchor a boat, it drags a
 *    hook across the bottom behind one.
 *
 * None of it needs new physics. The depth is the field the boat already grounds
 * on and the shelter is the one the waves already use.
 */

/** Least water under the keel to lie in, m. Below this she touches as she swings. */
export const CLEARANCE = 1.2;
/**
 * Most water a cruising yacht can comfortably anchor in, m.
 *
 * Not a hard limit in reality -- it is about how much cable is aboard, and the
 * usual rule of four times the depth means 12 m of water wants 50 m of chain,
 * which is most of what a boat this size carries.
 */
export const MAX_DEPTH = 12;
/** Fastest she can be moving over the ground and still be anchoring, m/s. */
export const MAX_WAY = 0.35;

export type Holding = 'good' | 'shoal' | 'deep' | 'aground';

export interface Anchorage {
  depth: number;
  holding: Holding;
  /** 0 = wide open, 1 = completely sheltered from the sea. */
  shelter: number;
  /** Whether she is slow enough over the ground to let go. */
  slowEnough: boolean;
  /** All of it together: the anchor can be let go here, now. */
  canAnchor: boolean;
}

export function anchorage(
  terrain: Terrain,
  cfg: BoatConfig,
  pos: Vec2,
  sog: number,
  twd: number,
): Anchorage {
  const depth = terrain.depthAt(pos.x, pos.y);
  const holding: Holding =
    depth < cfg.draft
      ? 'aground'
      : depth < cfg.draft + CLEARANCE
        ? 'shoal'
        : depth > MAX_DEPTH
          ? 'deep'
          : 'good';

  // 1 is sheltered, so it reads the way the word does. The wave field's own
  // term runs the other way -- 1 is the open sea -- which is right for scaling
  // a wave height and wrong for describing a place.
  const shelter = clamp(1 - terrain.waveShelter(pos.x, pos.y, twd), 0, 1);
  const slowEnough = sog <= MAX_WAY;

  return { depth, holding, shelter, slowEnough, canAnchor: holding === 'good' && slowEnough };
}

/** What is stopping her anchoring here, or null when nothing is. */
export function anchorProblem(a: Anchorage): string | null {
  if (a.holding === 'aground') return 'aground';
  if (a.holding === 'shoal') return 'too shallow — she would touch as she swings';
  if (a.holding === 'deep') return 'too deep to lie to';
  if (!a.slowEnough) return 'still carrying way — take the way off her first';
  return null;
}
