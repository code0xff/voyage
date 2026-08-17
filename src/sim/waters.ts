import type { LatLon } from './globe';

/**
 * Places to take your departure from.
 *
 * The planet is sailable everywhere, which is exactly why this list has to
 * exist: an ocean you may enter at any point is an ocean with no doors, and
 * a player who wants to sail the Cape has no way to ask for it short of
 * spending a fortnight getting there. These are the doors.
 *
 * Chosen for what they are to sail rather than for what they are to look at
 * -- a strait, a cape, a trade-wind island chain, a subpolar coast -- and
 * spread across the belts on purpose, because the belts are what make one
 * sea different from another. Between them they cover every ocean and every
 * inhabited continent, which is the shape a list like this should have.
 *
 * **Every position is verified against the shipped raster, not remembered.**
 * Each was tuned to lie about four kilometres off its coast, which is the
 * distance the generated coast has always put its own spawn at: far enough
 * that the shoreline's kilometre and a half of invention cannot beach her,
 * near enough that the land is *in* the window she sails in rather than at
 * the corner of it. Twelve was the first answer and it was wrong -- the
 * window is twenty kilometres square, so land twelve off is a smudge in one
 * corner or outside it altogether, and every departure opened on an empty
 * sea with no way to tell one from another. `waters.test.ts` re-checks all of them
 * against `globe-4m.bin` itself, so a hand-edited coordinate fails a test
 * rather than opening a session inside Spain. Three of the first draft's
 * candidates -- Iceland, the Falklands and Golfo Nuevo -- were dry land at
 * the coordinates they were written from memory at.
 *
 * The names live in `ui/strings.ts` with the rest of the words. This file
 * owns geography and nothing else, which is what lets it be checked.
 */

export interface Water {
  /** Stable id; the UI keys its name and its one-line description off this. */
  id: string;
  /** Where she starts, in the open water off the place. */
  place: LatLon;
}

export const WATERS: readonly Water[] = [
  // Where the game opens, listed so there is a way back to it.
  { id: 'golden-gate', place: { lat: 37.78, lon: -122.57 } },
  // The Gulf of Cádiz, inside Trafalgar and a day from Gibraltar.
  { id: 'cadiz', place: { lat: 36.52, lon: -6.3 } },
  // Off Cape Point, where the two oceans are said to meet.
  { id: 'good-hope', place: { lat: -34.3, lon: 18.42 } },
  // Between Busan and Tsushima.
  { id: 'korea-strait', place: { lat: 34.48, lon: 129.22 } },
  // Outside Sydney Heads.
  { id: 'sydney', place: { lat: -33.84, lon: 151.34 } },
  // Off the Horn itself, in the westerlies with nothing in their way.
  { id: 'cape-horn', place: { lat: -55.9, lon: -67.2 } },
  // The Leewards: the trade wind that carried the sailing ships west.
  { id: 'antigua', place: { lat: 17.08, lon: -61.66 } },
  // Mid-Pacific, two thousand miles from anywhere.
  { id: 'oahu', place: { lat: 21.32, lon: -157.9 } },
  // Reykjanes, at the top of the North Atlantic.
  { id: 'reykjanes', place: { lat: 64.12, lon: -22.32 } },
  // The Zanzibar channel, in the south-east trades of the Indian Ocean.
  { id: 'zanzibar', place: { lat: -6.2, lon: 39.58 } },
  // The Galápagos, on the equator: the doldrums, where the wind goes out.
  { id: 'galapagos', place: { lat: -0.75, lon: -90.3 } },
];

export const waterById = (id: string): Water | null =>
  WATERS.find((w) => w.id === id) ?? null;

/**
 * m. Which departure a position counts as being at.
 *
 * Generous, because a session opens ninety metres from its pin and then
 * sails: the menu should still say "Cádiz" after a mile of it, and stop
 * saying so once she is somewhere else. Two kilometres is under a quarter of
 * the window she can see out of.
 */
export const AT_WATER = 2000;

/**
 * m. How near counts as being able to *name* a position by a departure.
 *
 * Wider than `AT_WATER` by a lot, and for a different job: this one is the
 * menu saying where she would carry on from, and "off Cádiz" should still be
 * the answer after a day's sailing along that coast. Beyond it she is at sea
 * and the honest label is her latitude and longitude.
 */
export const NEAR_WATER = 100_000;

/**
 * The departure a position is at, or null out at sea.
 *
 * Compared in degrees rather than through a great circle: the list is
 * nowhere near a pole, the distances are kilometres, and a cosine here would
 * be a second copy of `globe.ts` for no gain in an answer that is a
 * threshold anyway.
 */
export function waterAt(place: LatLon, within = AT_WATER): Water | null {
  const perDeg = 111_195;
  let best: Water | null = null;
  let closest = within;
  for (const w of WATERS) {
    const dLat = (w.place.lat - place.lat) * perDeg;
    const dLon = (w.place.lon - place.lon) * perDeg * Math.cos((place.lat * Math.PI) / 180);
    // The *nearest* rather than the first that qualifies. At the spawn radius
    // it makes no difference -- no two departures are within fifty kilometres
    // of each other -- but the menu names her position at a hundred, and at
    // that width two can qualify at once. First-past-the-post would then name
    // her by whichever happens to sit earlier in the list.
    const away = Math.hypot(dLat, dLon);
    if (away <= closest) {
      closest = away;
      best = w;
    }
  }
  return best;
}
