import { describe, expect, it } from 'vitest';
import { SIZE, createWater, ringGeometry } from './water';

/**
 * The ring the far sea is cut from.
 *
 * A renderer test, which this project writes only for conventions and never for
 * looks. Two conventions live here and both are invisible until they are wrong
 * in a way no screenshot frames well:
 *
 * - **Winding.** The material is FrontSide, so a triangle wound the other way
 *   is simply not drawn. Written by hand the first time, every triangle faced
 *   down, and the whole sea would have vanished when you looked at it from
 *   above. It cost one derivation to notice and would have cost a session to
 *   find by eye.
 * - **The hole.** It has to be exactly the wave grid's extent. Wider and a gap
 *   opens with the sky showing through; narrower and the two surfaces overlap
 *   at the same height, which is the depth fight the old sunk plane existed to
 *   avoid -- and the reason it could be deleted is that nothing is drawn twice.
 */
describe('the far sea ring', () => {
  const half = SIZE / 2;
  const outer = 4000;
  const tris = (g: ReturnType<typeof ringGeometry>) => {
    const p = g.getAttribute('position').array;
    const out: number[][] = [];
    for (let i = 0; i < p.length; i += 9) out.push([...p.slice(i, i + 9)]);
    return out;
  };

  it('faces up, every triangle of it', () => {
    for (const [ax, , az, bx, , bz, cx, , cz] of tris(ringGeometry(half, outer))) {
      // y of (b-a) x (c-a), for a triangle lying in the XZ plane.
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      expect(ny).toBeGreaterThan(0);
    }
  });

  it('lies flat at the grid height, so the two seas meet rather than step', () => {
    for (const t of tris(ringGeometry(half, outer))) {
      for (const y of [t[1], t[4], t[7]]) expect(y).toBe(0);
    }
  });

  /**
   * The hole is the grid's own square. Asserted as an area rather than by
   * reading corners back, because area catches a hole in the wrong *place* as
   * well as one of the wrong size -- and a ring that quietly covered its own
   * hole would still have the right corners somewhere in the list.
   */
  it('cuts a hole of exactly the grid, no gap and no overlap', () => {
    let area = 0;
    for (const [ax, , az, bx, , bz, cx, , cz] of tris(ringGeometry(half, outer))) {
      area += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
    }
    expect(area).toBeCloseTo(4 * outer * outer - 4 * half * half, 6);
  });

  /**
   * And the sea that is actually built uses the grid's own extent.
   *
   * Everything above tests `ringGeometry` with arguments this file chose, which
   * says nothing about the arguments `createWater` chooses -- the near-miss
   * this closes: shrinking the hole at the call site left all of it green.
   */
  it('is built with a hole that is the wave grid, not a number of its own', () => {
    const water = createWater();
    const p = water.far.geometry.getAttribute('position').array;
    let holeX = Infinity;
    let holeZ = Infinity;
    for (let i = 0; i < p.length; i += 3) {
      holeX = Math.min(holeX, Math.abs(p[i]));
      holeZ = Math.min(holeZ, Math.abs(p[i + 2]));
    }
    // The nearest vertex to the centre is a corner of the hole, on both axes.
    expect(holeX).toBe(half);
    expect(holeZ).toBe(half);
    water.dispose();
  });

  it('reaches the whole way out', () => {
    const xs = tris(ringGeometry(half, outer)).flatMap((t) => [t[0], t[3], t[6]]);
    expect(Math.max(...xs)).toBe(outer);
    expect(Math.min(...xs)).toBe(-outer);
  });
});
