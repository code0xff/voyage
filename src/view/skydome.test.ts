import { describe, expect, it } from 'vitest';
import { glslFloat } from './skydome';

/**
 * The one thing in the sky that can be asserted.
 *
 * Everything else about `skydome.ts` is a look, and looks are checked by
 * looking -- that is what the `run-voyage` skill is for. This is not a look.
 * Two constants are declared in TypeScript and interpolated into the GLSL so
 * that the clock's bound in `underway.ts` can be derived from the same
 * numbers the shader uses, and the interpolation has a way of going wrong
 * that no screenshot would survive and no other test would see: the shader
 * simply stops compiling.
 */
describe('a number as a GLSL float literal', () => {
  it('never hands the shader an integer', () => {
    // GLSL will not assign an int to a float. A lacunarity of exactly 2 is
    // the most ordinary value either interpolated constant could take, and
    // `${2}` is `2`.
    for (const v of [2, 0, 1, -3, 16]) {
      expect(glslFloat(v), `${v} would not compile`).toMatch(/\.|e/);
      expect(Number(glslFloat(v)), `${v} did not survive`).toBe(v);
    }
  });

  it('leaves a number that is already a float alone', () => {
    for (const v of [1.9, 2.03, 0.5, -0.25]) expect(Number(glslFloat(v))).toBe(v);
  });
});
