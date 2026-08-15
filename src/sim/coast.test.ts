import { describe, expect, it } from 'vitest';
import { COAST_ID, COAST_NAME, coastHeightField, coastRegion, coastSamples } from './coast';
import { placeName } from './regions';
import { RegionTerrain } from './region-terrain';

/**
 * The generated coast, held to the claims that make it worth having.
 *
 * Every assertion here is a property, not a picture: whether the place *looks*
 * like a coast is settled by looking at it, but whether it is a mainland
 * rather than more islands, whether the boat can sail out of her own spawn,
 * and whether the grid is oriented the way `HeightField` reads it are facts a
 * retune must not silently break.
 */

/**
 * 546 and 1764 are not arbitrary: they are witness seeds, found by scanning
 * 150,000 for ones whose noise stands ground inside the radius the spawn test
 * sweeps. Without the clearing, 546 is dry at the boat's own starting spot and
 * 1764 stands its dry ground about 200 m out -- still well inside the sweep.
 * Ordinary seeds measure deep water at the spawn whether the clearing exists
 * or not, and a guard whose deletion no test notices is on its way to being
 * deleted.
 */
const SEEDS = [13, 20260815, 4242, 546, 1764, 999983];

const GRID = coastRegion(1).grid;
const { width, height: rows, cell } = GRID;

function fractions(samples: Int16Array) {
  let land = 0;
  let sailable = 0;
  let border = 0;
  let borderLand = 0;
  for (let i = 0; i < samples.length; i++) {
    const el = samples[i] * GRID.unit;
    if (el > 0) land++;
    if (el < -3) sailable++;
    const row = (i / width) | 0;
    const col = i % width;
    if (row === 0 || row === rows - 1 || col === 0 || col === width - 1) {
      border++;
      if (el > 0) borderLand++;
    }
  }
  return {
    land: land / samples.length,
    sailable: sailable / samples.length,
    borderLand: borderLand / border,
  };
}

describe('the generated coast', () => {
  it('is the same coast from the same seed, and another from another', () => {
    expect(coastSamples(13)).toEqual(coastSamples(13));
    const a = coastSamples(13);
    const b = coastSamples(14);
    let differing = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differing++;
    // Not merely unequal -- a single differing cell would satisfy that. A new
    // seed is a new place.
    expect(differing / a.length).toBeGreaterThan(0.5);
  });

  /**
   * A mainland and not another island: the land runs off the chart. That is
   * the whole brief -- a coast that can be followed past the horizon -- and it
   * is what the island field can never make, since its landmasses are bounded
   * by construction.
   */
  it('runs its mainland off the edge of the chart', () => {
    for (const seed of SEEDS) {
      const { borderLand, land } = fractions(coastSamples(seed));
      expect(borderLand).toBeGreaterThan(0.15);
      // And it is a coast, not a continent with a puddle: most of the square
      // stays water.
      expect(land).toBeGreaterThan(0.08);
      expect(land).toBeLessThan(0.4);
    }
  });

  it('leaves most of the square as water she can sail', () => {
    for (const seed of SEEDS) {
      expect(fractions(coastSamples(seed)).sailable).toBeGreaterThan(0.6);
    }
  });

  /**
   * The Newport lesson, as a hard promise: `placeAtStart` puts the boat 90 m
   * from the origin, and a region whose centre turns out shoal puts her
   * aground before she has touched the helm. Ten metres, written out rather
   * than imported, because the depth is the claim being made -- asserting the
   * generator's own constant back at it would pass at any value including one
   * she grounds in.
   */
  it('spawns her in water, every seed, with room to sail out', () => {
    for (const seed of SEEDS) {
      const { height } = coastHeightField(seed);
      for (let a = 0; a < 24; a++) {
        for (const r of [0, 90, 200, 300]) {
          const x = Math.sin((a / 24) * Math.PI * 2) * r;
          const y = Math.cos((a / 24) * Math.PI * 2) * r;
          expect(-height.elevationAt(x, y)).toBeGreaterThan(10);
        }
      }
    }
  });

  /**
   * Offshore islets exist -- land the flood fill cannot reach from the border
   * -- because a bare mainland is a wall, and the interesting water of a real
   * coast is the lane between the shore and its outliers. Asserted across the
   * seed set as a whole: any single seed is allowed a clean coastline.
   */
  it('stands islets off the coast, somewhere in every handful of seeds', () => {
    let islets = 0;
    for (const seed of SEEDS) {
      const s = coastSamples(seed);
      const reached = new Uint8Array(s.length);
      const queue: number[] = [];
      const push = (i: number) => {
        if (!reached[i] && s[i] > 0) {
          reached[i] = 1;
          queue.push(i);
        }
      };
      for (let col = 0; col < width; col++) {
        push(col);
        push((rows - 1) * width + col);
      }
      for (let row = 0; row < rows; row++) {
        push(row * width);
        push(row * width + width - 1);
      }
      while (queue.length > 0) {
        const i = queue.pop()!;
        const row = (i / width) | 0;
        const col = i % width;
        if (col > 0) push(i - 1);
        if (col < width - 1) push(i + 1);
        if (row > 0) push(i - width);
        if (row < rows - 1) push(i + width);
      }
      for (let i = 0; i < s.length; i++) if (s[i] > 0 && !reached[i]) islets++;
    }
    expect(islets).toBeGreaterThan(0);
  });

  /**
   * The shore is a beach and not a wall. The first profile branched on the
   * sign of the shore distance, with the land side starting at +2 m and the
   * sea side at -3 -- a five-metre cliff along every metre of coast, which a
   * review caught and the land mesh had been rendering faithfully. The 95th
   * percentile is the assertion because islets are allowed to be steep; it
   * measures the mainland's waterline, which is nearly all of the crossings.
   * Measured: this profile's p95 runs 1.4-2.4 m across these seeds, the
   * cliff's ran 5.5-6.0.
   */
  it('crosses the waterline as a beach, not a cliff', () => {
    for (const seed of [13, 546, 1885135]) {
      const s = coastSamples(seed);
      const jumps: number[] = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < width - 1; col++) {
          const a = s[row * width + col] * GRID.unit;
          const b = s[row * width + col + 1] * GRID.unit;
          if (a > 0 !== b > 0) jumps.push(Math.abs(a - b));
        }
      }
      jumps.sort((x, y) => x - y);
      expect(jumps.length).toBeGreaterThan(100);
      expect(jumps[Math.floor(jumps.length * 0.95)]).toBeLessThanOrEqual(3);
    }
  });

  /**
   * The mainland lies on the compass side the seed chose -- asserted against
   * the world, not against other code. The first version of this compared
   * `coastSamples` to `elevationAt`, and it passed with the generator's y
   * mapping flipped upside down, because both read the same array and flipped
   * together; `creature.test.ts` records the identical trap. So instead: seed
   * 32 draws an inland direction within four degrees of due north, seed 50
   * within four of due west, and 9.5 km out along those bearings is land under
   * every displacement the generator can apply (9500·0.97 − 5600 − 2300 − 900
   * leaves 400 m of margin), while the opposite bearings are deep sea. A
   * flipped y mapping fails seed 32; a flipped x fails seed 50.
   */
  it('puts the mainland on the compass side the seed chose', () => {
    const north = coastHeightField(32).height;
    expect(north.elevationAt(0, 9500)).toBeGreaterThan(0);
    expect(north.elevationAt(0, -9500)).toBeLessThan(-10);
    const west = coastHeightField(50).height;
    expect(west.elevationAt(-9500, 0)).toBeGreaterThan(0);
    expect(west.elevationAt(9500, 0)).toBeLessThan(-10);
  });

  /**
   * And the samples sit where `HeightField` thinks they do -- at cell centres,
   * half a cell in from the edges. This one *is* a comparison between the two
   * mappings, which cannot catch a flip both sides share (the compass test
   * above owns that); what it pins is the half-cell offset, which a flip does
   * not disturb and the compass cannot see.
   */
  it('agrees with HeightField about the half-cell offset', () => {
    const seed = 20260815;
    const samples = coastSamples(seed);
    const { height } = coastHeightField(seed);
    const halfWidth = (width * cell) / 2;
    const halfHeight = (rows * cell) / 2;
    for (const [row, col] of [
      [10, 20],
      [700, 640],
      [399, 400],
    ] as const) {
      const x = -halfWidth + (col + 0.5) * cell;
      const y = halfHeight - (row + 0.5) * cell;
      expect(height.elevationAt(x, y)).toBeCloseTo(samples[row * width + col] * GRID.unit, 6);
    }
  });

  /**
   * Ranges alone are not it -- a shelter sweep deleted outright still answers
   * inside [0, 1], which a review pointed out made the first version of this
   * a test of nothing. Seed 32's mainland lies due north, so with a northerly
   * blowing, a point a few hundred metres off its lee shore must be robbed of
   * wind that the open spawn still has.
   */
  it('feeds RegionTerrain a world whose land really shades the wind', () => {
    const { region, height } = coastHeightField(32);
    const terrain = new RegionTerrain(region, height);
    expect(Number.isFinite(terrain.distanceToShore(0, 0))).toBe(true);

    // Walk north from the spawn to the waterline, then stand 250 m off it.
    let shoreY = 0;
    for (let y = 0; y < 9000; y += 25) {
      if (height.elevationAt(0, y) > 0) {
        shoreY = y;
        break;
      }
    }
    expect(shoreY).toBeGreaterThan(0);
    const lee = terrain.windExposure(0, shoreY - 250, 0);
    const open = terrain.windExposure(0, 0, 0);
    expect(open).toBeGreaterThan(0.8);
    expect(lee).toBeLessThan(open - 0.1);
  });

  /** The logbook must file a coast passage under its name, not "Open ocean". */
  it('is what placeName calls it', () => {
    expect(placeName(COAST_ID, () => null)).toBe(COAST_NAME);
  });
});
