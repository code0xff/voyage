import { describe, expect, it } from 'vitest';
import { DEG, RAD, add, compassVec, scale, wrapPi, type Vec2 } from './math';
import { PassageLog, mustTack, passageInfo, type Conditions } from './passage';

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

describe('passage log', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 0, y: 1000 };

  it('accumulates what the passage was, not where she went', () => {
    const log = new PassageLog(from, to, 1000);
    for (let i = 0; i < 600; i++) log.advance(3, 12, 1); // ten minutes at 3 m/s
    const r = log.finish('a', { x: 0, y: 1800 }, 'sf');
    expect(r.duration).toBeCloseTo(600, 6);
    expect(r.distance).toBeCloseTo(1800, 6);
    expect(r.avgSog).toBeCloseTo(3, 6);
    expect(r.maxSog).toBeCloseTo(3, 6);
    expect(r.windKnots).toBeCloseTo(12, 6);
    expect(r.venue).toBe('sf');
  });

  /**
   * Time-weighted, so an hour becalmed drags the average down as it should. A
   * mean of the samples would report the speed she sailed at when she was
   * sailing, which is a different and much more flattering number.
   */
  it('averages over time, so a calm counts against the passage', () => {
    const log = new PassageLog(from, to, 0);
    for (let i = 0; i < 100; i++) log.advance(4, 14, 1);
    for (let i = 0; i < 300; i++) log.advance(0, 1, 1); // becalmed
    const r = log.finish('a', to, '');
    expect(r.avgSog).toBeCloseTo(400 / 400, 6);
    expect(r.maxSog).toBeCloseTo(4, 6);
  });

  /** How much was tacked: the track over the straight line between the ends. */
  it('records the direct distance as well as the track', () => {
    const log = new PassageLog(from, to, 0);
    for (let i = 0; i < 500; i++) log.advance(3, 12, 1);
    const r = log.finish('a', to, '');
    expect(r.direct).toBeCloseTo(1000, 6);
    expect(r.distance / r.direct).toBeCloseTo(1.5, 6);
  });

  it('ends where the anchor went down, not where she was aiming', () => {
    // A passage never finishes exactly on the point that was clicked.
    const log = new PassageLog(from, to, 0);
    log.advance(3, 12, 1);
    const r = log.finish('a', { x: 20, y: 980 }, '');
    expect(r.to).toEqual({ x: 20, y: 980 });
    expect(r.to).not.toBe(to);
  });

  it('survives being finished the instant it began', () => {
    const r = new PassageLog(from, to, 0).finish('a', from, '');
    expect(r.duration).toBe(0);
    expect(r.avgSog).toBe(0);
    expect(r.windKnots).toBe(0);
    expect(Number.isFinite(r.direct)).toBe(true);
  });

  it('copies its endpoints, so a moving boat cannot rewrite history', () => {
    const start = { x: 5, y: 5 };
    const log = new PassageLog(start, to, 0);
    const r = log.finish('a', to, '');
    start.x = 999;
    expect(r.from.x).toBe(5);
  });
});

/**
 * What was seen, rather than how fast it was got through.
 *
 * The animal fields publish what is in sight this step and refill the list on
 * the next, so the log is told about one whale a few hundred times over an
 * encounter. Every test here is about that: the thing being counted is the
 * animal, not the call.
 */
describe('passage sightings', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 0, y: 1000 };

  it('counts one encounter once, however long it stayed in sight', () => {
    const log = new PassageLog(from, to, 0);
    // A whale encounter runs about half a minute at 120 Hz.
    for (let i = 0; i < 3600; i++) log.sight('whales', 7);
    expect(log.finish('a', to, '').sightings).toEqual({ whales: 1, sharks: 0 });
  });

  it('counts a second animal as a second animal', () => {
    const log = new PassageLog(from, to, 0);
    for (let i = 0; i < 100; i++) log.sight('whales', 1);
    for (let i = 0; i < 100; i++) log.sight('whales', 2);
    expect(log.finish('a', to, '').sightings?.whales).toBe(2);
  });

  /**
   * The fields number themselves independently, so the first whale and the
   * first shark of a passage are both id 1. Keyed on the id alone, the shark
   * would be swallowed by the whale already counted -- and silently, since the
   * total would still look plausible.
   */
  it('keeps the kinds apart, because both fields start their ids at one', () => {
    const log = new PassageLog(from, to, 0);
    log.sight('whales', 1);
    log.sight('sharks', 1);
    expect(log.finish('a', to, '').sightings).toEqual({ whales: 1, sharks: 1 });
  });

  /**
   * Nothing seen is a fact about the passage and is written down as one. Only a
   * record from before the field existed may be silent about it, and that is
   * what the optional type is for.
   */
  it('says nothing was seen, rather than saying nothing', () => {
    const log = new PassageLog(from, to, 0);
    for (let i = 0; i < 600; i++) log.advance(3, 12, 1);
    expect(log.finish('a', to, '').sightings).toEqual({ whales: 0, sharks: 0 });
  });

  it('copies the counts, so a later sighting cannot rewrite a finished record', () => {
    const log = new PassageLog(from, to, 0);
    log.sight('whales', 1);
    const r = log.finish('a', to, '');
    log.sight('whales', 2);
    expect(r.sightings?.whales).toBe(1);
  });
});

/** When it was and what it was like, as against how long it took. */
describe('passage weather and clock', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 0, y: 1000 };
  /** A calm forenoon, for the tests that are about one field and not the rest. */
  const FLAT: Conditions = { weather: 'fair', hour: 9, heel: 0, seaHeight: 0 };

  /**
   * `startedAt` is when the player sat down and has never been anything else.
   * At the default time scale of sixty, twenty minutes at the keyboard is most
   * of a day at sea, so the two clocks are barely related and only one of them
   * is about the voyage.
   */
  it('remembers the world clock, and leaves the wall clock alone', () => {
    const log = new PassageLog(from, to, 1_700_000_000_000);
    // 05:00 to 11:00.
    for (let i = 0; i <= 360; i++) log.conditions({ ...FLAT, hour: 5 + i / 60 }, 1);
    const r = log.finish('a', to, '');
    expect(r.startHour).toBeCloseTo(5, 6);
    expect(r.endHour).toBeCloseTo(11, 6);
    expect(r.startedAt).toBe(1_700_000_000_000);
  });

  it('brings a passage that ran past midnight back into the day', () => {
    const log = new PassageLog(from, to, 0);
    log.conditions({ ...FLAT, weather: 'clear', hour: 22 }, 1);
    log.conditions({ ...FLAT, weather: 'clear', hour: 27.5 }, 1);
    const r = log.finish('a', to, '');
    expect(r.startHour).toBeCloseTo(22, 6);
    // Not 27.5, which is not a time of day. `duration` is what says the passage
    // crossed a midnight; these two say when it was.
    expect(r.endHour).toBeCloseTo(3.5, 6);
  });

  /**
   * The weather it is remembered for, which is the one it spent the passage in.
   * Taking whatever was blowing at the end would let a day of fog be filed as a
   * clear passage on the strength of the last two minutes of it.
   */
  it('reports the weather it spent longest in, not the one it arrived in', () => {
    const log = new PassageLog(from, to, 0);
    for (let i = 0; i < 600; i++) log.conditions({ ...FLAT, weather: 'fog' }, 1);
    for (let i = 0; i < 60; i++) log.conditions({ ...FLAT, weather: 'clear' }, 1);
    expect(log.finish('a', to, '').weather).toBe('fog');
  });

  it('knows nothing of a world it was never told about', () => {
    const r = new PassageLog(from, to, 0).finish('a', to, '');
    expect(r.startHour).toBeUndefined();
    expect(r.endHour).toBeUndefined();
    expect(r.weather).toBeUndefined();
    expect(r.maxHeel).toBeUndefined();
    expect(r.maxSea).toBeUndefined();
  });

  /**
   * Maxima, for the reason `maxSog` is one: a mean over a long passage buries
   * the ten minutes that were the whole of it, and those ten minutes are what
   * gets remembered.
   */
  it('keeps the worst of it, not the average of it', () => {
    const log = new PassageLog(from, to, 0);
    const calm = { weather: 'fair' as const, hour: 9, heel: 4 * DEG, seaHeight: 0.3 };
    for (let i = 0; i < 3000; i++) log.conditions(calm, 1);
    log.conditions({ ...calm, heel: 31 * DEG, seaHeight: 2.4 }, 1);
    for (let i = 0; i < 3000; i++) log.conditions(calm, 1);
    const r = log.finish('a', to, '');
    expect(r.maxHeel).toBeCloseTo(31 * DEG, 6);
    expect(r.maxSea).toBeCloseTo(2.4, 6);
  });

  /**
   * Heel is signed -- positive to starboard, like every angle in this project
   * -- and a knockdown to port is exactly as rough as one to starboard. Left
   * signed, a passage laid over on port tack would report its worst moment as
   * a smaller number than a calm one, because the running maximum would never
   * rise above the zero it started at.
   */
  it('measures a knockdown the same on either tack', () => {
    const port = new PassageLog(from, to, 0);
    port.conditions({ weather: 'squall', hour: 9, heel: -38 * DEG, seaHeight: 0 }, 1);
    const starboard = new PassageLog(from, to, 0);
    starboard.conditions({ weather: 'squall', hour: 9, heel: 38 * DEG, seaHeight: 0 }, 1);
    expect(port.finish('a', to, '').maxHeel).toBeCloseTo(38 * DEG, 6);
    expect(port.finish('a', to, '').maxHeel).toBe(starboard.finish('b', to, '').maxHeel);
  });

  /**
   * Counted against the log even when nothing was ever reported to it, unlike
   * the four fields above. A photograph is the player pressing a key, not the
   * world being described, so the two cannot be tied together.
   */
  it('counts photographs whether or not it was ever told about the world', () => {
    const told = new PassageLog(from, to, 0);
    told.conditions(FLAT, 1);
    told.photographed();
    told.photographed();
    expect(told.finish('a', to, '').photographs).toBe(2);

    const silent = new PassageLog(from, to, 0);
    silent.photographed();
    const r = silent.finish('b', to, '');
    expect(r.photographs).toBe(1);
    expect(r.weather).toBeUndefined();
  });

  it('records a passage that was never rough as never rough, which is a fact', () => {
    const log = new PassageLog(from, to, 0);
    log.conditions({ weather: 'clear', hour: 9, heel: 0, seaHeight: 0 }, 1);
    const r = log.finish('a', to, '');
    expect(r.maxHeel).toBe(0);
    expect(r.maxSea).toBe(0);
  });
});
