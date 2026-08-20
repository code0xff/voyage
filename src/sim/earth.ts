import { METRES_PER_DEG_LAT, toLatLon, wrapLon, type LatLon } from './globe';

/**
 * The coarse Earth, asked the one question the world needs of it.
 *
 * `globe-4m.bin` is elevation in metres at four arc-minutes -- about seven
 * kilometres a cell north-south, and less east-west the further from the
 * equator you are (six off San Francisco, three at 60 degrees) -- which is a
 * quarter of the window the boat sails inside and far too coarse to anchor in. So it is *not* used as terrain. What it
 * decides is **where the land is**: continents, islands big enough to have a
 * name, the shape of a gulf. The metres under the keel are still made by the
 * coast generator, conditioned on this.
 *
 * That division is the honest one and it is worth being plain about which
 * half is which. Sail from Gibraltar to the Canaries and the passage, the
 * bearing, the distance and the landfall are the real Earth's. The beach you
 * anchor off is invented -- a plausible coast in the right place, not the
 * coast that is there, and the menu says so. Six surveyed squares were the
 * exception until they were retired; see `docs/real-map.md`.
 *
 * Pure and headless like everything in `src/sim`: the raster is handed in,
 * already loaded, exactly as `HeightField` takes a region's.
 */

/** The grid the fetch script writes; see scripts/fetch-globe.ts. */
export interface GlobeGrid {
  /** Columns, one per step of longitude from -180. */
  width: number;
  /** Rows, one per step of latitude from +90 southward. */
  height: number;
  /** Arc-minutes per cell, the same in both axes. */
  arcMinutes: number;
}

export const GLOBE_4M: GlobeGrid = { width: 5400, height: 2700, arcMinutes: 4 };

/**
 * Degrees per cell of the *source* grid the fetcher subsamples: ETOPO's 60
 * arc-seconds. It is the offset of a kept sample inside its block, so it
 * belongs to the reader as much as to the script -- see `elevationAt`.
 */
const SOURCE_STEP = 1 / 60;

/**
 * How far a coarse cell reaches, in metres of latitude. Four arc-minutes is
 * about 7.4 km, and that is the north-south figure: east-west a cell is
 * narrower by the cosine of the latitude, so this is the *widest* the grid
 * ever is. The shore is smoothed over roughly this, which is why the
 * generated detail has to supply everything below it.
 */
export function cellMetres(grid: GlobeGrid): number {
  return (grid.arcMinutes / 60) * METRES_PER_DEG_LAT;
}

/**
 * Where a place falls on an equirectangular map, in fractional pixels.
 *
 * The plainest projection there is -- longitude straight across, latitude
 * straight down -- and here that is not a compromise but the grid's own
 * shape. `globe-4m.bin` is 5400 by 2700 because it is 360 degrees by 180 at
 * four arc-minutes, so a map drawn this way resamples the planet along the
 * axes it was already stored on. Anything better-behaved at the poles would
 * be a second geometry to keep in step with the raster for no gain: this is a
 * "where in the world am I" picture, not a chart anyone navigates on.
 *
 * Exported beside `landMask` and used by it, so the picture and the marks put
 * on top of it cannot drift apart. That is the same rule the water shader
 * keeps with `waveShelter`: a boat drawn in a different place from the boat
 * the map means is a lie the player will eventually notice.
 *
 * Longitude is taken modulo 360 rather than through `wrapLon`, which returns
 * 180 rather than -180 and would put the date line one pixel off the right
 * edge. Here both ends of it land at x = 0, which is where a map cut at the
 * date line has its seam. Latitude clamps at the poles and not at `clampLat`'s
 * 89.5: that limit belongs to the tangent plane, and cutting the top and
 * bottom half-degree off a world map would lose the ice.
 */
export function mapProject(
  place: LatLon,
  width: number,
  height: number,
): { x: number; y: number } {
  const lon = ((((place.lon + 180) % 360) + 360) % 360) / 360;
  const lat = (90 - Math.max(-90, Math.min(90, place.lat))) / 180;
  return { x: lon * width, y: lat * height };
}

/** The inverse, at the pixel's own corner. Exact against `mapProject`. */
export function mapUnproject(x: number, y: number, width: number, height: number): LatLon {
  return { lon: (x / width) * 360 - 180, lat: 90 - (y / height) * 180 };
}

export class Earth {
  private readonly samples: Int16Array;
  readonly grid: GlobeGrid;

  constructor(samples: Int16Array, grid: GlobeGrid = GLOBE_4M) {
    if (samples.length !== grid.width * grid.height) {
      // Worth throwing rather than sampling garbage, on the same argument as
      // HeightField: a grid of the wrong size reads as a plausible planet
      // whose first symptom is an ocean where a country should be.
      throw new Error(
        `globe raster is ${samples.length} samples, expected ${grid.width * grid.height}`,
      );
    }
    this.samples = samples;
    this.grid = grid;
  }

  /**
   * Elevation in metres at a place: positive is land, negative is sea.
   *
   * Bilinear, and wrapped east-west rather than clamped -- the grid is a
   * whole planet, so the cell east of the last column is the first column
   * and not a copy of itself. Getting that wrong draws a seam of stretched
   * coastline down the date line, which is a long way to sail to find a bug.
   * North and south do clamp: there is nothing beyond the poles.
   */
  elevationAt(place: LatLon): number {
    const { width, height, arcMinutes } = this.grid;
    const step = arcMinutes / 60;
    /*
     * Where a sample actually sits, which is not where a surveyed raster's
     * would.
     *
     * Those are baked as cell centres and are read at half-step offsets. This
     * grid is *subsampled*: the fetcher keeps every fourth source cell, so a
     * sample carries the position of the first 60-arcsecond cell of its
     * block -- half a source step in from the block's edge, not half an
     * output step. Reading it on the surveyed convention put the entire
     * planet 1.5 arc-minutes north-east of itself, which is 2.8 km: a review
     * caught it by comparing the fetch's own indices against the coordinate
     * variable, and nothing in the game would have looked wrong.
     */
    const half = SOURCE_STEP / 2;
    const gx = (wrapLon(place.lon) + 180 - half) / step;
    const gy = (90 - place.lat - half) / step;

    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;

    const wrapX = (i: number) => ((i % width) + width) % width;
    const clampY = (i: number) => (i < 0 ? 0 : i >= height ? height - 1 : i);
    const x1 = wrapX(x0 + 1);
    const y1 = clampY(y0 + 1);
    const cx = wrapX(x0);
    const cy = clampY(y0);

    const s = this.samples;
    const a = s[cy * width + cx];
    const b = s[cy * width + x1];
    const c = s[y1 * width + cx];
    const d = s[y1 * width + x1];
    const top = a + (b - a) * fx;
    const bottom = c + (d - c) * fx;
    return top + (bottom - top) * fy;
  }

  /** True where the coarse Earth says there is land. */
  isLand(place: LatLon): boolean {
    return this.elevationAt(place) > 0;
  }

  /**
   * The whole planet as land or sea, on an equirectangular grid of `width` by
   * `height` cells: 255 land, 0 sea.
   *
   * **A cell is land if any source sample in it is**, rather than land at the
   * middle of it. The two differ by more than they sound: at 1080 across, a
   * cell is a third of a degree -- about 37 km -- so a point sample loses
   * every island narrower than that, which is most of the ones worth sailing
   * to. The Aegean, the Leewards, the Tuamotus and Hawaii all disappear from
   * a mid-cell map, and they are exactly what a world map is looked at for.
   * The price is a coastline a cell wider than the real one, which at this
   * scale is under a pixel of what is already a pixel-wide line.
   *
   * Built by walking the source grid once and marking, not by asking this
   * class a question per output cell. The reduction is 14.6 million array
   * reads either way, but as an elevation query per source sample it would be
   * bilinear interpolation of four neighbours for each -- and the answer here
   * is about a stored sample rather than about a point between them.
   *
   * The rows and columns are resolved through `mapProject` once each rather
   * than by the ratio of the two grid sizes. A ratio looks equivalent and is
   * not: the samples sit half a *source* step in from their block's edge --
   * see `elevationAt`, and the review that found the whole planet 2.8 km
   * north-east of itself for exactly this reason -- so a map built on the
   * ratio would carry that offset as a shift nothing in the picture reveals.
   */
  landMask(width: number, height: number): Uint8Array {
    const mask = new Uint8Array(width * height);
    const { width: sw, height: sh, arcMinutes } = this.grid;
    const step = arcMinutes / 60;
    const half = SOURCE_STEP / 2;

    const col = new Int32Array(sw);
    for (let gx = 0; gx < sw; gx++) {
      const { x } = mapProject({ lat: 0, lon: -180 + half + gx * step }, width, height);
      col[gx] = Math.min(width - 1, Math.max(0, Math.floor(x)));
    }
    const row = new Int32Array(sh);
    for (let gy = 0; gy < sh; gy++) {
      const { y } = mapProject({ lat: 90 - half - gy * step, lon: 0 }, width, height);
      row[gy] = Math.min(height - 1, Math.max(0, Math.floor(y)));
    }

    const s = this.samples;
    for (let gy = 0; gy < sh; gy++) {
      const src = gy * sw;
      const out = row[gy] * width;
      for (let gx = 0; gx < sw; gx++) {
        if (s[src + gx] > 0) mask[out + col[gx]] = 255;
      }
    }
    return mask;
  }

  /**
   * A signed distance field for one window's worth of sea, in metres:
   * positive inland, negative afloat.
   *
   * This is the number the coast generator is built around -- it makes a
   * beach, a shelf, a ridge and an island field out of exactly this one
   * input -- so conditioning the generator on the real Earth is a matter of
   * handing it this instead of its own straight line.
   *
   * Built as a *patch* rather than answered per sample, and that is a
   * measured decision: a per-sample ring search costs about 13 microseconds,
   * which is nine seconds for the 640,000 samples of one window. A patch at
   * kilometre spacing over the window and its margin is ten thousand cheap
   * elevation reads and a two-pass chamfer -- the same transform
   * RegionTerrain already runs over its own raster -- and every sample after
   * that is one bilinear lookup. Nothing is lost by the coarse spacing: the
   * source grid has no feature finer than seven kilometres, and everything
   * below that is the generator's to invent.
   *
   * The margin is what makes the far field honest. A window in mid-ocean
   * has no shore in it at all, and a patch that stopped at the window edge
   * would have to guess; carrying it `MARGIN` beyond means the answer is
   * either a real distance or an honest saturation.
   */
  shorePatch(anchor: LatLon, halfSpan: number, spacing = 1000): ShorePatch {
    const half = halfSpan + SHORE_MARGIN;
    const n = Math.max(3, Math.ceil((half * 2) / spacing) + 1);
    const land = new Uint8Array(n * n);
    // The same read, kept rather than thrown away: `elevationAt` has already
    // been called for every cell, and how deep the water is out here is the
    // other half of what it answers. Building a second patch for it would be
    // ten thousand more reads of the same raster.
    const deep = new Float32Array(n * n);
    for (let row = 0; row < n; row++) {
      // Row 0 is the north edge, as everywhere else in this project.
      const y = half - (row / (n - 1)) * half * 2;
      for (let col = 0; col < n; col++) {
        const x = -half + (col / (n - 1)) * half * 2;
        const metres = this.elevationAt(toLatLon(anchor, x, y));
        land[row * n + col] = metres > 0 ? 1 : 0;
        deep[row * n + col] = Math.max(0, -metres);
      }
    }
    return new ShorePatch(land, deep, n, (half * 2) / (n - 1), half);
  }

  /**
   * The coarse shoreline distance at one place, for a caller that wants a
   * single answer rather than a window: the anchorage judge, a chart label,
   * a test. Built on a one-off patch, so it agrees exactly with the terrain
   * rather than being a second implementation of the same idea.
   */
  shoreDistance(place: LatLon, halfSpan = 2000): number {
    return this.shorePatch(place, halfSpan).at(0, 0);
  }
}

/**
 * m the shore patch reaches beyond the window it was asked for. Two coarse
 * cells past the deepest thing the generator does with the number: the shelf
 * bottoms out at a few kilometres offshore and the outer islands at sixteen,
 * so twenty-five is past every question that can be asked of it.
 */
const SHORE_MARGIN = 25_000;

/** A window's signed distance to the coarse coastline; see `Earth.shorePatch`. */
export class ShorePatch {
  private readonly field: Float32Array;

  constructor(
    land: Uint8Array,
    private readonly deep: Float32Array,
    private readonly n: number,
    private readonly spacing: number,
    private readonly half: number,
  ) {
    // Signed chamfer, exactly as RegionTerrain builds its own: once with the
    // sea as the source and once with the land, subtracted. One-sided would
    // report zero everywhere inland and give the beach nothing to slope
    // against.
    const toLand = chamfer(land, n, 1);
    const toSea = chamfer(land, n, 0);
    this.field = new Float32Array(n * n);
    // Saturated at the patch's own reach. A window with no land in it at all
    // -- mid-ocean, which is most of the planet -- leaves the chamfer at its
    // sentinel, and multiplying that by the spacing handed the generator a
    // shoreline 10^12 m away. "At least this far" is the honest answer and
    // the only one this patch can support.
    const limit = half;
    for (let i = 0; i < this.field.length; i++) {
      // Half a *step* off, not half a cell, and the difference shows at a
      // corner. A chamfer gives the nearest opposite cell in its own units:
      // one across an edge, root two across a diagonal. The waterline runs
      // halfway along whichever of those it was, so the correction is half
      // the step that produced the distance -- taking a flat 0.5 off a
      // diagonal left the shore 354 m out at a corner, which a review found
      // with a three-cell test mask. The fractional part carries the step:
      // an exact integer came across edges, anything else across at least
      // one diagonal.
      const raw = land[i] ? toSea[i] : toLand[i];
      const diagonal = Math.abs(raw - Math.round(raw)) > 1e-6;
      const cells = raw - (diagonal ? Math.SQRT1_2 : 0.5);
      const metres = Math.min(Math.max(0, cells) * spacing, limit);
      this.field[i] = land[i] ? metres : -metres;
    }
  }

  /**
   * How deep the ocean is here, in metres, bilinear and never negative.
   *
   * The coarse grid's own bathymetry, straight: it is far too blunt for a
   * sounding near a coast -- seven kilometres a cell -- but out where the
   * generator has nothing else to go on it is the difference between the
   * abyssal Pacific and a 42-metre shelf. Near the shore the generator's own
   * beach and slope decide, and this only sets what they ramp down to.
   */
  floor(x: number, y: number): number {
    return this.sample(this.deep, x, y);
  }

  /** Signed metres at a plane position, bilinear. Positive is inland. */
  at(x: number, y: number): number {
    return this.sample(this.field, x, y);
  }

  /** One bilinear read, shared so the two fields cannot drift apart. */
  private sample(f: Float32Array, x: number, y: number): number {
    const gx = (x + this.half) / this.spacing;
    const gy = (this.half - y) / this.spacing;
    const c = (i: number) => (i < 0 ? 0 : i >= this.n - 1 ? this.n - 2 : i);
    const x0 = c(Math.floor(gx));
    const y0 = c(Math.floor(gy));
    const fx = Math.max(0, Math.min(1, gx - x0));
    const fy = Math.max(0, Math.min(1, gy - y0));
    const a = f[y0 * this.n + x0];
    const b = f[y0 * this.n + x0 + 1];
    const d = f[(y0 + 1) * this.n + x0];
    const e = f[(y0 + 1) * this.n + x0 + 1];
    return a + (b - a) * fx + (d - a) * fy + (a - b - d + e) * fx * fy;
  }
}

/** Cells to the nearest cell of the target kind, by two-pass chamfer. */
function chamfer(mask: Uint8Array, n: number, target: number): Float32Array {
  const D_ORTH = 1;
  const D_DIAG = Math.SQRT2;
  const BIG = 1e9;
  const d = new Float32Array(n * n);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] === target ? 0 : BIG;
  const relax = (i: number, from: number, cost: number) => {
    const v = d[from] + cost;
    if (v < d[i]) d[i] = v;
  };
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      if (d[i] === 0) continue;
      if (col > 0) relax(i, i - 1, D_ORTH);
      if (row > 0) {
        relax(i, i - n, D_ORTH);
        if (col > 0) relax(i, i - n - 1, D_DIAG);
        if (col < n - 1) relax(i, i - n + 1, D_DIAG);
      }
    }
  }
  for (let row = n - 1; row >= 0; row--) {
    for (let col = n - 1; col >= 0; col--) {
      const i = row * n + col;
      if (d[i] === 0) continue;
      if (col < n - 1) relax(i, i + 1, D_ORTH);
      if (row < n - 1) {
        relax(i, i + n, D_ORTH);
        if (col > 0) relax(i, i + n - 1, D_DIAG);
        if (col < n - 1) relax(i, i + n + 1, D_DIAG);
      }
    }
  }
  return d;
}
