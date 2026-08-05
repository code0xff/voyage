/**
 * Deterministic value noise. Given the same seed it returns the same value
 * anywhere, any number of times.
 *
 * It deliberately does not use Math.random(): the wind field has to be a pure
 * function of position. Sail back to the same spot and the same wind must be
 * there, and the renderer and the physics must get identical answers when they
 * ask about the same coordinate.
 */

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Quintic smootherstep. Shows fewer grid artefacts than the cubic version. */
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

export function valueNoise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);

  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);

  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

/** Stack octaves for a natural-looking texture. Returns 0..1. */
export function fbm2(x: number, y: number, seed: number, octaves = 3): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2(fx, fy, seed + i * 7919) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.03;
    fy *= 2.03;
  }
  return sum / norm;
}
