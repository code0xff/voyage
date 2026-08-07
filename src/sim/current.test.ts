import { describe, expect, it } from 'vitest';
import { CRUISER, DEFAULT_ENV } from './config';
import { initialState, step, type Controls, type SeaState } from './boat';
import { DEG, RAD, type Vec2 } from './math';
import { solveOne } from './polar';
import { knotsToMs } from './units';

/**
 * Set and drift.
 *
 * The whole model is one distinction: `u`/`v` are velocity *through the water*
 * and everything hydrodynamic is a function of them alone, while position, the
 * apparent wind and the racing run on velocity *over the ground*. These tests
 * exist to keep those two apart, because the two are identical in still water
 * and every one of these properties is silently satisfied until a tide runs.
 */

const DT = 1 / 120;
const AUTO: Controls = { rudder: 0, sheet: 0, twist: 0, autoTrim: true };
const FLAT: SeaState = { h13: 0, dir: 0, heave: 0, pitchSlope: 0, rollSlope: 0, depth: Infinity };

function settle(
  seconds: number,
  env: Partial<typeof DEFAULT_ENV> & { current?: Vec2 },
  headingDeg: number,
  u = 3,
  sea: SeaState = FLAT,
) {
  const e = { ...DEFAULT_ENV, ...env };
  const s = initialState({ heading: headingDeg * DEG, u });
  const opts = { lockHeading: true, sea };
  let d = step(s, CRUISER, e, AUTO, DT, opts);
  for (let i = 1; i < Math.round(seconds / DT); i++) d = step(s, CRUISER, e, AUTO, DT, opts);
  return { s, d };
}

describe('current', () => {
  /**
   * `Environment.current` is optional so that a polar cannot acquire a tide by
   * accident. This pins the other half of that promise: writing the field out
   * as zero has to be the same thing as leaving it off, to the last bit, or
   * "still water" would mean two subtly different things depending on which
   * caller built the environment.
   */
  it('is exactly nothing when it is zero, and when it is absent', () => {
    const tws = knotsToMs(12);
    const a = settle(120, { tws }, 315);
    const b = settle(120, { tws, current: { x: 0, y: 0 } }, 315);
    expect(b.s.pos.x).toBe(a.s.pos.x);
    expect(b.s.pos.y).toBe(a.s.pos.y);
    expect(b.d.speed).toBe(a.d.speed);
    expect(b.d.sog).toBe(a.d.sog);
  });

  it('reads the same speed and course two ways when there is no tide', () => {
    const { d } = settle(120, { tws: knotsToMs(12) }, 315);
    expect(d.sog).toBeCloseTo(d.speed, 9);
  });

  /**
   * The invariant the whole model rests on: whatever the boat is doing, her
   * track over the ground minus her track through the water is the set, exactly.
   * Anything that leaks the current into a hydrodynamic force -- keel lift out
   * of the tide is the tempting one -- breaks this, and it is not a property
   * that can be got right by accident.
   */
  it('separates the ground track from the water track by exactly the set', () => {
    const cur = { x: 0.9, y: -0.4 };
    const { s, d } = settle(400, { tws: knotsToMs(12), current: cur }, 315);

    const track = s.heading + d.leeway; // through the water: heading plus leeway
    const setX = d.sog * Math.sin(d.cog) - d.speed * Math.sin(track);
    const setY = d.sog * Math.cos(d.cog) - d.speed * Math.cos(track);
    expect(setX).toBeCloseTo(cur.x, 4);
    expect(setY).toBeCloseTo(cur.y, 4);
    // The premise: this heading is genuinely being set off course, so the two
    // tracks are not trivially the same.
    expect(Math.abs(d.cog - track) * RAD).toBeGreaterThan(3);
  });

  /**
   * A flat calm with a tide running is the cleanest statement of the split: no
   * sail force at all, so the only thing moving the boat is the water.
   *
   * She does not quite make the full rate, and that is not an error. Still air
   * with the boat moving through it is windage, and windage is a force -- the
   * boat settles where hull drag through the water balances it, a little under
   * the drift, with a knot or so of water running past her keel. Measured at
   * 84% of a 1 m/s set. The lag is larger than a real yacht's because the hull
   * drag that opposes it here is skin friction only, and skin friction is a
   * poor model of resistance at a fifth of a knot.
   */
  it('carries a boat with no sail force along at very nearly the drift', () => {
    const drift = 1; // m/s east
    const { d } = settle(900, { tws: 0, current: { x: drift, y: 0 } }, 90, 0.2);

    expect(d.sog).toBeGreaterThan(0.75 * drift);
    expect(d.sog).toBeLessThan(drift);
    expect(d.cog * RAD).toBeCloseTo(90, 6); // due east, with the water
    expect(d.speed).toBeLessThan(0.25 * drift); // barely moving through it
  });

  /**
   * The reason the apparent wind is built from ground velocity and not water
   * velocity. Air is not carried along by the tide, so a boat drifting in a
   * dead calm makes her own breeze, from dead ahead, at exactly the rate she is
   * drifting. Sail this from the water track instead and the boat lies in a
   * calm feeling nothing, which is not what happens.
   */
  it('makes its own apparent wind out of a drift in a dead calm', () => {
    const { d } = settle(900, { tws: 0, current: { x: 1, y: 0 } }, 90, 0.2);
    expect(d.aws).toBeCloseTo(d.sog, 9);
    expect(d.awa * RAD).toBeCloseTo(0, 6); // heading east, drifting east
  });

  /**
   * VMG is made good over the ground, because that is where the marks are. A
   * foul tide therefore costs VMG on a heading that is sailing exactly as well
   * as it was -- the boat is unchanged and her progress is not.
   */
  it('gives up VMG to a foul tide without the boat sailing any worse', () => {
    const tws = knotsToMs(12);
    const still = settle(300, { tws }, 315);
    // DEFAULT_ENV blows from the north, so a set to the south is dead foul for
    // a boat working to windward.
    const foul = settle(300, { tws, current: { x: 0, y: -0.6 } }, 315);

    expect(foul.d.vmg).toBeLessThan(still.d.vmg - 0.4);
    // Through the water she is still sailing, and close to as fast: the tide
    // shifts the apparent wind a little, it does not stop the boat.
    expect(foul.d.speed).toBeGreaterThan(0.9 * still.d.speed);
  });

  /**
   * A polar is a still-water measurement, and the solver drops any current
   * rather than trusting its caller not to pass one. The engine builds the
   * in-game polar from DEFAULT_ENV today, so this holds either way -- which is
   * exactly why it is worth pinning, because the day someone hands the solver
   * the live sailing environment instead, the diagram would quietly stop being
   * a polar and there would be nothing on screen to say so.
   */
  it('cannot be measured into a polar', () => {
    const env = { ...DEFAULT_ENV, tws: knotsToMs(12) };
    const still = solveOne(CRUISER, env, 60, 120);
    const tidal = solveOne(CRUISER, { ...env, current: { x: 1.2, y: -0.8 } }, 60, 120);
    expect(tidal.speed).toBe(still.speed);
    expect(tidal.vmg).toBe(still.vmg);
    expect(tidal.awa).toBe(still.awa);
  });

  /**
   * Aground the ground has her, and the tide runs past instead of carrying her.
   * The drift and the apparent wind are both scaled by the same grip, so she
   * neither slides across the bank nor lies there feeling the breeze of a
   * passage she is not making.
   */
  it('does not carry a boat that is hard aground', () => {
    const shallow: SeaState = { ...FLAT, depth: 0.9 }; // draft is 1.8 m
    const { s, d } = settle(300, { tws: 0, current: { x: 1, y: 0 } }, 90, 0.1, shallow);

    expect(d.aground).toBe(1);
    expect(d.sog).toBeLessThan(0.01);
    // Five minutes at the full 1 m/s set would be 300 m downtide of here.
    expect(Math.hypot(s.pos.x, s.pos.y)).toBeLessThan(1);
  });
});
