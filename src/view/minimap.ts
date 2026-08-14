import type { BoatState } from '../sim/boat';
import { CHART_RANGE, MAX_ISLAND_RADIUS, Terrain, sameIslands, type Island } from '../sim/terrain';
import { CRUISER } from '../sim/config';
import type { RegionTerrain } from '../sim/region-terrain';
import type { WindField } from '../sim/wind';
import { clamp, compassVec, type Vec2 } from '../sim/math';
import type { CurrentField } from '../sim/current';
import { token } from '../ui/tokens';

/**
 * The chart.
 *
 * A chart in a sailing game is not there to stop you getting lost. It is there
 * to show the two things that decide where to sail and that a helmsman cannot
 * see from the deck, and to be the thing you point at to say where you are
 * bound:
 *
 *   1. **Where the breeze is.** The wind is a pure function of position, so it
 *      can simply be drawn: blue where there is more of it, grey where there
 *      is less, and nothing where it is average. The hole behind an island
 *      falls out of the same sample, which turns "do not sail into the lee"
 *      from advice into something you can look at. This is the whole reason
 *      the chart earns its screen space.
 *   2. **Where the water runs out.** The shoreline drawn here is traced through
 *      the same elevationAt() the boat grounds on, and the second contour is
 *      the depth this hull actually needs, so the line on the chart is the line
 *      you go aground on rather than an artist's impression of it.
 *
 * Everything is drawn north-up. Course-up would spin the whole world on every
 * tack, and the one thing a chart has to be is still.
 */

/**
 * The ranges the chart cycles through, m from the centre to the edge.
 *
 * The first three are pilotage scales -- what is close enough to hit. The last
 * two arrived with the surveyed regions and are passage scales: a 20 km bay
 * cannot be planned on a 1200 m chart, where the Golden Gate is off the edge
 * from the city front and the only thing visible is the water already under
 * the keel.
 */
export const RANGES = [300, 700, 1200, 2500, 5000] as const;

/** Grid spacing at each range, m. Something to count, so distance is readable. */
const GRID = [100, 200, 500] as const;

/**
 * How far from the centre the boat may get before the chart starts to pan,
 * as a fraction of the range.
 *
 * This is the whole difference between a chart you can judge progress on and
 * one you cannot. Locked to the boat, the land creeps by at under a pixel a
 * second and nothing appears to happen; held still, the boat visibly crosses
 * the water and past an island. Once it reaches the limit the chart pans at
 * exactly the boat's speed, which keeps the water ahead in view without ever
 * jumping.
 */
const PAN_AT = 0.55;

/**
 * How far a chart's own drawing reaches past an island's centre, m.
 *
 * A shape is traced outwards from the centre, so land whose centre sits outside
 * the disc still puts a coast inside it. `traceOutline` marches to exactly this
 * for the largest island the field makes.
 */
export const ISLAND_DRAW_REACH = MAX_ISLAND_RADIUS * 1.45 + CRUISER.draft * 14 + 30;

/**
 * How far the chart may be dragged off the boat at this range, m.
 *
 * The chart is drawn from a window of sea collected around the *boat*, so a
 * drag is only honest as long as it stays inside it. Unbounded, which it was,
 * it could be pulled into water the field has never been asked about -- and
 * that water draws as empty ocean, which is the exact lie this whole window
 * exists to stop, arrived at from the other direction.
 *
 * Wider at the close ranges, where looking around is what the drag is for, and
 * tighter at 5 km, where the disc has already eaten most of the window. Always
 * at least the automatic pan, so holding the chart still while she sails across
 * it can never hit the limit.
 */
export function maxChartOffset(rangeIndex: number): number {
  const range = RANGES[rangeIndex] ?? RANGES[0];
  return Math.max(range * PAN_AT, CHART_RANGE - range - ISLAND_DRAW_REACH);
}

/**
 * Where the chart looks this frame.
 *
 * The whole centring rule, and pure, so that it can be driven by a test instead
 * of inferred from a canvas -- the same reason `dragTo` is separated out in
 * `orbit.ts`. Keeping the clamp alone pure was not enough: a first attempt put
 * it in the pointer handler, where it was correct for exactly as long as a
 * finger was down, and the test happily passed because it was checking the
 * arithmetic rather than the code that used it.
 *
 * @param prev  last frame's centre, or null on the first frame
 * @param boat  where she is now
 * @param pan   where the player has dragged the chart, or null to follow
 */
export function chartCentre(
  prev: Vec2 | null,
  boat: Vec2,
  pan: Vec2 | null,
  rangeIndex: number,
): Vec2 {
  const range = RANGES[rangeIndex] ?? RANGES[0];
  // Dragged: the chart stays where it was put and the boat is free to sail off
  // the edge of it, which is the point of having taken hold. Held inside the
  // island window, though -- that window is collected around the boat and
  // follows her, so a chart put down at the limit and then left alone would
  // drift outside it as she sails on.
  if (pan) return clampChartCentre(pan, boat, rangeIndex);
  // First frame, or the boat has been teleported by a restart.
  if (!prev || Math.hypot(boat.x - prev.x, boat.y - prev.y) > range * 2) return { ...boat };
  // Otherwise hold the view still and let her move across it, panning only once
  // she reaches the limit -- and then by exactly the distance she is over it, so
  // the pan matches her speed rather than chasing it.
  const offX = boat.x - prev.x;
  const offY = boat.y - prev.y;
  const off = Math.hypot(offX, offY);
  const limit = range * PAN_AT;
  if (off <= limit) return prev;
  return { x: prev.x + (offX / off) * (off - limit), y: prev.y + (offY / off) * (off - limit) };
}

/**
 * Where a dragged chart is actually centred: where it was put, pulled back
 * along the same line if that is outside the window.
 *
 * Separated from the drawing so the rule can be asserted without a canvas --
 * and, as with `dragTo` in `orbit.ts`, so that it is asserted *through the code
 * that implements it* rather than against a second copy of the arithmetic. A
 * test that only checked `maxChartOffset` returned safe numbers passed happily
 * while the draw path ignored them, which is how the first version of this went
 * in.
 */
export function clampChartCentre(want: Vec2, boat: Vec2, rangeIndex: number): Vec2 {
  const off = Math.hypot(want.x - boat.x, want.y - boat.y);
  const reach = maxChartOffset(rangeIndex);
  if (off <= reach || off === 0) return want;
  return {
    x: boat.x + ((want.x - boat.x) / off) * reach,
    y: boat.y + ((want.y - boat.y) / off) * reach,
  };
}

/*
 * This list used to be bounded by the physics, and the comment here said so:
 * the island window reaches ACTIVE_RANGE, so beyond it the chart would show
 * open water where there is land. It named 1200 m as the ceiling that kept the
 * far corner inside the window.
 *
 * Then 2500 and 5000 were added beneath it for the surveyed regions, which
 * bring their own coast and never had the problem -- and the comment was left
 * alone, so the procedural ocean quietly got the failure the comment had
 * predicted. At 5 km the chart held five islands of the fifty-four inside its
 * own frame.
 *
 * The bound is the other way round now: `CHART_RANGE` is the sea the field
 * hands the chart, and `minimap.test.ts` adds up what the widest range actually
 * needs -- the disc, the pan, and how far a coast is drawn past its own centre
 * -- and holds CHART_RANGE to it. Adding a range wider than the window fails a
 * test instead of quietly drawing an empty ocean.
 *
 * Not the corner: the chart is clipped to a circle, so the range is the radius
 * and the square's corners are never painted.
 */

/** How many wind samples across the chart. Coarse: this is pressure, not detail. */
const WIND_CELLS = 28;
/**
 * How many tide arrows across the chart.
 *
 * Far coarser than the wind, and it has to be: the wind layer is a wash of
 * colour that reads as pressure, while these are arrows a player counts and
 * follows. A grid this size is a tidal atlas page; twice it is a texture.
 */
const TIDE_CELLS = 7;
/** Bearings used to trace a coastline. */
const BEARINGS = 36;
/** Redraw interval for the wind layer, ms. It advects far too slowly to need 60 Hz. */
const WIND_INTERVAL = 120;

const TRACK_MAX = 240;
/** Metres between recorded track points. */
const TRACK_STEP = 12;

export interface MinimapInput {
  state: BoatState;
  wind: WindField;
  terrain: Terrain;
  /**
   * The land to draw: the same sea as `terrain`, but out as far as this chart
   * can be zoomed rather than as far as the boat can feel.
   *
   * The two are different windows on purpose. `terrain` stops at ACTIVE_RANGE
   * because nothing beyond it can change what the boat does, which is exactly
   * the wrong bound for a chart -- at the 5 km range that window covers 45% of
   * the radius, and the chart drew open water over the rest.
   */
  chart: Terrain;
  /** The surveyed region, or null in the procedural ocean. */
  region: RegionTerrain | null;
  /** Depth the hull needs, m. The shoal contour is drawn at exactly this. */
  draft: number;
  /** Index into RANGES. */
  range: number;
  /** Bumped by the engine on every new session; the track starts over on it. */
  session: number;
  /** Where the boat is bound, or null when she is just out sailing. */
  destination: Vec2 | null;
  /** The tidal streams, so the chart can show where they run. */
  currents: CurrentField;
  /**
   * Where to centre the chart, or null to follow the boat.
   *
   * Set while the player is dragging the chart about to look ahead. Following
   * is the right default -- the thing you most want to see is where you are --
   * but a passage is planned by looking at water you have not reached yet, and
   * on a surveyed coast there is a great deal of it.
   */
  pan: Vec2 | null;
}

/**
 * The region's land and shoals, painted cell by cell into an offscreen canvas.
 *
 * Kept between frames and redrawn only when the view actually moved. The
 * resolution is deliberately coarser than the screen -- a chart cell is a few
 * pixels -- because the underlying grid is 25 m and drawing it finer would
 * claim a precision the survey does not have.
 */
const CHART_CELL = 2;

/**
 * One chart's cached raster.
 *
 * Per `Minimap` and not per module, because there is more than one chart now:
 * the card and the full-screen view are two instances, and a single shared
 * canvas would be resized by whichever drew last. That resize clears the key,
 * so two charts of different sizes drawing in the same frame would each force a
 * full re-render of the other's -- a per-frame terrain sweep, for a cache.
 */
interface ChartCache {
  canvas: HTMLCanvasElement | null;
  key: string;
}

function drawRegion(
  cache: ChartCache,
  ctx: CanvasRenderingContext2D,
  region: RegionTerrain,
  size: number,
  centreX: number,
  centreY: number,
  range: number,
  draft: number,
): void {
  // Rendered at device resolution and drawn back down, not at CSS pixels.
  // The chart context is already scaled by the device ratio, so an offscreen
  // canvas sized in CSS pixels gets magnified on the way in and the coast comes
  // out in visible blocks -- the data is 25 m, and it should not look like 50.
  const dpr = Math.min(devicePixelRatio, 2);
  const px = Math.round(size * dpr);
  // Quantised to about one device pixel of travel, not to a fixed 8 m. Eight
  // metres is a pixel on a 208 px card at 700 m range and nine pixels on a
  // full-screen chart at 300 m, where the coastline would visibly step as she
  // moved. Redrawing costs a few milliseconds and is cached; stepping is a
  // chart that looks broken.
  const step = Math.max(1, (range * 2) / px);
  const key = `${Math.round(centreX / step)},${Math.round(centreY / step)},${range},${draft},${px}`;
  if (!cache.canvas) {
    cache.canvas = document.createElement('canvas');
  }
  const chartCanvas = cache.canvas;
  if (chartCanvas.width !== px || chartCanvas.height !== px) {
    chartCanvas.width = px;
    chartCanvas.height = px;
    cache.key = '';
  }
  if (cache.key !== key) {
    cache.key = key;
    const c = chartCanvas.getContext('2d');
    if (c) {
      c.clearRect(0, 0, px, px);
      const land = token('--muted-foreground', 0.85);
      const shoal = token('--warning', 0.22);
      const metresPerPixel = (range * 2) / px;
      for (let dy = 0; dy < px; dy += CHART_CELL) {
        for (let dx = 0; dx < px; dx += CHART_CELL) {
          const wx = centreX + (dx + CHART_CELL / 2 - px / 2) * metresPerPixel;
          // Screen y grows downward and north is up, hence the negation.
          const wy = centreY - (dy + CHART_CELL / 2 - px / 2) * metresPerPixel;
          const depth = region.depthAt(wx, wy);
          if (depth > draft) continue;
          // Two bands and no more: what will float you, and what will not.
          // A chart that shaded every metre would be prettier and would take
          // longer to read, and the only question here is the one question.
          c.fillStyle = depth > 0 ? shoal : land;
          c.fillRect(dx, dy, CHART_CELL, CHART_CELL);
        }
      }
    }
  }
  ctx.drawImage(chartCanvas, 0, 0, size, size);
}

/** Shore and safe-water radius at each bearing, both measured from the centre. */
interface Outline {
  shore: Float32Array;
  safe: Float32Array;
  /**
   * The neighbours this shape was traced with. elevationAt() merges islands
   * that share a shelf, so an outline is a function of them too, and one keyed
   * on its island alone goes stale the moment a neighbour loads or drops.
   */
  deps: readonly Island[];
}

export interface Minimap {
  draw(ctx: CanvasRenderingContext2D, size: number, input: MinimapInput): void;
  /**
   * The world position under a canvas pixel, for pointing at somewhere to go.
   *
   * Only meaningful after a draw, since the chart's centre pans with the boat
   * and it is the last drawn centre a click is being read against.
   */
  worldAt(px: number, py: number, size: number, rangeIndex: number): Vec2;
  /** Where the chart is centred now, so a drag can begin from it. */
  centre(): Vec2;
}

/**
 * Trace an island by marching out along each bearing until the ground drops
 * below sea level, and again until it drops below the boat's draft.
 *
 * elevationAt() takes the highest of every island, so two islands close enough
 * to share a shelf trace as the single piece of land the boat will actually
 * meet.
 */
function traceOutline(terrain: Terrain, isl: Island, draft: number): Outline {
  const shore = new Float32Array(BEARINGS);
  const safe = new Float32Array(BEARINGS);
  const deps = terrain.islandsAffecting(isl);
  /*
   * Sampled against this island and its neighbours alone, not the whole chart.
   *
   * `elevationAt` walks every island it is given, so tracing against the full
   * terrain made this quadratic in how much land is on screen -- fine for the
   * dozen the physics window holds, and 317 ms for the hundred and twenty a
   * five-kilometre chart can hold at the thickest island setting.
   *
   * The answers are identical, and that is not a hope. `islandsAffecting` is
   * defined as every island whose ground can reach inside this one's tracing
   * radius, which is the same claim the outline cache already stakes its
   * correctness on: `deps` is what a redraw is checked against. Anything
   * outside it cannot raise the seabed anywhere this march looks.
   */
  const local = new Terrain([isl, ...deps]);
  // Far enough out to clear the shelf: the seabed falls away slowly, so safe
  // water is a good way beyond the beach.
  const outer = isl.radius * 1.45 + draft * 14 + 30;
  const step = outer / 60;

  for (let i = 0; i < BEARINGS; i++) {
    const a = (i / BEARINGS) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let foundShore = false;
    // If the march never reaches water -- which happens on the bearing towards
    // a neighbour close enough to share a shelf -- the honest answer is "land
    // all the way out". Leaving it at zero would spike the outline back to the
    // island's centre and draw a bite out of the coast that is not there.
    shore[i] = outer;
    safe[i] = outer;
    for (let r = isl.radius * 0.35; r <= outer; r += step) {
      const e = local.elevationAt(isl.pos.x + dx * r, isl.pos.y + dy * r);
      if (!foundShore && e < 0) {
        shore[i] = r;
        foundShore = true;
      }
      if (foundShore && -e >= draft) {
        safe[i] = r;
        break;
      }
    }
  }
  return { shore, safe, deps };
}

export function createMinimap(): Minimap {
  // Outlines are keyed on the island object, which the island field hands back
  // unchanged for as long as a piece of sea stays loaded. Tracing costs a few
  // hundred elevation samples and must not happen per frame.
  const outlines = new Map<Island, Outline>();

  // This chart's own raster cache. See ChartCache.
  const chart: ChartCache = { canvas: null, key: '' };

  // The chart keeps its own track of where she has been.
  const track = new Float32Array(TRACK_MAX * 2);
  let trackCount = 0;

  const windLayer = document.createElement('canvas');
  let windDrawnAt = -Infinity;
  let windRange = -1;
  let windCx = NaN;
  let windCy = NaN;
  const windOut: [number, number] = [1, 0];

  let session = -1;

  // Where the chart is looking. World coordinates, and deliberately not the
  // boat's: see PAN_AT.
  let centreX = NaN;
  let centreY = NaN;

  function pushTrack(x: number, y: number): void {
    if (trackCount > 0) {
      const lx = track[(trackCount - 1) * 2];
      const ly = track[(trackCount - 1) * 2 + 1];
      if (Math.hypot(x - lx, y - ly) < TRACK_STEP) return;
    }
    if (trackCount === TRACK_MAX) {
      track.copyWithin(0, 2);
      trackCount--;
    }
    track[trackCount * 2] = x;
    track[trackCount * 2 + 1] = y;
    trackCount++;
  }

  /**
   * The breeze, painted one pixel per sample and blown up to fill the chart.
   *
   * Drawing the cells at full size instead looked like a chessboard, and the
   * half-pixel overlap needed to close the gaps between them made it worse:
   * translucent fills laid over each other double up, so the seams the overlap
   * was there to hide came back darker. At one pixel a cell there is nothing to
   * overlap, and letting the canvas scale it up gives the smooth gradient a
   * pressure map should have anyway.
   */
  function drawWind(input: MinimapInput, range: number, cx: number, cy: number): void {
    if (windLayer.width !== WIND_CELLS) {
      windLayer.width = WIND_CELLS;
      windLayer.height = WIND_CELLS;
    }
    const ctx = windLayer.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, WIND_CELLS, WIND_CELLS);

    const mPerCell = (2 * range) / WIND_CELLS;
    // Breeze reads blue, its absence reads as flat grey.
    //
    // Two earlier attempts were wrong in instructive ways. --foreground makes
    // the lull dark on a light theme and very nearly white on a dark one, so
    // an island's wind shadow arrived as a bright plume: the one patch of
    // water with no breeze in it, drawn as the brightest thing on the chart.
    // Anything keyed to light-versus-dark has that problem, because that is
    // precisely what a theme inverts.
    //
    // --destructive fixed the inversion and introduced a worse fault. This
    // colour is not the lee alone: it is every point below the mean, which in
    // a gusty field is most of the water. Painting ordinary gustiness in a
    // warning colour teaches the eye to discount the colour, and then the one
    // lee that matters does not stand out either. Grey claims nothing, and the
    // deep lees still separate themselves -- a shadow takes the breeze down by
    // nine tenths, so the alpha ramp alone makes it far the darkest thing here.
    const puff = token('--info');
    const lull = token('--muted-foreground');

    for (let gx = 0; gx < WIND_CELLS; gx++) {
      for (let gy = 0; gy < WIND_CELLS; gy++) {
        // Canvas y runs down, north runs up.
        const wx = cx + (gx + 0.5 - WIND_CELLS / 2) * mPerCell;
        const wy = cy - (gy + 0.5 - WIND_CELLS / 2) * mPerCell;
        input.wind.sampleInto(wx, wy, windOut);

        // sampleInto returns gust * exposure, so an island's wind shadow is
        // already in it -- the hole behind the land draws itself.
        const t = windOut[0] - 1;
        // Puffs and lulls need different scales. A puff is a few per cent; a
        // lee takes the breeze down by nine tenths, and on one scale every
        // shadow saturates into the same flat grey with no gradient to read.
        const strength = t > 0 ? clamp(t * 2.6, 0, 1) : clamp(-t * 1.15, 0, 1);
        if (strength < 0.04) continue;
        ctx.globalAlpha = strength * (t > 0 ? 0.45 : 0.5);
        ctx.fillStyle = t > 0 ? puff : lull;
        ctx.fillRect(gx, gy, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * The chart's scale and centre, in one place.
   *
   * Shared by drawing and by reading a click back out, because they are the
   * same transform in opposite directions -- and a second copy of it would put
   * the destination somewhere other than where the player pointed, which is the
   * kind of wrong that looks like a physics bug.
   */
  const view = (size: number, range: number) => ({
    k: size / (2 * range), // px per metre
    cx: size / 2,
    cy: size / 2,
  });

  return {
    /** Where on the chart a canvas pixel is, in world coordinates. */
    centre() {
      return { x: centreX, y: centreY };
    },
    worldAt(px, py, size, rangeIndex) {
      const range = RANGES[clamp(rangeIndex, 0, RANGES.length - 1)];
      const { k, cx, cy } = view(size, range);
      // The y axis is flipped on the way out, so it flips back on the way in.
      return { x: centreX + (px - cx) / k, y: centreY - (py - cy) / k };
    },

    draw(ctx, size, input) {
      const rangeIndex = clamp(input.range, 0, RANGES.length - 1);
      const range = RANGES[rangeIndex];
      const { k, cx, cy } = view(size, range);
      const bx = input.state.pos.x;
      const by = input.state.pos.y;

      const centred = chartCentre(
        Number.isFinite(centreX) ? { x: centreX, y: centreY } : null,
        { x: bx, y: by },
        input.pan,
        rangeIndex,
      );
      centreX = centred.x;
      centreY = centred.y;

      const sx = (x: number) => cx + (x - centreX) * k;
      const sy = (y: number) => cy - (y - centreY) * k;

      // A new session is a new track. Guessing from a teleport did not work:
      // the finish gate is the start gate, so a restart moves the boat about
      // ninety metres and the next session drew on joined to the last one.
      if (input.session !== session) {
        session = input.session;
        trackCount = 0;
      }
      pushTrack(bx, by);

      ctx.clearRect(0, 0, size, size);
      ctx.save();
      // Everything is clipped to the chart circle, so land and breeze run off
      // the edge instead of stopping at a square nobody drew.
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2 - 1, 0, Math.PI * 2);
      ctx.clip();

      ctx.fillStyle = token('--muted', 0.55);
      ctx.fillRect(0, 0, size, size);

      // --- Wind -----------------------------------------------------------
      // Time is the usual trigger; the distance test only catches a jump. The
      // chart pans at sailing speed, so between two redraws the layer is stale
      // by well under a pixel, but a restart moves it a kilometre at once.
      const now = performance.now();
      if (
        now - windDrawnAt > WIND_INTERVAL ||
        windRange !== range ||
        Math.hypot(centreX - windCx, centreY - windCy) > range * 0.05
      ) {
        drawWind(input, range, centreX, centreY);
        windDrawnAt = now;
        windRange = range;
        windCx = centreX;
        windCy = centreY;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(windLayer, 0, 0, size, size);

      // --- Grid ---------------------------------------------------------------
      // Anchored to round world coordinates, not to the chart, so it slides
      // under the boat as she sails. Watching it go past is the difference
      // between knowing you are moving and being told you are, and the squares
      // give a distance you can count rather than estimate.
      const grid = GRID[rangeIndex];
      ctx.strokeStyle = token('--foreground', 0.1);
      ctx.lineWidth = 1;
      ctx.beginPath();
      const first = Math.ceil((centreX - range) / grid) * grid;
      for (let gx = first; gx <= centreX + range; gx += grid) {
        ctx.moveTo(sx(gx), 0);
        ctx.lineTo(sx(gx), size);
      }
      const firstY = Math.ceil((centreY - range) / grid) * grid;
      for (let gy = firstY; gy <= centreY + range; gy += grid) {
        ctx.moveTo(0, sy(gy));
        ctx.lineTo(size, sy(gy));
      }
      ctx.stroke();

      // --- Land -------------------------------------------------------------
      // A region is drawn by sampling, not by tracing.
      //
      // The circle chart traces a shoreline outward from each island's centre
      // at 36 bearings, which is only possible because a circle has a centre
      // and one radius per bearing. A real coast has neither -- Raccoon Strait
      // would come out as a bite, and anywhere the shore doubles back the ray
      // would find the wrong side of it. So the region is read the way a chart
      // is actually made: sample the ground, and colour by what is under you.
      //
      // Cached, and redrawn only when the boat has moved a pixel's worth or the
      // range changed. Filling a 176 px chart is 31,000 samples, which is
      // nothing once but real work at 60 Hz for a picture that is identical
      // between frames.
      if (input.region) {
        drawRegion(chart, ctx, input.region, size, centreX, centreY, range, input.draft);
      }
      for (const isl of input.chart.islands) {
        let outline = outlines.get(isl);
        if (!outline || !sameIslands(outline.deps, input.chart.islandsAffecting(isl))) {
          outline = traceOutline(input.chart, isl, input.draft);
          outlines.set(isl, outline);
        }
        const ring = (radii: Float32Array) => {
          ctx.beginPath();
          for (let i = 0; i < BEARINGS; i++) {
            const a = (i / BEARINGS) * Math.PI * 2;
            const x = sx(isl.pos.x + Math.cos(a) * radii[i]);
            const y = sy(isl.pos.y + Math.sin(a) * radii[i]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
        };
        // Shoal first, so the land sits on top of its own shallows.
        ring(outline.safe);
        ctx.fillStyle = token('--warning', 0.22);
        ctx.fill();
        ring(outline.shore);
        ctx.fillStyle = token('--muted-foreground', 0.85);
        ctx.fill();
      }

      // Drop stale outlines. Islands fall astern for ever in an endless ocean,
      // and a map that never forgot them would grow all session.
      if (outlines.size > input.chart.islands.length + 24) {
        const live = new Set(input.chart.islands);
        for (const isl of [...outlines.keys()]) if (!live.has(isl)) outlines.delete(isl);
      }

      // --- Tide ---------------------------------------------------------------
      // The stream, as arrows on a grid, in the manner of a tidal atlas. Until
      // now the only way to know a tide was running was to read SOG against BSP
      // and work it out -- and in a place where the tide is the whole game, a
      // number you have to derive is a thing most players will never see.
      //
      // Length carries the rate, so the slack water inshore is visibly slack:
      // that inshore lane is the decision the venue exists for, and it has to be
      // legible on the chart before it can be chosen.
      if (input.currents.running) {
        const step = size / TIDE_CELLS;
        ctx.strokeStyle = token('--info', 0.5);
        ctx.lineWidth = 1;
        for (let gy = 0; gy < TIDE_CELLS; gy++) {
          for (let gx = 0; gx < TIDE_CELLS; gx++) {
            const px = (gx + 0.5) * step;
            const py = (gy + 0.5) * step;
            const w = { x: centreX + (px - cx) / k, y: centreY - (py - cy) / k };
            const rate = input.currents.rateAt(w.x, w.y);
            if (rate < 0.08) continue;
            const v = input.currents.peak;
            const m = Math.hypot(v.x, v.y);
            if (m < 1e-6) continue;
            // Screen y runs the other way from north, hence the minus.
            const ux = (v.x / m) * rate;
            const uy = -(v.y / m) * rate;
            const half = step * 0.42;
            ctx.globalAlpha = 0.25 + 0.75 * rate;
            ctx.beginPath();
            ctx.moveTo(px - ux * half, py - uy * half);
            ctx.lineTo(px + ux * half, py + uy * half);
            // A barb on the leading end, so the arrow says which way it sets --
            // a plain tick would leave the one thing a tide has to tell you out.
            ctx.lineTo(px + ux * half - (ux + uy) * half * 0.45, py + uy * half - (uy - ux) * half * 0.45);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      }

      // --- Track ------------------------------------------------------------
      if (trackCount > 1) {
        ctx.beginPath();
        for (let i = 0; i < trackCount; i++) {
          const x = sx(track[i * 2]);
          const y = sy(track[i * 2 + 1]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = token('--foreground', 0.3);
        ctx.lineWidth = 1;
        ctx.stroke();
      }


      // --- Where she is bound --------------------------------------------------
      // Drawn before the boat so the boat sits on top of it on arrival, and as a
      // ring with the rhumb line to it rather than a filled dot: the line is the
      // useful part, because the gap between it and the track astern is the tide
      // and the leeway, made visible without a number.
      if (input.destination) {
        const dx = sx(input.destination.x);
        const dy = sy(input.destination.y);
        ctx.strokeStyle = token('--info', 0.55);
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx(bx), sy(by));
        ctx.lineTo(dx, dy);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = token('--info');
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(dx, dy, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(dx, dy, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = token('--info');
        ctx.fill();
      }

      // --- Boat ---------------------------------------------------------------
      ctx.save();
      ctx.translate(sx(bx), sy(by));
      ctx.rotate(input.state.heading); // compass bearing, and north is up
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(4.5, 5);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(-4.5, 5);
      ctx.closePath();
      ctx.fillStyle = token('--foreground');
      ctx.fill();
      ctx.restore();

      ctx.restore(); // end clip

      // --- Frame, north and wind ----------------------------------------------
      ctx.strokeStyle = token('--border');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2 - 1, 0, Math.PI * 2);
      ctx.stroke();

      // The true wind, drawn flying with the breeze from the edge of the rose,
      // which is the way a wind barb is read on any chart.
      // Kept short and clear of the rim, so it cannot sit on top of the north
      // mark on the one bearing that matters most -- a northerly.
      const from = compassVec(input.wind.baseTwd);
      const r = size / 2 - 18;
      const tipX = cx + from.x * r * 0.45;
      const tipY = cy - from.y * r * 0.45;
      const tailX = cx + from.x * r;
      const tailY = cy - from.y * r;
      ctx.strokeStyle = token('--info');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tailX, tailY, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = token('--info');
      ctx.fill();

      ctx.font = '9px ui-monospace, "JetBrains Mono", monospace';
      ctx.fillStyle = token('--muted-foreground');
      ctx.textAlign = 'center';
      ctx.fillText('N', cx, 10);
    },
  };
}
