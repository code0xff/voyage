import { anchorage } from './anchorage';
import type { BoatConfig } from './config';
import { TAU, compassVec, wrapPi, type Vec2 } from './math';
import { rng } from './rng';
import type { TerrainQuery } from './terrain';

/**
 * Ports of call: a handful of places worth sailing to, offered at once.
 *
 * The cruising mode's whole idea is choice -- not one goal but several, spread
 * around the boat so that picking one is a decision about the wind: beat up to
 * the cove north of you, or run down to the islets south. This file only finds
 * the places; whether one is chosen, and what completing it means, belongs to
 * the engine and the interface.
 *
 * Every offered point can actually be completed, and that is the load-bearing
 * promise. A passage ends when the anchor goes down within 150 m of the
 * destination, and the anchor has its own demands -- good holding, 3 to 12 m
 * of water. The first destination this game's owner ever set was in 42 m of
 * open water, where the passage could never be completed at all, and nothing
 * said so. An *offered* goal must never do that, so every candidate is judged
 * by `anchorage()` itself -- the same function that will judge the anchor when
 * it is let go -- and not by a restatement of its rules here.
 */

/** How many places one offer holds, at most. Fewer where the coast is poor. */
export const CALL_COUNT = 4;

/** m, how far from the boat an offer may reach. */
export const CALL_RANGE_MIN = 900;
export const CALL_RANGE_MAX = 4200;

/**
 * m, the closest two offered places may stand to each other. Closer than this
 * and they are one decision written down twice.
 */
const SEPARATION = 700;

/**
 * How the boat would meet the wind sailing straight at a place: the coarse
 * three-way split a sailor actually reasons in.
 */
type Leg = 0 | 1 | 2;
const legOf = (twd: number, bearing: number): Leg => {
  const twa = Math.abs(wrapPi(twd - bearing));
  return twa < Math.PI / 3 ? 0 : twa < (2 * Math.PI) / 3 ? 1 : 2;
};

/**
 * The places on offer, deterministically, from the boat's own spot.
 *
 * @param salt distinguishes successive offers in one world: the engine folds a
 *   counter in so that completing a call deals a fresh hand, while the same
 *   hand re-dealt -- a reload of a pinned world at the same point -- is the
 *   same hand.
 *
 * The search is rejection sampling, judged by `anchorage()`: random bearings
 * and ranges, kept only where the anchor could really be let go. The picks are
 * then dealt round-robin across the three points of sail, so an offer holds a
 * beat, a reach and a run whenever the *samples* find all three -- the choice
 * the mode exists to pose. Sampling is not a survey: a sliver of anchorable
 * water the attempts never land in stays out of the hand, so an offer says
 * what was found, never that nothing else exists. Within each leg the nearest
 * candidates are preferred -- short errands over long hauls, by design -- and
 * never two places within a few hundred metres of each other.
 *
 * The terrain handed in must be the *whole* world within `CALL_RANGE_MAX`,
 * not the boat's felt window. On the windowed procedural ocean the engine
 * hands the chart window for exactly this reason: judged against the felt
 * window, a candidate on the unloaded flank of an island reads as open water
 * and the mode offers a port that turns out to be dry land.
 *
 * The empty answer is real and callers must expect it: the open procedural
 * ocean with no islands has no anchorable water anywhere, and a boat far from
 * any coast may be out of range of all of it.
 */
export function offerCalls(
  terrain: TerrainQuery,
  cfg: BoatConfig,
  boat: Vec2,
  twd: number,
  seed: number,
  salt: number,
): Vec2[] {
  const rand = rng((seed ^ 0xca11) + salt * 7919);
  const byLeg: [Vec2[], Vec2[], Vec2[]] = [[], [], []];

  for (let attempt = 0; attempt < 900; attempt++) {
    const bearing = rand() * TAU;
    const range = CALL_RANGE_MIN + rand() * (CALL_RANGE_MAX - CALL_RANGE_MIN);
    const dir = compassVec(bearing);
    const pos = { x: boat.x + dir.x * range, y: boat.y + dir.y * range };

    // The judge is the real one, asked as if the boat were already there and
    // stopped. Speed is the player's part of the bargain; the place's part is
    // depth and holding, and that is what is being vetted.
    if (!anchorage(terrain, cfg, pos, 0, twd).canAnchor) continue;
    byLeg[legOf(twd, bearing)].push(pos);
  }

  // Round-robin across the points of sail, nearest candidates preferred within
  // each: an offer should pose "which wind do I take", not "which of four
  // identical reaches".
  for (const leg of byLeg) {
    leg.sort(
      (a, b) =>
        (a.x - boat.x) ** 2 + (a.y - boat.y) ** 2 - ((b.x - boat.x) ** 2 + (b.y - boat.y) ** 2),
    );
  }
  const picked: Vec2[] = [];
  const clear = (p: Vec2) =>
    picked.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= SEPARATION);
  for (let round = 0; picked.length < CALL_COUNT; round++) {
    let dealt = false;
    for (const leg of byLeg) {
      const next = leg.find(clear);
      if (!next || picked.length >= CALL_COUNT) continue;
      picked.push(next);
      dealt = true;
    }
    if (!dealt) break;
  }
  return picked;
}
