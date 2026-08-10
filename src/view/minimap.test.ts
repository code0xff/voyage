import { describe, expect, it } from 'vitest';
import {
  ISLAND_DRAW_REACH,
  RANGES,
  chartCentre,
  clampChartCentre,
  maxChartOffset,
} from './minimap';
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
          expect(RANGES[i] + off + ISLAND_DRAW_REACH).toBeLessThanOrEqual(CHART_RANGE + 1e-9);
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
    expect(RANGES[rangeIndex] + worst + ISLAND_DRAW_REACH).toBeLessThanOrEqual(CHART_RANGE + 1e-9);
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
   * The bug itself, as the gap it left. Locked down because the fix is a second
   * window and the tempting simplification -- "just draw `terrain`" -- puts it
   * straight back.
   */
  it('could not have drawn even half the widest chart from the physics window', () => {
    expect(ACTIVE_RANGE).toBeLessThan(widest);
    expect(ACTIVE_RANGE / widest).toBeLessThan(0.5);
  });

  /**
   * The cap never bites, in any world the field can make.
   *
   * Asserted as "nothing is dropped at all" rather than "nothing inside the
   * frame is dropped", because the cap truncates by distance from the boat and
   * the chart can be held off her -- so which islands are in frame depends on
   * where it was dragged, and a filter that guessed that wrong is a test that
   * quietly stops testing. The docblock on MAX_CHART_ISLANDS claims a backstop
   * that never fires; this is that claim.
   *
   * Scanned over seeds, which is the whole lesson here. The first version took
   * one seed, passed, and blessed a cap of 192 that truncates 32 seeds in 400.
   */
  it('never truncates the chart window, in the thickest sea, over many worlds', () => {
    let most = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const field = new IslandField({
        seed,
        density: MAX_DENSITY,
        keepClear: [],
        clearance: 130,
      });
      const everything = field.debugCollectAll(0, 0, CHART_RANGE);
      expect(field.chart(0, 0)).toHaveLength(everything.length);
      most = Math.max(most, everything.length);
    }
    // Guards the guard: if the field ever stopped producing land, the loop
    // above would pass without having asked anything.
    expect(most).toBeGreaterThan(150);
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
