import { describe, expect, it } from 'vitest';
import { WaveField, dominantEncounter, waveHitStrength } from './waves';

/**
 * Wind from the north, so the waves travel south. Everything below is stated in
 * terms of the boat's heading against that.
 */
const sea = () => new WaveField(12, 0);

/** The biggest train's own frequency, which is what encounter is measured against. */
function ownOmega(w: WaveField): number {
  let best = w.comps[0];
  for (const c of w.comps) if (c.amp > best.amp) best = c;
  return best.omega;
}

describe('encounter frequency', () => {
  it('is the wave\'s own frequency when the boat is stopped', () => {
    const w = sea();
    expect(dominantEncounter(w, 0, 0, 0).omega).toBeCloseTo(ownOmega(w), 6);
  });

  /** Beating into a sea, the crests arrive faster than their own period. */
  it('rises beating into the sea', () => {
    const w = sea();
    // Heading north, into waves that are running south.
    expect(dominantEncounter(w, 0, 3, 0).omega).toBeGreaterThan(ownOmega(w));
  });

  /** Running with them, she chases and they arrive more slowly. */
  it('falls running with the sea', () => {
    const w = sea();
    expect(dominantEncounter(w, Math.PI, 3, 0).omega).toBeLessThan(ownOmega(w));
  });

  it('is unchanged beam on, where there is no closing speed along the train', () => {
    const w = sea();
    const east = dominantEncounter(w, Math.PI / 2, 3, 0).omega;
    const west = dominantEncounter(w, -Math.PI / 2, 3, 0).omega;
    expect(east).toBeCloseTo(ownOmega(w), 6);
    expect(west).toBeCloseTo(ownOmega(w), 6);
  });

  it('goes faster the harder she is driven to windward', () => {
    const w = sea();
    const slow = dominantEncounter(w, 0, 2, 0).omega;
    const fast = dominantEncounter(w, 0, 5, 0).omega;
    expect(fast).toBeGreaterThan(slow);
  });

  /**
   * Downwind at the wave's own celerity the boat keeps station with the crest
   * and stops meeting waves at all. The rate of meetings is a magnitude, so it
   * must come back through zero rather than going negative and reading as a
   * fast head sea.
   */
  it('passes through zero when she keeps station with the crest, and never goes negative', () => {
    const w = sea();
    let best = w.comps[0];
    for (const c of w.comps) if (c.amp > best.amp) best = c;
    const celerity = best.omega / best.k;

    expect(dominantEncounter(w, Math.PI, celerity, 0).omega).toBeCloseTo(0, 6);
    // Faster still: overtaking, and the count of meetings climbs again.
    const over = dominantEncounter(w, Math.PI, celerity * 1.6, 0).omega;
    expect(over).toBeGreaterThan(0);
  });

  it('counts leeway, not just the way she is pointing', () => {
    const w = sea();
    // Beam on, so heading contributes nothing; all of it is sideways slip.
    const noSlip = dominantEncounter(w, Math.PI / 2, 0, 0).omega;
    const slipping = dominantEncounter(w, Math.PI / 2, 0, 1.5).omega;
    expect(slipping).not.toBeCloseTo(noSlip, 3);
  });

  it('is flat calm when there is no sea', () => {
    const w = sea();
    w.comps.length = 0;
    expect(dominantEncounter(w, 0, 4, 0)).toEqual({ omega: 0, amp: 0 });
  });
});

describe('wave hit strength', () => {
  /**
   * The point of the whole thing: at the same wave height and the same boat
   * speed, punching into a sea has to sound harder than being carried by one.
   * It comes out of the encounter frequency without being asked for.
   */
  it('is harder beating than running, in the same sea at the same speed', () => {
    const w = sea();
    const beating = waveHitStrength(dominantEncounter(w, 0, 3, 0), 3);
    const running = waveHitStrength(dominantEncounter(w, Math.PI, 3, 0), 3);
    expect(beating).toBeGreaterThan(running);
  });

  it('is harder in a bigger sea', () => {
    const small = new WaveField(10, 0);
    const big = new WaveField(28, 0);
    expect(waveHitStrength(dominantEncounter(big, 0, 3, 0), 3)).toBeGreaterThan(
      waveHitStrength(dominantEncounter(small, 0, 3, 0), 3),
    );
  });

  it('is harder the faster she is driven', () => {
    const w = sea();
    const slow = waveHitStrength(dominantEncounter(w, 0, 1, 0), 1);
    const fast = waveHitStrength(dominantEncounter(w, 0, 5, 0), 5);
    expect(fast).toBeGreaterThan(slow);
  });

  /** Nothing to meet, nothing to hear. */
  it('is nothing in flat calm', () => {
    const w = sea();
    w.comps.length = 0;
    expect(waveHitStrength(dominantEncounter(w, 0, 4, 0), 4)).toBe(0);
  });

  /** It is a volume, so it cannot run away in a gale. */
  it('never exceeds one, however hard she is pressed', () => {
    const gale = new WaveField(45, 0);
    expect(waveHitStrength(dominantEncounter(gale, 0, 9, 0), 9)).toBeLessThanOrEqual(1);
  });
});
