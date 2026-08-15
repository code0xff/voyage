import type { HeightField } from './heightfield';
import { compassVec } from './math';

/**
 * Fetch, and what land does to the wind, as a field rather than as a formula.
 *
 * ## Why this replaces the wake models rather than generalising them
 *
 * `Terrain.waveShelter` and `Terrain.windExposure` model a *circle* with a
 * spreading wake behind it, and the water shader carries a hand-written GLSL
 * copy of the first one. That copy is the project's most-watched hazard --
 * AGENTS.md names it, and a Codex review has already caught the two diverging.
 *
 * Neither model survives contact with a coastline. "Distance downwind of the
 * island centre" and "lateral offset from the wake axis" are questions about a
 * disc; a shore has no centre and no axis, and the landmass grouping that lets
 * a run of circles shelter once, together, exists only to paper over the fact
 * that a coast was never a circle.
 *
 * For a region -- fixed, finite, known in advance -- there is a better answer
 * that is also a simpler one. March the grid once per change of wind direction
 * and store what land actually does at every point. The physics reads the
 * field; the renderer reads the same field as a texture. There is no second
 * implementation to keep in step, because there is no implementation to copy --
 * only data.
 *
 * ## What is actually computed
 *
 * **Fetch**, the distance upwind over open water. It is the honest physical
 * quantity behind wave shelter -- waves need room to build, which is why the
 * lee of a headland is flat far further downwind than its wind shadow reaches
 * -- and on a grid it is a running sum reset to zero by every piece of land.
 *
 * **Wind deficit**, how much breeze the land upwind has taken. Land sets it to
 * its maximum and records how tall the land was; open water lets it decay with
 * distance, at a rate set by that height. This is the same rule the circle
 * model used, freed of the circle: shelter persists for roughly ten to fifteen
 * times the height of the obstacle.
 *
 * Both fall out of one sweep. Ordering the cells so that the upwind neighbour
 * is always already computed makes this O(cells) rather than a march per cell:
 * one pass over 640,000 cells instead of 640,000 marches of four hundred steps.
 *
 * ## What it still does not model
 *
 * Wake spreading, and refraction around a headland. A shadow here is cast
 * strictly downwind, so a lee has the shape of the land that casts it rather
 * than widening as it travels. AGENTS.md section 9 already records refraction
 * as deliberately absent and says why -- parking in a lee is the dominant
 * effect by a wide margin. Spreading joins it on the same reasoning, and with
 * a real coast it matters less than it did for a 200 m disc: the sheltered
 * water behind Angel Island is shaped by Angel Island, not by how a wake grows.
 */

/**
 * How far upwind fetch is worth counting, m.
 *
 * Beyond the region there is no data, so there is nothing to count. Capping at
 * the diagonal means a point can reach full fetch from anywhere inside the
 * square and the cap never becomes the thing being measured.
 */
const MAX_FETCH = 30000;

/**
 * Fetch at which the sea is as big as the wave model makes it, m.
 *
 * A tuning dial, and the one number here that is not read off the terrain, so
 * it is worth being plain about what it is and is not.
 *
 * The *shape* is physical: fetch-limited seas grow as the square root of fetch,
 * which is why doubling the room to build does not double the waves. The
 * *reference* is a calibration. `waveHeightFromWind` is already described as
 * fetch-limited coastal rather than open-ocean -- it is tuned so the boat meets
 * the right sea at the default settings -- so this field cannot also claim to
 * set absolute wave height without counting fetch twice. What it expresses is
 * shelter *relative to open water in this region*: 8 km of clear water upwind
 * reads as unsheltered, which across a 20 km bay puts the middle at its full
 * sea and the lee of a headland well down.
 *
 * An absolutely-calibrated fetch-limited sea is a real and worthwhile change --
 * it would let a region state its own sea state instead of inheriting a slider
 * -- but it means retuning the wave model against the polar, which is its own
 * piece of work and not one to slip in behind a terrain change.
 */
export const REFERENCE_FETCH = 8000;

/** The most wind land can take, matching what the circle model took at its worst. */
const MAX_DEFICIT = 0.85;
/** Shelter reaches this many times the height of the land that casts it. */
const REACH_PER_METRE = 13;
/** Treated as this tall at minimum, so a low sandspit still casts a short lee. */
const MIN_OBSTACLE = 8;
/** Never quite becalmed, and never quite flat: the floors the circle model used. */
const MIN_EXPOSURE = 0.08;
const MIN_SHELTER = 0.05;

/**
 * How far the wind must shift before the field is worth rebuilding, rad.
 *
 * The sweep costs a few milliseconds, so it cannot run per frame, and it does
 * not need to: two degrees moves a shadow by about 2% of its length, which is
 * 12 m at the end of a 600 m lee. Well under a boat length, and far under the
 * accuracy of anything the field feeds.
 */
const REBUILD_STEP = (2 * Math.PI) / 180;

export class ShelterField {
  /** Metres of open water upwind, per cell. */
  readonly fetch: Float32Array;
  /** Wind taken by the land upwind, 0..MAX_DEFICIT, per cell. */
  readonly deficit: Float32Array;

  /** How far shelter carries from whatever cast it, m. Carried downwind by the sweep. */
  private readonly reach: Float32Array;
  /** Above water, per cell -- read once here rather than through elevationAt per sweep. */
  private readonly land: Uint8Array;
  /** Height of the ground, m, zero at sea. Sets how far its lee reaches. */
  private readonly height: Float32Array;

  private readonly w: number;
  private readonly h: number;
  private readonly cell: number;
  private readonly halfWidth: number;
  private readonly halfHeight: number;
  /** Where the field's centre sits in the world; see HeightField.originX. */
  private readonly originX: number;
  private readonly originY: number;

  /** The direction the field was last built for, or null before the first build. */
  private builtFor: number | null = null;

  constructor(field: HeightField, width: number, height: number, cell: number) {
    this.w = width;
    this.h = height;
    this.cell = cell;
    this.halfWidth = field.halfWidth;
    this.halfHeight = field.halfHeight;
    this.originX = field.originX;
    this.originY = field.originY;

    const n = width * height;
    this.fetch = new Float32Array(n);
    this.deficit = new Float32Array(n);
    this.reach = new Float32Array(n);
    this.land = new Uint8Array(n);
    this.height = new Float32Array(n);

    // The terrain is read once, here, and never again. It cannot change within
    // a session, and pulling it through elevationAt() on every sweep would put
    // a bilinear interpolation inside the hot loop to recover numbers that were
    // already exact at the cell centres.
    for (let row = 0; row < height; row++) {
      const y = this.originY + this.halfHeight - (row + 0.5) * cell;
      for (let col = 0; col < width; col++) {
        const x = this.originX - this.halfWidth + (col + 0.5) * cell;
        const e = field.elevationAt(x, y);
        const i = row * width + col;
        this.land[i] = e > 0 ? 1 : 0;
        this.height[i] = e > 0 ? e : 0;
      }
    }
  }

  /**
   * Rebuild for this wind direction if it has moved far enough to matter.
   *
   * @param twd the direction the wind blows *from*, rad
   * @returns whether the field was rebuilt, so a caller holding a texture knows
   *          whether it needs re-uploading
   */
  update(twd: number): boolean {
    if (this.builtFor !== null) {
      // Compared on the wrapped difference, or the field would rebuild every
      // frame while the wind hunted across north.
      let d = twd - this.builtFor;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) < REBUILD_STEP) return false;
    }
    this.build(twd);
    this.builtFor = twd;
    return true;
  }

  private build(twd: number): void {
    // The wind blows from twd, so it travels the other way.
    const from = compassVec(twd);
    // Grid axes: columns count east with world x, rows count *south*, so the
    // northward component of travel flips sign on the way in. Getting this
    // backwards puts every lee on the windward side of its own headland.
    const dCol = -from.x;
    const dRow = from.y;

    // Sweep along whichever axis the wind is more aligned with, so that one
    // step downwind is always one whole cell of the major axis and never less.
    // Sweeping the minor axis instead would step more than a cell at a time and
    // march straight over narrow land.
    const xMajor = Math.abs(dCol) >= Math.abs(dRow);
    const majorD = xMajor ? dCol : dRow;
    const minorD = xMajor ? dRow : dCol;
    const majorCount = xMajor ? this.w : this.h;
    const minorCount = xMajor ? this.h : this.w;

    const stepSign = majorD >= 0 ? 1 : -1;
    // Minor cells crossed per whole major cell, and the true distance that
    // covers -- which is longer than a cell on any diagonal, and is why fetch
    // does not come out short when the wind is off the axis.
    const slope = minorD / Math.abs(majorD);
    const stepLen = this.cell / Math.abs(majorD);

    const w = this.w;
    const idx = xMajor
      ? (major: number, minor: number) => minor * w + major
      : (major: number, minor: number) => major * w + minor;

    const start = stepSign > 0 ? 0 : majorCount - 1;
    const end = stepSign > 0 ? majorCount : -1;

    for (let major = start; major !== end; major += stepSign) {
      const first = major === start;
      for (let minor = 0; minor < minorCount; minor++) {
        const i = idx(major, minor);

        let upFetch: number;
        let upDeficit: number;
        let upReach: number;
        let upWasLand = false;

        if (first) {
          // The upwind edge of the data. What lies beyond it is decided by what
          // is *at* it: water at the boundary is taken to continue, which off
          // the Golden Gate is the Pacific and is simply true, and land at the
          // boundary starts the fetch at zero. Assuming open ocean everywhere
          // would give an easterly the whole bay to build in, with a continent
          // sitting upwind of it.
          upFetch = MAX_FETCH;
          upDeficit = 0;
          upReach = 0;
        } else {
          const upMajor = major - stepSign;
          const upMinorF = minor - slope;

          // Three taps across the wind, not one.
          //
          // A single tap makes every ray independent, and the field then shows
          // it: a pier one cell wide throws a hard shadow line three kilometres
          // downwind, and the whole picture reads as scan lines. Real wakes do
          // not do that, because turbulence mixes them sideways as they travel.
          //
          // Averaging the neighbours at every step *is* that mixing -- diffusion
          // is repeated local averaging, and applying it once per step compounds
          // into a wake whose width grows as the square root of distance, which
          // is what diffusion does. So the spread costs three reads instead of
          // one and comes out with the right shape, where a fixed blur applied
          // afterwards would have had a width chosen by hand and would still
          // have left a three-kilometre streak, only a softer one.
          const w0 = this.weights(upMajor, upMinorF - 1, minorCount, idx);
          const w1 = this.weights(upMajor, upMinorF, minorCount, idx);
          const w2 = this.weights(upMajor, upMinorF + 1, minorCount, idx);

          upFetch = 0.25 * this.tap(this.fetch, w0) + 0.5 * this.tap(this.fetch, w1) +
            0.25 * this.tap(this.fetch, w2);
          upDeficit = 0.25 * this.tap(this.deficit, w0) + 0.5 * this.tap(this.deficit, w1) +
            0.25 * this.tap(this.deficit, w2);
          // Reach is taken from directly upwind and is deliberately *not*
          // mixed, unlike the two quantities above.
          //
          // Fetch and deficit are amounts, and mixing amounts is what diffusion
          // is. Reach is not an amount, it is the decay length of whatever cast
          // this shadow -- a parameter, not a substance -- and averaging it
          // sideways lends it between wakes. That was a real leak: a 10 m islet
          // sitting beside the wake of a 100 m ridge picked up the ridge's
          // 1300 m reach from its neighbours and threw a lee an order of
          // magnitude too long, which is the very inheritance the landmass
          // reset above exists to prevent.
          upReach = this.tap(this.reach, w1);

          // Run continuity is judged on the centre tap alone: it asks whether
          // this cell's own ray is still crossing the same ground, which the
          // neighbours it is being mixed with cannot answer.
          //
          // Either bracketing cell being land counts as still on it. Erring
          // that way by one cell is harmless; erring the other way would break
          // the run at every diagonal step and hand each island's lee back to
          // its own shoreline.
          upWasLand = this.land[w1.a] === 1 || this.land[w1.b] === 1;
        }

        if (this.land[i]) {
          this.fetch[i] = 0;
          this.deficit[i] = MAX_DEFICIT;
          // The tallest ground the ray has crossed on *this* landmass, not the
          // cell it happens to be leaving over.
          //
          // This was wrong first time round and it is the failure a coastline
          // provokes that a circle never did. Ground is always lowest at the
          // water's edge, so a ray over Alcatraz crosses 39 m at the summit and
          // exits over a 2.9 m beach: keyed on the last cell, a 500 m lee came
          // out as 100 m, and every headland in the region was under-sheltered
          // in the same way. Reset on each new landmass rather than carried,
          // so a 10 m islet does not inherit a shadow from a hill 5 km upwind.
          const own = Math.max(this.height[i], MIN_OBSTACLE) * REACH_PER_METRE;
          this.reach[i] = upWasLand ? Math.max(own, upReach) : own;
          continue;
        }

        this.fetch[i] = Math.min(MAX_FETCH, upFetch + stepLen);
        // Exponential recovery, as the circle model had it, but keyed to the
        // land that actually cast this shadow rather than to a loop variable.
        this.deficit[i] =
          upDeficit > 0 ? upDeficit * Math.exp(-stepLen / Math.max(upReach, 1)) : 0;
        this.reach[i] = upReach;
      }
    }
  }

  private clampMinor(i: number, count: number): number {
    return i < 0 ? 0 : i >= count ? count - 1 : i;
  }

  /**
   * The two cells bracketing a fractional position on the upwind line, and the
   * weight between them.
   *
   * Worked out once per tap and reused for all three carried quantities: the
   * indices do not depend on which array is being read, and recomputing a floor
   * and two clamps three times over is the difference between this sweep being
   * cheap and being noticeable.
   */
  private weights(
    major: number,
    minorF: number,
    count: number,
    idx: (major: number, minor: number) => number,
  ): { a: number; b: number; f: number } {
    const m0 = Math.floor(minorF);
    return {
      a: idx(major, this.clampMinor(m0, count)),
      b: idx(major, this.clampMinor(m0 + 1, count)),
      f: minorF - m0,
    };
  }

  private tap(data: Float32Array, w: { a: number; b: number; f: number }): number {
    return data[w.a] + (data[w.b] - data[w.a]) * w.f;
  }

  /** Metres of open water upwind of this point. */
  fetchAt(x: number, y: number): number {
    return this.sample(this.fetch, x, y);
  }

  /**
   * Wave height multiplier, 0..1.
   *
   * Square root of fetch, which is how a fetch-limited sea grows -- doubling
   * the room does not double the waves.
   */
  waveShelterAt(x: number, y: number): number {
    return Math.max(MIN_SHELTER, Math.sqrt(this.shelterInputAt(x, y)));
  }

  /**
   * Fetch capped at the reference and scaled to 0..1, bilinear.
   *
   * The cap is applied to each of the four samples *before* they are mixed,
   * which is not the same as capping afterwards and is the whole reason this
   * exists as its own method.
   *
   * The water shader cannot interpolate the way the CPU does. It gets a texture
   * and the hardware mixes texels linearly, so whatever is stored is what gets
   * mixed. Storing shelter meant the GPU interpolated a square root while the
   * CPU took the square root of an interpolation -- different answers, because
   * the root is not linear. Measured across the bay it was worth 0.0006 on
   * average and mattered at 38 navigable points out of 636,006, all of them
   * within a cell of a beach; small, but it is exactly the disagreement
   * AGENTS.md says to hunt, and it costs nothing to not have.
   *
   * So this is the quantity that goes in the texture, and the shader takes the
   * root itself. Both sides now interpolate the same linear thing and apply the
   * same transform to the result.
   *
   * Capping before mixing is also what keeps the two identical: `sqrt(min(f,R)/R)`
   * and `min(1, sqrt(f/R))` agree for a single sample, but only the first
   * survives being averaged with a neighbour.
   *
   * The agreement is exact in the arithmetic and not quite exact on the wire,
   * because the texture is eight bits. What is left is quantisation alone,
   * bounded by `sqrt(1/255) - 0.05 = 0.0126` and worst at the waterline where
   * the root is steepest; measured over the bay it comes to 0.0136 at worst,
   * 0.0003 on average, and nowhere navigable exceeds 0.02. Sixteen bits would
   * remove it and is not worth two megabytes for a difference no one can see in
   * a wave height.
   */
  shelterInputAt(x: number, y: number): number {
    const gx = (x - this.originX + this.halfWidth) / this.cell - 0.5;
    const gy = (this.halfHeight - (y - this.originY)) / this.cell - 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const cx = this.clampMinor(x0, this.w);
    const cy = this.clampMinor(y0, this.h);
    const x1 = this.clampMinor(x0 + 1, this.w);
    const y1 = this.clampMinor(y0 + 1, this.h);
    const cap = (i: number) => Math.min(this.fetch[i], REFERENCE_FETCH) / REFERENCE_FETCH;
    const a = cap(cy * this.w + cx);
    const b = cap(cy * this.w + x1);
    const c = cap(y1 * this.w + cx);
    const d = cap(y1 * this.w + x1);
    const top = a + (b - a) * fx;
    const bottom = c + (d - c) * fx;
    return top + (bottom - top) * fy;
  }

  /** How much of the wind survives here, 0..1. */
  windExposureAt(x: number, y: number): number {
    return Math.max(MIN_EXPOSURE, 1 - this.sample(this.deficit, x, y));
  }

  /**
   * Bilinear, on the same grid geometry as `HeightField` and for the same
   * reason: sampled nearest, the edge of a wind shadow is a staircase 25 m
   * across, and the boat crossing it would feel the breeze arrive in steps.
   */
  private sample(data: Float32Array, x: number, y: number): number {
    const gx = (x - this.originX + this.halfWidth) / this.cell - 0.5;
    const gy = (this.halfHeight - (y - this.originY)) / this.cell - 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;

    const cx = this.clampMinor(x0, this.w);
    const cy = this.clampMinor(y0, this.h);
    const x1 = this.clampMinor(x0 + 1, this.w);
    const y1 = this.clampMinor(y0 + 1, this.h);

    const a = data[cy * this.w + cx];
    const b = data[cy * this.w + x1];
    const c = data[y1 * this.w + cx];
    const d = data[y1 * this.w + x1];
    const top = a + (b - a) * fx;
    const bottom = c + (d - c) * fx;
    return top + (bottom - top) * fy;
  }
}
