import { clamp, wrap2Pi, wrapPi } from './math';

/**
 * The autopilot.
 *
 * A short-handed cruiser does not stand at the tiller for an hour, and neither
 * should the player. It sits alongside auto-trim and auto-reef: the boring part
 * of sailing done for you, so the interesting part -- where to go -- is what is
 * left.
 *
 * Two modes, because a real pilot has both and they answer different questions.
 * **Compass** holds a heading, which is what you want on a reach towards a
 * mark. **Wind** holds a true wind angle, which is what you want on a beat: the
 * boat then follows every shift on her own, taking the lifts and going down
 * with the headers, and the tactical question becomes whether to stay on this
 * board rather than how to hold the boat on it.
 *
 * Wind mode is not a second control law. A wind angle *is* a heading, once the
 * wind direction is known: twa = twd - heading, so holding twa at a target is
 * holding the heading at twd - target. Deriving it that way leaves one error
 * term and one set of signs to get right instead of two, which in this codebase
 * is worth more than the couple of lines it saves.
 */

export type PilotMode = 'off' | 'compass' | 'wind';

export interface PilotState {
  mode: PilotMode;
  /** Compass heading to hold, rad. Used directly in compass mode. */
  heading: number;
  /** True wind angle to hold, rad, signed to starboard. Used in wind mode. */
  twa: number;
}

/**
 * Proportional gain, rudder fraction per radian of heading error.
 *
 * Full helm is 35 degrees and puts about 7 deg/s of turn on at hull speed, so
 * this asks for roughly a third of it at ten degrees of error: enough to gather
 * the boat up briskly, gentle enough that a puff-induced wobble does not saw
 * the helm about.
 */
const KP = 2;
/**
 * Rate gain, rudder fraction per radian per second of yaw.
 *
 * Without it the pilot is a spring and the boat weaves: she carries her way
 * round for several seconds after the helm is centred, so a controller that
 * only looks at where she is pointing always arrives with the swing still on.
 * This is what makes it settle rather than hunt.
 */
const KD = 6;
/**
 * The pilot never uses more than this much helm.
 *
 * It is a helmsman, not an emergency. Hard over is for tacking, which is a
 * decision the player makes; a pilot that threw the helm across to chase a
 * gust would be both alarming and slow, since a rudder at that angle is mostly
 * making drag.
 */
const MAX_HELM = 0.55;

export function initialPilot(): PilotState {
  return { mode: 'off', heading: 0, twa: 0 };
}

/**
 * Engage on what the boat is doing right now, which is the only sane thing for
 * a pilot to do: you steady up on the course you want, then press the button.
 */
export function engage(p: PilotState, mode: PilotMode, heading: number, twa: number): void {
  p.mode = mode;
  p.heading = wrap2Pi(heading);
  p.twa = twa;
}

/** off -> compass -> wind -> off, which is the order they are reached for. */
export function cyclePilot(p: PilotState, heading: number, twa: number): void {
  const next: PilotMode = p.mode === 'off' ? 'compass' : p.mode === 'compass' ? 'wind' : 'off';
  engage(p, next, heading, twa);
}

/**
 * The helm angle the pilot wants, -1..1.
 *
 * @param twd the wind direction *where the boat is*, so that in wind mode she
 *            follows the shift she is actually in rather than the mean
 */
export function pilotRudder(
  p: PilotState,
  heading: number,
  twd: number,
  yawRate: number,
): number {
  if (p.mode === 'off') return 0;
  const want = p.mode === 'wind' ? wrap2Pi(twd - p.twa) : p.heading;
  const error = wrapPi(want - heading);
  // Positive rudder swings the bow to starboard, which increases the heading,
  // so a positive error calls for positive helm. The rate term opposes the
  // swing already happening, so it subtracts.
  return clamp(KP * error - KD * yawRate, -MAX_HELM, MAX_HELM);
}

/** What to show on the instrument: the number the pilot is steering to. */
export function pilotTarget(p: PilotState): number {
  return p.mode === 'wind' ? p.twa : p.heading;
}
