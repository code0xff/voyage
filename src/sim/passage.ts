import { compassAngle, compassVec, dot, len, rotCW90, sub, wrap2Pi, wrapPi, type Vec2 } from './math';

/**
 * Passage making: going somewhere, rather than round something.
 *
 * A race asks how fast. A passage asks the navigator's questions instead --
 * where is it, how long will it take, can I lay it or must I tack, and what do
 * I have to steer so the tide puts me there rather than a mile downstream. None
 * of those need a clock or an opponent, which is the point.
 *
 * Everything here is over the *ground*. A destination is a place, and places do
 * not move with the tide; a passage worked from speed and heading through the
 * water is the classic way to end up somewhere else entirely.
 */

export interface PassageInfo {
  /** Compass bearing from the boat to the destination, rad. */
  bearing: number;
  /** Distance to it, m. */
  distance: number;
  /**
   * Speed made good towards the destination, m/s, over the ground.
   *
   * Not boat speed. On a beat the boat sails at an angle to where she is
   * going, and half her speed can be going sideways relative to the passage --
   * which is why this is the number that decides an arrival time and boat speed
   * is not. Negative while sailing away from it.
   */
  vmc: number;
  /** Seconds to arrival at the present rate, or null when not closing at all. */
  eta: number | null;
  /**
   * rad, the true wind angle the boat would sail if she pointed straight at the
   * destination. Signed, so its sign is which tack that would be.
   */
  twaDirect: number;
  /**
   * The heading to steer so that the tide sets the boat *onto* the track rather
   * than off it, rad -- or null when the cross-tide is stronger than the boat
   * and no heading can hold the line.
   *
   * The classic tidal calculation, and the one piece of navigation that is
   * genuinely counter-intuitive: to go where you are looking, you must not look
   * where you are going. It is only about the cross-track component, because
   * the along-track part of a tide changes how long the passage takes and not
   * where the boat ends up.
   */
  courseToSteer: number | null;
}

/**
 * @param groundVel the boat's velocity over the ground, m/s, world frame
 * @param waterSpeed her speed through the water, m/s -- what she has to steer with
 * @param current    the stream here, m/s, world frame
 */
export function passageInfo(
  from: Vec2,
  dest: Vec2,
  groundVel: Vec2,
  waterSpeed: number,
  current: Vec2,
  twd: number,
): PassageInfo {
  const to = sub(dest, from);
  const distance = len(to);

  // A boat sitting on the destination has no bearing to it. Report the heading
  // she is making rather than the direction of the last rounding error.
  const bearing = distance < 1e-6 ? compassAngle(groundVel) : compassAngle(to);
  const track = compassVec(bearing);

  const vmc = dot(groundVel, track);
  // Not closing means no arrival, and a huge number is a worse answer than none:
  // it invites a readout to print four days rather than say it is going nowhere.
  const eta = vmc > 0.01 ? distance / vmc : null;

  const twaDirect = wrapPi(twd - bearing);

  // How hard the tide is pushing across the track, positive to starboard of it.
  // Only the cross component matters: the along-track part makes the passage
  // quicker or slower and does not move the boat off the line.
  const cross = dot(current, rotCW90(track));
  const courseToSteer =
    waterSpeed > 1e-6 && Math.abs(cross) <= waterSpeed
      ? // Steer up-tide by exactly the angle whose cross-track component cancels
        // it. Negative when the tide sets to starboard, which is the part that
        // reads wrong until you have watched it work.
        wrap2Pi(bearing + Math.asin(-cross / waterSpeed))
      : null;

  return { bearing, distance, vmc, eta, twaDirect, courseToSteer };
}

/**
 * Whether the destination is inside the no-go zone, so it cannot be laid on
 * this heading and the passage has to be worked to windward.
 *
 * @param noGo the closest the boat can sail to the true wind, rad
 */
export const mustTack = (info: PassageInfo, noGo: number): boolean =>
  Math.abs(info.twaDirect) < noGo;

/**
 * What was seen on the way.
 *
 * Whales and sharks, and not gulls. That is a judgement about what a record is
 * for rather than an oversight, and it does not rest on today's tuning: the
 * whales and the sharks are spaced by the wildlife setting and open minutes
 * apart, while a gull flock has no spacing at all and is tried for every few
 * seconds the whole length of a coast. Turn the setting to either end and the
 * two stay on their own sides of the line. One is an encounter and the other is
 * the weather, and a logbook reading "47 gull flocks" would be measuring how
 * long the passage was, in a field that claims to say what happened on it.
 */
export interface Sightings {
  whales: number;
  sharks: number;
}

/**
 * Which count an encounter goes towards.
 *
 * Derived from `Sightings` rather than written out again beside it, so a kind
 * added there cannot be forgotten here.
 */
export type SightingKind = keyof Sightings;

/**
 * What a completed passage was, once she has arrived.
 *
 * A plain serialisable row on purpose. The logbook lives in the browser today
 * and may be synced to a server later, and that later should be a new storage
 * adapter rather than a migration -- so nothing here is a class, a Map or a
 * typed array, and every record carries a stable id and a timestamp.
 *
 * Distances and speeds are over the ground, because a passage is a thing that
 * happened between two places.
 */
export interface PassageRecord {
  id: string;
  /** When she sailed, ms since the epoch. Real time, not world time. */
  startedAt: number;
  /** Seconds under way. */
  duration: number;
  /** Metres over the ground -- the track sailed, not the distance between the ends. */
  distance: number;
  from: Vec2;
  to: Vec2;
  /** Straight-line distance between the ends, m. Distance over it is how much was tacked. */
  direct: number;
  avgSog: number;
  maxSog: number;
  /** Venue id, or '' in the open ocean. */
  venue: string;
  /** Mean true wind while under way, knots. */
  windKnots: number;
  /**
   * What was seen, counted in encounters rather than in steps.
   *
   * Optional because every record already in a logbook was written before this
   * field existed, and a passage that does not know what it saw must not be
   * made to say it saw nothing. New records always carry it, zeros included.
   */
  sightings?: Sightings;
}

/**
 * A passage in progress.
 *
 * An accumulator rather than a track: the logbook wants what the passage *was*,
 * and keeping every position to work that out afterwards would store megabytes
 * to answer questions that are a handful of running totals.
 *
 * Pure, and holds no clock of its own -- the caller supplies dt, because the
 * only two things here that must not drift are what "under way" means and which
 * seconds count.
 */
export class PassageLog {
  distance = 0;
  duration = 0;
  maxSog = 0;
  private sogIntegral = 0;
  private windIntegral = 0;
  private readonly counted = new Set<string>();
  private readonly sightings: Sightings = { whales: 0, sharks: 0 };

  constructor(
    readonly from: Vec2,
    readonly to: Vec2,
    /** ms since the epoch, supplied because the sim core has no clock. */
    readonly startedAt: number,
  ) {}

  /**
   * @param sog speed over the ground, m/s
   * @param twsKn true wind, knots
   */
  advance(sog: number, twsKn: number, dt: number): void {
    this.duration += dt;
    this.distance += sog * dt;
    this.sogIntegral += sog * dt;
    this.windIntegral += twsKn * dt;
    if (sog > this.maxSog) this.maxSog = sog;
  }

  /**
   * Note an animal in sight, which is very probably the same one as last step.
   *
   * The fields publish what is in sight *now* and refill the list every step,
   * so one encounter arrives here a few hundred times. Counting by id rather
   * than by call is what turns that back into one whale.
   *
   * Ids restart when a field is reseeded, which would let a second animal be
   * mistaken for one already counted -- except that a reseed always ends the
   * passage, because `rebuildWorld` clears the destination and that abandons
   * the log. Within one passage an id is one animal and cannot be reissued.
   * Keyed by kind as well, since the fields number themselves independently and
   * whale 1 and shark 1 are both the first of their kind.
   */
  sight(kind: SightingKind, id: number): void {
    const key = `${kind}:${id}`;
    if (this.counted.has(key)) return;
    this.counted.add(key);
    this.sightings[kind]++;
  }

  /**
   * The record, given an id and where she ended up.
   *
   * `to` is passed in rather than taken from the constructor because a passage
   * ends where the anchor went down, which is near the destination and never
   * exactly on it.
   */
  finish(id: string, at: Vec2, venue: string): PassageRecord {
    // Time-weighted, so lying becalmed for an hour drags the average down as it
    // should. Guarded because a passage can be ended the instant it is begun.
    const avgSog = this.duration > 0 ? this.sogIntegral / this.duration : 0;
    return {
      id,
      startedAt: this.startedAt,
      duration: this.duration,
      distance: this.distance,
      from: { ...this.from },
      to: { ...at },
      direct: len(sub(at, this.from)),
      avgSog,
      maxSog: this.maxSog,
      venue,
      windKnots: this.duration > 0 ? this.windIntegral / this.duration : 0,
      // Copied for the same reason the endpoints are: the record is finished
      // and a sighting after it must not reach back into it.
      sightings: { ...this.sightings },
    };
  }
}
