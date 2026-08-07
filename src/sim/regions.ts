import { DEG } from './math';

/**
 * Regions: bounded pieces of a real coast, sailed freely.
 *
 * A region is the successor to a venue. A venue reproduces the *decisions* a
 * place asks of a sailor with land drawn from overlapping circles; a region is
 * the place, surveyed -- its coastline is where the coastline is, and its
 * depths are soundings rather than one uniform shelf slope.
 *
 * What is here is only the description of the grid and where in the world it
 * sits. The heights themselves are a binary raster fetched at load time and
 * handed to `HeightField`, because `src/sim` may not touch the network or the
 * filesystem (AGENTS.md section 3) and because a megabyte of terrain has no
 * business in a JavaScript bundle. `scripts/fetch-terrain.ts` bakes it.
 *
 * The metadata lives here as typed source rather than in a sidecar JSON so that
 * there is one fetch and not two, and so that a region whose grid does not
 * match its raster fails to compile rather than at sea.
 */

export interface Region {
  id: string;
  name: string;
  /** Where it is, for the menu. */
  area: string;
  /** One line on what the place asks of you. */
  brief: string;

  /** Centre of the grid, in the real world. */
  centre: { lat: number; lon: number };
  /** UTM zone the grid is projected in. World x is easting, y is northing. */
  utmZone: number;

  grid: {
    /** Samples across and down. */
    width: number;
    height: number;
    /** Metres per sample. */
    cell: number;
    /**
     * Metres per stored unit. Heights are int16 so that a 10 km square fits in
     * a megabyte; decimetres keep a quantum far finer than the survey.
     */
    unit: number;
  };

  /** Where the raster is served from, relative to the site root. */
  raster: string;

  /** Who surveyed it, so the claim on screen can be checked. */
  source: string;
  /** What that licence obliges, in the words that matter. */
  licence: string;

  /**
   * The conditions the place is known for.
   *
   * These are a *sketch*, and the region's land and depths are not, which is
   * the one place in this project where the labelling could mislead if it were
   * not said plainly. A surveyed coast sitting under an invented breeze invites
   * the reader to assume the breeze was surveyed too.
   *
   * So: the coastline and the soundings are `source`. Everything below is the
   * broad, well-known character of the place -- which way the wind usually
   * blows and roughly how hard, which way the stream sets -- and not a
   * climatological mean or a tidal diamond. A real one would be worth having;
   * inventing one and writing it down as though it were measured would be worse
   * than admitting the sketch.
   *
   * They live here rather than in a separate record because a place is one
   * choice. Two controls for "where am I sailing" invited picking a surveyed
   * coast and someone else's weather at the same time.
   */
  conditions: {
    /** Prevailing wind: the direction it blows *from*, rad, and its mean speed. */
    windTwd: number;
    windKnots: number;
    /** How shifty and puffy it is, 0..1, on the same scale as the setting. */
    gustiness: number;
    /** Wave height multiplier, on the same scale as the sea state setting. */
    seaScale: number;
    /** The deep-water stream: the direction the water *goes*, deg, and its rate. */
    setDeg: number;
    driftKnots: number;
    /**
     * Depth at which the stream reaches full rate, m -- how wide the band of
     * useful slack water inshore is. The place's main tactical dial.
     */
    fullDepth: number;
    /** Hour the session opens at, since the breeze at most of these is a clock. */
    startHour: number;
  };
}

/**
 * San Francisco Bay, from the Gate to the Berkeley flats.
 *
 * The same water the `sf` venue sketched in circles, done properly. A 10 km
 * radius from a point between Alcatraz and the city front reaches the Golden
 * Gate to the west, Angel Island and Raccoon Strait to the north, the Bay
 * Bridge to the south-east and the Berkeley shallows to the east -- which is to
 * say it contains the whole of the sailing that San Francisco is known for.
 *
 * Twenty kilometres across is a passage rather than a pond: crossed at 6 knots
 * it is about 1.8 hours of sailing, or two minutes at the default time scale.
 */
const SF_BAY: Region = {
  id: 'sf-bay',
  name: 'San Francisco Bay',
  area: 'California, USA',
  brief:
    'The Gate, Alcatraz, Raccoon Strait and the Berkeley flats. A surveyed coast ' +
    'and surveyed depths — the shoal you can see is the one you will touch.',
  // Between Alcatraz and the city front, so the Gate and Angel Island are both
  // comfortably inside the square rather than clipped by its western edge.
  centre: { lat: 37.825, lon: -122.43 },
  utmZone: 10,
  grid: { width: 800, height: 800, cell: 25, unit: 0.1 },
  raster: '/terrain/sf-bay.bin',
  source:
    'NOAA NCEI continuously updated digital elevation model (CUDEM), 1/9 arc-second ' +
    'topobathymetry, resampled to 25 m',
  // A US federal work: no copyright, and so no attribution obligation. Named
  // anyway, because a depth is only worth anything if you can find out who
  // sounded it.
  licence: 'US Government work, public domain',

  /*
   * Inherited from the `sf` venue this replaces, where they were reasoned about
   * at length and are worth keeping.
   *
   * The tide is the whole game here. A summer afternoon westerly comes in hard
   * through the Gate and the flood pushes in under it, so the beat out towards
   * the Gate is into a foul stream and the way to sail it is to work the
   * shallow water along the city shore -- which costs wind, and eventually the
   * bottom. Now that the bottom is surveyed, that trade is a real one.
   *
   * The set is the flood and not the ebb on purpose. An ebb runs out through
   * the Gate within about twenty degrees of the direction a westerly makes you
   * beat in, so it carries the boat towards the windward mark and the whole
   * inshore decision evaporates. Both are real on any given afternoon; this is
   * the one worth sailing.
   */
  conditions: {
    windTwd: 262 * DEG,
    windKnots: 20,
    gustiness: 0.5,
    seaScale: 1.1,
    setDeg: 98,
    driftKnots: 2.5,
    fullDepth: 30,
    startHour: 14,
  },
};

/**
 * Newport, from Prudence Island down to the open sound.
 *
 * The second region, chosen because it asks a different question. San Francisco
 * is a bay: the decision is the tide and where the bottom is. Newport is a
 * coast, and the decision is the sea breeze and when to leave the shelter of
 * the land for the swell outside. Two squares of the same kind of water would
 * have been one region twice.
 *
 * The square holds the East Passage whole -- from the south end of Prudence,
 * under the Pell Bridge, past Newport and Jamestown, out between Beavertail and
 * Castle Hill -- with the West Passage behind Conanicut Island and about four
 * kilometres of Rhode Island Sound south of Brenton. Centred any further south
 * and half of it is featureless ocean; any further north and the way out to sea
 * falls off the bottom edge.
 *
 * It is also the first region whose edge opens onto real ocean rather than more
 * bay, which is the case `RegionTerrain`'s fade into deep water was written for
 * and has never actually met.
 *
 * The cost, stated because it is larger here than at San Francisco: this is
 * 2.34 degrees west of UTM zone 19's central meridian, so grid north is about
 * 1.55 degrees east of true north, where at San Francisco it is 0.35. Every
 * bearing the game shows is a grid bearing. That is still far inside the error
 * on the conditions below, which are a sketch, and buys the same undistorted
 * plane -- but it is no longer small enough to leave unsaid.
 */
const NEWPORT: Region = {
  id: 'newport',
  name: 'Newport',
  area: 'Rhode Island, USA',
  brief:
    'The East Passage from Prudence to the sea, Conanicut and Aquidneck either side, ' +
    'and the open sound beyond Brenton. A sea breeze rather than a tide.',
  // Mid-channel in the East Passage abreast of Rose Island, so the passage runs
  // down the middle of the square with both islands inside it.
  //
  // Mid-channel and not merely thereabouts: a region's centre is the world
  // origin, and `placeAtStart` puts the boat 90 m from it. Centred 800 m east of
  // here -- which framed the square just as well -- she went to sea on a two
  // metre shoal drawing 1.8, and the first thing the player would have done is
  // run aground. It is 39 m here, and the shallowest water within 150 m in any
  // direction is 37.
  centre: { lat: 41.5, lon: -71.35 },
  utmZone: 19,
  grid: { width: 800, height: 800, cell: 25, unit: 0.1 },
  raster: '/terrain/newport.bin',
  source:
    'NOAA NCEI continuously updated digital elevation model (CUDEM), 1/9 arc-second ' +
    'topobathymetry, resampled to 25 m',
  licence: 'US Government work, public domain',

  /*
   * A summer afternoon, which at Newport means the southerly.
   *
   * The sea breeze here comes off open water rather than over a gap in a ridge,
   * so it is softer and far steadier than San Francisco's westerly -- hence
   * half the gustiness at two thirds the strength. What it brings instead is
   * swell: the square is open to the south, and the sea state outside Brenton
   * is not the sea state in the passage. That contrast is the point of the
   * place, and `seaScale` is set above one to make leaving the land cost
   * something.
   *
   * The stream is the flood, setting north up the passage, for the same reason
   * San Francisco's is: it is the one that makes the sailing interesting. Beat
   * south towards the sound in a southerly and a flood is foul, so the way out
   * is to work the shore -- which here costs breeze rather than depth, since
   * the passage is deep almost to the rocks. An ebb would simply carry you out
   * and there would be nothing to decide. Both are real on any given afternoon.
   *
   * A little over a knot, and not San Francisco's two and a half: Narragansett
   * Bay is a far smaller tidal prism than the Golden Gate drains, and pretending
   * otherwise would make the tide the game here too.
   */
  conditions: {
    windTwd: 195 * DEG,
    windKnots: 14,
    gustiness: 0.25,
    seaScale: 1.3,
    setDeg: 10,
    driftKnots: 1.2,
    fullDepth: 20,
    startHour: 13,
  },
};

export const REGIONS: readonly Region[] = [SF_BAY, NEWPORT];

export const regionById = (id: string): Region | null =>
  REGIONS.find((r) => r.id === id) ?? null;

/**
 * Ids that used to mean somewhere else.
 *
 * `sf` was the San Francisco venue, and passages logged there carry it. The
 * venue is gone and the surveyed region is the same water, so the id resolves
 * forward rather than falling through to "Open ocean" -- a logbook that forgot
 * where you had been would be a worse answer than a slightly generous one.
 */
const RENAMED: Record<string, string> = { sf: 'sf-bay' };

export const regionByStoredId = (id: string): Region | null =>
  regionById(RENAMED[id] ?? id);

/** How many bytes the region's raster must be, for whoever loads it to check. */
export const rasterBytes = (r: Region): number => r.grid.width * r.grid.height * 2;

/**
 * What to call the place a passage was sailed in.
 *
 * Regions first, then venues, then the open ocean. Both are consulted because
 * `PassageRecord.venue` is a stored id and the logbook outlives the list it
 * was written against: San Francisco was a venue when the earliest passages
 * were logged and is a region now, and a row that quietly became "Open ocean"
 * would be the logbook forgetting where someone went.
 */
export function placeName(id: string, venueName: (id: string) => string | null): string {
  return regionByStoredId(id)?.name ?? venueName(id) ?? 'Open ocean';
}
