import type { BoatConfig, Environment } from './config';
import { settleOnHeading } from './polar';

/**
 * How the crew has her ready when she puts to sea.
 *
 * The boat used to start every session the same way regardless of the
 * weather: full sail, the sheet pinned at a close-hauled 20 degrees, bolt
 * upright -- on a heading 100 degrees off the wind. The first seconds were a
 * re-enactment of a mistake nobody made: an over-sheeted beam reach rolling
 * her past her sailing heel until the auto-trim eased out and the auto-reef
 * caught up. The reef's measured ladder cannot act in under ten seconds --
 * it judges a 6-second average through a 6-second dwell, and both are right
 * (see sailplan.ts) and wrong to soften for the sake of an opening frame --
 * so what actually saved the worst starts, measured at 35 knots, was the
 * 45-degree knockdown emergency reefing her at 1.2 s. An opening that leans
 * on the knockdown handler is the measure of how wrong the start was.
 *
 * So the fix is not in the physics, which was being honest about a bad
 * start, but in the start: leave the way a crew actually leaves, trimmed and
 * reefed for the conditions. "For the conditions" is deliberately not
 * restated here as a wind-speed-to-reef table. The settle the polar already
 * trusts is the oracle -- the same pattern as the cruise judging its ports
 * of call by the `anchorage` the anchor itself uses -- because a table would
 * quietly drift the first time a reef threshold was tuned, and the settle
 * cannot.
 */
export interface Departure {
  reef: number;
  /** 0..1, how much of the jib is rolled away. */
  jibFurl: number;
  /** rad, the sheet trimmed for the departure heading. */
  sheet: number;
  /** rad, the twist to carry with it. */
  twist: number;
  /**
   * rad, the heel she sustains on this heading -- signed, so the boat starts
   * on the tack the wind actually puts her on.
   *
   * Seed `heelAvg` with this as well as `heel`. The auto-reef judges the
   * average, and an average that starts at zero spends its first seconds
   * describing a boat that is not there. Measured, today's thresholds get
   * away with it -- from a 26-degree start the average crosses the 15-degree
   * shake-out line at 5.0 s, one second before the first dwell can act -- so
   * the departure's reef happens not to bounce. One second is a coincidence
   * of the current tuning, not a property; seeding the average makes the
   * start honest instead of lucky.
   */
  heel: number;
}

/**
 * Settled for less time than the polar's 240 s, which chases the last few
 * hundredths of a knot of boat speed. The reef ladder and the trim converge
 * far sooner -- each reef step needs one 6 s dwell plus the average climbing
 * past the threshold -- and the choice is checked against the full-length
 * settle in departure.test.ts rather than trusted.
 */
const SETTLE_S = 90;

/** What to set before the lines are slipped, for this wind on this heading. */
export function prepareDeparture(
  cfg: BoatConfig,
  env: Environment,
  heading: number,
): Departure {
  const { s, rs } = settleOnHeading(cfg, env, heading, SETTLE_S);
  return { reef: rs.reef, jibFurl: rs.jibFurl, sheet: s.sheet, twist: s.twist, heel: s.heel };
}
