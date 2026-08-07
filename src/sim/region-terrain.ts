import type { HeightField } from './heightfield';
import { ShelterField } from './shelter';
import type { Region } from './regions';
import { compassAngle } from './math';

/**
 * A surveyed region, answering the questions the rest of the simulator asks of
 * ground.
 *
 * `Terrain` answers them from a list of circles; this answers them from a
 * raster and a swept shelter field. Everything upstream -- the wind, the tide,
 * the anchorage judge, the boat's depth under the keel -- asks through
 * `TerrainQuery` and does not know or care which it is holding.
 *
 * ## What is precomputed, and why
 *
 * Distance to the shore is the one query a raster cannot answer cheaply on
 * demand: there is no centre to measure from, and searching outward per call
 * would be a spiral scan at 120 Hz. So it is built once, as a signed distance
 * field, by a chamfer transform -- two passes over the grid, forward and
 * backward, each cell taking the best of its already-settled neighbours. The
 * terrain cannot change within a session, so once is all it needs.
 *
 * That field then answers the *bearing* to the shore as well, from its own
 * gradient: distance falls fastest straight at the beach. Which is a better
 * answer than the circles give -- `nearestIsland` returns a centre, so a gull
 * placed by it sits over the middle of the island rather than over the piece of
 * shore you are actually closing with.
 */

/**
 * How far outside the surveyed square the coast fades into open sea, m.
 *
 * Exported because the water shader has to fade over exactly the same distance.
 * Everything inside the square is shared as data, but the band *outside* it has
 * no texels to carry it, so the fade is the one piece of this model that both
 * sides compute -- and therefore the one piece that can diverge.
 */
export const EDGE_FADE = 800;
/** What the sea becomes out there: deep, unsheltered, and blowing full. */
const OPEN_DEPTH = 60;

/**
 * Chamfer weights for the distance transform.
 *
 * 1 straight and √2 diagonal is the honest metric on a square grid. The cheaper
 * 1/1 city-block variant would make every distance-to-shore reading up to 41%
 * long on a diagonal, and the gull that reading places would drift off the
 * beach by the same amount.
 */
const D_ORTH = 1;
const D_DIAG = Math.SQRT2;

export class RegionTerrain {
  readonly region: Region;
  readonly height: HeightField;
  readonly shelter: ShelterField;

  /** Metres to the waterline: positive afloat, negative inland. */
  private readonly shoreDistance: Float32Array;
  /**
   * Whether there is a waterline at all -- which needs land *and* sea.
   *
   * Both halves matter, and the first attempt at this only had one. Asking
   * whether any distance came out negative catches a region of nothing but
   * water, whose distances are all the positive sentinel; it is fooled by a
   * region of nothing but land, whose distances are all the *negative* one, and
   * happily reports a shore twenty-five thousand kilometres inland.
   */
  private readonly hasShore: boolean;

  private readonly w: number;
  private readonly h: number;
  private readonly cell: number;
  private readonly halfWidth: number;
  private readonly halfHeight: number;

  constructor(region: Region, height: HeightField) {
    this.region = region;
    this.height = height;
    const { width, height: rows, cell } = region.grid;
    this.w = width;
    this.h = rows;
    this.cell = cell;
    this.halfWidth = height.halfWidth;
    this.halfHeight = height.halfHeight;
    this.shelter = new ShelterField(height, width, rows, cell);
    // A region with no waterline leaves the chamfer transform at its sentinel
    // everywhere, which would report a shore tens of thousands of kilometres
    // off rather than none at all. `Terrain` with no islands says Infinity and
    // the callers are written for it -- the gulls fall silent -- so a region
    // with nothing to be near has to say the same thing, rather than a huge
    // number that merely behaves like it most of the time.
    const shore = { land: false, sea: false };
    this.shoreDistance = this.buildShoreDistance(shore);
    this.hasShore = shore.land && shore.sea;
  }

  /**
   * Signed distance to the waterline, by two-pass chamfer.
   *
   * Run twice and subtracted: once with the sea as the source and once with the
   * land, which is what makes it *signed* and so usable on both sides of the
   * beach. A one-sided transform would report zero everywhere inland and give
   * the gradient nothing to point at.
   */
  private buildShoreDistance(found: { land: boolean; sea: boolean }): Float32Array {
    const { w, h, cell } = this;
    const land = new Uint8Array(w * h);
    for (let row = 0; row < h; row++) {
      const y = this.halfHeight - (row + 0.5) * cell;
      for (let col = 0; col < w; col++) {
        const x = -this.halfWidth + (col + 0.5) * cell;
        const dry = this.height.elevationAt(x, y) > 0;
        land[row * w + col] = dry ? 1 : 0;
        if (dry) found.land = true;
        else found.sea = true;
      }
    }

    const toLand = this.chamfer(land, 1);
    const toSea = this.chamfer(land, 0);
    const out = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) {
      // Positive afloat, negative inland, and continuous through the beach
      // because each side measures to the other.
      out[i] = land[i] ? -toSea[i] * cell : toLand[i] * cell;
    }
    return out;
  }

  /** Cells to the nearest cell whose mask value is `target`. */
  private chamfer(mask: Uint8Array, target: number): Float32Array {
    const { w, h } = this;
    const d = new Float32Array(w * h);
    const BIG = 1e9;
    for (let i = 0; i < d.length; i++) d[i] = mask[i] === target ? 0 : BIG;

    const relax = (i: number, from: number, cost: number) => {
      const v = d[from] + cost;
      if (v < d[i]) d[i] = v;
    };

    // Forward: north-west to south-east, reading the neighbours already settled.
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const i = row * w + col;
        if (d[i] === 0) continue;
        if (col > 0) relax(i, i - 1, D_ORTH);
        if (row > 0) {
          relax(i, i - w, D_ORTH);
          if (col > 0) relax(i, i - w - 1, D_DIAG);
          if (col < w - 1) relax(i, i - w + 1, D_DIAG);
        }
      }
    }
    // Backward: south-east to north-west, which is what makes the two passes
    // together an exact chamfer rather than a one-directional smear.
    for (let row = h - 1; row >= 0; row--) {
      for (let col = w - 1; col >= 0; col--) {
        const i = row * w + col;
        if (d[i] === 0) continue;
        if (col < w - 1) relax(i, i + 1, D_ORTH);
        if (row < h - 1) {
          relax(i, i + w, D_ORTH);
          if (col > 0) relax(i, i + w - 1, D_DIAG);
          if (col < w - 1) relax(i, i + w + 1, D_DIAG);
        }
      }
    }
    return d;
  }

  /**
   * How far out of the surveyed square this point is, 0..1.
   *
   * Everything below fades to open sea across this rather than stopping dead.
   * docs/real-map.md weighs an invisible wall against a fade and picks the fade,
   * on the grounds that sailing out of the surveyed area into open water is what
   * actually happens -- and a wall in a game about going somewhere is the worst
   * possible answer to reaching the edge of the chart.
   */
  private beyond(x: number, y: number): number {
    const d = this.height.distanceOutside(x, y);
    return d <= 0 ? 0 : Math.min(1, d / EDGE_FADE);
  }

  elevationAt(x: number, y: number): number {
    const out = this.beyond(x, y);
    const inside = this.height.elevationAt(x, y);
    return out === 0 ? inside : inside * (1 - out) - OPEN_DEPTH * out;
  }

  depthAt(x: number, y: number): number {
    return -this.elevationAt(x, y);
  }

  isAground(x: number, y: number, draft: number): boolean {
    return this.depthAt(x, y) < draft;
  }

  windExposure(x: number, y: number, twd: number): number {
    // Rebuilt here rather than on a schedule, so that whoever asks first in a
    // frame pays for it and nobody has to remember to call an update. It is a
    // no-op unless the mean wind has moved a couple of degrees, which is rare:
    // `baseTwd` follows the weather and the player, not the gusts.
    this.shelter.update(twd);
    const out = this.beyond(x, y);
    if (out >= 1) return 1;
    const inside = this.shelter.windExposureAt(x, y);
    return inside + (1 - inside) * out;
  }

  waveShelter(x: number, y: number, twd: number): number {
    this.shelter.update(twd);
    const out = this.beyond(x, y);
    if (out >= 1) return 1;
    const inside = this.shelter.waveShelterAt(x, y);
    return inside + (1 - inside) * out;
  }

  /** Metres to the waterline, positive offshore. */
  distanceToShore(x: number, y: number): number {
    if (!this.hasShore || !this.height.contains(x, y)) {
      // Off the chart there is no shore to be near, and saying "very far" is
      // both true and what the callers want -- the gulls fall silent.
      return Infinity;
    }
    return this.sampleShore(x, y);
  }

  /**
   * Which way the nearest shore lies, as a compass bearing, or null in water
   * with no shore in reach.
   *
   * From the gradient of the distance field: it falls fastest straight at the
   * beach, so the downhill direction *is* the bearing. Sampled a cell either
   * side rather than differenced on the raw grid, so the answer is smooth as
   * the boat moves instead of snapping between cells.
   */
  bearingToShore(x: number, y: number): number | null {
    if (!this.hasShore || !this.height.contains(x, y)) return null;
    const s = this.cell;
    const gx = this.sampleShore(x + s, y) - this.sampleShore(x - s, y);
    const gy = this.sampleShore(x, y + s) - this.sampleShore(x, y - s);
    if (gx === 0 && gy === 0) return null;
    // Downhill, hence the negation.
    return compassAngle({ x: -gx, y: -gy });
  }

  private sampleShore(x: number, y: number): number {
    const gx = (x + this.halfWidth) / this.cell - 0.5;
    const gy = (this.halfHeight - y) / this.cell - 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const cl = (i: number, n: number) => (i < 0 ? 0 : i >= n ? n - 1 : i);
    const cx = cl(x0, this.w);
    const cy = cl(y0, this.h);
    const x1 = cl(x0 + 1, this.w);
    const y1 = cl(y0 + 1, this.h);
    const d = this.shoreDistance;
    const a = d[cy * this.w + cx];
    const b = d[cy * this.w + x1];
    const c = d[y1 * this.w + cx];
    const e = d[y1 * this.w + x1];
    const top = a + (b - a) * fx;
    const bottom = c + (e - c) * fx;
    return top + (bottom - top) * fy;
  }
}
