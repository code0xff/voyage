import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HeightField } from '../sim/heightfield';
import { RegionTerrain } from '../sim/region-terrain';
import { coastRegion } from '../sim/coast';
import { FIELD_DEPTH, SEG, SIZE, createWater, fieldGlsl, ringGeometry } from './water';

/**
 * The ring the far sea is cut from.
 *
 * A renderer test, which this project writes only for conventions and never for
 * looks. Three conventions live here, and every one of them fails in a way that
 * is either invisible in a screenshot or impossible to frame:
 *
 * - **Winding.** The material is FrontSide, so a triangle wound the other way
 *   is simply not drawn. Written by hand the first time, every triangle faced
 *   down; the whole sea would have vanished when looked at from above.
 * - **The hole.** It has to be exactly the wave grid's square. Wider and a gap
 *   opens with the sky through it; narrower and the two surfaces overlap at the
 *   same height, which is the depth fight the sunken plane existed to avoid --
 *   and the only reason that plane could be deleted is that nothing is drawn
 *   twice now.
 * - **No T-junctions.** The grid's rim carries a vertex every 3 m. An inner
 *   edge that did not would meet it partway along, and two edges that agree as
 *   lines can still rasterise onto different pixels, which shows as a dotted
 *   seam exactly where this join must not show.
 */
describe('the far sea ring', () => {
  const half = SIZE / 2;
  const outer = 4000;
  const ring = () => ringGeometry(half, outer, SEG);
  const tris = (g: ReturnType<typeof ringGeometry>) => {
    const p = g.getAttribute('position').array;
    const out: number[][] = [];
    for (let i = 0; i < p.length; i += 9) out.push([...p.slice(i, i + 9)]);
    return out;
  };
  const verts = (g: ReturnType<typeof ringGeometry>) => {
    const p = g.getAttribute('position').array;
    const out: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < p.length; i += 3) out.push({ x: p[i], y: p[i + 1], z: p[i + 2] });
    return out;
  };

  it('faces up, every triangle of it', () => {
    for (const [ax, , az, bx, , bz, cx, , cz] of tris(ring())) {
      // y of (b-a) x (c-a), for a triangle lying in the XZ plane.
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      expect(ny).toBeGreaterThan(0);
    }
  });

  it('lies flat at the grid height, so the two seas meet rather than step', () => {
    for (const v of verts(ring())) expect(v.y).toBe(0);
  });

  /**
   * Nothing of the ring reaches inside the grid's square, and the ring does
   * come all the way in to it. Together those two say the hole is the grid's
   * own square rather than merely a hole of the right size somewhere.
   */
  it('holds its edge exactly on the grid, with nothing inside it', () => {
    const reach = verts(ring()).map((v) => Math.max(Math.abs(v.x), Math.abs(v.z)));
    expect(Math.min(...reach)).toBe(half);
    expect(Math.max(...reach)).toBe(outer);
  });

  /**
   * A hole of the grid's area really is cut.
   *
   * Area and nothing more: it says nothing about where the hole is, because it
   * is unchanged by moving one. What it catches is the ring quietly covering
   * its own hole, which would bring back the overlap the sunken plane existed
   * to survive.
   */
  it('cuts away exactly the grid, so nothing is drawn twice', () => {
    let area = 0;
    for (const [ax, , az, bx, , bz, cx, , cz] of tris(ring())) {
      area += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
    }
    expect(area).toBeCloseTo(4 * outer * outer - 4 * half * half, 6);
  });

  /**
   * Every station on the grid's rim is a vertex of the ring too.
   *
   * This is the assertion the seam actually rests on. The lines agreeing is not
   * enough: a vertex partway along someone else's edge is a T-junction, and the
   * rasteriser is free to put the long edge and the chain of short ones on
   * different pixels.
   */
  it('carries a vertex at every station the grid rim has', () => {
    const step = SIZE / SEG;
    const stations = Array.from({ length: SEG + 1 }, (_, i) => -half + i * step);
    const v = verts(ring());
    // The north inner edge, and the west one, stand for all four by symmetry --
    // and the construction is checked below to be symmetric.
    const north = new Set(v.filter((p) => p.z === -half).map((p) => p.x));
    const west = new Set(v.filter((p) => p.x === -half).map((p) => p.z));
    for (const s of stations) {
      expect(north.has(s)).toBe(true);
      expect(west.has(s)).toBe(true);
    }
  });

  it('is symmetric, so all four sides are the side that was checked', () => {
    const v = verts(ring());
    const key = (p: { x: number; z: number }) => `${p.x},${p.z}`;
    const all = new Set(v.map(key));
    for (const p of v) {
      expect(all.has(key({ x: -p.x, z: p.z }))).toBe(true);
      expect(all.has(key({ x: p.z, z: p.x }))).toBe(true);
    }
  });

  /**
   * And the sea that is actually built uses the grid's own extent and
   * subdivision.
   *
   * Everything above tests `ringGeometry` with arguments this file chose, which
   * says nothing about the arguments `createWater` chooses -- the near-miss
   * this closes: shrinking the hole at the call site left all of it green.
   */
  it('is built from the wave grid, not from numbers of its own', () => {
    const water = createWater();
    const built = verts(water.far.geometry as ReturnType<typeof ringGeometry>);
    const reach = built.map((v) => Math.max(Math.abs(v.x), Math.abs(v.z)));
    expect(Math.min(...reach)).toBe(half);
    const step = SIZE / SEG;
    const north = new Set(built.filter((p) => p.z === -half).map((p) => p.x));
    for (let i = 0; i <= SEG; i++) expect(north.has(-half + i * step)).toBe(true);
    water.dispose();
  });
});

/** A small raster whose north and south edges have deliberately different depths. */
function textureTerrain(): RegionTerrain {
  const source = coastRegion(1);
  const region = {
    ...source,
    id: 'water-test',
    grid: { ...source.grid, width: 8, height: 8, unit: 1 },
  };
  const samples = new Int16Array(region.grid.width * region.grid.height).fill(-20);
  for (let col = 0; col < region.grid.width; col++) {
    samples[col] = -8;
    samples[(region.grid.height - 1) * region.grid.width + col] = -32;
  }
  return new RegionTerrain(region, new HeightField(samples, region));
}

describe('the surveyed water texture', () => {
  it('uploads depth in the same north-to-south rows the raster uses', () => {
    const terrain = textureTerrain();
    const water = createWater();
    water.setRegion(terrain);

    const material = water.mesh.material as THREE.ShaderMaterial;
    const field = material.uniforms.uField.value as THREE.DataTexture;
    const data = field.image.data as Uint8Array;
    const { width, height, cell } = terrain.region.grid;
    const halfW = terrain.height.halfWidth;
    const halfH = terrain.height.halfHeight;
    const greenAt = (row: number, col: number) =>
      (data[(row * width + col) * 4 + 1] / 255) * FIELD_DEPTH;
    const depthAtCell = (row: number, col: number) =>
      terrain.depthAt(
        -halfW + (col + 0.5) * cell,
        halfH - (row + 0.5) * cell,
      );

    // The top and bottom rows are intentionally 8 m and 32 m. If the row
    // convention is mirrored, these two assertions swap and the visible bay
    // is reflected about its middle even though the raster itself is correct.
    for (const row of [0, height - 1]) {
      const expected = Math.min(FIELD_DEPTH, depthAtCell(row, 0));
      expect(Math.abs(greenAt(row, 0) - expected)).toBeLessThanOrEqual(
        FIELD_DEPTH / 255,
      );
    }
    expect(greenAt(0, 0)).toBeLessThan(greenAt(height - 1, 0));

    water.dispose();
  });

  it('keeps the shelter and depth channels independent when the wind updates', () => {
    const source = coastRegion(1);
    const region = {
      ...source,
      id: 'water-shelter-test',
      grid: { ...source.grid, width: 8, height: 8, unit: 1 },
    };
    const samples = new Int16Array(region.grid.width * region.grid.height).fill(-20);
    // A dry block gives the shelter sweep something to write while the depth
    // channel remains the independently baked water depth.
    for (let row = 3; row < 5; row++) {
      for (let col = 3; col < 5; col++) samples[row * region.grid.width + col] = 30;
    }
    const terrain = new RegionTerrain(region, new HeightField(samples, region));
    const water = createWater();
    water.setRegion(terrain);
    water.updateRegion(0);

    const material = water.mesh.material as THREE.ShaderMaterial;
    const field = material.uniforms.uField.value as THREE.DataTexture;
    const data = field.image.data as Uint8Array;
    const { width, cell } = region.grid;
    const halfW = terrain.height.halfWidth;
    const halfH = terrain.height.halfHeight;
    const at = (row: number, col: number) => ({
      x: -halfW + (col + 0.5) * cell,
      y: halfH - (row + 0.5) * cell,
    });
    const byteAt = (row: number, col: number, channel: number) =>
      data[(row * width + col) * 4 + channel];

    for (const [row, col] of [[1, 1], [6, 6]]) {
      const p = at(row, col);
      expect(byteAt(row, col, 0)).toBe(
        Math.round(terrain.shelter.shelterInputAt(p.x, p.y) * 255),
      );
      expect(byteAt(row, col, 1)).toBe(
        Math.round(Math.min(1, terrain.depthAt(p.x, p.y) / FIELD_DEPTH) * 255),
      );
    }

    water.dispose();
  });
});

/**
 * The origin the sliding coast window introduces, at the texture boundary.
 *
 * The GLSL side subtracts uRegionOrigin before mapping into the texture; what
 * can be asserted headless is the other half of the bargain: that the baked
 * texels come from the field's own world position, and that the uniform the
 * shader will subtract is exactly the origin the field reports. A bake still
 * looping about the world origin would fill the texture from the field's edge
 * clamp -- 20 km of ghost coast -- the moment the window first slides.
 */
describe('the water texture of a moved window', () => {
  it('bakes the field where the window sits, and says so in the uniform', () => {
    const source = coastRegion(1);
    const region = {
      ...source,
      id: 'water-origin-test',
      grid: { ...source.grid, width: 8, height: 8, unit: 1 },
    };
    const origin = { x: 4000, y: -2600 };
    const samples = new Int16Array(64).fill(-20);
    for (let col = 0; col < 8; col++) {
      samples[col] = -8;
      samples[7 * 8 + col] = -32;
    }
    const terrain = new RegionTerrain(region, new HeightField(samples, region, origin));
    const water = createWater();
    water.setRegion(terrain);

    const material = water.mesh.material as THREE.ShaderMaterial;
    const o = material.uniforms.uRegionOrigin.value as THREE.Vector2;
    expect(o.x).toBe(origin.x);
    expect(o.y).toBe(origin.y);

    const field = material.uniforms.uField.value as THREE.DataTexture;
    const data = field.image.data as Uint8Array;
    const { cell } = region.grid;
    const halfW = terrain.height.halfWidth;
    const halfH = terrain.height.halfHeight;
    const greenAt = (row: number, col: number) => (data[(row * 8 + col) * 4 + 1] / 255) * FIELD_DEPTH;
    // The 8 m row and the 32 m row, read back at their *world* positions.
    for (const [row, expected] of [
      [0, 8],
      [7, 32],
    ] as const) {
      const worldY = origin.y + halfH - (row + 0.5) * cell;
      expect(Math.abs(terrain.depthAt(origin.x - halfW + 0.5 * cell, worldY) - expected)).toBeLessThan(1e-6);
      expect(Math.abs(greenAt(row, 0) - expected)).toBeLessThanOrEqual(FIELD_DEPTH / 255);
    }
    water.dispose();
  });
});

/**
 * A tripwire, and honestly no more than that: no GLSL runs in this file, so
 * the shader's use of the origin cannot be mutation-tested the way the TS
 * side is -- a review demonstrated that deleting the subtraction passed every
 * test here. What a string assertion can hold is that both field helpers
 * still subtract the origin before they map; the *correctness* of that
 * subtraction is the twin-formula argument in the fieldGlsl comment, kept
 * true by review and by looking.
 */
describe('the shader origin tripwire', () => {
  it('both field helpers subtract uRegionOrigin', () => {
    const helpers = fieldGlsl.split('float regionFade');
    expect(helpers).toHaveLength(2);
    for (const half of helpers) {
      expect(half).toContain('p - uRegionOrigin');
    }
  });
});
