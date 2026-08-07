import { DEG, type Vec2 } from './math';
import { knotsToMs } from './units';
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
 * A run of overlapping circles making one continuous coast.
 *
 * Overlapping is the point: `elevationAt` takes the highest of every island, so
 * circles that overlap union into one shore with no seam. They share a `land`
 * so the shelter models treat them as the one piece of ground they are drawing.
 */
function coast(
  land: number,
  from: Vec2,
  to: Vec2,
  count: number,
  radius: number,
  height: number,
  seed: number,
): Island[] {
  const out: Island[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    out.push({
      pos: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
      radius,
      height,
      seed: seed + i * 17,
      land,
    });
  }
  return out;
}

/**
 * San Francisco, the city front.
 *
 * The one venue where the tide is the whole game. A summer afternoon westerly
 * comes in hard through the Gate, and the flood pushes in under it -- so the
 * beat out towards the Gate is dead into a foul stream, and the way to sail it
 * is to get out of the stream by working the shallow water along the city
 * shore. That costs wind and eventually the bottom, which is the trade.
 *
 * The set is the flood and not the ebb on purpose, and the first version had it
 * the other way round. An ebb runs out through the Gate, which is within about
 * twenty degrees of the direction a westerly makes you beat in -- so it carried
 * the boat towards the windward mark, and the whole inshore decision evaporated
 * because there was nothing to escape. Measured: 2.33 kn of *fair* stream on
 * the beat. Both states are real on any given afternoon; this is the one worth
 * building a course around.
 *
 * Laid out with the course off the city front, the shore to the south, Alcatraz
 * to the north, and Angel Island beyond it. The scale is compressed: the real
 * city front is some kilometres of shoreline and this is the part of it a
 * windward-leeward course fits into.
 */
const SF: Venue = {
  id: 'sf',
  name: 'San Francisco — city front',
  region: 'California, USA',
  brief: 'Hard summer westerly over a foul flood. Work inshore out of the tide, or pay for it.',
  islands: [
    // The city shore, running roughly east-west to the south of the course.
    ...coast(1, { x: -2300, y: -1300 }, { x: 2300, y: -1250 }, 7, 800, 70, 4100),
    // A headland at the west end, standing up into the course: this is what
    // puts land upwind of the beat and so gives the inshore lane a wind cost.
    ...coast(1, { x: -2500, y: -900 }, { x: -2150, y: -650 }, 2, 520, 90, 4300),
    // Alcatraz: small, steep, and right where it is in the way.
    { pos: { x: 250, y: 1150 }, radius: 170, height: 35, seed: 4500 },
    // Angel Island, further out and mostly scenery at this range.
    { pos: { x: 1500, y: 2450 }, radius: 700, height: 85, seed: 4600 },
  ],
  // Afternoon sea breeze through the Gate: hard, from a little south of west.
  windTwd: 262 * DEG,
  windKnots: 20,
  gustiness: 0.5,
  seaScale: 1.1,
  // The flood pushes in through the Gate and up the bay: east, and so straight
  // into the teeth of a beat that has to go west into the breeze.
  setDeg: 98,
  driftKnots: 2.5,
  // A wide band, because the inshore lane has to be worth the distance to reach
  // it. This is the number to move if the venue plays too easy or too mean.
  fullDepth: 30,
  startHour: 14,
};

export const VENUES: readonly Venue[] = [SF];

export const venueById = (id: string): Venue | null => VENUES.find((v) => v.id === id) ?? null;

/** The venue's deep-water stream as the velocity vector the physics wants. */
export const venueCurrent = (v: Venue): Vec2 => ({
  x: Math.sin(v.setDeg * DEG) * knotsToMs(v.driftKnots),
  y: Math.cos(v.setDeg * DEG) * knotsToMs(v.driftKnots),
});
