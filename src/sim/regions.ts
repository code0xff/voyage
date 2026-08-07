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
};

export const REGIONS: readonly Region[] = [SF_BAY];

export const regionById = (id: string): Region | null =>
  REGIONS.find((r) => r.id === id) ?? null;

/** How many bytes the region's raster must be, for whoever loads it to check. */
export const rasterBytes = (r: Region): number => r.grid.width * r.grid.height * 2;
