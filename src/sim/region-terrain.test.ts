import { describe, expect, it } from 'vitest';
import { HeightField } from './heightfield';
import { EDGE_FADE, RegionTerrain } from './region-terrain';
import { coastHeightField } from './coast';
import { DEG, RAD } from './math';
import { CRUISER } from './config';

/**
 * `RegionTerrain` itself: the class every world in this game is made of.
 *
 * It was tested against San Francisco Bay, because a surveyed square was the
 * only thing that filled it. Those regions are gone and the generated coast is
 * the one caller left -- so the fixture is a coast, and what is asserted here
 * is what the *class* owes rather than where Alcatraz is. `coast.test.ts`
 * holds the claims about the coast itself.
 *
 * Land and water are found by looking rather than written down: a seed is
 * entitled to move its own shoreline, and a test that named a point would be
 * asserting against the generator's last run instead of against the class.
 */
const { region, height } = coastHeightField(7);
const terrain = new RegionTerrain(region, height);

/** A wind to sweep the shelter with; nothing here depends on which. */
const WESTERLY = 262 * DEG;

/** The first point of open water and of dry ground the field can be found to hold. */
function find(want: 'water' | 'land'): { x: number; y: number } {
  const half = (region.grid.width * region.grid.cell) / 2 - 500;
  for (let y = -half; y <= half; y += 250) {
    for (let x = -half; x <= half; x += 250) {
      const e = height.elevationAt(x, y);
      if (want === 'water' ? e < -20 : e > 5) return { x, y };
    }
  }
  throw new Error(`this coast has no ${want}`);
}

const water = find('water');
const land = find('land');

/** Water with the beach close aboard, for the tests that need a lee. */
function beside(): { x: number; y: number } {
  const half = (region.grid.width * region.grid.cell) / 2 - 500;
  let best = water;
  let closest = Infinity;
  for (let y = -half; y <= half; y += 250) {
    for (let x = -half; x <= half; x += 250) {
      if (height.elevationAt(x, y) > -6) continue;
      const d = terrain.distanceToShore(x, y);
      if (d > 0 && d < closest) {
        closest = d;
        best = { x, y };
      }
    }
  }
  return best;
}

describe('depth and grounding', () => {
  it('floats her in the deep water and grounds her on the land', () => {
    expect(terrain.isAground(water.x, water.y, CRUISER.draft)).toBe(false);
    expect(terrain.isAground(land.x, land.y, CRUISER.draft)).toBe(true);
  });

  it('agrees with the field inside the survey', () => {
    expect(terrain.depthAt(water.x, water.y)).toBeCloseTo(
      -terrain.height.elevationAt(water.x, water.y),
      6,
    );
  });
});

describe('the shore', () => {
  it('is signed: positive at sea, negative inland', () => {
    expect(terrain.distanceToShore(water.x, water.y)).toBeGreaterThan(0);
    expect(terrain.distanceToShore(land.x, land.y)).toBeLessThan(0);
  });

  it('points at the shore it is actually near', () => {
    // Walked in from the water towards the land it was found beside: whatever
    // the bearing is, stepping that way must get closer to the beach.
    const b = terrain.bearingToShore(water.x, water.y);
    expect(b).not.toBeNull();
    const before = terrain.distanceToShore(water.x, water.y);
    const step = 300;
    const after = terrain.distanceToShore(
      water.x + Math.sin(b as number) * step,
      water.y + Math.cos(b as number) * step,
    );
    expect(after).toBeLessThan(before);
    // And it is a compass bearing, not a plane angle in disguise.
    expect(Math.abs((b as number) * RAD)).toBeLessThanOrEqual(360);
  });

  it('has nothing to say off the chart', () => {
    expect(terrain.distanceToShore(50000, 0)).toBe(Infinity);
    expect(terrain.bearingToShore(50000, 0)).toBeNull();
  });
});

describe('shelter through the query interface', () => {
  it('rebuilds itself when the wind moves, without being told to', () => {
    // Taken from the shore itself rather than from a guessed point: `inshore`
    // is water with land close by, and the bearing says which way. Blowing
    // *from* the land it must be sheltered, and from the opposite side open --
    // and the field has to notice the shift on its own.
    const inshore = beside();
    const toLand = terrain.bearingToShore(inshore.x, inshore.y) as number;
    const offshore = terrain.windExposure(inshore.x, inshore.y, toLand);
    const onshore = terrain.windExposure(inshore.x, inshore.y, toLand + Math.PI);
    expect(offshore).toBeLessThan(onshore);
    expect(onshore).toBeGreaterThan(0.9);
  });
});

/**
 * The edge of the survey.
 *
 * docs/real-map.md weighs an invisible wall against a fade into open sea and
 * picks the fade, because sailing off the edge of the surveyed area is what
 * actually happens and a wall in a game about going somewhere is the worst
 * available answer.
 */
describe('sailing off the chart', () => {
  it('opens into deep water rather than stopping dead', () => {
    const far = terrain.depthAt(region.grid.width * region.grid.cell, 0);
    expect(far).toBeGreaterThan(50);
    expect(terrain.isAground(region.grid.width * region.grid.cell, 0, CRUISER.draft)).toBe(false);
  });

  it('gives the wind and the sea back on the way out', () => {
    const x = terrain.height.halfWidth + 2000;
    expect(terrain.windExposure(x, 0, WESTERLY)).toBeCloseTo(1, 3);
    expect(terrain.waveShelter(x, 0, WESTERLY)).toBeCloseTo(1, 3);
  });

  it('crosses the boundary without a step in the depth', () => {
    // Walked across the eastern edge: the fade has to be continuous, or the
    // keel would find a cliff at a line drawn on nothing.
    const edge = terrain.height.halfWidth;
    let previous = terrain.depthAt(edge - 200, 0);
    for (let d = -150; d <= 1200; d += 50) {
      const depth = terrain.depthAt(edge + d, 0);
      expect(Math.abs(depth - previous)).toBeLessThan(15);
      previous = depth;
    }
  });

  /*
   * The fade is the one part of the shelter model that is *not* shared as data.
   * Inside the square both sides read the same texels; outside there are none,
   * so the water shader computes the same blend from the same EDGE_FADE. That
   * makes this the one place they can drift apart, and they did: the shader
   * returned open sea the instant the boundary was crossed while the boat went
   * on feeling the lee for another 800 m -- 0.35 against 1.0 at the north edge
   * in a westerly, a hard seam on a line drawn on nothing.
   *
   * This holds the constant the shader is built against and the shape of the
   * blend. It cannot reach into GLSL, so it is not proof; it is the half of the
   * agreement that can be checked, and the constant is imported by both.
   */
  it('fades over exactly the distance the shader is given', () => {
    // On a field built for it: a wall of land along the north edge and water
    // under it, so the water at the boundary is certainly sheltered. Taken
    // from a coast instead, this asserted nothing the day the seed put open
    // water at that edge -- which is how a test blesses a bug.
    const spec = {
      id: 'wall',
      name: 'Wall',
      grid: { width: 64, height: 64, cell: 100, unit: 1 },
      source: 'a test',
    };
    const samples = new Int16Array(64 * 64).fill(-20);
    // Land down to three rows short of the southern edge, so the strip of
    // water at that edge is in its lee and nothing else.
    for (let i = 0; i < 64 * 61; i++) samples[i] = 60;
    const walled = new RegionTerrain(spec, new HeightField(samples, spec));
    const northerly = 0;
    const y = -walled.height.halfHeight;
    const atEdge = walled.waveShelter(0, y + 1, northerly);
    // Sheltered water, or this proves nothing about a blend towards open sea.
    expect(atEdge).toBeLessThan(0.6);

    // Just outside, still essentially what the boat felt a metre back.
    expect(walled.waveShelter(0, y - 1, northerly)).toBeCloseTo(atEdge, 2);
    // Half way through the band, half way to open sea.
    const half = walled.waveShelter(0, y - EDGE_FADE / 2, northerly);
    expect(half).toBeCloseTo(atEdge + (1 - atEdge) * 0.5, 2);
    // And fully open at the end of it, not before.
    expect(walled.waveShelter(0, y - EDGE_FADE * 0.99, northerly)).toBeLessThan(1);
    expect(walled.waveShelter(0, y - EDGE_FADE, northerly)).toBeCloseTo(1, 6);
  });

  it('is still finite a very long way out', () => {
    expect(Number.isFinite(terrain.depthAt(1e6, -1e6))).toBe(true);
    expect(Number.isFinite(terrain.windExposure(1e6, -1e6, WESTERLY))).toBe(true);
  });
});

/**
 * Regions with no waterline.
 *
 * Neither can be sailed and neither ships, but `distanceToShore` has one job
 * off the chart -- say Infinity, as `Terrain` with no islands does, so the
 * callers written for it fall quiet. The first attempt tested only that some
 * distance came out negative, which catches all-water and is *fooled* by
 * all-land: every distance is the negative sentinel, so it reported a shore
 * twenty-five thousand kilometres inland. A shore needs both halves.
 */
describe('a region with nothing to be near', () => {
  const flat = (elevation: number) => {
    const spec = { ...region, grid: { ...region.grid, width: 32, height: 32, unit: 1 } };
    const samples = new Int16Array(32 * 32).fill(elevation);
    return new RegionTerrain(spec, new HeightField(samples, spec));
  };

  it('says Infinity when it is all water', () => {
    const t = flat(-20);
    expect(t.distanceToShore(0, 0)).toBe(Infinity);
    expect(t.bearingToShore(0, 0)).toBeNull();
  });

  it('says Infinity when it is all land', () => {
    const t = flat(40);
    expect(t.distanceToShore(0, 0)).toBe(Infinity);
    expect(t.bearingToShore(0, 0)).toBeNull();
  });

  it('still finds one when there is both', () => {
    const spec = { ...region, grid: { ...region.grid, width: 32, height: 32, unit: 1 } };
    const samples = new Int16Array(32 * 32).fill(-20);
    for (let i = 0; i < 32 * 16; i++) samples[i] = 40; // the northern half is land
    const t = new RegionTerrain(spec, new HeightField(samples, spec));
    expect(Number.isFinite(t.distanceToShore(0, -200))).toBe(true);
    expect(t.bearingToShore(0, -200)).not.toBeNull();
  });
});

/**
 * What the eight-bit texture costs.
 *
 * Inside the survey the physics and the shader read the same field, and since
 * the texture carries capped *fetch* rather than shelter they now interpolate
 * the same linear quantity and each take the root themselves. The arithmetic
 * is exact. The wire is not: the red channel is a byte.
 *
 * This pins the size of what is left, because a comment saying "0.0126" is
 * only true until someone changes REFERENCE_FETCH, the floor, or the encoding
 * -- and all three are one edit away from widening it silently. The worst case
 * is at the waterline, where the root is steepest and the floor cuts in.
 */
describe('the shelter texture, as the shader will read it', () => {
  const REF = 8000;
  /** Exactly what water.ts writes into the red channel. */
  const byte = (i: number) => Math.round((Math.min(terrain.shelter.fetch[i], REF) / REF) * 255) / 255;

  it('agrees with the physics to within the quantisation bound', () => {
    terrain.waveShelter(0, 0, WESTERLY);
    const { width, height, cell } = region.grid;
    const hw = terrain.height.halfWidth;
    const hh = terrain.height.halfHeight;
    let worst = 0;
    // Every eleventh midpoint: enough of the bay to catch a shoreline without
    // making this the slowest test in the suite.
    for (let row = 1; row < height - 1; row += 11) {
      for (let col = 1; col < width - 2; col += 11) {
        const i = row * width + col;
        const x = -hw + (col + 1) * cell;
        const y = hh - (row + 0.5) * cell;
        const cpu = terrain.waveShelter(x, y, WESTERLY);
        // The hardware mixes the two bytes, then the shader takes the root.
        const gpu = Math.max(0.05, Math.sqrt((byte(i) + byte(i + 1)) / 2));
        worst = Math.max(worst, Math.abs(cpu - gpu));
      }
    }
    // sqrt(1/255) - 0.05 is the bound at the floor; a little over it for the
    // interpolated case, and nowhere near enough to see in a wave height.
    expect(worst).toBeLessThan(0.02);
  });

  it('agrees exactly where the byte is exact', () => {
    terrain.waveShelter(0, 0, WESTERLY);
    // Zero fetch is the floor on both sides, and fully capped fetch is 1.
    expect(Math.max(0.05, Math.sqrt(0))).toBeCloseTo(0.05, 10);
    expect(Math.max(0.05, Math.sqrt(255 / 255))).toBeCloseTo(1, 10);
  });
});
