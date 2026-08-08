import { TAU, clamp, compassVec, type Vec2 } from './math';
import type { TerrainQuery } from './terrain';

/**
 * Gulls, and nothing else.
 *
 * There is no animal here with a body, and that is a decision rather than an
 * omission. Whales, dolphins and gulls were all built, and all three were cut
 * after being looked at: low-poly animals read as geometry, not as life, and a
 * bad animal is worse than none, because it tells you the sea is a set. The
 * whale went through three shapes -- flukes and a sounding arch, a long
 * capsule, a smooth low dome -- and not one of them was a whale.
 *
 * What survives is the part that never had that problem. Near a shore you hear
 * gulls. Nothing to draw, nothing to get wrong, and it does real work: it is a
 * bearing to land you can hear before the haze gives it up, which is exactly
 * how you find a coast from a small boat. Open water stays silent.
 *
 * Seeded, so the same world sounds the same way -- the same rule the wind, the
 * weather and the islands already follow.
 */

export interface WildlifeEvent {
  /** Where the bird is, so the sound can be placed by distance. */
  pos: Vec2;
  /** 0..1 before distance is taken into account. */
  strength: number;
}

/** Gulls are audible within about this far of a shore, m. */
const GULL_RANGE = 800;

function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export class Wildlife {
  /** Filled during update(), drained by whoever plays the sounds. */
  readonly events: WildlifeEvent[] = [];

  private rand: () => number;
  private timer = 3;

  constructor(seed = 1) {
    this.rand = rng(seed ^ 0x5eed);
  }

  /** Restart the sound event stream when a new seeded world begins. */
  reseed(seed: number): void {
    this.rand = rng(seed ^ 0x5eed);
    this.timer = 3;
    this.events.length = 0;
  }

  /**
   * The rate rises as the shore closes, so standing in towards an island fills
   * with noise and open water stays quiet.
   */
  update(dt: number, boat: Vec2, terrain: TerrainQuery): void {
    this.events.length = 0;

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 2.5 + this.rand() * 7;

    const shore = terrain.distanceToShore(boat.x, boat.y);
    if (!Number.isFinite(shore)) return;
    const closeness = clamp(1 - shore / GULL_RANGE, 0, 1);
    if (closeness < 0.05 || this.rand() > closeness) return;

    // Put the bird between you and the beach rather than at your masthead, so
    // the call fades in as you approach rather than switching on.
    //
    // Asked of the terrain rather than worked out from an island centre here.
    // A circle can only offer its middle, which put the gull over the hill; a
    // surveyed coast points at the piece of shore actually being closed with.
    const bearing = terrain.bearingToShore(boat.x, boat.y) ?? this.rand() * TAU;
    const spread = (this.rand() - 0.5) * 1.2;
    const dir = compassVec(bearing + spread);
    const range = 25 + this.rand() * Math.max(40, shore * 0.8);

    this.events.push({
      pos: { x: boat.x + dir.x * range, y: boat.y + dir.y * range },
      strength: 0.5 + closeness * 0.5,
    });
  }
}
