import type { Vec2 } from './math';
import { setDriftVec } from './current';
import type { Island } from './terrain';

/**
 * Venues: named places, laid out approximately.
 *
 * **Not for navigation.** Every number here is a sketch. The land is drawn from
 * overlapping circles because that is the shape primitive the physics and the
 * water shader share; depths come from one uniform shelf slope and not from a
 * survey; the stream is one direction that does not turn with the tide. A
 * venue is meant to reproduce *the decisions* a place asks of a sailor, not its
 * geography. Nothing here should be used to take a boat anywhere.
 *
 * What is being reproduced, and what is deliberately not:
 *
 *  - **Reproduced.** The prevailing breeze and roughly how hard it blows. Which
 *    way the stream sets and roughly how hard. Where the land is in relation to
 *    the course, so that the choice of which side to take is the choice the
 *    place is known for.
 *  - **Not.** Coastline shape beyond a recognisable arrangement. Real depths.
 *    Tidal cycle, springs and neaps, or the height of tide. Local effects that
 *    would need a model this simulator does not have -- the wind bending around
 *    a headland rather than simply being blocked by it, most of all.
 *
 * Figures are the broad, well-known character of each place rather than values
 * read off an atlas: a real tidal diamond or a real climatological mean would
 * be worth having, but inventing one and writing it down as though it were
 * measured would be worse than admitting the sketch.
 */

export interface Venue {
  id: string;
  name: string;
  /** Where it is, for the menu. Not used by the physics. */
  region: string;
  /** One line on what the place asks of you. */
  brief: string;

  /** The land, as circles that union into coasts. */
  islands: Island[];

  /** Prevailing wind: the direction it blows *from*, rad, and its mean speed. */
  windTwd: number;
  windKnots: number;
  /** How shifty and puffy it is here, 0..1, on the same scale as the setting. */
  gustiness: number;
  /** Wave height multiplier, on the same scale as the sea state setting. */
  seaScale: number;

  /**
   * The tidal stream in deep water: the direction the water *goes*, rad, and
   * how fast. Zero drift means a place where the tide is not a factor.
   */
  setDeg: number;
  driftKnots: number;
  /**
   * Depth at which the stream reaches full rate, m -- how wide the band of
   * useful slack water inshore is. The venue's main tactical dial.
   */
  fullDepth: number;

  /** Hour the session opens at, since the breeze at most of these is a clock. */
  startHour: number;
}

/**
 * No venues ship today, and the type is kept anyway.
 *
 * San Francisco was the only one, and it has been replaced by the surveyed
 * region of the same water -- two entries for one place, one of them a sketch
 * of the other, was a menu asking the player to choose between a chart and a
 * drawing of it.
 *
 * What is kept is the shape, because it is still the right answer for a coast
 * with no open survey behind it. docs/real-map.md is plain about this: CUDEM
 * covers US waters and nothing else, so a Korean or European place would be a
 * real coastline over an invented shelf, and admitting that in circles beats
 * inventing soundings and calling them depths.
 */
export const VENUES: readonly Venue[] = [];

export const venueById = (id: string): Venue | null => VENUES.find((v) => v.id === id) ?? null;

/**
 * The venue's deep-water stream as the velocity vector the physics wants.
 *
 * Goes through the same `setDriftVec` the settings do rather than repeating the
 * conversion. The engine reads the tide out of the settings -- a venue writes
 * its set and drift into them -- so a second copy here would be a conversion
 * only the tests exercised, free to drift away from the one the game runs on.
 */
export const venueCurrent = (v: Venue): Vec2 => setDriftVec(v.setDeg, v.driftKnots);
