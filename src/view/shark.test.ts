import { describe, expect, it } from 'vitest';
import { sharkSurfaceY } from './shark';

/**
 * A renderer test, for the reason AGENTS.md allows one: this is a direction,
 * not a look. Whether a sounding shark goes down or up is a fact with an
 * answer, and the answer had better not depend on anyone remembering which way
 * the water is. How the dive *reads* is a separate question and is settled by
 * watching it, which no assertion here claims to do.
 */

describe('shark view', () => {
  it('moves a sounding shark farther below the surface', () => {
    const surface = 2;
    const size = 6;
    const heights = [0, 0.25, 0.5, 0.75, 1].map((t) => sharkSurfaceY(surface, size, t));

    expect(heights[0]).toBeLessThan(surface);
    expect(heights[heights.length - 1]).toBeLessThan(surface - 1);
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeLessThan(heights[i - 1]);
    }
  });
});
