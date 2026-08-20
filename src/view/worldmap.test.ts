import { describe, expect, it } from 'vitest';
import { seamCrossing } from './worldmap';

/**
 * Where a passage crosses the date line.
 *
 * A renderer test, on the terms AGENTS.md sets for them: this is not a look,
 * it is a direction and a share, and both have a right answer that a
 * screenshot will not settle. The line is drawn in two halves at opposite
 * edges of the sheet, and there are exactly two ways to get it wrong -- the
 * halves on the same side, or meeting at the wrong latitude and stepping
 * across the seam. Neither is obvious at a glance on a map two thousand
 * kilometres to the pixel.
 */
describe('a leg across the date line', () => {
  const japan = { lat: 34.48, lon: 140.2 };
  const oahu = { lat: 21.32, lon: -157.9 };
  const goldenGate = { lat: 37.78, lon: -122.57 };

  it('leaves a leg that stays on the sheet alone', () => {
    expect(seamCrossing(goldenGate, oahu)).toBeNull();
    expect(seamCrossing(oahu, goldenGate)).toBeNull();
    // Exactly half the world apart is the far side of the sheet, not the near
    // side of the seam: at 180 the two ways round are the same length and the
    // straight line is no worse than the split one.
    expect(seamCrossing({ lat: 0, lon: -90 }, { lat: 0, lon: 90 })).toBeNull();
  });

  it('sends each end out through the edge its own longitude is on', () => {
    // Japan is east, so it runs off the right; sailed the other way the same
    // water runs off the left. Both halves on one side is the failure this
    // catches, and it leaves the far end of the leg joined to nothing.
    expect(seamCrossing(japan, oahu)?.eastward).toBe(true);
    expect(seamCrossing(oahu, japan)?.eastward).toBe(false);
  });

  it('meets itself at the seam whichever way she sailed it', () => {
    // The two halves are drawn at one latitude on both edges, so the leg and
    // its reverse have to agree about which. They are computed from opposite
    // ends, which is why this is worth asserting rather than assuming.
    const there = seamCrossing(japan, oahu);
    const back = seamCrossing(oahu, japan);
    expect(there?.lat).toBeCloseTo(back?.lat ?? NaN, 9);
  });

  it('crosses between the two ends and never outside them', () => {
    const { lat } = seamCrossing(japan, oahu) ?? { lat: NaN };
    expect(lat).toBeGreaterThan(oahu.lat);
    expect(lat).toBeLessThan(japan.lat);
  });

  it('crosses at once when the seam is a degree away, not halfway', () => {
    /*
     * The test that pins the share the right way up.
     *
     * A degree short of the date line and forty past it: she is over the seam
     * almost as soon as she has left, so the crossing is at her departure's
     * latitude and not at the middle of the leg. Taking the longitude to the
     * *far* edge instead -- the same subtraction with the sign the other way
     * -- puts the crossing off the end of the leg entirely, and on the map
     * that is a line that leaves the sheet through the top.
     */
    const { lat } = seamCrossing({ lat: 0, lon: 179 }, { lat: 50, lon: -140 }) ?? { lat: NaN };
    expect(lat).toBeGreaterThan(0);
    expect(lat).toBeLessThan(3);
  });

  it('crosses on the parallel it was sailed along', () => {
    // Due west along a latitude: whatever the share works out at, the
    // crossing is at that latitude, because both ends are.
    const { lat } = seamCrossing({ lat: -42, lon: -170 }, { lat: -42, lon: 160 }) ?? { lat: NaN };
    expect(lat).toBeCloseTo(-42, 9);
  });
});
