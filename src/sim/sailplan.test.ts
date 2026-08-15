import { describe, expect, it } from 'vitest';
import { DEG } from './math';
import { MAX_REEF, autoReef, type ReefState } from './sailplan';

const DT = 1 / 120;

const fresh = (over: Partial<ReefState> = {}): ReefState => ({
  reef: 0,
  jibFurl: 0,
  timer: 0,
  ...over,
});

/** How short the sail plan is, as one number, so either lever counts. */
const shortened = (rs: ReefState): number => rs.reef + rs.jibFurl;

/** Drive the auto-reef for `seconds` at a fixed average and instantaneous heel. */
function hold(rs: ReefState, avgDeg: number, instDeg: number, seconds: number): ReefState {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    autoReef(rs, avgDeg * DEG, instDeg * DEG, DT);
  }
  return rs;
}

/**
 * The auto-reef judges on the filtered heel the physics already keeps, and only
 * the knockdown branch looks at this instant. These tests pin that split: it is
 * the whole reason the function takes two heels rather than filtering its own,
 * and passing the same number twice would satisfy the types while quietly
 * putting the reef back on a hair trigger.
 */
describe('auto-reef', () => {
  it('ignores a gust that the boat is not staying over for', () => {
    // 40 degrees is past every reef threshold, but the boat is only there for
    // an instant: the average says 20. Reacting to the peak reefs in 12 knots.
    const rs = hold(fresh(), 20, 40, 30);
    expect(shortened(rs)).toBe(0);
  });

  it('shortens sail when the boat stays over', () => {
    const rs = hold(fresh(), 35, 35, 30);
    expect(shortened(rs)).toBeGreaterThan(0);
  });

  it('waits out its dwell before touching anything', () => {
    // Without the hysteresis the reef chatters, so even a plainly overpowered
    // boat gets a few seconds of grace.
    const rs = hold(fresh(), 35, 35, 3);
    expect(shortened(rs)).toBe(0);
  });

  it('reacts to a knockdown without waiting for the average', () => {
    // Lying at 50 degrees is an emergency whatever the last six seconds looked
    // like -- and that is the one case the instantaneous heel is right for.
    const rs = hold(fresh(), 8, 50, 2);
    expect(shortened(rs)).toBeGreaterThan(0);
  });

  it('shakes out again once the boat comes back on her feet', () => {
    const rs = hold(fresh({ reef: 2, jibFurl: 0.5 }), 8, 8, 30);
    expect(shortened(rs)).toBeLessThan(2.5);
  });

  it('reads a heel to port exactly as it reads one to starboard', () => {
    // Sign convention: positive is starboard. Heel is a magnitude question.
    const stb = hold(fresh(), 35, 35, 30);
    const port = hold(fresh(), -35, -35, 30);
    expect(shortened(port)).toBe(shortened(stb));
  });

  it('still overpowered with the main fully reefed, it rolls the jib to storm size', () => {
    // Regression: with the main at MAX_REEF the jib's-turn condition stayed
    // true at 0.75 forever, so the ladder clamped a no-op every dwell and the
    // 0.9 rung was unreachable -- in a 70 kn squall the settle kept a quarter
    // of the jib flying at 40 degrees of sustained heel. Enough time here for
    // the dwell however the ladder is retuned; the claim is the rung, so 0.9
    // is written out rather than imported.
    // MAX_REEF imported because a fully-reefed main is the *precondition*
    // this test needs in order to look at the jib; 0.9 written out because
    // the rung itself is the claim.
    const rs = hold(fresh({ reef: MAX_REEF, jibFurl: 0.75 }), 35, 35, 30);
    expect(rs.jibFurl).toBeCloseTo(0.9, 10);
  });
});
