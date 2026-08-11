import { describe, expect, it } from 'vitest';
import { Telemetry } from './telemetry';

/**
 * The instrument trace, which is a ring buffer with a clock in it.
 *
 * Tested for one reason: `clear()` is what a new session calls, and a reset
 * that leaves part of its state behind is the mistake this project keeps
 * finding -- the wildlife generators, the sea's clock, the last passage's
 * diagnostics. This is the same shape in the one place a graph rather than the
 * boat can see it.
 */
const spec = [{ label: 'BSP', color: '#fff', min: 0, max: 10 }];

/** Feed it `seconds` at 120 Hz, the rate the engine pushes at. */
function push(tel: Telemetry, seconds: number, value: number): void {
  for (let i = 0; i < Math.round(seconds * 120); i++) tel.push(1 / 120, [value]);
}

function samples(tel: Telemetry): number[] {
  const out: number[] = [];
  tel.forEach(tel.channels[0], (v) => out.push(v));
  return out;
}

describe('Telemetry', () => {
  it('samples at its interval rather than every push', () => {
    const tel = new Telemetry(spec, 60, 0.1);
    push(tel, 1, 4);
    // About ten a second, not a hundred and twenty. Not exactly ten: the
    // remainder past each interval is dropped rather than carried, and twelve
    // steps of 1/120 sum to just under 0.1 in floating point, so it takes
    // thirteen. Asserting the exact count would be asserting that.
    const n = samples(tel).length;
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(11);
  });

  /**
   * Regression: `clear()` emptied the ring but left `acc` -- the fraction of an
   * interval already elapsed -- where the last session had it. The first sample
   * of a new session then landed at an offset that depended on how far through
   * the interval the previous one happened to stop.
   *
   * Driven by stopping mid-interval on purpose: half of 0.1 s is banked, then
   * cleared, and the next sample must come a full interval later.
   */
  it('restarts its sampling clock when it is cleared', () => {
    const tel = new Telemetry(spec, 60, 0.1);
    push(tel, 0.05, 1); // half an interval banked and no sample taken
    expect(samples(tel).length).toBe(0);

    tel.clear();
    // Just under a full interval from the clear. With `acc` left running the
    // half already banked would carry it over and a sample would appear here.
    push(tel, 0.09, 2);
    expect(samples(tel).length).toBe(0);

    push(tel, 0.02, 3);
    expect(samples(tel).length).toBe(1);
  });

  it('empties what it had', () => {
    const tel = new Telemetry(spec, 60, 0.1);
    push(tel, 1, 7);
    expect(samples(tel).length).toBeGreaterThan(0);
    tel.clear();
    expect(samples(tel).length).toBe(0);
  });
});
