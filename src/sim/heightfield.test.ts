import { describe, expect, it } from 'vitest';
import { HeightField } from './heightfield';
import type { Region } from './regions';

/**
 * A 4x4 grid, 10 m cells, whose value is its column index in metres. Small
 * enough to reason about by hand, and asymmetric in x and y so that a
 * transposed or flipped lookup cannot pass.
 */
const TOY: Region = {
  id: 'toy',
  name: 'Toy',
  grid: { width: 4, height: 4, cell: 10, unit: 1 },
  source: 'a test',
};

/** Row-major from the north-west corner: rows count south, columns count east. */
function toy(values: number[][]): HeightField {
  return new HeightField(Int16Array.from(values.flat()), TOY);
}

/** Cell centres sit half a cell in from the edge; this is the centre of (col,row). */
const at = (col: number, row: number) => ({ x: -20 + col * 10 + 5, y: 20 - row * 10 - 5 });

describe('HeightField geometry', () => {
  const rising = toy([
    [0, 1, 2, 3],
    [0, 1, 2, 3],
    [0, 1, 2, 3],
    [0, 1, 2, 3],
  ]);

  it('reads a sample back exactly at its own cell centre', () => {
    for (let c = 0; c < 4; c++) {
      const p = at(c, 0);
      expect(rising.elevationAt(p.x, p.y)).toBeCloseTo(c, 10);
    }
  });

  it('interpolates halfway between two cell centres', () => {
    // Midway between column 1 and column 2, so midway between 1 m and 2 m.
    expect(rising.elevationAt(0, 15)).toBeCloseTo(1.5, 10);
  });

  /*
   * Row 0 is the *north* edge. Flipping this is the classic raster bug and it
   * is invisible in any symmetric fixture, so the fixture is not symmetric:
   * north is high, south is low.
   */
  it('puts row zero at the north edge', () => {
    const northHigh = toy([
      [9, 9, 9, 9],
      [6, 6, 6, 6],
      [3, 3, 3, 3],
      [0, 0, 0, 0],
    ]);
    expect(northHigh.elevationAt(0, 15)).toBeCloseTo(9, 10);
    expect(northHigh.elevationAt(0, -15)).toBeCloseTo(0, 10);
    expect(northHigh.elevationAt(0, 15)).toBeGreaterThan(northHigh.elevationAt(0, -15));
  });

  it('counts columns eastward', () => {
    expect(rising.elevationAt(15, 0)).toBeGreaterThan(rising.elevationAt(-15, 0));
  });

  it('applies the stored unit', () => {
    const decimetres: Region = { ...TOY, grid: { ...TOY.grid, unit: 0.1 } };
    const hf = new HeightField(Int16Array.from(new Array(16).fill(250)), decimetres);
    expect(hf.elevationAt(0, 0)).toBeCloseTo(25, 10);
  });
});

describe('HeightField edges', () => {
  const flat = toy([
    [5, 5, 5, 5],
    [5, 5, 5, 5],
    [5, 5, 5, 5],
    [5, 5, 5, 5],
  ]);

  it('knows where the survey stops', () => {
    expect(flat.contains(0, 0)).toBe(true);
    expect(flat.contains(20, 20)).toBe(true);
    expect(flat.contains(21, 0)).toBe(false);
    expect(flat.contains(0, -21)).toBe(false);
  });

  it('measures how far outside a point is, and zero inside', () => {
    expect(flat.distanceOutside(0, 0)).toBe(0);
    expect(flat.distanceOutside(20, 20)).toBe(0);
    expect(flat.distanceOutside(30, 0)).toBeCloseTo(10, 10);
    expect(flat.distanceOutside(0, -35)).toBeCloseTo(15, 10);
  });

  /*
   * Sampled far outside the grid rather than just past it. The physics reads
   * this at 120 Hz and the renderer reads it out to the horizon, so a NaN or a
   * throw here is a crash or a black hole in the sea, not a diagnosable error.
   */
  it('stays finite a long way outside the grid', () => {
    for (const [x, y] of [
      [1e5, 0],
      [-1e5, 0],
      [0, 1e5],
      [0, -1e5],
      [1e6, -1e6],
    ]) {
      expect(Number.isFinite(flat.elevationAt(x, y))).toBe(true);
    }
  });

  it('refuses a raster of the wrong size rather than sampling nonsense', () => {
    expect(() => new HeightField(Int16Array.from([1, 2, 3]), TOY)).toThrow(/expected 16/);
  });
});
