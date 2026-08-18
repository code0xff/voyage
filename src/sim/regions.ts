import { DEG } from './math';
import { COAST_ID, COAST_NAME } from './coast';

/**
 * Regions: bounded pieces of a real coast, sailed freely.
 *
 * A region is the successor to the sketched venues. A sketch reproduces the
 * *decisions* a place asks of a sailor with land drawn from overlapping
 * circles; a region is the place, surveyed -- its coastline is where the coastline is, and its
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

  /**
   * Where the raster lives, relative to the site root.
   *
   * Relative to the root and not to the deploy base, because `src/sim` is
   * headless and must not read `import.meta.env` any more than it may fetch --
   * and the two callers want different prefixes anyway: `terrain-load.ts` puts
   * the base in front of it, the tests and the polar read `public${raster}` off
   * disk. Whoever fetches this owns the prefix.
   */
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
    'and the open sound beyond Brenton. A sea breeze first, and a stream that ' +
    'turns under it.',
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

/**
 * Merchant Row: the islands between Stonington and Isle au Haut.
 *
 * The third region, and the third question -- but not the question first
 * proposed for it, which the measurements refused.
 *
 * The plan was Penobscot Bay proper, some eighteen kilometres west of here, on
 * the argument that the Camden Hills stand 398 m straight off the water and a
 * hill that size makes a lee you park in rather than sail through. That square
 * was baked and its shelter field measured against the other two regions. It
 * came last: a mean wind deficit over water of 0.038, against Newport's 0.041
 * and San Francisco's 0.173. Swept across every wind direction the place
 * plausibly gets, it never beat 0.098. The hills are real; the water is too open
 * to sit behind them, and 21% land is the least of any region here. **San
 * Francisco is the region the shelter model matters most in, and no Maine
 * square was going to take that from it.**
 *
 * This square is the one that measured as genuinely different. Of the water the
 * boat can actually sail, **16% of it is within 200 m of a shore, against 8-9%
 * everywhere else** -- the archipelago is not scenery here, it is the thing in
 * the way. San Francisco asks where the tide is and Newport asks where the
 * breeze is; this asks which side of the island to take, and answers in metres.
 *
 * What is in the square: the deep channel of East Penobscot Bay down the west
 * side, reaching 107 m; Deer Isle across the north with Stonington at its foot;
 * Merchant Row itself, the scatter of islands south of the town; and the north
 * of Isle au Haut, whose Champlain Mountain at 164 m is the highest ground
 * here. The south of Isle au Haut falls off the bottom edge, which is the one
 * thing worth wanting that would not fit.
 *
 * On the projection, since Newport had to apologise for it: this sits 0.28
 * degrees from the central meridian of zone 19, so grid north is within 0.2
 * degrees of true north -- the cleanest of the three, by luck rather than
 * choosing.
 */
const MERCHANT_ROW: Region = {
  id: 'merchant-row',
  name: 'Merchant Row',
  area: 'Maine, USA',
  brief:
    'Stonington, the islands south of it, and the north of Isle au Haut. ' +
    'Twice as much of the sailable water is close aboard a shore as anywhere else here.',
  // In the channel south-west of Stonington. Mid-channel and not merely
  // thereabouts -- see NEWPORT, where this was learned the hard way: the centre
  // is the world origin and the boat is put on station 90 m from it.
  centre: { lat: 44.13, lon: -68.72 },
  utmZone: 19,
  grid: { width: 800, height: 800, cell: 25, unit: 0.1 },
  raster: '/terrain/merchant-row.bin',
  source:
    'NOAA NCEI continuously updated digital elevation model (CUDEM), 1/9 arc-second ' +
    'topobathymetry, resampled to 25 m',
  licence: 'US Government work, public domain',

  /*
   * A summer afternoon in Maine, which means the sou'wester.
   *
   * The softest breeze of the three and the shiftiest for its strength, which
   * is what a gradient wind arriving over a hundred islands actually does. The
   * gustiness here stands for that rather than for squalls.
   *
   * The sea is the smallest of the three by some way: there is no fetch worth
   * the name in any direction that is not blocked within a few kilometres.
   *
   * The tide, unlike at Penobscot Bay proper, is worth having. The range here
   * is around three metres and it has to get in and out through the channels,
   * so `fullDepth` is set deep enough that the stream runs where the water is
   * and goes slack over the flats -- which is the same trade San Francisco
   * makes, arrived at from the opposite direction. There it is deep water that
   * is foul and the shallows that are safe from it; here the deep water is also
   * the only water, so the stream and the pilotage pull the same way rather
   * than against each other.
   */
  conditions: {
    windTwd: 210 * DEG,
    windKnots: 11,
    gustiness: 0.4,
    seaScale: 0.5,
    setDeg: 20,
    driftKnots: 1.1,
    fullDepth: 30,
    startHour: 13,
  },
};

/**
 * Shared by every region baked in the second survey.
 *
 * Nine US coasts were reconnoitred, six had CUDEM under the whole square, and
 * three earned a place. What the other three failed on is recorded at the foot
 * of this file, because a region rejected for a measured reason is worth as
 * much to the next person as one accepted.
 */
const SURVEY = {
  source:
    'NOAA NCEI continuously updated digital elevation model (CUDEM), 1/9 arc-second ' +
    'topobathymetry, resampled to 25 m',
  licence: 'US Government work, public domain',
  grid: { width: 800, height: 800, cell: 25, unit: 0.1 },
} as const;

/**
 * Puget Sound: Elliott Bay, Bainbridge, and the main basin between them.
 *
 * The region with no bottom. Median depth over its water is **85 m**, where the
 * next deepest region manages 20 and San Francisco 11; the main basin runs past
 * 280 m within sight of the city. Nothing else here is remotely like it, and it
 * matters to how the place sails: depth never decides anything, the anchor is
 * useless over most of the square, and a mistake costs distance rather than the
 * keel. Every other region in this list is partly a conversation with the
 * bottom. This one is not.
 *
 * What it has instead is land that stands steep -- the Bainbridge bluffs to the
 * west, Magnolia and Queen Anne to the east at 128 m -- and a long way apart.
 * The basin is 7 km across at this latitude and 12 at the south of the square,
 * which is wider than it feels on a chart. 45% of the square is land and almost
 * all of it is round the edges. That geometry gives the second highest wind
 * deficit of any region, 0.100 against San Francisco's 0.173, and it arrives as
 * shifts off the bluffs rather than as one large lee you can plan around.
 *
 * Worth knowing before sailing it: **this is the region where you mostly cannot
 * see the land you are feeling.** `weather.ts` caps visibility at 2600 m in any
 * conditions and the scene fog starts closing at a third of that, so the west
 * shore at 1.7 km comes up as a smudge and the east shore at 5 km not at all.
 * That cap was set for the procedural ocean, where nothing is ever far away and
 * drawing to the horizon would be unaffordable; a 20 km square with its shores
 * 5 km apart is the first thing in this project it actually binds. The wind
 * shadow is computed from the terrain and not from what is drawn, so the shifts
 * are there either way -- but it does mean the place looks emptier than it is.
 */
const PUGET: Region = {
  id: 'puget-sound',
  name: 'Puget Sound',
  area: 'Washington, USA',
  brief:
    'Elliott Bay, Bainbridge and the main basin. Deep enough that the bottom never ' +
    'enters into it — the decision is the breeze under the bluffs.',
  // Deep, and with a shore 1.3 km off. Both halves matter: `weather.ts` caps
  // visibility at 2600 m in any conditions, and centred a kilometre further out
  // in the basin the nearest land was 1.7 km away on one side and 4.9 km on the
  // other -- so the region with the most dramatic shoreline in the list opened
  // on an empty horizon that looked like the procedural ocean.
  centre: { lat: 47.6375, lon: -122.4753 },
  utmZone: 10,
  ...SURVEY,
  raster: '/terrain/puget-sound.bin',
  conditions: {
    windTwd: 350 * DEG,
    windKnots: 10,
    gustiness: 0.45,
    seaScale: 0.6,
    setDeg: 180,
    driftKnots: 1.5,
    fullDepth: 60,
    startHour: 15,
  },
};

/**
 * Chesapeake Bay off Annapolis: the Severn, the Bay Bridge and the flats.
 *
 * Puget Sound's exact opposite, and shipped for that reason. Median depth 6 m
 * against Puget's 85, and **18% of the square is water too shoal for this boat
 * to sail** -- the most of any region, San Francisco's 13% included. The bottom
 * is never far, everywhere, all the time.
 *
 * It also carries the lightest breeze in the list at 9 knots, and the weakest
 * stream. That combination is the point: with little tide to play and no lee
 * worth having -- a wind deficit of 0.025, second lowest -- what is left is
 * finding pressure in light air over water that will ground you if you stop
 * looking.
 * The other regions all hand you something to fight; this one hands you very
 * little and asks what you do with it.
 */
const CHESAPEAKE: Region = {
  id: 'chesapeake',
  name: 'Chesapeake Bay',
  area: 'Maryland, USA',
  brief:
    'Annapolis, the Severn and the Bay Bridge. The shallowest and the lightest — ' +
    'more of it is too shoal to sail than anywhere else here.',
  centre: { lat: 38.9484, lon: -76.3923 },
  utmZone: 18,
  ...SURVEY,
  raster: '/terrain/chesapeake.bin',
  conditions: {
    windTwd: 190 * DEG,
    windKnots: 9,
    gustiness: 0.35,
    seaScale: 0.5,
    setDeg: 340,
    driftKnots: 0.6,
    fullDepth: 12,
    startHour: 14,
  },
};

/**
 * Buzzards Bay, with Woods Hole, Falmouth and the Elizabeth Islands.
 *
 * San Francisco's wind and tide with nothing in the way. It has the second
 * hardest breeze here at 18 knots and, after San Francisco, the hardest stream
 * at 2 knots -- but only 19% land, the most sailable water of any region at
 * 78%, and a wind deficit of 0.015, the lowest of the six. San Francisco puts
 * an island, a shoal and a city front between you and the mark; here there is
 * open water and a lot of weather in it.
 *
 * The famous Buzzards Bay south-wester really does fill to 18 knots on a summer
 * afternoon with the reliability of a timetable, which is why the gustiness is
 * the lowest of any region: it is a strong wind that is not a squally one.
 *
 * One thing not modelled, said plainly because the place is known for it: Woods
 * Hole runs four knots and more through a gap a few hundred metres wide. The
 * stream here is a deep-water rate scaled by depth, so it gives the sound its
 * two knots and does not give the Hole its gate. That would need a flow model
 * this project does not have, and inventing the gate by hand would be a number
 * pretending to be a measurement.
 */
const BUZZARDS: Region = {
  id: 'buzzards-bay',
  name: 'Buzzards Bay',
  area: 'Massachusetts, USA',
  brief:
    'Woods Hole, Vineyard Sound and the Elizabeth Islands. Hard breeze and hard ' +
    'stream over open water — the most sailable square here.',
  centre: { lat: 41.5335, lon: -70.7284 },
  utmZone: 19,
  ...SURVEY,
  raster: '/terrain/buzzards-bay.bin',
  conditions: {
    windTwd: 225 * DEG,
    windKnots: 18,
    gustiness: 0.3,
    seaScale: 1,
    setDeg: 60,
    driftKnots: 2,
    fullDepth: 20,
    startHour: 14,
  },
};




export const REGIONS: readonly Region[] = [
  SF_BAY,
  NEWPORT,
  MERCHANT_ROW,
  PUGET,
  CHESAPEAKE,
  BUZZARDS,
];

export const regionById = (id: string): Region | null =>
  REGIONS.find((r) => r.id === id) ?? null;

/**
 * Ids that used to mean somewhere else.
 *
 * `sf` was the San Francisco sketch that preceded the surveyed region, and
 * passages logged there carry it. The sketch is gone and the surveyed region
 * is the same water, so the id resolves forward rather than falling through to
 * "Open ocean" -- a logbook that forgot where you had been would be a worse
 * answer than a slightly generous one.
 */
const RENAMED: Record<string, string> = { sf: 'sf-bay' };

export const regionByStoredId = (id: string): Region | null =>
  regionById(RENAMED[id] ?? id);

/** How many bytes the region's raster must be, for whoever loads it to check. */
export const rasterBytes = (r: Region): number => r.grid.width * r.grid.height * 2;

/**
 * What to call the place a passage was sailed in.
 *
 * The stored id and nothing else, because the logbook outlives every list it
 * was written against: `PassageRecord.venue` is a field older than regions,
 * older than the Earth, and it holds whatever the world was called on the day
 * it was written. `RENAMED` is what carries those forward.
 */
export function placeName(id: string): string {
  // The generated coast is not in REGIONS -- it has no raster to ship -- but a
  // passage sailed along one was not sailed on the open ocean, and the logbook
  // reads its stored field through here. Imported from `coast.ts` rather than
  // restated; the cycle is type-only in the other direction, so it is safe.
  if (id === COAST_ID) return COAST_NAME;
  return regionByStoredId(id)?.name ?? 'Open ocean';
}

/**
 * The six candidates that were baked and not kept, and why.
 *
 * Kept here rather than deleted because "we looked at it" is worth as much as
 * "we shipped it", and because the next person to want a US region should not
 * re-survey these three from scratch. All were measured on the same axes as the
 * table in `region-terrain.test.ts` compares.
 *
 *  - **Long Island Sound (west, off Norwalk).** Extreme on nothing. Land 24%,
 *    sailable 71%, 2% of it close aboard, wind deficit 0.016, median depth 17 m,
 *    11 knots, a knot of stream. Every one of those sits inside the range the
 *    six shipped regions already cover. A square, not a region.
 *  - **Charleston.** Median depth 6 m and 14% too shoal to sail, which is
 *    Chesapeake; its only distinction was 1.6 knots of stream, which is less
 *    than Buzzards Bay's 2. Dominated on both axes it might have won on.
 *  - **Biscayne Bay.** Extreme on four axes and all of them absences: the least
 *    land at 9%, the least shelter at 0.006, the least close-aboard water at 1%,
 *    and the least stream at half a knot, over a median depth of 4 m. Being the
 *    emptiest square measured is not a reason to sail it.
 *
 * Three more never got as far as a bake, for want of data rather than
 * character. The DEM mosaic has no CUDEM over **San Diego** or the **Channel
 * Islands** -- both return ETOPO at 15 arc-seconds, which is roughly 450 m and
 * would be an invented coastline under a 25 m grid. **Chicago** returns a Great
 * Lakes product rather than ETOPO, but a lake surface sits at 176 m of
 * elevation and every depth in this project is measured from zero, so a Great
 * Lakes region needs a datum offset that `Region` does not have.
 */
