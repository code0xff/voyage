import { fbm2 } from './noise';
import { rng } from './rng';
import { TAU, clamp, smoothstep, type Vec2 } from './math';
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

/**
 * What the menu and the logbook call it.
 *
 * It was "Uncharted coast" while the shore was invented outright. It is the
 * real planet's coastline now, so the name says so -- a world called
 * uncharted, in a list beside six surveyed places, is where a player looks
 * last for the Earth.
 */
export const COAST_NAME = 'Open Earth';

/**
 * The same grid the surveyed regions use: 20 km square at 25 m, decimetres in
 * an int16. Not a coincidence — the view's field texture and mesh tiling are
 * sized against this, and a generated coast should exercise the identical
 * path, not a near-identical one.
 */
/*
 * `unit` is 0.2 m rather than the decimetre a surveyed region stores, because
 * an int16 of decimetres reaches 3,276 m and the real ocean floor is deeper
 * than that: the Pacific abyssal plain would have read as a plateau at the
 * clamp. Twenty centimetres is still an order finer than anything the
 * generator claims to know -- the beach it quantises is made of 380 m of
 * crenellation noise -- and it buys 6,553 m, which is past every floor the
 * boat can sail over.
 */
const GRID = { width: 800, height: 800, cell: 25, unit: 0.2 } as const;

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

/**
 * The shoreline's displacement, at three scales, because one was the tell.
 *
 * The first coast had a single ±1200 m swing at one wavelength, and rendered
 * top-down it read as exactly what it was: a noise-displaced straight line.
 * Real coasts are displaced at every scale a chart can show -- gulfs you plan
 * a day around, bays you stand into, crenellation that makes the waterline
 * worth following -- so the line now carries three octaves, tuned by
 * rendering five seeds and looking:
 *
 * - **macro**: capes and gulfs, ±3200 m over an 18 km wavelength, with the
 *   amplitude itself breathing over 40 km so some stretches of a passage are
 *   bold and others calm rather than every window undulating identically.
 * - **meso**: the original bays, ±1200 m over 5.2 km.
 * - **crenellation**: ±380 m over 1.9 km, the raggedness that keeps the
 *   waterline from reading rounded at chart range.
 */
const MACRO_SWING = 3200;
const MACRO_SCALE = 18000;
const BREATHE_SCALE = 40000;
const MESO_SWING = 1200;
const MESO_SCALE = 5200;
const CREN_SWING = 380;
const CREN_SCALE = 1900;
/** m, the domain warp that makes every contour crinkle at every scale. */
const WARP = 800;
const WARP_SCALE = 2600;
/** Beyond this far inland the ground stops caring about the shore, m. */
const RAMP = 2500;
/** m, the tallest ground; well under the int16 ceiling of 3276 m. */
const PEAK = 110;
/**
 * m, the deepest water a coast makes on its own; matches the open ocean a
 * surveyed region fades into. Where the source knows the real depth it wins,
 * and the int16 sounding reaches 6,553 m -- see `GRID.unit`.
 */
const FLOOR = 42;
/**
 * The shelf's width runs on its own noise rather than a constant, because a
 * constant was the other tell: a shallow-water band of uniform width tracking
 * the coast like a glow. Real banks are wide in one sound and gone off the
 * next head, so the ramp to the floor takes between SHELF_MIN and
 * SHELF_MIN + SHELF_VAR metres, decided by a 9 km field.
 */
const SHELF_MIN = 1200;
const SHELF_VAR = 3200;
const SHELF_SCALE = 9000;

/**
 * m offshore, where the continental slope starts and where it has finished.
 * The start is past the outer island population's 16 km reach, so the deep
 * water never undercuts anything the generator has stood up.
 */
const SLOPE_START = 17_000;
const SLOPE_END = 32_000;

/**
 * Islands, two populations instead of one strip of dots.
 *
 * The old islets were a single 1.4 km noise thresholded inside a hard band
 * 3.8 km off the coast: same-sized blobs on a string, and the ocean beyond
 * them empty forever. What a coastal chart actually shows is *clumps* -- an
 * archipelago here, clean water there -- with the occasional outlier standing
 * well offshore. So:
 *
 * - **archipelago**: a 1.6 km field gated by a 6 km clump mask (where the
 *   mask is low, the threshold rises and the water stays clean), thinning
 *   out between 2.5 and 10 km offshore;
 * - **lone outliers**: a rarer 3.8 km field reaching 16 km out, so the
 *   seaward horizon keeps somewhere to sail while the far ocean does,
 *   eventually, open.
 *
 * Each island's own rise supplies its shallow apron, which is what makes a
 * sounding line around an island rather than a dot in deep water.
 */
const ARCH_SCALE = 1600;
const ARCH_CLUMP_SCALE = 6000;
const ARCH_FADE_FULL = 2500;
const ARCH_FADE_END = 10000;
const LONE_SCALE = 3800;
const LONE_THRESHOLD = 0.8;
const LONE_FADE_FULL = 6000;
const LONE_FADE_END = 16000;
/**
 * m of descent per unit of noise below an island's threshold: the underwater
 * flank that carries its shore down to the seabed instead of a cliff.
 */
const FLANK = 60;
/**
 * m an island is pushed down as its population's falloff runs out. Deeper
 * than the tallest island stands above the deepest floor, so a fully faded
 * island is gone rather than lurking as a shoal. Applied on the *cube* of
 * the spent falloff: linearly, islands halfway out the band were already
 * sunk to pale banks -- rendered, seed 546's outer archipelago dissolved
 * into ghosts -- while cubed, the middle of the band keeps its islands
 * standing and the drowning happens in the last stretch before the fade
 * ends, where it belongs.
 */
const SINK = 80;

/** The default spawn: the plane's origin, which is where a session opens. */
const ORIGIN: Vec2 = { x: 0, y: 0 };

/**
 * The spawn clearing. `placeAtStart` puts the boat 90 m from the plane's
 * origin, and Newport's own siting note records what happens when that is
 * not respected: centred 800 m from where it is now, she went to sea on a
 * two-metre shoal. Within `CLEAR_R` of *the spawn* the water is forced at
 * least `CLEAR_DEPTH` deep, fading out by `CLEAR_FADE` — the same bargain
 * the island field's `keepClear` strikes.
 *
 * Of the spawn and not of the origin, which are the same point only until
 * the plane is re-pinned. On the endless Earth that happens every two
 * hundred kilometres, wherever the boat then is, and a clearing nailed to
 * the origin followed her out and took a nine-hundred-metre bite out of
 * whatever real coast she was passing.
 *
 * The clearing can shave a headland — or now an island. The anchor holds the
 * *mainland* waterline near 3 km, but the swing's residual grows away from
 * the spawn's own alongshore position, the warp projects up to ~1.1 km on
 * top, and the archipelago field may stand land anywhere offshore — seed 546
 * still puts dry ground at the spawn without this guard, and 1764 within a
 * couple of hundred metres (re-verified against the three-octave coast by
 * deleting the clearing and watching the spawn test fail). Where that
 * happens the clearing planes the offender down into a shoal, smoothly, and
 * that is the accepted price of a spawn that is always afloat: the
 * alternative was the bug this guard exists for, a session that opens
 * aground.
 */
const CLEAR_R = 250;
const CLEAR_FADE = 650;
const CLEAR_DEPTH = 15;

/**
 * The two smaller octaves: bays and crenellation, without the macro swing.
 *
 * Separated because a real coast supplies its own gulfs and capes and needs
 * only what the coarse grid is too blunt to hold -- see the `coarse`
 * parameter in `elevation`.
 */
function coastDetail(along: number, seed: number): number {
  const meso = (fbm2(along / MESO_SCALE, 0.37, seed + 5, 4) * 2 - 1) * MESO_SWING;
  const cren = (fbm2(along / CREN_SCALE, 0.53, seed + 9, 3) * 2 - 1) * CREN_SWING;
  return meso + cren;
}

/** The shoreline's total displacement at an alongshore position, m. */
function coastSwing(along: number, seed: number): number {
  const breathe = 0.35 + 0.65 * fbm2(along / BREATHE_SCALE, 0.71, seed + 3, 2);
  const macro = (fbm2(along / MACRO_SCALE, 0.13, seed + 7, 3) * 2 - 1) * MACRO_SWING * breathe;
  return macro + coastDetail(along, seed);
}

/**
 * Whatever can say how far a point is from the shore, signed, positive
 * inland. `ShorePatch` from earth.ts is one; a test's own stub is another.
 * Declared here rather than imported so `coast.ts` keeps knowing nothing
 * about the Earth -- it takes a number source, and the engine decides
 * whether that source is a planet.
 */
export interface ShoreSource {
  at(x: number, y: number): number;
  /**
   * How deep the water is out here, in metres, or undefined from a source
   * that does not know.
   *
   * Separate from `at` because they answer different questions and only one
   * of them has a fallback: without a shoreline there is no coast to
   * generate, but without a floor there is simply the `FLOOR` this file has
   * always used. It exists because a source that knows where the land is
   * generally also knows how far down the sea goes, and 42 m of water two
   * thousand kilometres from anywhere is a sounding nobody should believe:
   * every ocean on the planet read as a coastal shelf.
   */
  floor?(x: number, y: number): number;
}

/**
 * Ground elevation for one point of a coast, m — positive is land.
 *
 * The construction: a straight base shoreline `SHORE_DISTANCE` from the
 * origin, on a side drawn from the seed; the three-octave alongshore swing
 * above, anchored at the spawn, that turns it into gulfs, bays and ragged
 * headlands; a two-axis domain warp that crinkles every contour; then
 * elevation as a ramp through that displaced line — up to `PEAK` inland,
 * down to `FLOOR` offshore across a shelf whose width is its own field. The
 * two island populations rise out of the offshore side with their own
 * falloffs, so the coastal lane is the busy part and the far ocean does,
 * eventually, open.
 */
function elevation(
  x: number,
  y: number,
  seed: number,
  inlandX: number,
  inlandY: number,
  /**
   * `coastSwing(0, seed)`, precomputed once per window fill.
   *
   * Subtracting the swing's own value at the spawn's alongshore position
   * anchors the waterline near SHORE_DISTANCE from the origin whatever the
   * macro coast is doing there -- without it, a spawn could open at the back
   * of a five-kilometre gulf with no land in sight, which is the exact
   * failure the 3 km shore distance was retuned to prevent. The pin is exact
   * only for the unwarped shoreline curve; the domain warp moves the
   * physical waterline, measured 2.6-3.3 km off the spawn across probed
   * seeds.
   *
   * Ignored when a `coarse` shoreline is given: a real coast is where it is,
   * and there is nothing to anchor.
   */
  anchor: number,
  /**
   * Where the real Earth says the shore is, or null for a coast of this
   * file's own invention.
   *
   * This is the whole of what opening the planet costs the generator. Every
   * feature below -- the beach, the ridge, the shelf, the two island fields
   * -- is built from one number, the signed distance to the waterline, and
   * that number is either drawn from a straight line and three octaves of
   * noise or read from a coarse map of the Earth. The rest of the file
   * cannot tell the difference, which is why a planet costs one parameter
   * rather than a second generator.
   *
   * The noise does not go away when the Earth arrives: the coarse grid has
   * no feature finer than a cell -- seven kilometres north-south, less
   * east-west -- so the meso and crenellation
   * octaves are added *to* it -- the real gulf, with an invented shoreline
   * inside it. Only the macro swing drops out, because that is the scale
   * the Earth is now supplying.
   */
  coarse: ShoreSource | null = null,
  /**
   * Where the clearing goes, in the same plane metres as `x` and `y`.
   *
   * It used to be plane zero, which is the same point only until the plane
   * is re-pinned. On the endless Earth the pin moves to wherever the boat is
   * every two hundred kilometres, so the clearing followed her out to sea
   * and took a 900-metre bite out of whatever real headland she happened to
   * be passing at the time. It belongs to the *spawn*, which is the only
   * thing it was ever protecting.
   */
  spawn: Vec2 = ORIGIN,
): number {
  // Crinkle the sample point before anything reads it, so every contour the
  // shore and the shelf draw inherits the same wrinkles.
  const wx = x + (fbm2(x / WARP_SCALE, y / WARP_SCALE, seed + 11, 3) * 2 - 1) * WARP;
  const wy = y + (fbm2(x / WARP_SCALE, y / WARP_SCALE, seed + 23, 3) * 2 - 1) * WARP;

  // Signed distance to the displaced shoreline: positive inland.
  const along = wx * inlandY - wy * inlandX;
  const s = coarse
    ? coarse.at(wx, wy) + coastDetail(along, seed)
    : wx * inlandX + wy * inlandY - SHORE_DISTANCE + coastSwing(along, seed) - anchor;

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
  const shelfWidth = SHELF_MIN + SHELF_VAR * fbm2(wx / SHELF_SCALE, wy / SHELF_SCALE, seed + 87, 2);
  const shelf = (FLOOR - 3) * clamp((-s - 80) / shelfWidth, 0, 1);
  /*
   * And then, a long way out, the bottom drops away.
   *
   * The shelf above is a coastal shelf and stays one: it reaches 42 m within
   * a few kilometres of the beach, which is what a shelf does and what every
   * sounding near a coast should read. What was wrong was that it was *also*
   * the middle of the Pacific, where 42 m says the boat may anchor two
   * thousand kilometres from anywhere.
   *
   * So the real floor is a second, much wider ramp, and it begins past
   * everything this file invents -- the outer island population reaches 16
   * km, so nothing is undercut and no islet is left standing on a cliff. By
   * SLOPE_END the water is the ocean's own depth, which past the shore
   * patch's reach is all this can be asked about anyway.
   */
  const abyss = Math.max(0, (coarse?.floor?.(wx, wy) ?? 0) - FLOOR);
  const slope = abyss * smoothstep(SLOPE_START, SLOPE_END, -s);
  let ground = beach + PEAK * rise * texture - shelf - slope;

  // Islands stand only offshore of the waterline; each population carries
  // its own falloff, and an island's rise above its threshold is also its
  // shallow apron -- the -4 m start is what draws a sounding line around it.
  //
  // Two shapes matter here, and both were got wrong once. The profile runs
  // *through* the threshold rather than starting at it -- below, `t` goes
  // negative and the flank descends to the seabed -- because a thresholded
  // Math.max put a forty-metre underwater cliff along every island's edge
  // (found by a review probing adjacent samples on seed 14812). And the
  // falloff *sinks* the whole island rather than scaling it: a multiplied
  // fade shrinks the negative flank toward zero, which would hoist the abyss
  // to a phantom four-metre reef wherever the fade ran out.
  const off = -s;
  if (off > 0) {
    const archFade = smoothstep(ARCH_FADE_END, ARCH_FADE_FULL, off);
    if (archFade > 0) {
      const clump = fbm2(wx / ARCH_CLUMP_SCALE, wy / ARCH_CLUMP_SCALE, seed + 71, 2);
      const arch = fbm2(wx / ARCH_SCALE, wy / ARCH_SCALE, seed + 57, 4);
      const threshold = 0.6 + 0.32 * (1 - clump);
      const t = (arch - threshold) / (1 - threshold);
      const profile = t * (t > 0 ? 34 : FLANK) - 4;
      ground = Math.max(ground, profile - SINK * (1 - archFade) ** 3);
    }
    const loneFade = smoothstep(LONE_FADE_END, LONE_FADE_FULL, off);
    if (loneFade > 0) {
      const lone = fbm2(wx / LONE_SCALE, wy / LONE_SCALE, seed + 93, 3);
      const t = (lone - LONE_THRESHOLD) / (1 - LONE_THRESHOLD);
      const profile = t * (t > 0 ? 46 : FLANK) - 5;
      ground = Math.max(ground, profile - SINK * (1 - loneFade) ** 3);
    }
  }

  // The clearing outranks everything: whatever stood here, the boat spawns in
  // water she can sail out of.
  const r = Math.hypot(x - spawn.x, y - spawn.y);
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
 * are a measured ~190 ms — a dozen dropped frames if paid at once. Spread a few
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
  /**
   * The Earth's own shoreline for this window, or null for a coast the seed
   * invents. Built once per window by the caller -- see `Earth.shorePatch`
   * -- because it costs a chamfer and every row of the fill reads it.
   *
   * Its coordinates are this window's: the caller anchors the patch on the
   * same place the window is centred, so `at(x, y)` and the fill's own
   * (x, y) mean the same point. Getting that wrong would put the Earth's
   * coastline somewhere the boat is not, which is why the two are built
   * together in `coastHeightField`.
   */
  coarse: ShoreSource | null = null,
  /** Where the boat will be put; see `elevation`. */
  spawn: Vec2 = ORIGIN,
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
  // Once per fill, not per sample: it is three fbm evaluations that never
  // change within a seed. See the parameter's note in `elevation`.
  const anchor = coastSwing(0, seed);

  for (let row = row0; row < row1; row++) {
    const y = origin.y + halfHeight - (row + 0.5) * cell;
    for (let col = 0; col < width; col++) {
      const x = origin.x - halfWidth + (col + 0.5) * cell;
      const ground = elevation(x, y, seed, inlandX, inlandY, anchor, coarse, spawn);
      samples[row * width + col] = clamp(Math.round(ground / unit), -32768, 32767);
    }
  }
}

/** The samples for a whole coast window. */
export function coastSamples(
  seed: number,
  origin = { x: 0, y: 0 },
  coarse: ShoreSource | null = null,
  spawn: Vec2 = ORIGIN,
): Int16Array {
  const samples = new Int16Array(GRID.width * GRID.height);
  fillCoastRows(samples, seed, snapCoastOrigin(origin), 0, GRID.height, coarse, spawn);
  return samples;
}

/** The whole thing, ready for `RegionTerrain`, windowed about `origin`. */
export function coastHeightField(
  seed: number,
  origin = { x: 0, y: 0 },
  coarse: ShoreSource | null = null,
  spawn: Vec2 = ORIGIN,
): { region: Region; height: HeightField; origin: { x: number; y: number } } {
  const region = coastRegion(seed);
  const snapped = snapCoastOrigin(origin);
  return {
    region,
    height: new HeightField(coastSamples(seed, snapped, coarse, spawn), region, snapped),
    origin: snapped,
  };
}
