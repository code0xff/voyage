import { describe, expect, it } from 'vitest';
import { MANEUVER_TIMEOUT, ManeuverTracker, type Maneuver } from './maneuver';
import { DEG } from './math';

/**
 * The judgement of a turn, driven with synthetic traces of the two numbers the
 * real engine feeds it. Every trace here is a story a boat can actually tell --
 * a clean tack, a botched one, a wobble in irons, a dead run in shifty air --
 * and the assertions are about which of them deserve a report.
 */

const DT = 1 / 120;

/** Feed one condition for a number of seconds, collecting any report. */
function hold(
  tracker: ManeuverTracker,
  seconds: number,
  twaDeg: number,
  speed: number,
): Maneuver[] {
  const out: Maneuver[] = [];
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    const m = tracker.update(twaDeg * DEG, speed, DT);
    if (m) out.push(m);
  }
  return out;
}

/** A tracker that has settled on starboard tack at cruising speed. */
function settled(twaDeg = 45, speed = 3): ManeuverTracker {
  const tracker = new ManeuverTracker();
  hold(tracker, 10, twaDeg, speed);
  return tracker;
}

describe('a tack', () => {
  it('reports once, with what the turn cost', () => {
    const tracker = settled(45, 3);
    const during = [
      // Through the wind and slow on the new side...
      ...hold(tracker, 1, -10, 2.2),
      ...hold(tracker, 3, -45, 2.2),
      // ...then the way comes back.
      ...hold(tracker, 2, -45, 2.9),
    ];
    expect(during).toHaveLength(1);
    const [m] = during;
    expect(m.kind).toBe('tack');
    expect(m.entrySpeed).toBeCloseTo(3, 1);
    // The low point against the speed she carried in, not against a number
    // invented at the crossing.
    expect(m.lost).toBeCloseTo(3 - 2.2, 1);
    // From the crossing to the recovery: the four slow seconds, give or take
    // the step the recovery lands on.
    expect(m.seconds).toBeGreaterThan(3.5);
    expect(m.seconds).toBeLessThan(4.5);
    // And nothing further while she just sails.
    expect(hold(tracker, 10, -45, 2.9)).toHaveLength(0);
  });

  /**
   * Signs are what this project gets wrong most often, and a tracker that only
   * worked port-to-starboard would pass every test written on one tack.
   */
  it('reads the same from either tack', () => {
    const one = settled(45, 3);
    const a = [...hold(one, 1, -10, 2.2), ...hold(one, 4, -45, 2.9)];
    const other = settled(-45, 3);
    const b = [...hold(other, 1, 10, 2.2), ...hold(other, 4, 45, 2.9)];
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].kind).toBe('tack');
    expect(b[0].kind).toBe('tack');
    expect(a[0].lost).toBeCloseTo(b[0].lost, 6);
  });

  it('does not report a tack she pulled out of', () => {
    const tracker = settled(45, 3);
    const during = [
      ...hold(tracker, 1, -5, 2.4),
      // Thought better of it.
      ...hold(tracker, 4, 45, 2.9),
    ];
    expect(during).toHaveLength(0);
    // And the next real one still counts: the abort put her back on a known side.
    const real = [...hold(tracker, 1, -10, 2.2), ...hold(tracker, 4, -45, 2.9)];
    expect(real).toHaveLength(1);
    // Counted from its own crossing. Without the abort the earlier pull-out
    // stays armed underneath, silently merges into this one, and the report
    // covers ten seconds of turn the player did not make -- the count alone
    // cannot tell those apart, which is how this test first passed with the
    // abort deleted.
    expect(real[0].seconds).toBeLessThan(6);
  });

  it('keeps counting through a struggle in irons, and reports the whole of it', () => {
    const tracker = settled(45, 3);
    const wobble: Maneuver[] = [];
    wobble.push(...hold(tracker, 1, -5, 1.5));
    // Head to wind, sign dithering, way falling off: one maneuver, not five.
    for (let i = 0; i < 5; i++) {
      wobble.push(...hold(tracker, 2, 5, 1.0));
      wobble.push(...hold(tracker, 2, -5, 1.0));
    }
    wobble.push(...hold(tracker, 5, -45, 2.8));
    expect(wobble).toHaveLength(1);
    expect(wobble[0].kind).toBe('tack');
    // The report covers the struggle: twenty-odd seconds, not the last five.
    expect(wobble[0].seconds).toBeGreaterThan(20);
  });

  it('has nothing to say about a turn from a standstill', () => {
    const tracker = settled(45, 0.5);
    expect([...hold(tracker, 1, -10, 0.4), ...hold(tracker, 10, -45, 0.5)]).toHaveLength(0);
  });

  it('drops a turn the wind died under, once the timeout passes', () => {
    const tracker = settled(45, 3);
    const during = [
      ...hold(tracker, 1, -10, 0.5),
      // Becalmed head off the wind: never recovers to 90% of entry.
      ...hold(tracker, MANEUVER_TIMEOUT + 5, -45, 0.5),
      // And the breeze filling back in later is not retroactively a tack.
      ...hold(tracker, 10, -45, 3),
    ];
    expect(during).toHaveLength(0);
  });
});

describe('a gybe', () => {
  it('is told apart from a tack by which boundary the wind crossed', () => {
    const tracker = settled(140, 3);
    hold(tracker, 2, 170, 3);
    const during = [...hold(tracker, 1, -170, 3), ...hold(tracker, 3, -140, 3)];
    expect(during).toHaveLength(1);
    expect(during[0].kind).toBe('gybe');
    // A gybe that sheds no way is a clean gybe, not an error.
    expect(during[0].lost).toBeCloseTo(0, 6);
  });

  /**
   * The dead-run filter. Running deep, the wind's own shifts carry TWA across
   * 180 and the boom across the boat -- physically a gybe, but reporting one
   * per wander would bury the reports that mean anything. A blow-through never
   * commits twenty degrees onto the new side, so it stays unreported.
   */
  it('stays quiet when a shift blows her across dead astern', () => {
    const tracker = settled(140, 3);
    hold(tracker, 5, 176, 3);
    const during = [
      ...hold(tracker, 20, -178, 3),
      ...hold(tracker, 20, 177, 3),
      ...hold(tracker, MANEUVER_TIMEOUT + 10, -176, 3),
    ];
    expect(during).toHaveLength(0);
  });
});

describe('the tracker across a teleport', () => {
  it('does not read a jump as a turn', () => {
    const tracker = settled(45, 3);
    tracker.reset();
    // A new session opens on the other tack at speed: no report, ever.
    expect(hold(tracker, 15, -45, 3)).toHaveLength(0);
  });
});
