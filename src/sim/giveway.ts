import { clamp, compassAngle, wrapPi, type Vec2 } from './math';

/**
 * The rule by which an animal bends its course away from an approaching boat.
 *
 * It lives here rather than in either species because both need it for the same
 * reason and neither may have its own copy. There is no collision anywhere in
 * this simulation, so without a rule of this kind nothing stops the hull passing
 * straight through the animal -- and spawn geometry cannot prevent it, because
 * the player can turn. Worse, the crossing tracks both species generate contain
 * an exact collision course: the animal is on a constant bearing when the boat's
 * speed across the line of sight matches its own.
 *
 * The whale had this first and the shark was written without it, which is
 * exactly the shape of duplication this project keeps paying for -- the second
 * animal did not inherit the correction because it never inherited the code.
 *
 * Two properties are the reason this is not three lines written twice:
 *
 * - **Rate-limited rather than assigned.** Set directly, the animal snaps round
 *   to face away the instant the boat crosses `range`, which reads as a thing
 *   reacting to a trigger rather than as an animal.
 * - **Urgency-scaled.** A distant pass barely deflects the track, so the
 *   encounter is still an animal going about its own business; a boat driven
 *   straight at it gets the full rate.
 *
 * Nothing here acts on the boat. The animal gives way and the helmsman feels
 * nothing, which is the whole reason this lives outside the physics.
 *
 * @param range   how far out the animal starts giving way, m
 * @param rate    how fast it can come round, rad/s
 * @returns the animal's new heading; it is not mutated here
 */
export function giveWay(
  pos: Vec2,
  heading: number,
  boat: Vec2,
  dt: number,
  range: number,
  rate: number,
): number {
  const offX = pos.x - boat.x;
  const offY = pos.y - boat.y;
  const distance = Math.hypot(offX, offY);
  // Exactly on the boat there is no direction to flee in, and asking for one
  // would be atan2(0, 0). Hold course; the next step will have an answer.
  if (distance >= range || distance < 1e-6) return heading;

  const away = compassAngle({ x: offX, y: offY });
  const urgency = 1 - distance / range;
  const step = rate * urgency * dt;
  return heading + clamp(wrapPi(away - heading), -step, step);
}
