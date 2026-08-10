import { compassVec, smoothstep, type Vec2, TAU } from './math';
import { fbm2, valueNoise2 } from './noise';

/**
 * Islands.
 *
 * Islands are worth having only if they change how you sail, not because they
 * decorate the horizon. Three effects make them tactical:
 *
 *   1. **Wind shadow.** An island steals the wind downwind of it. Sailing into
 *      its lee is a real and painful mistake, and staying out of it is a real
 *      decision. This costs almost nothing to implement here because the wind
 *      is already a pure function of position -- the shadow is just another
 *      term composed into WindField.sample().
 *   2. **Flat water in the lee.** Waves are blocked too, so the sheltered side
 *      is smoother. Sometimes that is worth the lost wind, which is exactly the
 *      kind of trade-off worth offering.
 *   3. **Grounding.** Shallow water near the shore ends your race. That is what
 *      makes cutting a corner close a gamble rather than a free shortcut.
 *
 * Shapes are analytic (a noise-modulated radius) rather than meshes with
 * collision, so every query is a handful of arithmetic operations and the
 * physics can call them at 120 Hz without noticing.
 */

/**
 * What the rest of the simulator asks of ground.
 *
 * There are two answers to it now: `Terrain`, which works from a list of
 * circles and can stream forever, and `RegionTerrain`, which works from a
 * surveyed raster of one fixed place. The wind, the tide, the anchorage judge
 * and the boat's depth under the keel all ask through this and are indifferent
 * to which they hold -- which is the whole reason a real coast was a small
 * change rather than a rewrite.
 *
 * The island list is deliberately *not* in here. `terrain.islands` is a
 * work-list of circles to build meshes from, and a coastline has no such thing;
 * the three places in `src/view` that still need it name `Terrain` directly and
 * so stop compiling if they are ever handed a region by mistake.
 */
export interface TerrainQuery {
  /** Ground relative to sea level: positive above water, negative below. */
  elevationAt(x: number, y: number): number;
  /** Water depth in metres. Zero or less means land. */
  depthAt(x: number, y: number): number;
  /** True if a hull of this draft would touch bottom here. */
  isAground(x: number, y: number, draft: number): boolean;
  /** How much of the wind survives here, 0..1. */
  windExposure(x: number, y: number, twd: number): number;
  /** Wave height multiplier here, 0..1. */
  waveShelter(x: number, y: number, twd: number): number;
  /** Distance to the nearest shoreline, positive offshore. */
  distanceToShore(x: number, y: number): number;
  /** Compass bearing to the nearest shore, or null with none in reach. */
  bearingToShore(x: number, y: number): number | null;
}

export interface Island {
  /** Centre position. */
  pos: Vec2;
  /** Mean shoreline radius, m. */
  radius: number;
  /** Peak height above sea level, m. Drives how far the wind shadow reaches. */
  height: number;
  /** Per-island noise seed, so no two look alike. */
  seed: number;
  /**
   * Which landmass this circle belongs to. Omit and it is a landmass of its own.
   *
   * Any number will do -- it is a label, and `Terrain` renumbers them densely
   * from zero, so nothing downstream depends on which one you pick.
   *
   * `elevationAt` already takes the highest of every island, so overlapping
   * circles union into one continuous shore for free -- which is how a mainland
   * or the two sides of a channel get built without a new shape primitive. What
   * does not come for free is the shelter: the wake models below compose one
   * island at a time, so a coast drawn as eight circles would shade its lee
   * eight times over and produce flat water and a hole in the wind that no
   * headland that size could make. Circles sharing a `land` shelter once,
   * together, as the single piece of ground they are drawing.
   */
  land?: number;
}

/** How steeply the seabed falls away from the shore (m of depth per m offshore). */
const SHELF_SLOPE = 0.09;
/** Deep water depth, m. Beyond this the bottom stops mattering. */
const MAX_DEPTH = 40;

/**
 * Distance downwind at which a lee is over, m, and where it starts to fade out.
 *
 * The wake models below decay exponentially, so on paper an island shelters the
 * water a very long way downwind -- a large one still holds a third of its wave
 * shelter at 2 km. That was harmless when the whole world was four islands that
 * could all be looped over. In an endless ocean the boat has to work from a
 * finite window of nearby land, and a window is only honest if everything
 * outside it genuinely has no effect. So the wake is faded out to exactly zero
 * over the last 600 m instead of trailing off forever.
 *
 * What this costs: a large island's flat water now ends by 1.5 km rather than
 * thinning out to 2.5 km. At the default 380 m leg that is four legs downwind,
 * well past where anyone is still thinking about the island.
 */
export const WAKE_MAX = 1500;
export const WAKE_FADE = 900;

/** 1 close astern of an island, easing to 0 at the end of the wake. */
const wakeTaper = (along: number): number => 1 - smoothstep(WAKE_FADE, WAKE_MAX, along);

/**
 * Shoreline radius at a given bearing. Islands are lobed rather than circular;
 * a perfect circle reads as a game object, an irregular coast reads as land.
 */
function shoreRadius(island: Island, bearing: number): number {
  const c = Math.cos(bearing);
  const s = Math.sin(bearing);
  // Sample the noise on the unit circle so the shape wraps seamlessly.
  const n = fbm2(c * 1.7 + 10, s * 1.7 + 10, island.seed, 2);
  return island.radius * (0.72 + 0.56 * n);
}

export class Terrain implements TerrainQuery {
  readonly islands: Island[];
  /**
   * Landmass id per island, aligned with `islands` and sorted ascending.
   *
   * Both the shelter models here and the copies of them in the water shader
   * compose by walking the list and closing off a landmass when the id changes,
   * which is only correct while a landmass's pieces are adjacent. Establishing
   * that here, once, is what lets the shader read `terrain.islands` in order and
   * still agree -- the alternative was a lookup keyed on the id, and GLSL ES
   * 1.00 cannot index an array by a value it did not get from a loop counter.
   */
  readonly landGroup: number[];

  constructor(islands: Island[] = []) {
    // An island with no `land` of its own is its own landmass, so it needs a
    // real id rather than a shared placeholder: two of them left undefined
    // would compare equal and shelter as though they were one piece of ground.
    let next = 0;
    for (const isl of islands) if (isl.land !== undefined) next = Math.max(next, isl.land + 1);
    const tagged = islands.map((isl) => ({ isl, g: isl.land ?? next++ }));
    // Stable, so a field of ungrouped islands keeps the order it arrived in and
    // composes exactly as it did before landmasses existed.
    tagged.sort((a, b) => a.g - b.g);
    this.islands = tagged.map((t) => t.isl);

    // Renumbered to 0, 1, 2... rather than kept as authored. `Island.land` is a
    // label an author picks, and the shader has to survive whatever they pick:
    // it uploads the id plus one into a float slot where zero already means
    // "no island here", so a `land: -1` would make a piece of coast silently
    // vanish from the shader's shelter while the physics still felt it, and ids
    // far apart enough to lose precision as float32 would merge two landmasses
    // into one. Renumbering here means the contract holds by construction
    // instead of by everyone remembering it.
    const dense = new Map<number, number>();
    this.landGroup = tagged.map((t) => {
      const seen = dense.get(t.g);
      if (seen !== undefined) return seen;
      const id = dense.size;
      dense.set(t.g, id);
      return id;
    });
  }

  /**
   * Ground elevation relative to sea level: positive above water, negative
   * below. Returns the shallowest (highest) value across all islands.
   */
  elevationAt(x: number, y: number): number {
    let best = -MAX_DEPTH;
    for (const isl of this.islands) {
      const dx = x - isl.pos.x;
      const dy = y - isl.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > isl.radius * 2.6 + MAX_DEPTH / SHELF_SLOPE) continue;

      const r = shoreRadius(isl, Math.atan2(dy, dx));
      let e: number;
      if (d < r) {
        // Above water: a smooth dome, roughened a little so it is not a bubble.
        const t = 1 - d / r;
        const rough = 0.82 + 0.36 * valueNoise2(x / 55, y / 55, isl.seed + 31);
        e = isl.height * Math.pow(t, 0.75) * rough;
      } else {
        e = -Math.min(MAX_DEPTH, (d - r) * SHELF_SLOPE);
      }
      if (e > best) best = e;
    }
    return best;
  }

  /** Water depth in metres. Zero or less means land. */
  depthAt(x: number, y: number): number {
    return -this.elevationAt(x, y);
  }

  /** True if a hull of this draft would touch bottom here. */
  isAground(x: number, y: number, draft: number): boolean {
    return this.depthAt(x, y) < draft;
  }

  /**
   * How much of the wind survives at this point, 0..1.
   *
   * The model is a spreading wake behind each island: the closer you are, the
   * more wind is missing, and the wake widens and weakens with distance. It
   * ignores the speed-up around headlands, which is a second-order effect next
   * to simply parking in the lee.
   */
  windExposure(x: number, y: number, twd: number): number {
    if (this.islands.length === 0) return 1;
    // Downwind unit vector: the wind blows from twd, so it travels the other way.
    const from = compassVec(twd);
    const dwx = -from.x;
    const dwy = -from.y;

    // Strongest wake within a landmass, multiplied across landmasses. One piece
    // of ground casts one shadow however many circles were used to draw it;
    // two separate islands in line do each take their bite.
    let exposure = 1;
    let groupMax = 0;
    let group = -1;
    for (let i = 0; i < this.islands.length; i++) {
      if (this.landGroup[i] !== group) {
        exposure *= 1 - groupMax;
        groupMax = 0;
        group = this.landGroup[i];
      }
      const isl = this.islands[i];
      const dx = x - isl.pos.x;
      const dy = y - isl.pos.y;
      // Distance downwind of the island, and lateral offset from its wake axis.
      const along = dx * dwx + dy * dwy;
      if (along <= 0) continue; // upwind of the island: unaffected
      if (along > WAKE_MAX) continue;
      const across = Math.abs(dx * dwy - dy * dwx);

      // The wake spreads as it travels downwind.
      const halfWidth = isl.radius * 1.05 + along * 0.16;
      if (across > halfWidth) continue;

      // A rough rule of thumb: shelter persists for roughly ten to fifteen times
      // the obstacle height before the wind fills back in.
      const reach = Math.max(isl.height, 8) * 13;
      const decay = Math.exp(-along / reach) * wakeTaper(along);
      // Softer towards the edges of the wake than dead astern of the island.
      const edge = 1 - Math.pow(across / halfWidth, 2);
      groupMax = Math.max(groupMax, 0.85 * decay * edge);
    }
    exposure *= 1 - groupMax; // the last landmass has no successor to close it
    return Math.max(0.08, exposure);
  }

  /**
   * Wave height multiplier at this point, 0..1. Waves need fetch to build, so
   * the lee of an island stays flat far further downwind than the wind shadow
   * reaches.
   */
  waveShelter(x: number, y: number, twd: number): number {
    if (this.islands.length === 0) return 1;
    const from = compassVec(twd);
    const dwx = -from.x;
    const dwy = -from.y;

    // Grouped by landmass, as in windExposure. It matters more here: shelter is
    // really a statement about fetch, and the fetch behind a coast is set by
    // the coast, not by how many circles it happened to be drawn with.
    let shelter = 1;
    let groupMax = 0;
    let group = -1;
    for (let i = 0; i < this.islands.length; i++) {
      if (this.landGroup[i] !== group) {
        shelter *= 1 - groupMax;
        groupMax = 0;
        group = this.landGroup[i];
      }
      const isl = this.islands[i];
      const dx = x - isl.pos.x;
      const dy = y - isl.pos.y;
      const along = dx * dwx + dy * dwy;
      if (along <= 0) continue;
      if (along > WAKE_MAX) continue;
      const across = Math.abs(dx * dwy - dy * dwx);
      const halfWidth = isl.radius * 1.15 + along * 0.1;
      if (across > halfWidth) continue;

      // Fetch-limited: it takes a long way downwind to rebuild a sea.
      const decay = Math.exp(-along / (isl.radius * 9 + 200)) * wakeTaper(along);
      const edge = 1 - Math.pow(across / halfWidth, 2);
      groupMax = Math.max(groupMax, 0.9 * decay * edge);
    }
    shelter *= 1 - groupMax;
    return Math.max(0.05, shelter);
  }

  /**
   * The other islands whose ground reaches into this one's, so a shape traced
   * through elevationAt() around `isl` depends on them as well as on `isl`.
   *
   * Anything that caches a traced coastline has to know this. elevationAt()
   * takes the highest of every island, so two close enough to share a shelf
   * trace as one landmass -- and a cache keyed on the island alone keeps the
   * shape it had when it was traced. Measured across the shapes this field
   * generates, a neighbour arriving moves the shoreline by up to 374 m: a whole
   * isthmus appears, and since nothing invalidates the cache it stays missing
   * for as long as that island is loaded, right up to sailing into it.
   */
  islandsAffecting(isl: Island): Island[] {
    // isl's own tracing reach, plus how far the neighbour's ground carries.
    const own = isl.radius * 2.6 + MAX_DEPTH / SHELF_SLOPE;
    return this.islands.filter(
      (o) =>
        o !== isl &&
        Math.hypot(o.pos.x - isl.pos.x, o.pos.y - isl.pos.y) <
          own + o.radius * 2.6 + MAX_DEPTH / SHELF_SLOPE,
    );
  }

  /** The island whose shoreline is nearest, or null in open water. */
  nearestIsland(x: number, y: number): Island | null {
    let best: Island | null = null;
    let bestD = Infinity;
    for (const isl of this.islands) {
      const d = Math.hypot(x - isl.pos.x, y - isl.pos.y) - isl.radius;
      if (d < bestD) {
        bestD = d;
        best = isl;
      }
    }
    return best;
  }

  /**
   * Which way the nearest shore lies, or null in an empty ocean.
   *
   * The island's centre, which is the best a circle can offer: it has no
   * shoreline to point at, only a middle. `RegionTerrain` does better, from the
   * gradient of its distance field.
   */
  bearingToShore(x: number, y: number): number | null {
    const isl = this.nearestIsland(x, y);
    return isl ? Math.atan2(isl.pos.x - x, isl.pos.y - y) : null;
  }

  /** Distance to the nearest shoreline, positive offshore. Infinity with no islands. */
  distanceToShore(x: number, y: number): number {
    let best = Infinity;
    for (const isl of this.islands) {
      const dx = x - isl.pos.x;
      const dy = y - isl.pos.y;
      const d = Math.hypot(dx, dy);
      const r = shoreRadius(isl, Math.atan2(dy, dx));
      best = Math.min(best, d - r);
    }
    return best;
  }
}

/** Deterministic pseudo-random stream, so an archipelago can be reproduced from a seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const EMPTY_TERRAIN = new Terrain([]);

/** Cell size, m. At most one island per cell, so this sets the closest spacing. */
const CELL = 820;
/**
 * How far from the boat anything asks about the terrain, m.
 *
 * Not everything is asked about the boat's own position: the renderer samples
 * the wave surface across its whole grid, several hundred metres out, and a
 * shelter that was right under the hull and wrong at the edge of the water
 * would show as a seam.
 */
const QUERY_REACH = 650;
/** The largest island the field will generate. The bounds below depend on it. */
/** Exported so the chart can work out how far a coast reaches past its centre. */
export const MAX_ISLAND_RADIUS = 250;
/**
 * How far from an island's centre its influence can possibly reach, m.
 *
 * WAKE_MAX alone is not it, and the first version of this bound said it was.
 * A wake is not a line: it spreads, so the furthest influenced point is out at
 * the corner of the wake, not straight down the axis. Taking the wider of the
 * two spreading rates and the widest island the field makes, the corner sits
 * about ninety metres beyond WAKE_MAX -- which is how much of the wake the old
 * bound quietly cut off.
 *
 * The shelf is not the binding constraint: land shoals to full depth within
 * radius * 2.6 + MAX_DEPTH / SHELF_SLOPE, about 1.1 km, well inside this.
 */
const INFLUENCE_RADIUS = Math.hypot(
  WAKE_MAX,
  MAX_ISLAND_RADIUS * 1.15 + WAKE_MAX * 0.16,
);
/**
 * How far the physics window reaches from the boat, m.
 *
 * This is a bound, not a taste. Nothing is asked about the terrain further than
 * QUERY_REACH from the boat, and no island reaches further than
 * INFLUENCE_RADIUS from its own centre, so an island beyond the sum of the two
 * provably cannot change any answer. That is what makes it safe to hand the
 * physics a finite list -- and `terrain.test.ts` holds the claim to account
 * rather than leaving it as a comment.
 */
export const ACTIVE_RANGE = INFLUENCE_RADIUS + QUERY_REACH;
/**
 * How many islands the physics window holds. The water shader loops over this
 * many uniforms, so it is a shader cost as much as a physics one, and both must
 * use the same number or the flat water and the felt lee stop matching.
 *
 * Sixteen and MAX_DENSITY are a matched pair, chosen by measurement rather than
 * taste: at the thickest sea the field will make, sixteen is where the window
 * stops leaving anything out that could be felt anywhere the water is sampled.
 * Twelve was not -- it was 0.12 of wind exposure short at the top of the range
 * even after relevance() started deciding what to drop, and 0.30 short before
 * that. Raising either number without re-running that measurement breaks the
 * guarantee terrain.test.ts asserts.
 */
export const MAX_ACTIVE_ISLANDS = 16;
/**
 * The thickest the sea gets, as a fraction of cells holding an island.
 *
 * A ceiling on how much land the cap has to account for, so the window's
 * promise -- that what it leaves out cannot be felt -- holds for every world
 * the field can be asked for and not merely the ones the menu offers today.
 */
export const MAX_DENSITY = 0.55;
/** How far islands are drawn, m. Past the fog at any visibility, so they are born unseen. */
export const VISUAL_RANGE = 2800;
/** Cap on drawn islands, purely to bound the mesh budget in a crowded archipelago. */
const MAX_VISIBLE_ISLANDS = 40;

/**
 * How far the chart is given land, m.
 *
 * A third window, and the only one that is not about what the boat can feel or
 * see. Nothing in it need be reachable: it is never handed to the physics, the
 * wind, the stream or the water shader. It exists so that a chart drawn at a
 * passage scale is a chart of the sea that is actually there. Reading the
 * physics window instead showed five islands of the fifty-four inside a 5 km
 * chart's own frame, because that window stops at 2240 m.
 *
 * Three things add up, and the first version of this had only counted the
 * first:
 *
 *   the disc                5000  the widest range, and the chart is clipped
 *                                 to a circle, so the corner never matters
 *   the pan                +2750  the chart is not centred on the boat. It
 *                                 holds still and lets her cross it, up to
 *                                 PAN_AT of the range, which is what makes
 *                                 progress visible at all
 *   an island's own reach   +418  a shape is drawn from its centre outwards,
 *                                 so land whose centre is outside the disc
 *                                 still has a coast inside it
 *                          -----
 *                           8168
 *
 * `minimap.test.ts` adds those up from the same constants and holds this to the
 * total, rather than leaving it to a comment. A comment is what failed last
 * time: the one in `minimap.ts` named 1200 m as the widest range long after
 * 2500 and 5000 had been added beneath it.
 */
export const CHART_RANGE = 8300;
/**
 * Cap on charted islands.
 *
 * A backstop that must never bite. Truncating here would be the original defect
 * in a smaller coat: land inside the chart's own frame, not drawn.
 *
 * Measured across seeds rather than from one, which is how the first attempt at
 * this number went wrong: 192, taken from a single seed that happened to sit
 * near the median, truncated 32 seeds in 400.
 *
 * Re-measured after landmasses started clearing the water beside them, which
 * thinned the sea by about a tenth. Over ten thousand seeds at MAX_DENSITY the
 * window holds 54 at the thinnest, 98 on average and 177 at the worst, so this
 * has room over it -- and `minimap.test.ts` scans seeds to keep it that way.
 *
 * Affordable only because a coastline is traced against its own neighbours now:
 * 54 ms for 169 of them, where the old whole-terrain sampling would have been
 * the better part of a second. Traced once each and cached on island identity,
 * so this is the cost of a chart's first look at a new stretch of sea, not a
 * per-frame cost.
 */
const MAX_CHART_ISLANDS = 256;

export interface IslandFieldOptions {
  seed: number;
  /** 0 = open ocean, 1 = an island in nearly every cell. */
  density: number;
  /** Points that must stay in navigable water, usually the marks and the start. */
  keepClear: Vec2[];
  /** How far the shoreline must stay from those points, m. */
  clearance: number;
}

interface Cell {
  cx: number;
  cy: number;
  /** Empty, one island, or the several circles of a single landmass. */
  islands: Island[];
}

/**
 * How often a cell that has an island grows it into a landmass instead.
 *
 * The ocean was uniform before this: one circle per cell, radius 60 to 250 m
 * flat, so nothing was ever more than half a kilometre across and every cell
 * rolled the same odds. What that reads as is a field of dots.
 *
 * A landmass is several overlapping circles sharing a `land` id. `elevationAt`
 * takes the highest of every island, so they union into one continuous shore
 * for free -- which is how the surveyed regions already build a mainland, and
 * why this needs no new shape. One big circle would have been simpler and would
 * have drawn a disc; five overlapping ones have bays and headlands.
 */
const MASS_CHANCE = 0.05;
/** Circles in a landmass. Below three it is not a coast, above six it is a continent. */
const MASS_MIN = 3;
const MASS_MAX = 4;
/** How far the spine may wander between circles, radians. */
const MASS_BEND = 1.5;
/** Cells around a landmass that are searched for it. Its reach, in cells, plus one. */
const MASS_CELLS = 4;
/**
 * How far a landmass's circles can sit from the cell that seeded it, m.
 *
 * Three links at most, each at most `(250 + 250) * 0.78`. It exists because
 * `collect` walks cells: a landmass seeded outside the range being asked for
 * can still lay a circle well inside it, and scanning only the cells the range
 * touches missed those entirely. Over ten thousand seeds that cost up to 0.46
 * of wave shelter -- land the boat could feel, that the window did not know
 * about. Anything that changes MASS_MAX or the link spacing has to move this.
 */
const MASS_REACH = 1170;
/** Open water kept between a landmass and the nearest island to it, m. */
const MASS_ELBOW = 2300;
/**
 * A landmass's id: distinct for any two cells this side of three thousand
 * kilometres, and never zero.
 *
 * Never zero because `Terrain` numbers its ungrouped islands from zero up, and
 * a landmass colliding with one of those would shade its lee as though the two
 * were the same piece of ground. Distinct because a collision between two
 * landmasses does the same thing at a distance: folded to a million, two masses
 * four kilometres apart shared an id and measured as one 5.3 km coast.
 */
const massId = (cx: number, cy: number): number => 1 + ((cx * 1000003 + cy) >>> 0);

/**
 * An upper bound, 0..1, on how much this island could matter to anything asked
 * within QUERY_REACH of (x, y). Used only to decide what to drop when the
 * window is fuller than the shader can hold.
 *
 * Dropping the furthest island is the obvious rule and it is wrong. A wake
 * points downwind, so an island two kilometres away and dead upwind can be
 * taking most of the breeze out of the water the boat is about to sail into,
 * while three nearer ones sit harmlessly abeam. Ordered by distance the useful
 * one is the first to go: measured over four thousand crowded windows, the
 * wind at a point 650 m from the boat came out as much as 0.30 wrong, and the
 * wave shelter 0.47, against the same window uncapped.
 *
 * Every offset here is taken in the island's favour -- the strongest point the
 * neighbourhood can reach, not the boat's own position -- so this can only
 * overstate an island's importance, never drop one that mattered.
 */
function relevance(
  isl: Island,
  x: number,
  y: number,
  dwx: number,
  dwy: number,
  d: number,
): number {
  // Land near enough to shoal under the boat is kept whatever the wind is
  // doing: grounding does not care which way the wake points.
  if (d <= isl.radius * 2.6 + MAX_DEPTH / SHELF_SLOPE + QUERY_REACH) return 1;

  const dx = x - isl.pos.x;
  const dy = y - isl.pos.y;
  const along = dx * dwx + dy * dwy;
  // Entirely upwind of everything in reach: it cannot touch any of it.
  if (along + QUERY_REACH <= 0) return 0;

  const near = Math.max(0, along - QUERY_REACH);
  if (near > WAKE_MAX) return 0;
  const across = Math.max(0, Math.abs(dx * dwy - dy * dwx) - QUERY_REACH);
  // The wider of the two wake models, so this bounds both.
  if (across > isl.radius * 1.15 + near * 0.16) return 0;

  const reach = Math.max(isl.height, 8) * 13;
  return Math.exp(-near / reach) * wakeTaper(near);
}

/** Hash a cell to its own random stream. Neighbouring cells must be unrelated. */
function cellSeed(seed: number, cx: number, cy: number): number {
  let h = Math.imul(cx, 0x27d4eb2d) ^ Math.imul(cy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * An ocean that does not end.
 *
 * Islands are not a list that is generated once. The sea is divided into square
 * cells, and each cell either holds an island or does not, decided by hashing
 * the cell coordinates together with the world seed. Nothing is stored, so the
 * world is the same size whether you sail a mile or fifty, and sailing back to
 * an island you passed an hour ago finds it exactly where you left it.
 *
 * The boat still works from a plain `Terrain` -- a finite list -- because the
 * physics, the water shader and the island meshes all have to agree on the same
 * islands, and a shader cannot hash an infinite plane. This class is what keeps
 * that list up to date as the boat moves: `active()` is the window the physics
 * and the shader share, `visible()` the larger one the meshes are built from.
 *
 * Cells cache their island, so a cell that has been visited returns the very
 * same object. That is what lets the renderer tell "the same island as last
 * refresh" from "a new one" by identity, and rebuild only what actually
 * appeared.
 */
export class IslandField {
  private cells = new Map<string, Cell>();
  /** Landmasses, kept apart from `cells` because neighbours ask for them. */
  private masses = new Map<string, Island[] | null>();
  private density: number;

  constructor(private opts: IslandFieldOptions) {
    this.density = Math.min(Math.max(opts.density, 0), MAX_DENSITY);
  }

  /**
   * The circles of the landmass this cell seeds, or null if it seeds none.
   *
   * Pure and memoised, and deliberately *not* routed through `cell()`. A cell
   * has to ask its neighbours whether they are growing land before it decides
   * whether to grow anything itself, and going through `cell()` for that would
   * recurse for ever. One function rather than a cheap predicate beside a
   * builder, so the answer a neighbour gets and the land that is actually
   * placed cannot drift apart.
   */
  private massIslands(cx: number, cy: number): Island[] | null {
    const key = `${cx},${cy}`;
    const hit = this.masses.get(key);
    if (hit !== undefined) return hit;

    const rand = rng(cellSeed(this.opts.seed, cx, cy));
    let made: Island[] | null = null;
    if (rand() < this.density && rand() < MASS_CHANCE) {
      const base = {
        x: (cx + 0.18 + rand() * 0.64) * CELL,
        y: (cy + 0.18 + rand() * 0.64) * CELL,
      };
      const n = MASS_MIN + Math.floor(rand() * (MASS_MAX + 1 - MASS_MIN));
      // A spine, and circles strung along it. Hanging each one off a randomly
      // chosen predecessor instead is a random walk: it piles up around the
      // seed and the result was 600 m across, barely wider than a single
      // island. Strung along a line that wanders a little, the same circles
      // make a ridge with headlands at its ends.
      let angle = rand() * TAU;
      made = [];
      let prev = { pos: base, radius: 190 + rand() * 60 };
      made.push({ pos: prev.pos, radius: prev.radius, height: 70 + rand() * 70, land: massId(cx, cy), seed: Math.floor(rand() * 1e6) });
      for (let i = 1; i < n; i++) {
        angle += (rand() - 0.5) * MASS_BEND;
        const radius = 170 + rand() * 80;
        // Close enough that the shores merge: `elevationAt` takes the highest
        // of every island, so an overlap is one coast and a gap is two islands
        // pretending to be one.
        const d = (prev.radius + radius) * (0.5 + rand() * 0.28);
        const pos = { x: prev.pos.x + Math.cos(angle) * d, y: prev.pos.y + Math.sin(angle) * d };
        // Lower along the arms than at the seed, so it reads as a ridge running
        // out to headlands rather than a row of equal humps.
        made.push({ pos, radius, height: 24 + rand() * 60 * (radius / 200), land: massId(cx, cy), seed: Math.floor(rand() * 1e6) });
        prev = { pos, radius };
      }
      if (this.blocked(made)) made = null;
    }
    this.masses.set(key, made);
    return made;
  }

  private cell(cx: number, cy: number): Cell {
    const key = `${cx},${cy}`;
    const hit = this.cells.get(key);
    if (hit) return hit;

    const made: Cell = { cx, cy, islands: this.build(cx, cy) };
    this.cells.set(key, made);
    return made;
  }

  private build(cx: number, cy: number): Island[] {
    const mine = this.massIslands(cx, cy);
    if (mine) return mine;

    const rand = rng(cellSeed(this.opts.seed, cx, cy));
    if (rand() >= this.density) return [];
    rand(); // the landmass draw, already spent above
    const pos = {
      x: (cx + 0.18 + rand() * 0.64) * CELL,
      y: (cy + 0.18 + rand() * 0.64) * CELL,
    };

    // Land next door gets the water to itself. A ridge reaches well past its
    // own cell, and a scattering of dots around a coast reads as debris rather
    // than as an archipelago -- so an island inside a landmass's reach is not
    // placed at all. That is also what keeps the shader's sixteen slots
    // affordable: a landmass replaces the islands around it rather than adding
    // to them. Measured against the mass's real footprint and not a fixed ring,
    // because a five-circle ridge is twice the length of a three-circle one.
    for (let dx = -MASS_CELLS; dx <= MASS_CELLS; dx++) {
      for (let dy = -MASS_CELLS; dy <= MASS_CELLS; dy++) {
        if (dx === 0 && dy === 0) continue;
        const near = this.massIslands(cx + dx, cy + dy);
        if (!near) continue;
        for (const m of near) {
          if (Math.hypot(m.pos.x - pos.x, m.pos.y - pos.y) < m.radius + MASS_ELBOW) return [];
        }
      }
    }

    const radius = 60 + rand() * (MAX_ISLAND_RADIUS - 60);
    const height = 18 + rand() * 90 * (radius / 200);
    const single = [{ pos, radius, height, seed: Math.floor(rand() * 1e6) }];
    return this.blocked(single) ? [] : single;
  }

  /**
   * Whether this land would sit on top of where the boat starts.
   *
   * All of it or none of it: a landmass with one circle deleted out of its
   * middle is a shape nothing else in this file expects.
   */
  private blocked(islands: Island[]): boolean {
    return islands.some((isl) =>
      this.opts.keepClear.some(
        (p) => Math.hypot(p.x - isl.pos.x, p.y - isl.pos.y) <= isl.radius * 1.3 + this.opts.clearance,
      ),
    );
  }

  /**
   * Islands within `range` of a point, nearest first, at most `max` of them.
   *
   * Range is to the island's centre, because that is what every reach in this
   * file is measured from -- the wake starts at the centre, and so does the
   * shelf. Measuring to the shoreline instead would quietly pull islands into
   * the window that are a shoreline-width beyond where anything can be felt.
   */
  private collect(
    x: number,
    y: number,
    range: number,
    max: number,
    twd?: number,
  ): Island[] {
    // Widened by a landmass's reach, not by the range alone. A cell outside the
    // range can seed land that lies inside it, and the distance test below
    // throws away whatever really is too far -- so this costs a ring of empty
    // cells and buys the guarantee that nothing in range is missed.
    const pad = range + MASS_REACH;
    const c0 = Math.floor((x - pad) / CELL);
    const c1 = Math.floor((x + pad) / CELL);
    const r0 = Math.floor((y - pad) / CELL);
    const r1 = Math.floor((y + pad) / CELL);
    const from = twd === undefined ? null : compassVec(twd);

    const found: { isl: Island; d: number; rank: number }[] = [];
    for (let cx = c0; cx <= c1; cx++) {
      for (let cy = r0; cy <= r1; cy++) {
        for (const isl of this.cell(cx, cy).islands) {
          const d = Math.hypot(isl.pos.x - x, isl.pos.y - y);
          if (d > range) continue;
          found.push({ isl, d, rank: from ? relevance(isl, x, y, -from.x, -from.y, d) : 1 });
        }
      }
    }
    // Most relevant first, nearest first among equals. Distance alone is the
    // wrong order to truncate in: see relevance().
    found.sort((a, b) => b.rank - a.rank || a.d - b.d);
    if (found.length > max) found.length = max;
    return found.map((f) => f.isl);
  }

  /** Cells currently held. Exposed so a test can prove the cache stays bounded. */
  get cellCount(): number {
    return this.cells.size;
  }

  /**
   * Every island within `range`, no cap and no ranking. Only the test that
   * holds ACTIVE_RANGE to account uses this: it needs something to compare the
   * window against, and that something has to be the unwindowed truth.
   */
  debugCollectAll(x: number, y: number, range: number): Island[] {
    return this.collect(x, y, range, Number.MAX_SAFE_INTEGER);
  }

  /**
   * The window the physics and the water shader share.
   *
   * @param twd the mean wind direction, which decides what is worth keeping
   *            when there is more land in range than the shader can hold
   */
  active(x: number, y: number, twd: number): Island[] {
    return this.collect(x, y, ACTIVE_RANGE, MAX_ACTIVE_ISLANDS, twd);
  }

  /** The larger window the island meshes are built from. */
  visible(x: number, y: number): Island[] {
    this.prune(x, y);
    return this.collect(x, y, VISUAL_RANGE, MAX_VISIBLE_ISLANDS);
  }

  /**
   * The widest window, for the chart alone. Never handed to anything that
   * decides what the boat feels.
   *
   * Unranked, so it truncates by distance: if the cap is ever reached it is the
   * far edge that goes, which is the part of a chart that matters least. The
   * wind ranking `active()` uses would be wrong here -- what is worth drawing
   * is not what is worth feeling.
   */
  chart(x: number, y: number): Island[] {
    return this.collect(x, y, CHART_RANGE, MAX_CHART_ISLANDS);
  }

  /**
   * Forget cells far astern. The cache is what gives islands a stable identity,
   * but a long passage would otherwise grow it without limit. Anything dropped
   * regenerates identically if the boat ever comes back.
   */
  private prune(x: number, y: number): void {
    if (this.cells.size < 2048) return;
    // Measured from the widest window, which is now the chart's and not the
    // meshes'. Trimming to the mesh range would evict cells the chart is about
    // to ask for again, and since a cell is what gives an island its identity,
    // the coastlines traced from them would be thrown away and retraced every
    // time the window slid -- the one thing the outline cache exists to stop.
    // The doubling is the original margin: keep a window's worth beyond need.
    const keep = Math.max(VISUAL_RANGE, CHART_RANGE) * 1.5;
    const far = (cx: number, cy: number) =>
      Math.abs((cx + 0.5) * CELL - x) > keep || Math.abs((cy + 0.5) * CELL - y) > keep;
    for (const [key, c] of this.cells) if (far(c.cx, c.cy)) this.cells.delete(key);
    // And the landmasses with them. This map is filled by every cell asking its
    // neighbours, including the empty answers, so it grows faster than `cells`
    // and left alone it was the one thing on a long passage that never stopped.
    for (const key of this.masses.keys()) {
      const [cx, cy] = key.split(',');
      if (far(Number(cx), Number(cy))) this.masses.delete(key);
    }
  }
}

/** True if two windows hold exactly the same islands, so nothing need be rebuilt. */
export function sameIslands(a: readonly Island[], b: readonly Island[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
