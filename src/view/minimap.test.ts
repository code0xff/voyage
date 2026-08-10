import { describe, expect, it } from 'vitest';
import { ISLAND_DRAW_REACH, RANGES, maxChartOffset } from './minimap';
import { ACTIVE_RANGE, CHART_RANGE, IslandField, MAX_DENSITY } from '../sim/terrain';

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
    // And a coast is drawn outwards from its centre, so land whose centre is
    // outside the disc still puts a shore inside it.
    expect(disc + pan + ISLAND_DRAW_REACH).toBeLessThanOrEqual(CHART_RANGE);
  });

  /** A drag may never leave the window, and may never be tighter than the pan. */
  it('holds every range inside the window and never below the automatic pan', () => {
    for (let i = 0; i < RANGES.length; i++) {
      const offset = maxChartOffset(i);
      expect(RANGES[i] + offset + ISLAND_DRAW_REACH).toBeLessThanOrEqual(CHART_RANGE);
      // 0.55 is PAN_AT. Written out because the point is that the drag limit
      // must never bite before the chart's own panning does.
      expect(offset).toBeGreaterThanOrEqual(RANGES[i] * 0.55);
    }
  });

  /**
   * The bug itself, as the gap it left. Locked down because the fix is a second
   * window and the tempting simplification -- "just draw `terrain`" -- puts it
   * straight back.
   */
  it('could not have drawn even half the widest chart from the physics window', () => {
    expect(ACTIVE_RANGE).toBeLessThan(widest);
    expect(ACTIVE_RANGE / widest).toBeLessThan(0.5);
  });

  /**
   * Every island inside the frame is actually offered, at the thickest sea the
   * field will make. A cap that truncated here would be the same defect wearing
   * a different hat: land on the chart's own frame, not drawn.
   */
  it('offers every island inside the frame, even in the thickest sea', () => {
    const field = new IslandField({
      seed: 20260806,
      density: MAX_DENSITY,
      keepClear: [],
      clearance: 130,
    });

    // Worst case: the chart panned as far off the boat as it may go, so the
    // frame is a disc of `widest` centred that far away.
    const offset = maxChartOffset(widestIndex);
    const centre = { x: offset, y: 0 };
    const inFrame = field
      .debugCollectAll(0, 0, CHART_RANGE)
      .filter(
        (isl) =>
          Math.hypot(isl.pos.x - centre.x, isl.pos.y - centre.y) <= widest + ISLAND_DRAW_REACH,
      );

    expect(inFrame.length).toBeGreaterThan(40);
    const drawn = new Set(field.chart(0, 0));
    for (const isl of inFrame) expect(drawn.has(isl)).toBe(true);
  });

  /** And that the physics window is emphatically not enough to do that. */
  it('leaves most of them out if the physics window is used instead', () => {
    const field = new IslandField({
      seed: 20260806,
      density: MAX_DENSITY,
      keepClear: [],
      clearance: 130,
    });
    const inFrame = field.debugCollectAll(0, 0, widest);
    const feelable = new Set(field.active(0, 0, 0));
    const missed = inFrame.filter((isl) => !feelable.has(isl));
    expect(missed.length).toBeGreaterThan(inFrame.length * 0.5);
  });
});
