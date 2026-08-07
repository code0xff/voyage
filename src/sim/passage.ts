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
