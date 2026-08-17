import { describe, expect, it } from 'vitest';
import { approach, approachAngle, wrap2Pi, wrapPi } from './math';

/**
 * The angular lag. Its whole reason for existing is the wrap: the plain
 * `approach` takes the long way round whenever two angles straddle it, and
 * a wind backing from 350 degrees to 10 would swing through south.
 */
describe('easing an angle', () => {
  const deg = (r: number) => ((r * 180) / Math.PI + 360) % 360;
  const rad = (d: number) => (d * Math.PI) / 180;

  it('goes the short way across the wrap', () => {
    // 350 to 10 is twenty degrees clockwise, not three hundred and forty
    // the other way. A full second at a one-second constant covers most of
    // it, and the point is which side of 0 it lands on.
    const next = deg(approachAngle(rad(350), rad(10), 1, 1));
    expect(next > 350 || next < 10).toBe(true);
    // And the plain lag, for contrast, heads off through the south.
    expect(deg(approach(rad(350), rad(10), 1, 1))).toBeGreaterThan(60);
  });

  it('arrives, and stays', () => {
    let a = rad(120);
    for (let i = 0; i < 200; i++) a = approachAngle(a, rad(300), 1, 0.1);
    expect(deg(a)).toBeCloseTo(300, 3);
    expect(deg(approachAngle(rad(300), rad(300), 1, 0.1))).toBeCloseTo(300, 9);
  });

  it('is a lag, not a jump', () => {
    // One step of a tenth of its constant moves about a tenth of the way.
    const moved = deg(approachAngle(rad(0), rad(100), 1, 0.1));
    expect(moved).toBeGreaterThan(5);
    expect(moved).toBeLessThan(15);
  });
});

/**
 * The wrap's own endpoints, pinned because the convention is the point.
 *
 * `wrapPi`'s docblock promised (-PI, PI] and the code delivered [-PI, PI) --
 * caught by a review, and left as the code has it. What matters is that the
 * two agree and that nothing changes it by accident: this is the function
 * every sign convention in the project is expressed through.
 */
describe('wrapping an angle', () => {
  it('puts exactly astern at the bottom of the range', () => {
    expect(wrapPi(Math.PI)).toBe(-Math.PI);
    expect(wrapPi(-Math.PI)).toBe(-Math.PI);
    expect(wrapPi(3 * Math.PI)).toBe(-Math.PI);
  });

  it('leaves everything inside the range alone', () => {
    for (const a of [0, 1, -1, 3, -3]) expect(wrapPi(a)).toBeCloseTo(a, 12);
    expect(wrapPi(4)).toBeCloseTo(4 - 2 * Math.PI, 12);
    expect(wrap2Pi(-1)).toBeCloseTo(2 * Math.PI - 1, 12);
    expect(wrap2Pi(2 * Math.PI)).toBe(0);
  });
});
