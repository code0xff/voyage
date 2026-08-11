import { describe, expect, it } from 'vitest';
import { CRUISER, DEFAULT_ENV, type Environment } from './config';
import { initialState, step, type BoatState, type Controls } from './boat';
import { DEG, RAD, wrapPi } from './math';
import { knotsToMs } from './units';
import { cyclePilot, engage, initialPilot, pilotRudder } from './autopilot';

const DT = 1 / 120;

/**
 * Sail the real boat under the pilot. Testing the controller against a mock
 * would only prove the controller agrees with itself; every way this can go
 * wrong -- a sign, a gain that oscillates, a mode that steers the long way
 * round -- needs the boat's own yaw response to show up.
 */
function sail(
  p: ReturnType<typeof initialPilot>,
  seconds: number,
  opts: { heading?: number; twd?: number; tws?: number } = {},
) {
  const env: Environment = {
    ...DEFAULT_ENV,
    tws: knotsToMs(opts.tws ?? 12),
    twd: opts.twd ?? 0,
  };
  const s: BoatState = initialState({ heading: opts.heading ?? 0, u: knotsToMs(5) });
  const ctl: Controls = { rudder: 0, sheet: 0, twist: 0, autoTrim: true };
  const track: { heading: number; twa: number }[] = [];
  for (let i = 0; i < seconds / DT; i++) {
    ctl.rudder = pilotRudder(p, s.heading, env.twd, s.r, s.u);
    step(s, CRUISER, env, ctl, DT);
    if (i % 120 === 0) track.push({ heading: s.heading, twa: wrapPi(env.twd - s.heading) });
  }
  return { state: s, env, track };
}

describe('autopilot', () => {
  it('does nothing at all when it is off', () => {
    const p = initialPilot();
    expect(pilotRudder(p, 1.2, 0.4, 0.3)).toBe(0);
  });

  it('holds a compass heading it is given', () => {
    const p = initialPilot();
    engage(p, 'compass', 70 * DEG, 0);
    // Started 40 degrees off, so it has to find the course as well as hold it.
    const { state } = sail(p, 90, { heading: 110 * DEG, twd: 0 });
    expect(Math.abs(wrapPi(state.heading - 70 * DEG)) * RAD).toBeLessThan(4);
  });

  /**
   * The sign of the whole thing. Turning the wrong way still arrives at the
   * target eventually -- the long way round -- so the test has to watch the
   * route, not just the destination.
   */
  it('turns the short way to get there', () => {
    const p = initialPilot();
    engage(p, 'compass', 80 * DEG, 0);
    const { track } = sail(p, 40, { heading: 110 * DEG, twd: 0 });
    // 110 -> 80 is thirty degrees to port. It must never wander to starboard.
    const worst = Math.max(...track.map((t) => t.heading * RAD));
    expect(worst).toBeLessThan(112);
  });

  it('settles instead of weaving about the course', () => {
    const p = initialPilot();
    engage(p, 'compass', 70 * DEG, 0);
    const { track } = sail(p, 150, { heading: 100 * DEG, twd: 0 });
    // Once it has had a minute to gather her up, the error must stay small.
    const settled = track.slice(60).map((t) => Math.abs(wrapPi(t.heading - 70 * DEG)) * RAD);
    expect(Math.max(...settled)).toBeLessThan(5);
  });

  /**
   * The point of wind mode: the boat follows the shift on her own. If it were
   * quietly holding a compass course instead, the true wind angle would move
   * with the wind and this would fail.
   */
  it('holds a wind angle through a shift', () => {
    const p = initialPilot();
    engage(p, 'wind', 0, -45 * DEG);
    const before = sail(p, 60, { heading: 45 * DEG, twd: 0 });
    expect(Math.abs(before.track[before.track.length - 1].twa * RAD + 45)).toBeLessThan(4);

    // The wind veers 25 degrees. She should follow it round and keep the angle.
    const after = sail(p, 90, { heading: before.state.heading, twd: 25 * DEG });
    const twa = after.track[after.track.length - 1].twa * RAD;
    expect(Math.abs(twa + 45)).toBeLessThan(4);
    // ...which means the heading moved with the wind, not stayed put.
    expect(after.state.heading * RAD).toBeGreaterThan(before.state.heading * RAD + 15);
  });

  it('never asks for more helm than a helmsman would', () => {
    const p = initialPilot();
    engage(p, 'compass', 180 * DEG, 0);
    // The worst case: pointing exactly the wrong way, with the helm hard over.
    expect(Math.abs(pilotRudder(p, 0, 0, 0))).toBeLessThanOrEqual(0.55);
    expect(Math.abs(pilotRudder(p, 0, 0, 2))).toBeLessThanOrEqual(0.55);
  });

  it('cycles off -> compass -> wind -> off, engaging on the course being sailed', () => {
    const p = initialPilot();
    cyclePilot(p, 1.1, -0.8);
    expect(p.mode).toBe('compass');
    expect(p.heading).toBeCloseTo(1.1, 6);
    cyclePilot(p, 2.2, -0.9);
    expect(p.mode).toBe('wind');
    expect(p.twa).toBeCloseTo(-0.9, 6);
    cyclePilot(p, 0, 0);
    expect(p.mode).toBe('off');
  });

  /**
   * Regression: the helm works backwards when she has sternway -- the water
   * meets the blade from behind -- and the pilot did not know it. Measured
   * before the fix, a ten-degree error grew to 11.4 in one second with the helm
   * hard over the wrong way, and it went on growing.
   *
   * Driven under bare poles in a calm so that only the rudder is steering her:
   * with sail up she would sail out of the sternway before the point was made.
   */
  it('steers the right way when she is going astern', () => {
    const p = initialPilot();
    p.mode = 'compass';
    p.heading = 10 * DEG;

    const s: BoatState = initialState({ u: -1.5, v: 0, r: 0, heel: 0, heading: 0, stowed: true });
    const env: Environment = { ...DEFAULT_ENV, tws: 0 };
    const ctl: Controls = { rudder: 0, sheet: 0, twist: 0, autoTrim: false };
    const error = () => Math.abs(wrapPi(p.heading - s.heading)) * RAD;
    const before = error();

    for (let i = 0; i < 2 / DT; i++) {
      ctl.rudder = pilotRudder(p, s.heading, env.twd, s.r, s.u);
      step(s, CRUISER, env, ctl, DT);
    }

    expect(before).toBeCloseTo(10, 6);
    expect(error()).toBeLessThan(before);
    // ...and she really was going astern the whole time, or this proves nothing.
    expect(s.u).toBeLessThan(0);
  });
});