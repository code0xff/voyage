import { COAST_ID, COAST_NAME } from './coast';

/**
 * A region: a bounded piece of coast, described well enough to build one.
 *
 * There were six of these once, surveyed from NOAA's CUDEM and fetched as
 * rasters -- twenty kilometres of San Francisco Bay, Newport, Puget Sound and
 * three more. They are gone, and `docs/real-map.md` keeps the design and the
 * reasoning: what a 25 m survey bought, what it did not, and why the answer
 * turned out to be one world rather than seven. What is left here is the
 * *description*, because the Earth's generated coast is one too -- it goes
 * through the identical `HeightField` and `RegionTerrain` path, and the type
 * is what that path reads.
 *
 * So this is deliberately smaller than it was. A field nothing reads is a
 * claim nothing checks: the survey's provenance, its licence, its UTM zone and
 * its prevailing breeze all described places that no longer ship, and a
 * generated coast had to answer them with `'Nowhere on Earth'` and a zero.
 */
export interface Region {
  id: string;
  name: string;
  grid: {
    /** Samples across and down. */
    width: number;
    height: number;
    /** Metres per sample. */
    cell: number;
    /**
     * Metres per stored unit. Heights are int16 so that a 20 km square fits in
     * a megabyte; a fifth of a metre keeps a quantum far finer than anything
     * the generator claims to know, and reaches the deep ocean floor.
     */
    unit: number;
  };
  /**
   * Where the samples came from, in one line.
   *
   * Not decoration: the chart caches its painted raster against this string,
   * so it carries the seed that drew the coast. Two seeds are two places and
   * must not share a cache entry.
   */
  source: string;
}

/**
 * Ids that used to mean somewhere else.
 *
 * A logbook outlives every list it was written against. `sf` was the San
 * Francisco sketch, `sf-bay` the surveyed region that replaced it, and both
 * are in people's records; so are the other five. None of those worlds can be
 * sailed now, and that is no reason for a passage to forget where it happened
 * -- a row that quietly became "Open ocean" would be the logbook losing the
 * one thing it is for.
 */
const RETIRED: Record<string, string> = {
  sf: 'San Francisco Bay',
  'sf-bay': 'San Francisco Bay',
  newport: 'Newport',
  'merchant-row': 'Merchant Row',
  'puget-sound': 'Puget Sound',
  chesapeake: 'Chesapeake Bay',
  'buzzards-bay': 'Buzzards Bay',
};

/**
 * What to call the place a passage was sailed in.
 *
 * The stored id and nothing else: `PassageRecord.venue` is a field older than
 * regions and older than the Earth, and it holds whatever the world was called
 * on the day it was written.
 */
export function placeName(id: string): string {
  // The generated coast is the one live answer. Imported from `coast.ts`
  // rather than restated; the cycle is type-only in the other direction, so
  // it is safe.
  if (id === COAST_ID) return COAST_NAME;
  return RETIRED[id] ?? 'Open ocean';
}
