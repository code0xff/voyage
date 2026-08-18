/**
 * What the rest of the simulator asks of ground, and the sea with none.
 *
 * There is one answer to it now -- `RegionTerrain`, a sampled height field --
 * and there used to be two: `Terrain` worked from a list of noise-modulated
 * circles and streamed forever, which is what the island field was made of.
 * The wind, the tide, the anchorage judge and the boat's depth under the keel
 * all ask through this interface and are indifferent to what is behind it,
 * which is the reason a real coast was a small change rather than a rewrite,
 * and the reason removing the circles was one too.
 */

/** What the rest of the simulator asks of ground. */
export interface TerrainQuery {
  /** Ground relative to sea level: positive above water, negative below. */
  elevationAt(x: number, y: number): number;
  /** Water depth in metres. Zero or less means land. */
  depthAt(x: number, y: number): number;
  /** True if a hull of this draft would touch bottom here. */
  isAground(x: number, y: number, draft: number): boolean;
  /** How much of the wind survives here, 0..1. */
  windExposure(x: number, y: number, twd: number): number;
  /** Wave height multiplier here, 0..1. */
  waveShelter(x: number, y: number, twd: number): number;
  /** Distance to the nearest shoreline, positive offshore. */
  distanceToShore(x: number, y: number): number;
  /** Compass bearing to the nearest shore, or null with none in reach. */
  bearingToShore(x: number, y: number): number | null;
}

/**
 * Open water, with nothing in it.
 *
 * What a field holds before its first window is built, and what the wind and
 * the stream are constructed with. `Infinity` for the depth and the shore is
 * the honest answer rather than a large number: there is no bottom and no
 * beach, and the callers written for it -- `bearingToShore`'s null in
 * particular -- fall quiet on exactly that.
 */
export const EMPTY_TERRAIN: TerrainQuery = {
  elevationAt: () => -Infinity,
  depthAt: () => Infinity,
  isAground: () => false,
  windExposure: () => 1,
  waveShelter: () => 1,
  distanceToShore: () => Infinity,
  bearingToShore: () => null,
};

/**
 * How far the chart is given land, m.
 *
 * Not about what the boat can feel or see: it is never handed to the physics,
 * the wind, the stream or the water shader. It exists so that a chart drawn at
 * a passage scale is a chart of the sea that is actually there.
 *
 * Two things add up:
 *
 *   the disc                5000  the widest range, and the chart is clipped
 *                                 to a circle, so the corner never matters
 *   the pan                +2750  the chart is not centred on the boat. It
 *                                 holds still and lets her cross it, up to
 *                                 PAN_AT of the range, which is what makes
 *                                 progress visible at all
 *                          -----
 *                           7750
 *
 * `minimap.test.ts` adds those up from the same constants and holds this to
 * the total, rather than leaving it to a comment. A comment is what failed
 * last time: the one in `minimap.ts` named 1200 m as the widest range long
 * after 2500 and 5000 had been added beneath it.
 */
export const CHART_RANGE = 8300;
