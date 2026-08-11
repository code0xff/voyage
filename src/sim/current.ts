import { DEG, clamp, compassVec, scale, smoothstep, type Vec2 } from './math';
import { EMPTY_TERRAIN, type TerrainQuery } from './terrain';
import { knotsToMs } from './units';

/**
 * Tidal streams.
 *
 * The set and drift as a function of *where you are*, which is the whole
 * reason a real venue is worth naming. A tide that ran at the same rate
 * everywhere would be a headwind you cannot point at -- it would slow one leg
 * and speed the other and be over. What makes the Golden Gate or the Solent
 * worth sailing is that the stream is not the same across the course, so
 * where you put the boat is a decision and not just how you trim her.
 *
 * The model is one idea: **a stream runs where the water is deep and gives up
 * in the shallows.** That is the oldest piece of tidal tactics there is --
 * cheat the tide inshore -- and it falls out of bottom friction and of the
 * shallow margins simply sitting outside the main flux. It costs nothing to
 * compute, because `Terrain.depthAt` is already there for grounding.
 *
 * What it buys is a real trade rather than a free lunch. Inshore of the stream
 * there is less tide against you, and also less wind, because that is where the
 * land's shadow is; and less water, because that is where you go aground. Three
 * things pulling against each other is a tactical decision.
 *
 * The stream turns -- see `tideRate` -- but the *height* is deliberately not
 * modelled. A falling tide has to decide what happens to a boat anchored over
 * a bank, and what the chart's soundings are measured from, which is a rules
 * decision before it is code. See the deliberate simplifications in the README.
 */

/**
 * Below this rate a tide is not worth mentioning, m/s.
 *
 * Behind `running`, which is what the polar card's live marker turns itself off
 * on: the curve is a still-water polar, so with a tide under her the gap
 * between the marker and the curve stops meaning what it means.
 *
 * It used to say two readouts depended on this. The other was racing's layline
 * advice, which went with the rest of the race machinery.
 */
export const SLACK = 0.05;

/**
 * The semi-diurnal period, hours: two highs and two lows a day, which is what
 * most of the world's coasts get. A default rather than a claim about any
 * particular place -- the player can set it to whatever a place actually does.
 */
export const TIDE_PERIOD = 12.42;

/**
 * How much of the full stream is running at a given hour, -1..1, where negative
 * is the ebb running back the other way.
 *
 * A cosine rather than a square wave, because the thing a tide actually does to
 * a passage is the *slack*: the stream does not turn, it dies away, hangs, and
 * builds the other way. On the default period, half an hour either side of the
 * turn is a quarter of the stream and an hour either side is a half -- the
 * fractions scale with whatever period is set. A square wave would give a
 * player a stream to fight and never a window to wait for, which is the whole
 * of tidal tactics.
 *
 * Measured from the session's own start hour so that a passage begins on the
 * set the player asked for, at its full rate, and reverses about six hours
 * later. Taking it from midnight instead would mean setting three knots of
 * drift and getting whatever the clock happened to be doing.
 *
 * A function of the world hour and nothing else -- no clock of its own. Three
 * separate bugs in this project have been a clock that survived a restart, and
 * a tide that cannot hold state cannot join them.
 *
 * @param period the full cycle in hours; zero or less means a steady stream,
 *   which is what this was before there was a tide at all.
 */
export function tideRate(hour: number, startHour: number, period: number): number {
  // Guarded above zero rather than at it: a period small enough to overflow the
  // quotient hands `Math.cos` an Infinity and poisons the engine with a NaN,
  // and nothing under a minute is a tide anyway. The slider cannot produce one,
  // but a hand-edited setting can.
  if (!(period > 1 / 60)) return 1;
  return Math.cos((2 * Math.PI * (hour - startHour)) / period);
}

export interface CurrentFieldOptions {
  /**
   * Stream velocity where the water is deep, m/s, world frame. The direction
   * the water goes, as a tidal atlas quotes a set.
   */
  peak: Vec2;
  /**
   * Depth at which the stream reaches its full rate, m.
   *
   * The width of the margin the tide gives up, in effect: a big number pushes
   * the useful slack water a long way offshore, a small one keeps it to a
   * strip you have to be brave to use. It is the venue's main tactical dial.
   */
  fullDepth?: number;
}

export const DEFAULT_FULL_DEPTH = 14;

/**
 * Set and drift as the velocity vector the physics wants.
 *
 * The one place a compass set becomes a vector, because it is the one thing
 * about a tide that is easy to get backwards: the set is where the water is
 * going *to*, the opposite of the convention for wind direction, so it is
 * `compassVec(set)` and not its negation. A second copy of this -- one for the
 * settings and one for venues -- would let a test pass against one while the
 * game ran on the other.
 */
export const setDriftVec = (setDeg: number, driftKnots: number): Vec2 =>
  scale(compassVec(setDeg * DEG), knotsToMs(driftKnots));

export class CurrentField {
  /** Mutable, like WindField's mean wind: a setting can move it mid-session. */
  peak: Vec2;
  fullDepth: number;
  /** The land the stream runs past. Assigned by the engine as the world loads. */
  terrain: TerrainQuery = EMPTY_TERRAIN;

  constructor(opts: CurrentFieldOptions) {
    this.peak = opts.peak;
    this.fullDepth = Math.max(0.5, opts.fullDepth ?? DEFAULT_FULL_DEPTH);
  }

  /** The fastest the stream runs anywhere in this world, m/s. */
  get maxDrift(): number {
    return Math.hypot(this.peak.x, this.peak.y);
  }

  /** Whether there is enough tide in this world for any of it to matter. */
  get running(): boolean {
    return this.maxDrift > SLACK;
  }

  /**
   * The stream at a point.
   *
   * Scaled to zero at the shoreline, which does two jobs at once: it is where
   * the slack water is, and it is also why the model never has to think about
   * flow running into a beach. Water that has stopped cannot go anywhere it
   * should not.
   *
   * In open water there is no land, `depthAt` answers with the deep-water
   * constant, and the field is uniform -- so a player who simply sets a drift
   * and a set gets exactly the tide they asked for, everywhere.
   */
  sample(pos: Vec2): Vec2 {
    if (!this.running) return { x: 0, y: 0 };
    return scale(this.peak, this.rateAt(pos.x, pos.y));
  }

  /** The fraction of the full stream running here, 0..1. */
  rateAt(x: number, y: number): number {
    const depth = this.terrain.depthAt(x, y);
    return clamp(smoothstep(0, this.fullDepth, depth), 0, 1);
  }
}

/** Slack water. Shared so that "no tide" is one object and not many. */
export const NO_CURRENT = new CurrentField({ peak: { x: 0, y: 0 } });
