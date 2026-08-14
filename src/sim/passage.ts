import { compassAngle, compassVec, dot, len, rotCW90, sub, wrap2Pi, wrapPi, type Vec2 } from './math';
// The sky's, not a copy of it. It is the same clock: the engine's hour counts
// on monotonically so the sun and the tide never see it jump, and both that
// module and this one want it brought back into the day before anyone reads it
// as a time.
import { wrapHour } from './sky';
import type { WeatherKind } from './weather';

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
 * The world around her this step, as a passage remembers it.
 *
 * An object rather than four positional arguments, because two of them are
 * physical quantities with conventions attached and a call site reading
 * `conditions(kind, hour, heel, h13, dt)` gives a reader no way to check either
 * of them. Signs and units are the thing this project gets wrong most often.
 */
export interface Conditions {
  weather: WeatherKind;
  /** The world clock, hours, unwrapped -- it is brought into the day at the end. */
  hour: number;
  /**
   * rad, signed the way everything here is: positive means heeled to starboard.
   *
   * Only the magnitude is kept. A knockdown to port and one to starboard are
   * the same fact about how rough it was, and which tack she happened to be on
   * is not what the record is asking.
   */
  heel: number;
  /** Significant wave height where she is, m, after the land has sheltered it. */
  seaHeight: number;
}

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
  /**
   * The world clock she set out on and arrived on, hours, 0 to 24.
   *
   * The world's own time and not `startedAt`, which is when the player sat
   * down. They are barely related: the clock runs at `timeScale`, sixty by
   * default, so twenty minutes at the keyboard is most of a day at sea and a
   * passage begun at dawn very often ends after dark. That is the part worth
   * remembering, and none of it was recoverable from a wall-clock stamp.
   *
   * Wrapped into the day, so a passage that ran past midnight has an `endHour`
   * lower than its `startHour`. `duration` is what says how long it took;
   * these two say when it was, and an unwrapped 27.5 is not a time of day.
   */
  startHour?: number;
  endHour?: number;
  /**
   * The weather that took up most of the passage, by the clock.
   *
   * The one it is remembered for rather than the one it ended in: arriving in
   * a clearing sky does not make a day of fog a clear passage.
   */
  weather?: WeatherKind;
  /**
   * The worst of it: the steepest she was laid over, rad, and the biggest
   * significant wave height she was in, m.
   *
   * Unsigned heel, because which side she went over on is not what is being
   * asked. Both are maxima and not averages, for the same reason `maxSog` is
   * one -- a mean over a long passage buries the ten minutes that were the
   * whole of it, and those ten minutes are what gets remembered.
   *
   * Absent together, and only on a record from before they existed. A passage
   * that was never rough records zero, which is a fact and not a silence.
   */
  maxHeel?: number;
  maxSea?: number;
  /**
   * How many photographs were taken on it.
   *
   * A count and not a list of files, deliberately. The picture leaves the
   * browser the moment it is taken -- `a.download` asks for a name and does not
   * get to insist on one, since the browser renames on a collision and the
   * player may move the file or throw it away -- so a stored filename would be
   * a claim this record cannot check and will eventually be wrong about. That
   * she stopped three times to photograph something is a fact about the
   * passage, and it is the part worth keeping anyway.
   */
  photographs?: number;
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
  /** Null until the first step is reported, which is how "never told" is said. */
  private firstHour: number | null = null;
  private lastHour = 0;
  private readonly weatherSeconds = new Map<WeatherKind, number>();
  private maxHeel = 0;
  private maxSea = 0;
  private photographs = 0;

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
   * What the world was like this step, whether or not she was sailing through it.
   *
   * Ungated, unlike `advance`, and for the same reason `sight` is. Those
   * seconds measure how the miles were made and an anchored boat makes none;
   * these say what the passage was like, and the weather she anchored to sit
   * out is exactly the weather it is remembered for. Gating them would also
   * stop the clock, so a passage that ended at anchor would report arriving at
   * the hour she stopped rather than the hour she got there.
   *
   * @param dt real seconds, the same currency as `duration`. World seconds
   *   would give the same answer while `timeScale` holds still and a different
   *   one across a change of it, for no gain: what is wanted is which weather
   *   the player spent the passage in.
   */
  /**
   * One taken and kept.
   *
   * Counted when the picture actually exists, not when the shutter was asked
   * for: the capture resolves a frame later and can come back with nothing at
   * all, and a passage that reports a photograph the player has not got is
   * exactly the kind of small lie a logbook cannot afford.
   */
  photographed(): void {
    this.photographs++;
  }

  conditions(now: Conditions, dt: number): void {
    if (this.firstHour === null) this.firstHour = now.hour;
    this.lastHour = now.hour;
    this.weatherSeconds.set(now.weather, (this.weatherSeconds.get(now.weather) ?? 0) + dt);
    // Magnitude, per the note on the field: which side she went over on is not
    // a fact about the passage.
    const heel = Math.abs(now.heel);
    if (heel > this.maxHeel) this.maxHeel = heel;
    if (now.seaHeight > this.maxSea) this.maxSea = now.seaHeight;
  }

  /**
   * The kind with the most seconds against it, or nothing if never told.
   *
   * Iterated in insertion order, so a dead tie falls to whichever was met
   * first. Two kinds landing on the same float is not a case worth a rule, but
   * it is worth being deterministic about.
   */
  private dominantWeather(): WeatherKind | undefined {
    let best: WeatherKind | undefined;
    let most = -1;
    for (const [kind, seconds] of this.weatherSeconds) {
      if (seconds > most) {
        most = seconds;
        best = kind;
      }
    }
    return best;
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
    // The first hour reported, or null if none ever was. Read out here so that
    // the narrowing holds across every field that depends on it below.
    const told = this.firstHour;
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
      // Everything `conditions` feeds is absent together, because it is all
      // told together: a log never given a single step knows nothing about the
      // world it crossed, and saying so beats reporting midnight in flat calm.
      // `dominantWeather` answers the same way of its own accord, its map being
      // empty for exactly the same reason.
      startHour: told === null ? undefined : wrapHour(told),
      endHour: told === null ? undefined : wrapHour(this.lastHour),
      weather: this.dominantWeather(),
      maxHeel: told === null ? undefined : this.maxHeel,
      maxSea: told === null ? undefined : this.maxSea,
      // Not tied to `told`, unlike the four above: this one is counted by the
      // player pressing a key rather than by the world being reported, so a log
      // that was never given a step can still have had a photograph taken on it.
      photographs: this.photographs,
    };
  }
}
