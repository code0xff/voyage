import { describe, expect, it } from 'vitest';
import { SEG, SIZE, createWater, ringGeometry } from './water';

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
