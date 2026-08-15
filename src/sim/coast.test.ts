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

/**
 * The sliding window: the property that makes the coast a mainland rather
 * than a very large island. The field handed to the engine is a 20 km window
 * onto a function of world position, and the engine re-bakes it about the
 * boat as she sails -- which only works, and only invisibly, if any two
 * windows of the same seed say the same thing about every point they share.
 */
describe('the coast window', () => {
  // Every full window is ~130 ms of generation here and three to four times
  // that on the CI runner, and the march below bakes twelve of them -- the
  // default 5 s test timeout is a measure of the runner, not of the claim.
  // Same pattern as the trim search in shear.test.ts.
  it('re-baked windows agree exactly where they overlap', { timeout: 60_000 }, () => {
    // Byte-exact on the raw samples, not merely close: overlapping cells sit
    // on the same world lattice (see snapCoastOrigin), so the same doubles go
    // into the same noise and the int16 that comes out has no excuse to
    // differ. A tolerance here would hide exactly the lattice shear the snap
    // exists to prevent.
    for (const seed of [13, 546]) {
      const off = { x: 4000, y: -2600 };
      const a = coastSamples(seed);
      const b = coastSamples(seed, off);
      const dCol = off.x / cell;
      // Rows count southward from the north edge, so a window moved south
      // (negative y) sees the same world point at a *smaller* row index.
      const dRow = off.y / cell;
      let mismatches = 0;
      let compared = 0;
      for (let row = 0; row < rows; row++) {
        const rowB = row + dRow;
        if (rowB < 0 || rowB >= rows) continue;
        for (let col = 0; col < width; col++) {
          const colB = col - dCol;
          if (colB < 0 || colB >= width) continue;
          compared++;
          if (a[row * width + col] !== b[rowB * width + colB]) mismatches++;
        }
      }
      expect(compared).toBeGreaterThan(100_000);
      expect(mismatches).toBe(0);
    }
  });

  it('answers world queries identically through either window', { timeout: 60_000 }, () => {
    // The consumer contract, one level up from the raster: the physics asks
    // elevationAt in world coordinates and must not care which window
    // answers. Close-to rather than exact -- the bilinear weights are
    // computed from different float expressions per window -- but at 1e-9 m,
    // which no lattice error could survive.
    const a = coastHeightField(13);
    const b = coastHeightField(13, { x: 4000, y: -2600 });
    for (let i = 0; i < 200; i++) {
      const x = -5000 + ((i * 7919) % 9000);
      const y = -7000 + ((i * 104729) % 9000);
      expect(b.height.elevationAt(x, y)).toBeCloseTo(a.height.elevationAt(x, y), 9);
    }
  });

  it('snaps an unpinned origin to the lattice', () => {
    const f = coastHeightField(13, { x: 4013, y: -2591 });
    expect(f.origin).toEqual({ x: 4025, y: -2600 });
    expect(f.height.originX).toBe(4025);
    expect(f.height.originY).toBe(-2600);
  });

  it('the shore goes on, window after window, 120 km down the coast', { timeout: 120_000 }, () => {
    // Followed the way a sailor follows it: each window looks at its own
    // land, finds which way is inland and where its waterline lies, and the
    // next window is baked one window-length further along the shore. No
    // window is given the seed's secret bearing -- recomputing that here
    // would only prove the code agrees with a restatement of itself -- and
    // the recentring is what an extrapolated straight line cannot do, follow
    // the shore through its own bays. Every hop must keep both land and sea
    // in frame; a coast that pinned its land to the home window, or one
    // whose windows disagreed about where the world is, fails within a hop
    // or two.
    const windowSpan = width * cell;
    for (const seed of [13, 546]) {
      let centre = { x: 0, y: 0 };
      for (let hop = 0; hop < 6; hop++) {
        const s = coastSamples(seed, centre);
        // Mean elevation gradient: dominated by the mainland ramp, so it
        // points inland whatever the islets are doing.
        let gx = 0;
        let gy = 0;
        // Waterline centroid, to pull the next centre back onto the shore.
        let wx = 0;
        let wy = 0;
        let wn = 0;
        for (let row = 2; row < rows - 2; row += 2) {
          for (let col = 2; col < width - 2; col += 2) {
            const i = row * width + col;
            gx += s[i + 2] - s[i - 2];
            gy += s[i - 2 * width] - s[i + 2 * width];
            if ((s[i] > 0) !== (s[i + 2] > 0) || (s[i] > 0) !== (s[i + 2 * width] > 0)) {
              wx += centre.x - windowSpan / 2 + (col + 0.5) * cell;
              wy += centre.y + windowSpan / 2 - (row + 0.5) * cell;
              wn++;
            }
          }
        }
        expect(wn).toBeGreaterThan(50);
        const g = Math.hypot(gx, gy);
        const along = { x: -gy / g, y: gx / g };
        centre = {
          x: wx / wn + along.x * windowSpan,
          y: wy / wn + along.y * windowSpan,
        };
        const next = coastSamples(seed, centre);
        let land = 0;
        let cnt = 0;
        let same = 0;
        for (let i = 0; i < next.length; i += 7) {
          cnt++;
          if (next[i] > 0) land++;
          if (next[i] === s[i]) same++;
        }
        const frac = land / cnt;
        expect(frac).toBeGreaterThan(0.05);
        expect(frac).toBeLessThan(0.95);
        // And the window actually went somewhere: a generator that ignored
        // the centre would serve the home raster at every hop, keep every
        // fraction in bounds, and this march would prove nothing -- which a
        // review demonstrated by mutating exactly that. Twenty kilometres of
        // shore shares almost no cells with the last window.
        expect(same / cnt).toBeLessThan(0.5);
      }
    }
  });
});

/**
 * The parts of RegionTerrain that carry their own copy of the grid-to-world
 * mapping, exercised through a *moved* window. The overlap tests above prove
 * the raster and elevationAt; the shelter sweep and the shore-distance
 * chamfer each bake world coordinates of their own, and either of them left
 * mapping about the world origin would pass every home-window test in this
 * file -- at origin zero the shift is a no-op -- and then hand the boat a
 * 20 km-displaced lee the first time the window slides.
 */
describe('a moved window, felt through the whole terrain', () => {
  // Thirty kilometres down seed 32's shore, which runs east-west with the
  // mainland due north: the x offset is the slide, and the y offset is kept
  // small enough that the waterline near +3 km stays well inside the moved
  // frame -- a window shifted south of it would be measuring open sea.
  const off = { x: 30_000, y: -2_000 };

  it('still shades the wind off its own lee shore', { timeout: 60_000 }, () => {
    // Seed 32's mainland lies due north of the home spawn; the same shore,
    // found again from the moved window's centre.
    const { region, height } = coastHeightField(32, off);
    const terrain = new RegionTerrain(region, height);
    let shoreY = 0;
    for (let y = off.y; y < off.y + 9000; y += 25) {
      if (height.elevationAt(off.x, y) > 0) {
        shoreY = y;
        break;
      }
    }
    expect(shoreY).toBeGreaterThan(off.y);
    const lee = terrain.windExposure(off.x, shoreY - 250, 0);
    const open = terrain.windExposure(off.x, shoreY - 5000, 0);
    expect(open).toBeGreaterThan(0.8);
    expect(lee).toBeLessThan(open - 0.1);
  });

  it('agrees with the home window about the lee itself', { timeout: 60_000 }, () => {
    // What this pins is the *pairing* of the sweep's two mappings: the bake
    // writes the land mask through one grid-to-world formula and the queries
    // read it back through the inverse, and an origin dropped from only one
    // side hands back the shelter of a shore four kilometres away -- the
    // checked mutation. Dropped from *both* sides at once the grid is merely
    // relabelled, self-consistently, and inside the windows' overlap that is
    // genuinely behaviour-preserving -- no point test here can see it, which
    // is worth saying so nobody mistakes this for a guard it is not. What
    // that leaves unguarded is only coverage at a moved window's far half,
    // where the relabelled grid runs out and clamps.
    const a = coastHeightField(32);
    const near = { x: 4000, y: -2000 };
    const b = coastHeightField(32, near);
    const ta = new RegionTerrain(a.region, a.height);
    const tb = new RegionTerrain(b.region, b.height);
    let shoreY = 0;
    for (let y = 0; y < 9000; y += 25) {
      if (a.height.elevationAt(near.x, y) > 0) {
        shoreY = y;
        break;
      }
    }
    expect(shoreY).toBeGreaterThan(0);
    let sheltered = 0;
    for (const dx of [-1200, -400, 0, 400, 1200]) {
      const p = { x: near.x + dx, y: shoreY - 250 };
      const ea = ta.windExposure(p.x, p.y, 0);
      const eb = tb.windExposure(p.x, p.y, 0);
      expect(Math.abs(ea - eb)).toBeLessThan(0.05);
      if (ea < 0.9) sheltered++;
    }
    // Trivial agreement -- open water agreeing with open water -- proves
    // nothing; the probes must actually be standing in a lee.
    expect(sheltered).toBeGreaterThan(2);
  });

  it('agrees with the home window about the distance to shore', { timeout: 60_000 }, () => {
    // A world point both windows can see, near the shore so the chamfer has
    // something local to measure. The two windows crop the world differently,
    // so distances are only comparable where the nearest shore is well inside
    // both -- 50 m of chamfer tolerance covers the diagonal error.
    const a = coastHeightField(32);
    const near = { x: 4000, y: -2000 };
    const b = coastHeightField(32, near);
    const ta = new RegionTerrain(a.region, a.height);
    const tb = new RegionTerrain(b.region, b.height);
    let shoreY = 0;
    for (let y = 0; y < 9000; y += 25) {
      if (a.height.elevationAt(near.x, y) > 0) {
        shoreY = y;
        break;
      }
    }
    expect(shoreY).toBeGreaterThan(0);
    const p = { x: near.x, y: shoreY - 400 };
    const da = ta.distanceToShore(p.x, p.y);
    const db = tb.distanceToShore(p.x, p.y);
    expect(Number.isFinite(da)).toBe(true);
    expect(Math.abs(da - db)).toBeLessThan(50);
  });
});
