import { clamp, lerp, smoothstep, wrap2Pi } from './math';
import { knotsToMs } from './units';

/**
 * What the latitude does to the wind, and why a chart of the world is a
 * chart of different seas.
 *
 * This is the point of opening the planet. A coastline in the right place is
 * scenery; what makes the Southern Ocean a different thing to sail than the
 * Caribbean is that one blows a steady thirty from the west and the other a
 * warm fifteen from the east, and that between them lie the doldrums, where
 * a boat can sit for a day going nowhere. Those belts are the oldest working
 * knowledge there is -- they are why the trade routes ran the way they did,
 * and why a passage plan is a latitude plan.
 *
 * **A climatology, not a forecast.** These are the long-run averages a pilot
 * chart carries, not weather: the model says what a season of wind at this
 * latitude tends to do, and `weather.ts` still decides what today is doing
 * on top of it. Nothing here is stochastic and nothing here has state.
 *
 * The cells, north to south, and each one is a real thing with a real name:
 *
 * - **polar easterlies**, poleward of about 65 degrees: light, cold, from
 *   the east, and thin enough that ice rather than wind is what stops you.
 * - **the prevailing westerlies**, 35 to 65: the strongest steady wind on
 *   the planet, and the further south the harder -- the roaring forties and
 *   the furious fifties are the same belt with nothing in their way.
 * - **the horse latitudes**, near 30: the subtropical high, where the
 *   westerlies and the trades change places and the wind falls away.
 * - **the trade winds**, 5 to 30: steady, warm, from the east and a little
 *   toward the equator -- north-east in the northern hemisphere, south-east
 *   in the southern. The wind that made ocean crossings possible.
 * - **the doldrums**, within a few degrees of the equator: the
 *   intertropical convergence, where the two trades meet and cancel and the
 *   wind goes out.
 *
 * The seam between two belts is a *smoothstep*, not a step: a boat crossing
 * 30 degrees should find the wind swinging and easing over a day's sailing,
 * not switching direction the moment a number changes. That continuity is
 * what makes the belts feel like weather rather than like zones.
 */

/** A latitude's mean wind, as a climatology. */
export interface Climate {
  /** Compass rad the wind blows *from*, as sailors quote it. */
  twd: number;
  /** Mean speed, m/s. */
  tws: number;
  /** 0..1, how much the wind here fluctuates about that mean. */
  gustiness: number;
  /** Which belt this is, for anything that wants to name it. */
  belt: Belt;
}

export type Belt = 'doldrums' | 'trades' | 'horse' | 'westerlies' | 'polar';

/**
 * Every belt, for anything that has to check a name against the list.
 *
 * Written out rather than derived from `SPEED`, because a belt is a name in
 * this model before it is a wind speed -- and a quest pack naming one is
 * checked against this, so the list has to be the whole set. `climate.test.ts`
 * sweeps the latitudes and requires `beltAt` to answer from it, which is what
 * catches a belt added to the type and forgotten here.
 */
export const BELTS: readonly Belt[] = ['doldrums', 'trades', 'horse', 'westerlies', 'polar'];

/**
 * Mean speeds in knots at the middle of each belt.
 *
 * Pilot-chart order of magnitude rather than any one month's measurement:
 * the trades are famously steady at fifteen to twenty, the westerlies run
 * harder and the southern ones hardest of all, and the two calm belts are
 * calm rather than dead -- a doldrum with no wind at all would be a wall,
 * not a passage, and the real one always has something.
 */
const SPEED = {
  doldrums: 4,
  trades: 15,
  horse: 6,
  westerlies: 22,
  polar: 11,
} as const;

/**
 * How much harder the southern westerlies blow than the northern.
 *
 * The Southern Ocean has no continent in the way of it, so the same belt
 * that gives Biscay a gale gives Cape Horn a bigger one. This is the single
 * asymmetry between the hemispheres in the model, and it is the one that
 * decides where the hardest sailing on the planet is.
 */
const SOUTHERN_WESTERLIES = 1.25;

/** Gustiness by belt: steady trades, unsettled westerlies, fitful calms. */
const GUST = {
  doldrums: 0.7,
  trades: 0.25,
  horse: 0.5,
  westerlies: 0.55,
  polar: 0.5,
} as const;

/**
 * The belt at a latitude, by its own boundaries.
 *
 * Named separately from the wind because a readout wants the word and the
 * physics wants the numbers, and deriving the word from the numbers would
 * make "which belt is this" a question about wind speed rather than about
 * where you are.
 */
export function beltAt(lat: number): Belt {
  const a = Math.abs(lat);
  if (a < 5) return 'doldrums';
  if (a < 28) return 'trades';
  if (a < 34) return 'horse';
  if (a < 62) return 'westerlies';
  return 'polar';
}

/**
 * The climatological wind at a latitude.
 *
 * Built by blending along the latitude rather than by branching on the
 * belt: every quantity is a smooth function of where you are, so a passage
 * north through the trades into the horse latitudes and on into the
 * westerlies is a continuous swing of the wind through nearly a hundred and
 * eighty degrees, which is exactly what it is at sea.
 *
 * The direction is built from two components -- how much of the belt's
 * easterly or westerly is in force, and the meridional lean that gives the
 * trades their north-east and south-east -- and then turned into a compass
 * bearing at the end. Building it as a bearing directly is what makes a
 * wind model discontinuous at the equator, where the sign of the lean has
 * to change.
 */
export function climateAt(lat: number): Climate {
  const a = Math.abs(lat);

  /*
   * How much of each belt is in force here. Overlapping smoothsteps, so the
   * seams are days of sailing rather than lines.
   */
  const trade = 1 - smoothstep(26, 33, a);
  const westerly = smoothstep(29, 38, a) * (1 - smoothstep(58, 66, a));
  const polar = smoothstep(60, 68, a);

  /*
   * Which way the meridional lean points, and how much of it there is.
   *
   * It was the bare hemisphere, +1 or -1, and that put a step in the middle
   * of the ocean. The trade term used to fade out below 3 degrees as well, so
   * inside the doldrums every component was zero and the bearing fell through
   * to due north -- then snapped to 66 degrees the moment a boat crossed 3N,
   * and to 114 across 3S. A review found it; the model's own docblock had
   * promised no steps anywhere.
   *
   * Both halves are fixed by the same thing. The easterly influence now runs
   * all the way to the equator, so the direction is never undefined, and the
   * lean fades through the convergence instead of flipping: at the equator it
   * is zero and the wind is due east, which is what the two trades left over
   * when they cancel. Five degrees is the ITCZ's own half-width, the same
   * scale the calm belt is drawn on.
   */
  const lean = clamp(lat / 5, -1, 1);

  /*
   * The wind's direction, built as "how much of it comes from the east" and
   * "how much from the north".
   *
   * Named for where the wind comes *from* -- the sailor's convention, and
   * the one the bearing at the end is in -- because the first version of
   * this called them zonal and meridional and promptly put the north-east
   * trades in the south-west. A component called `zonal` has to be read
   * twice to know its sign; one called `fromEast` does not.
   *
   * The trades and the polar easterlies come from the east, the westerlies
   * from the west. The meridional lean is the surface flow of each cell:
   * the trades run *toward* the equator, so they come from the pole side --
   * north in the northern hemisphere -- and the westerlies run poleward, so
   * they come from the equator side. The polar easterlies lean like the
   * trades, from the pole side, which is what makes them north-east in the
   * north and south-east in the south rather than due east everywhere; that
   * term was missing and a review caught it. All of them flip with the
   * hemisphere, which is the whole reason this is built in components and
   * turned into a bearing only at the end.
   */
  const fromEast = trade - westerly + polar * 0.8;
  const fromNorth = (trade * 0.45 - westerly * 0.25 + polar * 0.35) * lean;

  const belt = beltAt(lat);
  /*
   * Speed follows the same blends, so the calms between belts are real places
   * with a width rather than lines on a chart.
   *
   * `strength` is how far into the westerlies this latitude is, and it is
   * what the southern boost rides on -- not the whole term. Applied to the
   * term, as it was, the 1.25 also fell on the horse latitudes underneath it
   * and made the southern subtropical high blow 7.5 knots against the
   * northern 6, which contradicts both the pilot chart and this file's own
   * claim that the westerlies are the single asymmetry. A review caught it by
   * comparing 31 north against 31 south.
   */
  const strength = smoothstep(31, 42, a);
  const south = lat < 0 ? 1 + (SOUTHERN_WESTERLIES - 1) * strength : 1;
  const knots =
    lerp(SPEED.doldrums, SPEED.trades, smoothstep(2, 10, a)) *
      (1 - smoothstep(24, 31, a)) +
    lerp(SPEED.horse, SPEED.westerlies, strength) *
      smoothstep(24, 31, a) *
      (1 - smoothstep(60, 68, a)) *
      south +
    SPEED.polar * smoothstep(60, 68, a);

  return {
    twd: componentsToTwd(fromEast, fromNorth),
    tws: knotsToMs(Math.max(1.5, knots)),
    gustiness: GUST[belt],
    belt,
  };
}

/**
 * Two components of "where the wind is from" as a compass bearing.
 *
 * Compass bearings run clockwise from north, so a wind entirely from the
 * north is 0 and one entirely from the east is 90 -- which makes the
 * bearing `atan2(fromEast, fromNorth)`, in that order. Its own function so
 * the convention can be asserted rather than trusted: this is the sign
 * every wind model gets wrong once, and this one did.
 */
export function componentsToTwd(fromEast: number, fromNorth: number): number {
  if (Math.abs(fromEast) < 1e-9 && Math.abs(fromNorth) < 1e-9) return 0;
  return wrap2Pi(Math.atan2(fromEast, fromNorth));
}

/**
 * How much of the climatology to believe, against the player's own slider.
 *
 * The settings still carry a wind speed and the world still has to obey it
 * somewhere -- a player who asks for twenty-five knots to practise heavy
 * weather should get it. So the climate is a *shape* applied to that: the
 * belts decide the direction outright, since a compass bearing has no
 * player-facing slider, and they scale the speed about the setting rather
 * than replacing it. At the extremes that means the doldrums are always
 * calmer than the setting and the southern westerlies always harder, which
 * is the whole point, but a slider at 25 still gives a hard sail everywhere.
 */
export function climateSpeed(settingMs: number, climate: Climate): number {
  // The trades are the reference: a setting of 12 knots means "trade wind
  // strength", and everything else is relative to it.
  const ratio = climate.tws / knotsToMs(SPEED.trades);
  return clamp(settingMs * ratio, knotsToMs(1), knotsToMs(45));
}

/** Degrees, exported so a test can walk the seams rather than guess them. */
export const BELT_EDGES = [5, 28, 34, 62] as const;
