import { describe, expect, it } from 'vitest';
import { rng } from './rng';

const draw = (seed: number, n: number): number[] => {
  const next = rng(seed);
  return Array.from({ length: n }, () => next());
};

describe('rng', () => {
  it('replays exactly from a seed', () => {
    expect(draw(4711, 64)).toEqual(draw(4711, 64));
  });

  it('stays inside 0..1', () => {
    for (const value of draw(9, 4096)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  /**
   * The bug this module exists for. The raw generator returned 0.3104, 0.3104,
   * 0.3103 and 0.3101 for seeds 1, 2, 3 and 7 -- all eight of the first seeds
   * inside a band 0.002 wide -- so every world that drew once and showed the
   * result immediately opened the same way. Nearby seeds are the common case:
   * they are what a counter or a date gives you.
   *
   * Asserted as spread rather than as a minimum gap between any two draws: with
   * only eight samples of a genuinely uniform variable, two of them landing
   * close together is expected, and a test that forbids it fails on a correct
   * generator roughly half the time.
   */
  it('spreads the first draw of neighbouring seeds across the range', () => {
    const first = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => rng(seed)());
    expect(Math.max(...first) - Math.min(...first)).toBeGreaterThan(0.5);

    // Over more seeds it should reach everywhere, not just span a gap.
    const wider = Array.from({ length: 64 }, (_, i) => rng(i + 1)());
    const tenths = new Set(wider.map((value) => Math.floor(value * 10)));
    expect(tenths.size).toBeGreaterThanOrEqual(9);
  });

  /** Zero is the one state xorshift32 can never leave, so it must not survive. */
  it('does not sit still on seed zero', () => {
    const values = new Set(draw(0, 32));
    expect(values.size).toBeGreaterThan(24);
  });

  it('is roughly uniform, so a probability gate means what it says', () => {
    const next = rng(20260809);
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 100_000; i++) buckets[Math.floor(next() * 10)]++;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(9000);
      expect(count).toBeLessThan(11_000);
    }
  });
});
