import { clamp, scale, smoothstep, type Vec2 } from './math';
import { EMPTY_TERRAIN, type Terrain } from './terrain';

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
 * Deliberately not modelled: the *cycle*. The stream sets one way for the whole
 * session rather than turning with the tide. Reversing it is a phase term and
 * almost free, but the height of tide is not -- a falling tide has to decide
 * what happens to a boat anchored over a bank -- and the two belong together.
 * See the deliberate simplifications in the README.
 */

/**
 * Below this rate a tide is not worth mentioning, m/s.
 *
 * Shared, because two readouts turn themselves off when a tide is running --
 * the layline advice and the polar's live marker, both built on a still-water
 * polar -- and they have to agree about when that starts.
 */
export const SLACK = 0.05;

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

const DEFAULT_FULL_DEPTH = 14;

export class CurrentField {
  /** Mutable, like WindField's mean wind: a setting can move it mid-session. */
  peak: Vec2;
  fullDepth: number;
  /** The land the stream runs past. Assigned by the engine as the world loads. */
  terrain: Terrain = EMPTY_TERRAIN;

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
