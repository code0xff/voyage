import { clamp, compassAngle, compassVec, rotCW90, wrapPi, type Vec2 } from './math';

/**
 * The rule by which an animal clears the track of an approaching boat.
 *
 * It lives here rather than in either species because both need it for the same
 * reason and neither may have its own copy. There is no collision anywhere in
 * this simulation, so without a rule of this kind nothing stops the hull passing
 * straight through the animal -- and spawn geometry cannot prevent it, because
 * the player can turn. Worse, the crossing tracks both species generate contain
 * an exact collision course: the animal is on a constant bearing when the boat's
 * speed across the line of sight matches its own.
 *
 * Two things about it are not obvious, and both were measured rather than
 * reasoned. Each replaced a plausible version that did not work.
 *
 * **It steers abeam of the boat's course, not away from the boat.** For a boat
 * holding a course the closest approach is the animal's perpendicular distance
 * from the track, so moving square off the track is what increases it; running
 * directly away is a stern chase the animal loses, because every animal here is
 * slower than the boat. The whale got away with fleeing radially only because it
 * opens 220 m off and the boat cannot reach it inside an encounter. The shark
 * opens at 45 m against a boat that covers 130 m, and radial flight does not
 * save it. Measured on the same constants at six knots, fleeing radially still
 * put 1.4% of encounters inside 10 m and the worst pass at 0.5 m; steering
 * abeam puts the worst at 20.1 m and nothing inside 20 m at all.
 *
 * **Urgency is mostly how near the boat's track the animal is, and partly how
 * near the boat.** Nearness to the track is the quantity it is actually in
 * trouble about, and it carries almost all of the work: range alone cannot tell
 * an animal 40 m dead ahead from one 40 m abeam, and it is zero at the moment
 * the animal first notices, so the turn only becomes urgent once there is no
 * longer time to complete it. That is what left the shark passing within 5 m on
 * 7.5% of encounters.
 *
 * The range term is kept because it measurably helps and costs nothing: the
 * larger of the two is taken, so it can only ever raise the urgency the lane
 * asks for. At six knots it moves the shark's worst pass from 19.2 m to 20.1 m
 * and clears the last few encounters inside 20 m. For the whale it changes
 * nothing at all, and `notice` is purely a gate.
 *
 * Well off the lane only the range term is left, and inside `notice` it never
 * quite reaches zero -- which is right, since a boat that close is worth
 * noticing wherever it is heading -- but it is small, and that is what keeps
 * most sightings the untouched crossing track they are meant to be. Outside
 * `notice` the rule does nothing at all.
 *
 * Two further properties, both of which cost something to rediscover:
 *
 * - **Rate-limited rather than assigned.** Set directly, the animal snaps round
 *   the instant the boat crosses `notice`, which reads as a thing reacting to a
 *   trigger rather than as an animal.
 * - **Only for a boat still coming.** One that has passed is not given way to,
 *   or the animal is shepherded along ahead of a hull going the other way.
 *
 * Nothing here acts on the boat. The animal gives way and the helmsman feels
 * nothing, which is the whole reason this lives outside the physics.
 *
 * @param speed   how fast the animal swims, m/s. Needed to weigh the two beams
 *   against each other -- see the choice of `side` below.
 * @param boatCourse the boat's course over ground, radians. Its track and not
 *   its heading: with a current running the two differ by the set, and it is
 *   the track the animal has to be off.
 * @param notice  range at which the animal starts giving way at all, m
 * @param lane    how far off the boat's track it wants to be, m
 * @param rate    how fast it can come round, rad/s
 * @returns the animal's new heading; it is not mutated here
 */
export function giveWay(
  pos: Vec2,
  heading: number,
  speed: number,
  boat: Vec2,
  boatCourse: number,
  dt: number,
  notice: number,
  lane: number,
  rate: number,
): number {
  const offX = pos.x - boat.x;
  const offY = pos.y - boat.y;
  const distance = Math.hypot(offX, offY);
  // Inside the hull there is no useful advice to give, and every quantity below
  // is measured from an offset that is zero. Hold course; the boat is the thing
  // that will move first, and the next step will have an answer.
  if (distance >= notice || distance < 1e-6) return heading;

  const track = compassVec(boatCourse);
  // Astern, so not a boat to give way to. See the docblock: without this the
  // animal is shepherded along ahead of a hull going the other way.
  if (offX * track.x + offY * track.y < 0) return heading;

  const starboard = rotCW90(track);
  const offTrack = offX * starboard.x + offY * starboard.y;
  // Floored at zero rather than returned on, because inside `notice` the range
  // term cannot be negative and the branch would be unreachable. The floor is
  // what keeps `step` below from going negative and inverting the clamp if the
  // urgency is ever changed to something that can.
  const urgency = Math.max(0, 1 - Math.abs(offTrack) / lane, 1 - distance / notice);

  // Which beam to clear towards: whichever it can be clear of the lane on
  // soonest, counting both the turn and the swim. Two one-line rules were tried
  // first, and the difference between them is the whole reason this is not one.
  //
  // *The beam it is already nearest* is the one that has to be ruled out. It
  // silently deletes the rule for the shark, which spawns on a crossing course
  // and so is already pointing very nearly abeam: the answer becomes "carry
  // on", and the worst pass goes back to 0.0 m with 8.0% of encounters inside
  // 5 m. The whale's worst falls to 12.0 m.
  //
  // *The side it lies on* is much closer, and the case against it is mostly
  // that it asks an animal already most of the way across to reverse. At a
  // whale's 0.2 rad/s that is fifteen seconds swinging its head back through
  // the oncoming hull, which is wrong to look at whatever it measures --
  // `swim()` learned the same about reversing off a shoal. It measures a little
  // worse too: the whale's worst pass is 23.1 m against 25.9, and the shark's
  // at six knots 19.4 m against 20.1.
  //
  // Time decides between them because time is the actual difference between the
  // two animals: the whale can finish its crossing before the boat arrives and
  // the shark cannot.
  let side = 1;
  let soonest = Infinity;
  for (const candidate of [1, -1]) {
    const beam = boatCourse + candidate * Math.PI * 0.5;
    const toTurn = Math.abs(wrapPi(beam - heading)) / rate;
    const toSwim = Math.max(0, lane - candidate * offTrack) / speed;
    if (toTurn + toSwim < soonest) {
      soonest = toTurn + toSwim;
      side = candidate;
    }
  }

  const away = compassAngle({ x: starboard.x * side, y: starboard.y * side });
  const step = rate * urgency * dt;
  return heading + clamp(wrapPi(away - heading), -step, step);
}
