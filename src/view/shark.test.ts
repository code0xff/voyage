import { describe, expect, it } from 'vitest';
import { sharkSurfaceY } from './shark';

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
