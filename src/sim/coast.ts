import { fbm2 } from './noise';
import { rng } from './rng';
import { TAU, clamp, smoothstep } from './math';
import { HeightField } from './heightfield';
import type { Region } from './regions';

/**
 * A procedurally generated coast: a mainland with bays and headlands, offshore
 * islets, and open water — built as a heightfield and fed through the same
 * `RegionTerrain` pipeline the surveyed regions use.
 *
 * The point is a kind of terrain the island field cannot make. Its islands are
 * unions of convex circles capped at sixteen shader slots, so nothing it
 * produces can be *followed*: there is no coastline running past the horizon,
 * no bay to stand into, no headland to weather. All of that machinery already
 * exists for the surveyed regions — shelter sweep, land meshes, the water
 * shader's field texture, grounding, the gulls' bearing-to-shore — and none of
 * it knows or cares whether the `Int16Array` underneath came from NOAA or from
 * noise. This file is the noise.
 *
 * Everything here is a pure function of the seed *and of world position* —
 * same seed, same coast, exactly, the property the whole world already keeps.
 * The second half of that is what makes the coast endless: the 20 km field is
 * a window, not the world, and the engine re-bakes it about the boat as she
 * sails (see `fillCoastRows` and `snapCoastOrigin`), every window agreeing
 * exactly with every other wherever they overlap.
 */

/** The one id the engine recognises as "generate, don't fetch". */
export const COAST_ID = 'coast';

/** What the logbook calls a passage sailed along one. */
export const COAST_NAME = 'Uncharted coast';

/**
 * The same grid the surveyed regions use: 20 km square at 25 m, decimetres in
 * an int16. Not a coincidence — the view's field texture and mesh tiling are
 * sized against this, and a generated coast should exercise the identical
 * path, not a near-identical one.
 */
const GRID = { width: 800, height: 800, cell: 25, unit: 0.1 } as const;

/**
 * The Region record a generated coast sails under.
 *
 * Most of a `Region` is provenance — where on Earth, who surveyed it, what the
 * licence obliges — and a generated coast has honest answers for none of that,
 * so the fields say so rather than inventing a place. `centre` and `utmZone`
 * are zeroed: they are display metadata for real places and nothing reads them
 * for this one. `conditions` are neutral and deliberately unreachable — the
 * engine looks conditions up through `regionById`, which does not know this
 * id, so a generated coast keeps the player's own wind and tide sliders, like
 * the open ocean it replaces and unlike a surveyed place, which brings its
 * own weather because the land was laid out around it.
 */
export function coastRegion(seed: number): Region {
  return {
    id: COAST_ID,
    name: COAST_NAME,
    area: 'Nowhere on Earth',
    brief: 'A mainland drawn from this seed: bays, headlands and islets no chart has.',
    centre: { lat: 0, lon: 0 },
    utmZone: 0,
    grid: GRID,
    // Never fetched: the engine generates this region's samples instead. Empty
    // rather than a fake path, so a loader handed it by mistake fails loudly.
    raster: '',
    source: `Procedurally generated, seed ${seed}`,
    licence: '',
    conditions: {
      windTwd: 0,
      windKnots: 12,
      gustiness: 0.45,
      seaScale: 1,
      setDeg: 90,
      driftKnots: 0,
      fullDepth: 25,
      startHour: 9,
    },
  };
}

// --- The shape of the place -------------------------------------------------

/**
 * m, how far offshore of the origin the base shoreline runs.
 *
 * Chosen against the haze, and retuned after looking: at the first value of
 * 5600 the spawn was out of sight of everything -- clear-weather visibility
 * tops out at 2.6 km, so a "coastal" world opened indistinguishable from the
 * open ocean. At 3000, less the swing below, the shore runs from about a
 * kilometre off at its boldest headland to five at the back of a deep bay:
 * the boat opens in the coastal lane, with the mainland coming up out of the
 * haze on the first tack toward it.
 */
const SHORE_DISTANCE = 3000;
/** m, how far the big bays and headlands displace that line either way. */
const SWING = 1200;
/** m, alongshore wavelength of those bays: a couple per map edge. */
const SWING_SCALE = 5200;
/** m, the domain warp that makes the waterline crinkle at every scale. */
const WARP = 800;
const WARP_SCALE = 2600;
/** Beyond this far inland the ground stops caring about the shore, m. */
const RAMP = 2500;
/** m, the tallest ground; well under the int16 ceiling of 3276 m. */
const PEAK = 110;
/** m, the deepest water; matches the open ocean the region fades into. */
const FLOOR = 42;
/**
 * Offshore islets: where a second noise field pokes above this threshold,
 * within a band off the coast, land rises out of open water.
 */
const ISLET_SCALE = 1400;
const ISLET_THRESHOLD = 0.7;
/** m, the band off the shoreline where islets may stand. */
const ISLET_BAND = 3800;

/**
 * The spawn clearing. `placeAtStart` puts the boat 90 m from the origin, and
 * Newport's own siting note records what happens when that is not respected:
 * centred 800 m from where it is now, she went to sea on a two-metre shoal.
 * Within `CLEAR_R` of the origin the water is forced at least `CLEAR_DEPTH`
 * deep, fading out by `CLEAR_FADE` — the same bargain the island field's
 * `keepClear` strikes.
 *
 * The clearing can shave a headland. The swing carries the shoreline up to
 * 1200 m and the warp's projection up to another ~1130, so the displaced
 * waterline can in principle come within ~670 m of the origin — inside the
 * clearing's 900 m edge — and a review found seed 546 standing dry ground a
 * few metres past it. Where that happens the clearing planes the tip of the
 * headland down into a shoal, smoothly, and that is the accepted price of a
 * spawn that is always afloat: the alternative was the bug this guard exists
 * for, a session that opens aground.
 */
const CLEAR_R = 250;
const CLEAR_FADE = 650;
const CLEAR_DEPTH = 15;

/**
 * Ground elevation for one point of a coast, m — positive is land.
 *
 * The construction: a straight base shoreline `SHORE_DISTANCE` from the
 * origin, on a side drawn from the seed; a low-frequency alongshore swing that
 * turns it into bays and headlands; a two-axis domain warp that crinkles it at
 * smaller scales; then elevation as a ramp through that displaced line — up to
 * `PEAK` inland, down to `FLOOR` offshore. Islets are a separate noise field
 * allowed to rise above water only in a band off the coast, so the open sea
 * stays open and the coastal lane is the busy part, which is where a coastal
 * cruise actually happens.
 */
function elevation(
  x: number,
  y: number,
  seed: number,
  inlandX: number,
  inlandY: number,
): number {
  // Crinkle the sample point before anything reads it, so every contour the
  // shore and the shelf draw inherits the same wrinkles.
  const wx = x + (fbm2(x / WARP_SCALE, y / WARP_SCALE, seed + 11, 3) * 2 - 1) * WARP;
  const wy = y + (fbm2(x / WARP_SCALE, y / WARP_SCALE, seed + 23, 3) * 2 - 1) * WARP;

  // Signed distance to the displaced shoreline: positive inland.
  const along = wx * inlandY - wy * inlandX;
  const swing = (fbm2(along / SWING_SCALE, 0.37, seed + 5, 4) * 2 - 1) * SWING;
  const s = wx * inlandX + wy * inlandY - SHORE_DISTANCE + swing;

  // A continuous profile through the waterline, assembled from three terms
  // that are each continuous, so the shore is a beach and not a wall. The
  // first version branched on the sign of `s` with the land side starting at
  // +2 m and the sea side at -3, which put a five-metre cliff along every
  // metre of coast -- found by a review, and rendered faithfully by the land
  // mesh, since nothing downstream smooths elevation. The beach term crosses
  // zero exactly at s = 0 and carries the profile to +/-3 m over the first
  // 80 m; the ridge and the shelf then take over beyond it.
  const beach = clamp(s / 80, -1, 1) * 3;
  const rise = clamp((s - 80) / RAMP, 0, 1);
  const texture = 0.55 + 0.45 * fbm2(wx / 1900, wy / 1900, seed + 41, 3);
  const shelf = (FLOOR - 3) * clamp((-s - 80) / 3000, 0, 1);
  let ground = beach + PEAK * rise * texture - shelf;

  // Islets stand only in the coastal band, and never in the spawn clearing.
  const band = smoothstep(ISLET_BAND, ISLET_BAND * 0.25, -s);
  if (s < 0 && band > 0) {
    const islet = fbm2(wx / ISLET_SCALE, wy / ISLET_SCALE, seed + 57, 4);
    if (islet > ISLET_THRESHOLD) {
      const top = ((islet - ISLET_THRESHOLD) / (1 - ISLET_THRESHOLD)) * 26 * band;
      ground = Math.max(ground, top - 4);
    }
  }

  // The clearing outranks everything: whatever stood here, the boat spawns in
  // water she can sail out of.
  const r = Math.hypot(x, y);
  const clear = smoothstep(CLEAR_R + CLEAR_FADE, CLEAR_R, r);
  if (clear > 0) ground = Math.min(ground, -CLEAR_DEPTH * clear + -3 * (1 - clear));

  return ground;
}

/**
 * Pin a window centre to the sample lattice.
 *
 * The whole reason two windows can agree exactly where they overlap is that
 * their samples land on the *same* world lattice: with the centre a multiple
 * of the cell, every sample sits at (k + ½)·cell for integer k whatever the
 * window, so the same world point gets the same double fed to the same noise.
 * An unsnapped centre would shear the lattice and the seam would show as a
 * 25 m jog in every contour the two windows share.
 */
export function snapCoastOrigin(p: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.round(p.x / GRID.cell) * GRID.cell,
    y: Math.round(p.y / GRID.cell) * GRID.cell,
  };
}

/**
 * Fill rows [row0, row1) of a coast window centred at `origin`, row-major from
 * the north-west corner — the exact layout `HeightField` reads, verified
 * against its own mapping: sample (row, col) sits at
 * x = origin.x − halfWidth + (col + ½)·cell, y = origin.y + halfHeight −
 * (row + ½)·cell.
 *
 * A row range rather than the whole array, because the engine re-bakes the
 * window mid-session as the boat sails along the shore, and the full 800 rows
 * are a measured 130 ms — sixteen dropped frames if paid at once. Spread a few
 * rows per step, generation disappears into the frame budget; this function is
 * also the whole of `coastSamples`, so the incremental path and the all-at-once
 * path cannot drift apart.
 *
 * `origin` must come through `snapCoastOrigin`; see there for why.
 */
export function fillCoastRows(
  samples: Int16Array,
  seed: number,
  origin: { x: number; y: number },
  row0: number,
  row1: number,
): void {
  const { width, cell, unit } = GRID;
  const halfWidth = (width * cell) / 2;
  const halfHeight = (GRID.height * cell) / 2;

  // Which side the mainland is on, drawn once from the seed. A full circle, so
  // two coasts differ in aspect as well as in outline. Per call rather than
  // cached: it is two numbers from three rng draws, and a cache would be state
  // this file otherwise does not have.
  const rand = rng(seed ^ 0xc0a57);
  const theta = rand() * TAU;
  const inlandX = Math.sin(theta);
  const inlandY = Math.cos(theta);

  for (let row = row0; row < row1; row++) {
    const y = origin.y + halfHeight - (row + 0.5) * cell;
    for (let col = 0; col < width; col++) {
      const x = origin.x - halfWidth + (col + 0.5) * cell;
      const ground = elevation(x, y, seed, inlandX, inlandY);
      samples[row * width + col] = clamp(Math.round(ground / unit), -32768, 32767);
    }
  }
}

/** The samples for a whole coast window. */
export function coastSamples(seed: number, origin = { x: 0, y: 0 }): Int16Array {
  const samples = new Int16Array(GRID.width * GRID.height);
  fillCoastRows(samples, seed, snapCoastOrigin(origin), 0, GRID.height);
  return samples;
}

/** The whole thing, ready for `RegionTerrain`, windowed about `origin`. */
export function coastHeightField(
  seed: number,
  origin = { x: 0, y: 0 },
): { region: Region; height: HeightField; origin: { x: number; y: number } } {
  const region = coastRegion(seed);
  const snapped = snapCoastOrigin(origin);
  return {
    region,
    height: new HeightField(coastSamples(seed, snapped), region, snapped),
    origin: snapped,
  };
}
