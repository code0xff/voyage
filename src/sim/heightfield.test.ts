import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HeightField, heightFieldFromBytes } from './heightfield';
import { regionById, rasterBytes, type Region } from './regions';
import { worldFromLatLon } from './geo';

/**
 * A 4x4 grid, 10 m cells, whose value is its column index in metres. Small
 * enough to reason about by hand, and asymmetric in x and y so that a
 * transposed or flipped lookup cannot pass.
 */
const TOY: Region = {
  id: 'toy',
  name: 'Toy',
  area: '',
  brief: '',
  centre: { lat: 0, lon: 0 },
  utmZone: 31,
  grid: { width: 4, height: 4, cell: 10, unit: 1 },
  raster: '',
  source: '',
  licence: '',
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

/**
 * The claim the whole feature rests on: that this is really San Francisco Bay.
 *
 * Stated in latitude and longitude and checked against the committed raster, so
 * every assertion is one anyone can take to a chart. Ranges are wide, because
 * the point is *which side of the waterline each place is on* and roughly how
 * deep -- not a sounding. A 25 m cell holding the mean of its 625 square metres
 * has no business claiming better.
 *
 * These are also what catches a re-bake that comes back flipped, shifted or
 * projected differently: get any of that wrong and Alcatraz is under water.
 */
describe('San Francisco Bay, against the chart', () => {
  const region = regionById('sf-bay');
  if (!region) throw new Error('sf-bay region is missing');

  const raw = readFileSync('public/terrain/sf-bay.bin');
  const field = heightFieldFromBytes(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    region,
  );
  const elevation = (lat: number, lon: number) => {
    const p = worldFromLatLon(region, lat, lon);
    return field.elevationAt(p.x, p.y);
  };

  it('is the size the region says it is', () => {
    expect(raw.byteLength).toBe(rasterBytes(region));
  });

  it('has these islands above water', () => {
    expect(elevation(37.8267, -122.423)).toBeGreaterThan(10); // Alcatraz
    expect(elevation(37.8609, -122.4326)).toBeGreaterThan(100); // Angel I., Mt Livermore
    expect(elevation(37.809, -122.363)).toBeGreaterThan(10); // Yerba Buena
  });

  it('has this mainland above water', () => {
    expect(elevation(37.827, -122.5)).toBeGreaterThan(100); // Marin headlands
    expect(elevation(37.7955, -122.3937)).toBeGreaterThan(0); // SF, the Ferry Building
  });

  it('has the Golden Gate deep, which is where the scour hole is', () => {
    // The narrows run to 100 m and more -- by a wide margin the deepest water
    // in the region, and the one place a bad projection could not fake.
    expect(elevation(37.8199, -122.4783)).toBeLessThan(-60);
  });

  it('has these channels navigable', () => {
    expect(elevation(37.8664, -122.4436)).toBeLessThan(-8); // Raccoon Strait
    expect(elevation(37.83, -122.41)).toBeLessThan(-8); // central bay
  });

  it('has the Berkeley flats shallow but still water', () => {
    const e = elevation(37.86, -122.33);
    expect(e).toBeLessThan(0);
    expect(e).toBeGreaterThan(-8);
  });

  it('is deeper in the Gate than anywhere on the Berkeley side', () => {
    // The one comparison that pins the east-west orientation on its own.
    expect(elevation(37.8199, -122.4783)).toBeLessThan(elevation(37.86, -122.33));
  });

  it('reaches the sea outside the Gate and the hills inside it', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let y = -9000; y <= 9000; y += 250) {
      for (let x = -9000; x <= 9000; x += 250) {
        const e = field.elevationAt(x, y);
        min = Math.min(min, e);
        max = Math.max(max, e);
      }
    }
    // Sanity bounds, not measurements: deep enough to be a real strait, high
    // enough to be real hills, and nowhere near an int16 overflow either way.
    expect(min).toBeLessThan(-80);
    expect(min).toBeGreaterThan(-200);
    expect(max).toBeGreaterThan(200);
    expect(max).toBeLessThan(1000);
  });
});
