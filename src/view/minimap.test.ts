import { describe, expect, it } from 'vitest';
import { coastHeightField } from '../sim/coast';
import { RegionTerrain } from '../sim/region-terrain';
import {
  GRID,
  RANGES,
  chartCentre,
  chartPinch,
  chartRasterKey,
  clampChartCentre,
  maxChartOffset,
} from './minimap';
import { CHART_RANGE } from '../sim/terrain';

/**
 * The chart's ranges against the sea it is handed.
 *
 * A renderer test, which this project writes only for conventions and never for
 * looks -- and this is a convention: the chart may not be drawn over water the
 * field has not been asked about. Nothing visual can catch it, because an ocean
 * with no islands and an ocean whose islands were left out look identical.
 *
 * It was left to a comment before and the comment went stale. It named 1200 m
 * as the widest range at a time when that was true; 2500 and 5000 were added
 * beneath it and nothing said a word. At 5 km the chart drew five islands of
 * the fifty-four inside its own frame.
 */
describe('chart ranges', () => {
  // Found rather than assumed last, so reordering RANGES cannot quietly point
  // these assertions at a range that is not the widest.
  const widestIndex = RANGES.reduce((best, r, i) => (r > RANGES[best] ? i : best), 0);
  const widest = RANGES[widestIndex];

  /**
   * The three things that add up, from the same constants the chart uses.
   *
   * Deliberately re-derived here rather than compared against a number: the
   * point is that adding a range, widening the pan or growing the islands has
   * to move CHART_RANGE with it.
   */
  it('is handed enough sea for the widest range, its pan and its coastlines', () => {
    // The disc: the chart is clipped to a circle, so the range is the radius
    // and the square's corners are never painted.
    const disc = widest;
    // The pan: the chart is not centred on the boat. maxChartOffset is what the
    // drag is held to, and it is never less than the automatic pan.
    const pan = maxChartOffset(widestIndex);
    expect(disc + pan).toBeLessThanOrEqual(CHART_RANGE);
  });

  /** A drag may never leave the window, and may never be tighter than the pan. */
  it('holds every range inside the window and never below the automatic pan', () => {
    for (let i = 0; i < RANGES.length; i++) {
      const offset = maxChartOffset(i);
      expect(RANGES[i] + offset).toBeLessThanOrEqual(CHART_RANGE);
      // 0.55 is PAN_AT. Written out because the point is that the drag limit
      // must never bite before the chart's own panning does.
      expect(offset).toBeGreaterThanOrEqual(RANGES[i] * 0.55);
    }
  });

  /**
   * Driven through the real clamp, not through the arithmetic beside it.
   *
   * This is the assertion that matters, and the one the first version of this
   * file did not have: it checked that `maxChartOffset` returned safe numbers
   * and never that anything used them. Deleting the clamp from the draw path
   * left all five tests green.
   */
  it('never lets a held chart sit outside the window, however far it is dragged', () => {
    const boat = { x: 1234, y: -567 };
    for (let i = 0; i < RANGES.length; i++) {
      for (const pull of [0, 500, 5000, 50_000, 1e6]) {
        for (const dir of [0, 1, 2, 3, 4]) {
          const a = (dir / 5) * Math.PI * 2;
          const want = { x: boat.x + Math.cos(a) * pull, y: boat.y + Math.sin(a) * pull };
          const held = clampChartCentre(want, boat, i);
          const off = Math.hypot(held.x - boat.x, held.y - boat.y);
          // Inside the window, coast included, at every range and every pull.
          expect(RANGES[i] + off).toBeLessThanOrEqual(CHART_RANGE + 1e-9);
          // And it is a pull-back along the same line, not a jump: a drag that
          // was already legal must come back untouched.
          if (pull <= maxChartOffset(i)) {
            expect(held.x).toBeCloseTo(want.x, 9);
            expect(held.y).toBeCloseTo(want.y, 9);
          }
        }
      }
    }
  });

  /**
   * The centring rule as the chart actually runs it, over a whole passage.
   *
   * `chartCentre` is what the draw path calls, so this covers the wiring the
   * pure-clamp test above cannot: sail her a long way with the chart held, and
   * the frame must stay inside the window the entire time. That is the failure
   * the first attempt had -- clamped on pointer movement, so a chart put down
   * at the limit and left alone drifted out of the window as she sailed.
   */
  it('keeps a held chart inside the window while she sails on', () => {
    const boat = { x: 0, y: 0 };
    const rangeIndex = widestIndex;
    // Dragged as far as it will go, and then never touched again.
    const held = clampChartCentre({ x: 1e6, y: 0 }, boat, rangeIndex);
    let centre = chartCentre(null, boat, held, rangeIndex);
    let worst = 0;
    for (let step = 0; step < 400; step++) {
      boat.x += 40; // about 20 seconds of sailing, 16 km in all
      centre = chartCentre(centre, boat, held, rangeIndex);
      worst = Math.max(worst, Math.hypot(centre.x - boat.x, centre.y - boat.y));
    }
    expect(RANGES[rangeIndex] + worst).toBeLessThanOrEqual(CHART_RANGE + 1e-9);
    // And it really did get pulled about, rather than the loop having run with
    // the chart already on top of the boat.
    expect(worst).toBeGreaterThan(1000);
  });

  /** Following the boat, the chart holds still until she reaches PAN_AT. */
  it('holds still until she reaches the pan limit, then follows at her speed', () => {
    const rangeIndex = 2;
    const range = RANGES[rangeIndex];
    const start = { x: 0, y: 0 };
    // Inside the limit: the centre must not move at all.
    const near = chartCentre(start, { x: range * 0.5, y: 0 }, null, rangeIndex);
    expect(near).toEqual(start);
    // Past it: moved by exactly the overshoot, so the chart tracks her speed.
    const over = range * 0.55 + 120;
    const far = chartCentre(start, { x: over, y: 0 }, null, rangeIndex);
    expect(far.x).toBeCloseTo(120, 9);
    expect(far.y).toBeCloseTo(0, 9);
  });

  /**
   * A grid spacing for every range.
   *
   * Regression: GRID sat at three entries while RANGES grew to five, so on
   * the passage scales `GRID[rangeIndex]` was undefined, the first grid
   * coordinate came out NaN, and the canvas dropped the whole path without a
   * word -- a chart with every layer but its grid, at the very range every
   * new voyage now opens on.
   */
  it('has a grid spacing for every range, with lines on the chart to count', () => {
    expect(GRID.length).toBe(RANGES.length);
    for (let i = 0; i < RANGES.length; i++) {
      // Positive and finite is what keeps NaN out of the draw path; smaller
      // than the range is what puts gridlines on the chart at all.
      expect(GRID[i]).toBeGreaterThan(0);
      expect(GRID[i]).toBeLessThan(RANGES[i]);
    }
  });
});

/**
 * The pinch against the ranges. A convention again, and the same one twice
 * over: which way the chart scales when the fingers spread, and that a
 * gesture must *earn* its steps rather than spraying them -- the ranges are
 * discrete, and a pinch that stepped on every pointer event would run the
 * whole ladder in a frame, which is the failure the wheel accumulator in
 * MinimapCard already guards against.
 *
 * Driven the way the pointer stream drives it: as a run of small ratios, not
 * one clean number per test.
 */
describe('pinching the chart', () => {
  /** Feed a total gap change through in `n` even multiplicative slices. */
  const gesture = (total: number, n = 20, acc = 1): { acc: number; steps: number } => {
    let steps = 0;
    for (let i = 0; i < n; i++) {
      const r = chartPinch(acc, Math.pow(total, 1 / n));
      acc = r.acc;
      steps += r.step;
    }
    return { acc, steps };
  };

  it('spreading the fingers narrows the range -- a closer look', () => {
    expect(gesture(2.5).steps).toBeLessThan(0);
  });

  it('closing them widens it', () => {
    expect(gesture(1 / 2.5).steps).toBeGreaterThan(0);
  });

  it('a jitter earns nothing', () => {
    expect(gesture(1.1).steps).toBe(0);
  });

  it('one wide pinch earns more than one step', () => {
    expect(gesture(4).steps).toBeLessThanOrEqual(-2);
    // Even delivered as one event -- a fast pinch can double between frames,
    // and a single-step return would swallow the rest of it. Both directions,
    // because the two loops in chartPinch are separate code and only one of
    // them being capped would pass a spread-only assertion.
    expect(chartPinch(1, 4).step).toBeLessThanOrEqual(-2);
    expect(chartPinch(1, 1 / 4).step).toBeGreaterThanOrEqual(2);
  });

  it('a reversal starts a new gesture, forfeiting the travel so far', () => {
    // Spread almost to a step, then close. If the reversal kept the spread's
    // credit, the close would have to pay it back before earning anything;
    // instead it starts from rest and earns its own step on its own travel.
    const spread = gesture(1.7);
    expect(spread.steps).toBe(0);
    const closed = gesture(1 / 1.9, 20, spread.acc);
    expect(closed.steps).toBe(1);
  });
});

/**
 * The chart raster cache, keyed on the land as well as the view.
 *
 * Regression: the key held only centre, range, draft and canvas size, so any
 * change to the *terrain* under an unchanged view served the old raster --
 * roll a generated coast's seed and the previous shore stayed drawn until
 * the boat had moved a quantisation step; slide the coast's window and the
 * chart lagged a session behind. Driven through the real key builder.
 */
describe('the chart raster key', () => {
  const view = [0, 0, 1200, 1.9, 416, 6] as const;

  it('is stable while nothing changed', () => {
    const { region, height } = coastHeightField(13);
    const t = new RegionTerrain(region, height);
    expect(chartRasterKey(t, ...view)).toBe(chartRasterKey(t, ...view));
  });

  it('changes with the seed under the same view', () => {
    const a = coastHeightField(13);
    const b = coastHeightField(14);
    expect(chartRasterKey(new RegionTerrain(a.region, a.height), ...view)).not.toBe(
      chartRasterKey(new RegionTerrain(b.region, b.height), ...view),
    );
  });

  it('changes when the window slides under the same view', () => {
    const a = coastHeightField(13);
    const b = coastHeightField(13, { x: 3000, y: 0 });
    expect(chartRasterKey(new RegionTerrain(a.region, a.height), ...view)).not.toBe(
      chartRasterKey(new RegionTerrain(b.region, b.height), ...view),
    );
  });
});
