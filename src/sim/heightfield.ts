import type { Region } from './regions';

/**
 * A surveyed piece of ground, sampled.
 *
 * This is the whole of what replaces the circle formula. `Terrain.elevationAt`
 * used to loop over analytic islands; everything downstream of it -- grounding,
 * the depth under the hull, the shoal colour, the chart's coastline, the land
 * meshes -- was already built by *sampling* that one function rather than by
 * knowing anything about circles. So a real coast is a different answer to the
 * same question, not a different question.
 *
 * Pure and headless, holding a typed array it did not load. `src/sim` may not
 * touch the network or the filesystem, and this way the browser can fetch the
 * raster while a test reads it off disk and both get the same object.
 */

/** Row-major from the north-west corner, which is how the raster is baked. */
export class HeightField {
  /** Metres east and north the grid reaches from its centre. */
  readonly halfWidth: number;
  readonly halfHeight: number;
  /**
   * Where the grid's centre sits in the world, m.
   *
   * Zero for every surveyed region -- their rasters are baked about the world
   * origin and nothing about them can move. The generated coast is the reason
   * this exists: its samples come from a pure function of *world* position, so
   * the same 20 km window can be re-baked anywhere along the shore and agree
   * exactly with every other window where they overlap. The field knows where
   * it sits so that every consumer -- the physics, the shelter sweep, the land
   * meshes, the water shader's texture -- asks it rather than each assuming
   * the centre is the origin, which is the assumption this replaces.
   */
  readonly originX: number;
  readonly originY: number;

  private readonly w: number;
  private readonly h: number;
  private readonly cell: number;
  private readonly unit: number;

  constructor(
    private readonly samples: Int16Array,
    region: Region,
    origin: { x: number; y: number } = { x: 0, y: 0 },
  ) {
    this.originX = origin.x;
    this.originY = origin.y;
    const { width, height, cell, unit } = region.grid;
    if (samples.length !== width * height) {
      // Worth throwing rather than sampling garbage: a raster of the wrong size
      // reads as a plausible but wrong coast, and the first sign of it would be
      // running aground in open water.
      throw new Error(
        `raster for ${region.id} is ${samples.length} samples, expected ${width * height}`,
      );
    }
    this.w = width;
    this.h = height;
    this.cell = cell;
    this.unit = unit;
    this.halfWidth = (width * cell) / 2;
    this.halfHeight = (height * cell) / 2;
  }

  /** True while the point is inside the surveyed square. */
  contains(x: number, y: number): boolean {
    return (
      Math.abs(x - this.originX) <= this.halfWidth && Math.abs(y - this.originY) <= this.halfHeight
    );
  }

  /**
   * How far outside the surveyed square this point is, in metres. Zero inside.
   *
   * What the edge of the data should feel like is a decision the region does not
   * get to make on its own -- docs/real-map.md settles on fading into the
   * procedural ocean rather than an invisible wall -- so this reports the
   * distance and lets the caller blend. Chebyshev rather than Euclidean, so the
   * fade follows the square the data actually occupies.
   */
  distanceOutside(x: number, y: number): number {
    return Math.max(
      0,
      Math.abs(x - this.originX) - this.halfWidth,
      0,
      Math.abs(y - this.originY) - this.halfHeight,
    );
  }

  /**
   * Ground elevation in metres: positive above the water, negative below.
   *
   * Bilinear, because the alternative shows. Nearest-neighbour on a 25 m grid
   * gives the shore a staircase the chart draws faithfully and the hull grounds
   * on, and it makes the sea floor a set of terraces that the keel would catch
   * on one at a time.
   *
   * Defined everywhere. Outside the square it clamps to the edge rather than
   * returning NaN or throwing, because the physics samples this at 120 Hz and
   * the renderer samples it right out to the horizon; a hole in it is a crash or
   * a black triangle, not an error anyone can act on. Callers that care where
   * the data stops ask `contains`.
   */
  elevationAt(x: number, y: number): number {
    // Samples sit at cell centres, so the first one is half a cell in from the
    // western and northern edges. Forgetting the half-cell shifts the whole
    // coast 12.5 m north-west, which is inside the noise of a single reading
    // and is exactly why it would never be noticed by looking.
    const gx = (x - this.originX + this.halfWidth) / this.cell - 0.5;
    // Row 0 is the north edge, so y counts down as the row index counts up.
    const gy = (this.halfHeight - (y - this.originY)) / this.cell - 0.5;

    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;

    const x1 = this.clampX(x0 + 1);
    const y1 = this.clampY(y0 + 1);
    const cx = this.clampX(x0);
    const cy = this.clampY(y0);

    const s = this.samples;
    const w = this.w;
    const a = s[cy * w + cx];
    const b = s[cy * w + x1];
    const c = s[y1 * w + cx];
    const d = s[y1 * w + x1];

    const top = a + (b - a) * fx;
    const bottom = c + (d - c) * fx;
    return (top + (bottom - top) * fy) * this.unit;
  }

  private clampX(i: number): number {
    return i < 0 ? 0 : i >= this.w ? this.w - 1 : i;
  }

  private clampY(i: number): number {
    return i < 0 ? 0 : i >= this.h ? this.h - 1 : i;
  }
}

/**
 * Read a baked raster into a `HeightField`.
 *
 * Takes bytes rather than a path or a URL, for the same reason the class does:
 * whoever has them -- `fetch` in the browser, `readFileSync` in a test or the
 * polar run -- is the side of the wall allowed to go and get them.
 */
export function heightFieldFromBytes(bytes: ArrayBuffer, region: Region): HeightField {
  const { width, height } = region.grid;
  if (bytes.byteLength !== width * height * 2) {
    throw new Error(
      `raster for ${region.id} is ${bytes.byteLength} bytes, expected ${width * height * 2}`,
    );
  }
  // Little-endian int16, which is what the baker writes and what every platform
  // this runs on reads natively.
  return new HeightField(new Int16Array(bytes), region);
}
