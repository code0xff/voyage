import { describe, expect, it } from 'vitest';
import { initialState, step, type Controls } from './boat';
import { CRUISER, DEFAULT_ENV, type Environment } from './config';
import { prepareDeparture } from './departure';
import { DEG, wrap2Pi } from './math';
import { settleOnHeading } from './polar';
import { autoReef, type ReefState } from './sailplan';
import { knotsToMs } from './units';

/**
 * The departure against the start it exists to fix.
 *
 * The bug being locked down: putting to sea used to mean full sail with a
 * close-hauled sheet on a beam-reach heading, bolt upright -- and in 25 knots
 * the first seconds rolled her to 42 degrees, nearly a knockdown, before the
 * auto-trim and the auto-reef could react. None of that was a physics error,
 * which is why these tests drive the real `step` from the prepared state and
 * assert on behaviour, not on the numbers the settle happens to return.
 */

/** The engine's departure heading: 100 degrees off the wind, wind from north. */
const HEADING = wrap2Pi(100 * DEG);

const envAt = (kn: number): Environment => ({ ...DEFAULT_ENV, twd: 0, tws: knotsToMs(kn) });

/**
 * Sail the boat from the prepared (or legacy bare) start exactly as the
 * engine does: auto-trim on, auto-reef judging every step.
 */
function sailFromStart(kn: number, prepared: boolean, seconds: number) {
  const env = envAt(kn);
  const dep = prepareDeparture(CRUISER, env, HEADING);
  const s = prepared
    ? initialState({
        heading: HEADING,
        u: 2.2,
        sheet: dep.sheet,
        twist: dep.twist,
        reef: dep.reef,
        jibFurl: dep.jibFurl,
        heel: dep.heel,
        heelAvg: dep.heel,
      })
    : initialState({ heading: HEADING, u: 2.2 });
  const rs: ReefState = { reef: s.reef, jibFurl: s.jibFurl, timer: 0 };
  const ctl: Controls = { rudder: 0, sheet: 0, twist: 0, autoTrim: true };
  const dt = 1 / 120;
  let maxHeel = 0;
  let flipped = false;
  for (let t = 0; t < seconds; t += dt) {
    autoReef(rs, s.heelAvg, s.heel, dt);
    s.reef = rs.reef;
    s.jibFurl = rs.jibFurl;
    step(s, CRUISER, env, ctl, dt, { lockHeading: true });
    maxHeel = Math.max(maxHeel, Math.abs(s.heel));
    // Ignore the first beat of the roll; after that the tack must hold.
    if (t > 1 && Math.sign(s.heel) !== Math.sign(dep.heel)) flipped = true;
  }
  return { dep, s, rs, maxHeel, flipped };
}

describe('putting to sea prepared', () => {
  it('settles long enough to make the full-length choice', () => {
    // The departure settles 90 s where the polar takes 240; the shortcut is
    // only honest if it lands on the same answer, and this is that check
    // across the settings range rather than at the one wind it was measured.
    // The sheet is allowed its asymptotic tail; the reef, the furl and the
    // heel are the choices the start is built from.
    for (const kn of [8, 16, 25, 35]) {
      const env = envAt(kn);
      const quick = prepareDeparture(CRUISER, env, HEADING);
      const full = settleOnHeading(CRUISER, env, HEADING, 240);
      expect(quick.reef).toBe(full.rs.reef);
      expect(quick.jibFurl).toBe(full.rs.jibFurl);
      expect(Math.abs(quick.heel - full.s.heel)).toBeLessThan(1 * DEG);
    }
  });

  it('is deterministic', () => {
    const a = prepareDeparture(CRUISER, envAt(18), HEADING);
    const b = prepareDeparture(CRUISER, envAt(18), HEADING);
    expect(b).toEqual(a);
  });

  it('leaves full sail set in a light breeze', () => {
    const dep = prepareDeparture(CRUISER, envAt(8), HEADING);
    expect(dep.reef).toBe(0);
    expect(dep.jibFurl).toBe(0);
  });

  it('leaves with sail shortened in a gale', () => {
    // 35 knots is survival-adjacent; leaving the dock under full sail in it
    // is the mistake the departure exists to stop re-enacting.
    const dep = prepareDeparture(CRUISER, envAt(35), HEADING);
    expect(dep.reef).toBeGreaterThanOrEqual(1);
  });

  it('never rolls far past the heel she will actually sail at', () => {
    // The regression itself, at the wind where the old start nearly knocked
    // her down: 42 degrees measured, against a sustained sailing heel of 26.
    // The bound is settle-relative so it survives retuning the rig; the
    // absolute cap below stops the pair passing by both being wrong.
    const { dep, maxHeel } = sailFromStart(25, true, 20);
    expect(maxHeel).toBeLessThan(Math.abs(dep.heel) + 5 * DEG);
    // Written out, not imported: 35 degrees IS the claim -- a start that
    // exceeds it is overpowered whatever the reef thresholds are tuned to.
    expect(maxHeel).toBeLessThan(35 * DEG);
  });

  it('the bare start it replaced does roll past it', () => {
    // The witness that the test above measures something: remove the
    // preparation and the same 20 seconds break both bounds.
    const { dep, maxHeel } = sailFromStart(25, false, 20);
    expect(maxHeel).toBeGreaterThan(Math.abs(dep.heel) + 5 * DEG);
    expect(maxHeel).toBeGreaterThan(35 * DEG);
  });

  it('starts on the tack the wind puts her on, and stays there', () => {
    // The sign trap this feature invites: the polar solves heading twd - twa,
    // the engine departs at twd + 100. A departure that mirrored the tack
    // would start her heeled to windward and roll her across.
    const { dep, flipped } = sailFromStart(18, true, 20);
    expect(Math.abs(dep.heel)).toBeGreaterThan(5 * DEG);
    expect(flipped).toBe(false);
  });

  it('the auto-reef does not shake out the reef the departure chose', () => {
    // A property guard rather than a regression: with heelAvg seeded this
    // cannot fail today, and measured, even unseeded it would not -- the
    // average crosses the shake-out line one second before the first dwell.
    // What it locks down is that margin ever being tuned away silently: move
    // the dwell or the shake-out threshold so the reef starts bouncing on
    // departure, and this is the test that says so.
    const { dep, rs } = sailFromStart(35, true, 30);
    expect(dep.reef).toBeGreaterThanOrEqual(1);
    expect(rs.reef).toBeGreaterThanOrEqual(dep.reef);
  });
});
