import { compassVec, type Vec2 } from './math';
import { fbm2, valueNoise2 } from './noise';

/**
 * Islands.
 *
 * Islands are worth having only if they change how you sail, not because they
 * decorate the horizon. Three effects make them tactical:
 *
 *   1. **Wind shadow.** An island steals the wind downwind of it. Sailing into
 *      its lee is a real and painful mistake, and staying out of it is a real
 *      decision. This costs almost nothing to implement here because the wind
 *      is already a pure function of position -- the shadow is just another
 *      term composed into WindField.sample().
 *   2. **Flat water in the lee.** Waves are blocked too, so the sheltered side
 *      is smoother. Sometimes that is worth the lost wind, which is exactly the
 *      kind of trade-off worth offering.
 *   3. **Grounding.** Shallow water near the shore ends your race. That is what
 *      makes cutting a corner close a gamble rather than a free shortcut.
 *
 * Shapes are analytic (a noise-modulated radius) rather than meshes with
 * collision, so every query is a handful of arithmetic operations and the
 * physics can call them at 120 Hz without noticing.
 */

export interface Island {
  /** Centre position. */
  pos: Vec2;
  /** Mean shoreline radius, m. */
  radius: number;
  /** Peak height above sea level, m. Drives how far the wind shadow reaches. */
  height: number;
  /** Per-island noise seed, so no two look alike. */
  seed: number;
}

/** How steeply the seabed falls away from the shore (m of depth per m offshore). */
const SHELF_SLOPE = 0.09;
/** Deep water depth, m. Beyond this the bottom stops mattering. */
const MAX_DEPTH = 40;

/**
 * Shoreline radius at a given bearing. Islands are lobed rather than circular;
 * a perfect circle reads as a game object, an irregular coast reads as land.
 */
function shoreRadius(island: Island, bearing: number): number {
  const c = Math.cos(bearing);
  const s = Math.sin(bearing);
  // Sample the noise on the unit circle so the shape wraps seamlessly.
  const n = fbm2(c * 1.7 + 10, s * 1.7 + 10, island.seed, 2);
  return island.radius * (0.72 + 0.56 * n);
}

export class Terrain {
  constructor(readonly islands: Island[] = []) {}

  /**
   * Ground elevation relative to sea level: positive above water, negative
   * below. Returns the shallowest (highest) value across all islands.
   */
  elevationAt(x: number, y: number): number {
    let best = -MAX_DEPTH;
    for (const isl of this.islands) {
      const dx = x - isl.pos.x;
      const dy = y - isl.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > isl.radius * 2.6 + MAX_DEPTH / SHELF_SLOPE) continue;

      const r = shoreRadius(isl, Math.atan2(dy, dx));
      let e: number;
      if (d < r) {
        // Above water: a smooth dome, roughened a little so it is not a bubble.
        const t = 1 - d / r;
        const rough = 0.82 + 0.36 * valueNoise2(x / 55, y / 55, isl.seed + 31);
        e = isl.height * Math.pow(t, 0.75) * rough;
      } else {
        e = -Math.min(MAX_DEPTH, (d - r) * SHELF_SLOPE);
      }
      if (e > best) best = e;
    }
    return best;
  }

  /** Water depth in metres. Zero or less means land. */
  depthAt(x: number, y: number): number {
    return -this.elevationAt(x, y);
  }

  /** True if a hull of this draft would touch bottom here. */
  isAground(x: number, y: number, draft: number): boolean {
    return this.depthAt(x, y) < draft;
  }

  /**
   * How much of the wind survives at this point, 0..1.
   *
   * The model is a spreading wake behind each island: the closer you are, the
   * more wind is missing, and the wake widens and weakens with distance. It
   * ignores the speed-up around headlands, which is a second-order effect next
   * to simply parking in the lee.
   */
  windExposure(x: number, y: number, twd: number): number {
    if (this.islands.length === 0) return 1;
    // Downwind unit vector: the wind blows from twd, so it travels the other way.
    const from = compassVec(twd);
    const dwx = -from.x;
    const dwy = -from.y;

    let exposure = 1;
    for (const isl of this.islands) {
      const dx = x - isl.pos.x;
      const dy = y - isl.pos.y;
      // Distance downwind of the island, and lateral offset from its wake axis.
      const along = dx * dwx + dy * dwy;
      if (along <= 0) continue; // upwind of the island: unaffected
      const across = Math.abs(dx * dwy - dy * dwx);

      // The wake spreads as it travels downwind.
      const halfWidth = isl.radius * 1.05 + along * 0.16;
      if (across > halfWidth) continue;

      // A rough rule of thumb: shelter persists for roughly ten to fifteen times
      // the obstacle height before the wind fills back in.
      const reach = Math.max(isl.height, 8) * 13;
      const decay = Math.exp(-along / reach);
      // Softer towards the edges of the wake than dead astern of the island.
      const edge = 1 - Math.pow(across / halfWidth, 2);
      exposure *= 1 - 0.85 * decay * edge;
    }
    return Math.max(0.08, exposure);
  }

  /**
   * Wave height multiplier at this point, 0..1. Waves need fetch to build, so
   * the lee of an island stays flat far further downwind than the wind shadow
   * reaches.
   */
  waveShelter(x: number, y: number, twd: number): number {
    if (this.islands.length === 0) return 1;
    const from = compassVec(twd);
    const dwx = -from.x;
    const dwy = -from.y;

    let shelter = 1;
    for (const isl of this.islands) {
      const dx = x - isl.pos.x;
      const dy = y - isl.pos.y;
      const along = dx * dwx + dy * dwy;
      if (along <= 0) continue;
      const across = Math.abs(dx * dwy - dy * dwx);
      const halfWidth = isl.radius * 1.15 + along * 0.1;
      if (across > halfWidth) continue;

      // Fetch-limited: it takes a long way downwind to rebuild a sea.
      const decay = Math.exp(-along / (isl.radius * 9 + 200));
      const edge = 1 - Math.pow(across / halfWidth, 2);
      shelter *= 1 - 0.9 * decay * edge;
    }
    return Math.max(0.05, shelter);
  }

  /** Distance to the nearest shoreline, positive offshore. Infinity with no islands. */
  distanceToShore(x: number, y: number): number {
    let best = Infinity;
    for (const isl of this.islands) {
      const dx = x - isl.pos.x;
      const dy = y - isl.pos.y;
      const d = Math.hypot(dx, dy);
      const r = shoreRadius(isl, Math.atan2(dy, dx));
      best = Math.min(best, d - r);
    }
    return best;
  }
}

/** Deterministic pseudo-random stream, so an archipelago can be reproduced from a seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface ArchipelagoOptions {
  seed: number;
  count: number;
  /** Points the islands must stay clear of, usually the course marks. */
  keepClear: Vec2[];
  /** Minimum distance from those points to the island shoreline, m. */
  clearance: number;
  /** Ring the islands are scattered within. */
  minRange: number;
  maxRange: number;
  origin: Vec2;
}

/**
 * Scatter islands around the course.
 *
 * They are deliberately placed *near* the course rather than safely far from it.
 * An island 2 km away is scenery; an island a few hundred metres off the layline
 * is a decision. The clearance check only keeps them off the marks themselves.
 */
export function generateArchipelago(opts: ArchipelagoOptions): Terrain {
  const rand = rng(opts.seed);
  const islands: Island[] = [];

  for (let attempt = 0; attempt < opts.count * 40 && islands.length < opts.count; attempt++) {
    const angle = rand() * Math.PI * 2;
    const range = opts.minRange + rand() * (opts.maxRange - opts.minRange);
    const pos = {
      x: opts.origin.x + Math.cos(angle) * range,
      y: opts.origin.y + Math.sin(angle) * range,
    };
    const radius = 60 + rand() * 190;
    const height = 18 + rand() * 90 * (radius / 200);

    const candidate: Island = { pos, radius, height, seed: Math.floor(rand() * 1e6) };

    // Keep clear of the marks, and of other islands.
    const maxShore = radius * 1.3;
    const tooClose =
      opts.keepClear.some(
        (p) => Math.hypot(p.x - pos.x, p.y - pos.y) < maxShore + opts.clearance,
      ) ||
      islands.some(
        (o) => Math.hypot(o.pos.x - pos.x, o.pos.y - pos.y) < maxShore + o.radius * 1.3 + 120,
      );
    if (tooClose) continue;

    islands.push(candidate);
  }

  return new Terrain(islands);
}

export const EMPTY_TERRAIN = new Terrain([]);
