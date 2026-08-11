import { describe, expect, it } from 'vitest';
import { giveWay } from './giveway';
import { compassVec, rotCW90, wrapPi } from './math';

/**
 * The shark's numbers, because they are the tighter ones and the rule was
 * rewritten to fix the shark. Written out rather than imported: `sharks.ts`
 * keeps them private, and a test that read them would be asserting the rule
 * behaves the same whatever they are set to, which is not the claim.
 */
const NOTICE = 50;
const LANE = 26;
const RATE = 2.0;
const SPEED = 1.6;
const STEP = 1 / 120;

/** Boat at the origin making due north, so the track is the y axis. */
const BOAT = { x: 0, y: 0 };
const COURSE = 0;
const STARBOARD = rotCW90(compassVec(COURSE));

const offTrackOf = (pos: { x: number; y: number }) =>
  pos.x * STARBOARD.x + pos.y * STARBOARD.y;

/** Swim an animal under the rule and report where it got to. */
function swim(
  pos: { x: number; y: number },
  heading: number,
  seconds: number,
  notice = NOTICE,
  lane = LANE,
  rate = RATE,
  speed = SPEED,
) {
  const at = { ...pos };
  let hdg = heading;
  for (let t = 0; t < seconds; t += STEP) {
    hdg = giveWay(at, hdg, speed, BOAT, COURSE, STEP, notice, lane, rate);
    const dir = compassVec(hdg);
    at.x += dir.x * speed * STEP;
    at.y += dir.y * speed * STEP;
  }
  return { pos: at, heading: hdg };
}

describe('giveWay', () => {
  /**
   * The property the whole rule exists for, and the one that distinguishes it
   * from the radial flight it replaced: what protects an animal from a boat
   * holding a course is distance from the *track*, so that is what has to grow.
   *
   * Set up running directly away, which is the case radial flight cannot
   * improve on at all -- it is already pointing where that rule would send it,
   * so anything this asserts is the abeam rule and nothing else.
   */
  it('increases the animal distance from the track, not from the boat', () => {
    const start = { x: 0, y: 30 };
    const after = swim(start, COURSE, 20);

    expect(Math.abs(offTrackOf(after.pos))).toBeGreaterThan(20);
    // ...and it did it by turning abeam, not by running on up the track.
    expect(Math.abs(Math.sin(after.heading - COURSE))).toBeGreaterThan(0.9);
  });

  /**
   * Regression, and the reason the beam is chosen by time rather than by side.
   *
   * The geometry is a real whale encounter: 108 m ahead, 9 m to port, already
   * crossing to starboard at 92 degrees. "Clear towards the side you are on"
   * sends it back through 178 degrees to reach the port beam, and at 0.2 rad/s
   * that is fifteen seconds with its head swinging through the oncoming hull.
   * It should carry on across instead, which is both faster and what the animal
   * would do.
   *
   * This is the assertion that has to carry that choice, because the cost of
   * getting it wrong does not show up in an ordinary encounter: sailing on at
   * six knots, "the side you are on" measures 23.1 m worst against this rule's
   * 25.9, which no affordable world-level test would separate. The manoeuvre is
   * wrong to look at well before it is close enough to measure.
   */
  it('does not reverse an animal that is already most of the way across', () => {
    const heading = (92 * Math.PI) / 180;
    const after = swim({ x: -9, y: 108 }, heading, 4, 160, 100, 0.2, 1.8);

    // Settled on the starboard beam it was nearly on already, despite lying to
    // port. Four seconds is chosen so the two rules are far apart rather than
    // merely different: urgency here is 0.91, so a whale sent to the port beam
    // instead would be 40 degrees round by now and still turning.
    expect(Math.abs(wrapPi(after.heading - Math.PI * 0.5))).toBeLessThan(0.1);
  });

  /**
   * The other half of that choice. An animal lying well out on one side has
   * nothing to gain by crossing to the other, however little it would have to
   * turn to do it, because it would have to cross the track to get there.
   */
  it('does not send an animal across the track to reach the nearer beam', () => {
    // 24 m to starboard and pointing at the port beam: the cheap turn is the
    // wrong one, and only the swim to clear tells the two apart.
    const after = swim({ x: 24, y: 30 }, -Math.PI * 0.5, 12);

    expect(offTrackOf(after.pos)).toBeGreaterThan(24);
  });

  it('holds course for a boat that has already passed', () => {
    const heading = 1.1;
    // Astern of the boat and well inside every other threshold.
    expect(giveWay({ x: 4, y: -20 }, heading, SPEED, BOAT, COURSE, STEP, NOTICE, LANE, RATE)).toBe(
      heading,
    );
  });

  it('holds course beyond the range it notices the boat at', () => {
    const heading = 1.1;
    // Dead on the track, so only the range gate can be what stops it.
    expect(
      giveWay({ x: 0, y: NOTICE + 1 }, heading, SPEED, BOAT, COURSE, STEP, NOTICE, LANE, RATE),
    ).toBe(heading);
  });

  /**
   * What keeps most sightings the untouched crossing track they are meant to
   * be. Inside `notice` the rule never goes fully quiet -- the range term sees
   * to that, and should, since a boat that close is worth noticing wherever it
   * is heading -- so the claim is about how much, not whether.
   *
   * Both animals are placed the same distance off, so the only thing between
   * them is where the track runs. This is also the assertion that fails if the
   * two urgencies are ever added rather than maxed.
   */
  it('deflects an animal passing clear far less than one on the track', () => {
    const range = 30;
    const heading = 1.1;
    const turn = (pos: { x: number; y: number }) =>
      Math.abs(wrapPi(giveWay(pos, heading, SPEED, BOAT, COURSE, STEP, NOTICE, LANE, RATE) - heading));

    const clear = turn({ x: LANE + 4, y: Math.sqrt(range * range - (LANE + 4) * (LANE + 4)) });
    const onTrack = turn({ x: 0, y: range });

    expect(clear).toBeGreaterThan(0);
    expect(clear).toBeLessThan(onTrack * 0.5);
  });

  /**
   * Inside the hull every quantity the rule works from is measured off an
   * offset of zero, so there is nothing to say. The bearing itself is fine --
   * it comes from the track normal, not from the offset -- which is why the
   * guard is about having nothing useful to advise rather than about atan2.
   */
  it('holds course when the animal is exactly on the boat', () => {
    const heading = 1.1;
    expect(giveWay({ ...BOAT }, heading, SPEED, BOAT, COURSE, STEP, NOTICE, LANE, RATE)).toBe(
      heading,
    );
  });

  /**
   * The turn is a curve, not an assignment. Without the limit an animal snaps
   * to the beam in a single step the moment the boat crosses `notice`, which
   * reads as a thing reacting to a trigger.
   */
  it('turns no faster than its rate', () => {
    const heading = Math.PI; // pointing back down the track, the largest demand
    const after = giveWay({ x: 0, y: 20 }, heading, SPEED, BOAT, COURSE, STEP, NOTICE, LANE, RATE);
    expect(Math.abs(wrapPi(after - heading))).toBeLessThanOrEqual(RATE * STEP + 1e-12);
    expect(Math.abs(wrapPi(after - heading))).toBeGreaterThan(0);
  });

  /**
   * The rule is written in the boat's frame, so it has to hold in any of them.
   * A version that used world axes anywhere would pass every test above, all of
   * which sail due north.
   */
  it('works the same on any course', () => {
    for (const course of [0.9, 2.4, -1.7, Math.PI]) {
      const track = compassVec(course);
      const stbd = rotCW90(track);
      // The first case above, rotated: 30 m dead ahead, running directly away.
      const at = { x: track.x * 30, y: track.y * 30 };
      let hdg = course;
      for (let t = 0; t < 20; t += STEP) {
        hdg = giveWay(at, hdg, SPEED, BOAT, course, STEP, NOTICE, LANE, RATE);
        const dir = compassVec(hdg);
        at.x += dir.x * SPEED * STEP;
        at.y += dir.y * SPEED * STEP;
      }
      expect(Math.abs(at.x * stbd.x + at.y * stbd.y)).toBeGreaterThan(20);
    }
  });
});
