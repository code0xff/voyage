import { describe, expect, it } from 'vitest';
import { DEG, RAD, add, compassVec, scale, wrapPi, type Vec2 } from './math';
import { mustTack, passageInfo } from './passage';

const HERE: Vec2 = { x: 0, y: 0 };
const NO_TIDE: Vec2 = { x: 0, y: 0 };
/** Sailing at `speed` on a compass heading, as a ground velocity. */
const going = (bearingDeg: number, speed: number) => scale(compassVec(bearingDeg * DEG), speed);

describe('passage', () => {
  it('bears and measures to the destination', () => {
    // World frame is x = East, y = North.
    const north = passageInfo(HERE, { x: 0, y: 500 }, going(0, 3), 3, NO_TIDE, 0);
    expect(north.bearing * RAD).toBeCloseTo(0, 6);
    expect(north.distance).toBeCloseTo(500, 6);

    const east = passageInfo(HERE, { x: 500, y: 0 }, going(90, 3), 3, NO_TIDE, 0);
    expect(east.bearing * RAD).toBeCloseTo(90, 6);
  });

  /**
   * The number that decides an arrival time is not boat speed. On a beat the
   * boat sails at an angle to where she is going and much of her speed goes
   * sideways relative to the passage.
   */
  it('makes good less than boat speed when not pointing at it', () => {
    const at45 = passageInfo(HERE, { x: 0, y: 1000 }, going(45, 4), 4, NO_TIDE, 0);
    expect(at45.vmc).toBeCloseTo(4 * Math.cos(45 * DEG), 6);
    expect(at45.vmc).toBeLessThan(4);
  });

  it('reports no arrival at all when it is not closing', () => {
    const away = passageInfo(HERE, { x: 0, y: 1000 }, going(180, 4), 4, NO_TIDE, 0);
    expect(away.vmc).toBeLessThan(0);
    // A huge number would be a worse answer than none: a readout would print
    // four days rather than say the boat is going the other way.
    expect(away.eta).toBeNull();

    const across = passageInfo(HERE, { x: 0, y: 1000 }, going(90, 4), 4, NO_TIDE, 0);
    expect(across.eta).toBeNull();
  });

  it('divides the distance by what is actually being made good', () => {
    const p = passageInfo(HERE, { x: 0, y: 900 }, going(0, 3), 3, NO_TIDE, 0);
    expect(p.eta).toBeCloseTo(300, 6);
  });

  it('says which way the wind would be if you pointed straight at it', () => {
    // Wind from the north, destination to the north: dead upwind.
    const beat = passageInfo(HERE, { x: 0, y: 800 }, going(0, 3), 3, NO_TIDE, 0);
    expect(Math.abs(beat.twaDirect) * RAD).toBeCloseTo(0, 6);
    expect(mustTack(beat, 40 * DEG)).toBe(true);

    // Same wind, destination to the south: dead downwind, and laid easily.
    const run = passageInfo(HERE, { x: 0, y: -800 }, going(180, 3), 3, NO_TIDE, 0);
    expect(Math.abs(run.twaDirect) * RAD).toBeCloseTo(180, 6);
    expect(mustTack(run, 40 * DEG)).toBe(false);
  });
});

/**
 * The course to steer is the one piece of navigation that is genuinely
 * counter-intuitive -- to go where you are looking you must not look where you
 * are going -- so it is worth pinning as an identity rather than a direction.
 */
describe('course to steer', () => {
  it('is simply the bearing when there is no tide', () => {
    const p = passageInfo(HERE, { x: 300, y: 300 }, going(45, 4), 4, NO_TIDE, 0);
    expect(p.courseToSteer! * RAD).toBeCloseTo(p.bearing * RAD, 6);
  });

  /**
   * The identity: steer the course it gives, at the speed it was given, add the
   * tide, and the boat's track over the ground must lie along the bearing. If
   * this holds the sign cannot be wrong, which is the whole risk here.
   */
  it('actually puts the ground track on the bearing', () => {
    const waterSpeed = 4;
    for (const set of [
      { x: 1.2, y: 0 },
      { x: -1.2, y: 0 },
      { x: 0.7, y: -0.9 },
      { x: -0.3, y: 1.5 },
    ]) {
      for (const destDeg of [0, 35, 120, 250, 300]) {
        const dest = scale(compassVec(destDeg * DEG), 1000);
        const p = passageInfo(HERE, dest, going(destDeg, 3), waterSpeed, set, 0);
        expect(p.courseToSteer).not.toBeNull();

        const throughWater = scale(compassVec(p.courseToSteer!), waterSpeed);
        const overGround = add(throughWater, set);
        const madeGood = Math.atan2(overGround.x, overGround.y);
        // Compared as a wrapped difference, not as two numbers: due north is
        // both 0 and 360, and the first version of this failed on that alone.
        expect(Math.abs(wrapPi(madeGood - p.bearing)) * RAD).toBeLessThan(1e-4);
      }
    }
  });

  it('steers up-tide, not down it', () => {
    // Track due north, tide setting east: it will push the boat to starboard of
    // the line, so the boat has to look to port of where she is going.
    const p = passageInfo(HERE, { x: 0, y: 1000 }, going(0, 3), 4, { x: 1.2, y: 0 }, 0);
    expect(p.courseToSteer! * RAD).toBeGreaterThan(180); // i.e. west of north
    expect(p.courseToSteer! * RAD).toBeLessThan(360);
  });

  it('gives up when the cross-tide is stronger than the boat', () => {
    // Two knots of boat against three across the track: no heading holds it.
    const p = passageInfo(HERE, { x: 0, y: 1000 }, going(0, 1), 1, { x: 1.6, y: 0 }, 0);
    expect(p.courseToSteer).toBeNull();
  });

  it('ignores a tide running straight along the track', () => {
    // It changes how long the passage takes and not where the boat ends up.
    const fair = passageInfo(HERE, { x: 0, y: 1000 }, going(0, 3), 4, { x: 0, y: 1.5 }, 0);
    const foul = passageInfo(HERE, { x: 0, y: 1000 }, going(0, 3), 4, { x: 0, y: -1.5 }, 0);
    expect(fair.courseToSteer! * RAD).toBeCloseTo(0, 6);
    expect(foul.courseToSteer! * RAD).toBeCloseTo(0, 6);
  });

  it('does not divide by a boat that is not moving', () => {
    const p = passageInfo(HERE, { x: 0, y: 1000 }, { x: 0, y: 0 }, 0, { x: 1, y: 0 }, 0);
    expect(p.courseToSteer).toBeNull();
    expect(Number.isFinite(p.bearing)).toBe(true);
  });

  it('survives being asked about the place it is already sitting on', () => {
    const p = passageInfo(HERE, { x: 0, y: 0 }, going(90, 2), 2, NO_TIDE, 0);
    expect(p.distance).toBe(0);
    // No direction to a place you are standing on, so it reports the way the
    // boat is going rather than the angle of the last rounding error.
    expect(Number.isFinite(p.bearing)).toBe(true);
    // Zero, not "no arrival": she has arrived. Asserting null here was my own
    // assumption rather than anything the passage owes the navigator.
    expect(p.eta).toBe(0);
  });
});
