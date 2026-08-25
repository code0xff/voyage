import { clamp } from './sim/math';
import { clampLat, wrapLon, type LatLon } from './sim/globe';

/**
 * The voyage she is on, carried from one session to the next.
 *
 * The planet made this necessary. An endless coast that regenerated around the
 * origin every time had nothing worth remembering, but the moment the land
 * became the Earth, a boat that reached the Azores and reopened off San
 * Francisco had had a passage taken away from her.
 *
 * So the row is the *voyage* and not merely a position: which seed, and where
 * she had got to in it. Restoring both is what lets "sail on" mean what
 * it says even after the menu has been used to look at somewhere else.
 *
 * **A place, and the hour. Not the trim, not the heading, not the weather.**
 * Every session in this game is a departure -- she is put to sea already
 * sailing, trimmed and reefed for the conditions of the moment (see
 * `prepareDeparture`) -- and restoring an exact instant would fight that
 * rather than extend it. What is carried is what a session cannot re-derive.
 *
 * The hour was on the other side of that line and did not belong there. Trim
 * and heading are the *departure's*, and handing them back would be handing
 * back a boat mid-tack under last night's sails. The clock is the world's,
 * like the position: nothing about being put to sea depends on it being
 * morning, and a voyage that opened at 09:00 however late she had sailed
 * could not be taken into a night at all -- sail into dusk, stop, come back,
 * and it is breakfast time again on the same passage. That reads as the game
 * having forgotten, which is what this row exists to stop.
 *
 * Unwrapped, and counting on from the `startHour` the voyage began at, which
 * is what `hour` is in the engine. Two things are measured from that number
 * rather than from the time of day -- the tide's phase and the sky effects'
 * monotonic clock -- so wrapping it at 24 would land her at the right hour on
 * the wrong tide.
 *
 * The weather stays behind, and that is a limit rather than a decision made
 * the same way: its generators keep private state that only `reseed` can
 * reach, so carrying it would mean opening five of them up. She opens in the
 * weather of the moment, trimmed for it, which is at least what the
 * departure already promises.
 *
 * A latitude and longitude, and never plane metres, because the Earth's
 * tangent plane *moves* -- every 200 km the origin is re-pinned under the boat
 * -- so its metres mean nothing tomorrow. Rows once carried plane metres too,
 * for the worlds whose plane never moved; those worlds are gone and such a row
 * is refused, because there is nowhere left to put her.
 *
 * localStorage rather than IndexedDB, deliberately, and the rule in AGENTS.md
 * is the reason: the logbook lives in IndexedDB because it *accumulates*.
 * This is one row that is overwritten, which is what the settings are, and it
 * sits beside them. It carries a timestamp all the same, because the first
 * question a sync would ask about two copies of one row is which is newer.
 */

/** The voyage a session was on when it was last written down. */
export interface Underway {
  /** The seed that drew it; a voyage resumed under another seed is another world. */
  seed: number;
  /** Where she was on the Earth. */
  place: LatLon;
  /**
   * The world clock she was sailing on, unwrapped from the voyage's start
   * hour, or null for a row written before this was carried.
   *
   * Null rather than a default, because the default is `startHour` and this
   * module does not know it -- and guessing 0 would open a resumed voyage at
   * midnight, which is worse than the reset it is fixing.
   */
  hour: number | null;
  /**
   * The hour the voyage began at, which is what its tide is measured from,
   * or null for a row that does not say.
   *
   * The "Start time" setting is where a *new* voyage begins, and a player may
   * move it between one session and the next. `hour` alone was enough until
   * you ask what it counts from: the tide's phase is `hour - startHour` over
   * the period, so read against a setting that has since moved, a resumed
   * voyage opened on a tide it was never on -- move Start time by six hours
   * with a 12.42-hour period and the stream runs the other way.
   *
   * So the origin travels with the clock. It is the one thing here that is
   * *not* re-derivable and not the world's either: it is a fact about when
   * this particular voyage started.
   */
  began: number | null;
  /** ms since the epoch. The only thing a later sync could resolve on. */
  at: number;
}

const KEY = 'voyage.underway.v1';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Whether a stored hour is one this game could have written. */
const readable = (v: unknown): v is number => finite(v) && v >= 0 && v <= HOUR_LIMIT;

/**
 * The furthest the clock is allowed to run, world hours.
 *
 * Eleven years, which is about seventeen hundred hours of playing one voyage
 * at the default time scale -- further than a voyage goes, and the clock is
 * the only thing here that can grow without bound now that it survives a
 * session.
 *
 * The bound is not the double that holds `hour`, which is good for far
 * longer. It is float32, on the far side of the renderer. `skydome.ts`
 * multiplies the hour up and hands the *products* to two uniforms -- the star
 * angle at `2 pi / 24` per hour, and the cloud deck's drift at 0.5 per hour --
 * and neither is periodic in a way that could be wrapped on the way through:
 * the stars would take a modulo of 24 happily, the drift would jump.
 *
 * The drift is the binding one, and by a long way, because it does not stay a
 * drift: the shader scales it by `DECK_SCALE` and then samples five noise
 * octaves off it, so a step in the uniform is a step of `1.9 * 2.03^i` in
 * octave i's own cells. Measured, per octave, against its share of the field:
 *
 *     hours    base octave (52% of it)   finest octave (3.2% of it)
 *     2e4      0.12% of a cell           2.1%
 *     1e5      0.61%                     10%
 *     3e5      1.8%                      31%
 *     1e6      3.0%                      52%
 *
 * So 1e5 keeps the octave that carries half the sky moving at well under a
 * hundredth of a cell, and leaves a tenth-of-a-cell stutter only in the one
 * carrying three per cent of it. At 1e6 the base octave itself is stepping
 * and the finest is jumping half a cell at a time.
 *
 * A first version of this reasoned about the hour rather than the products
 * and put the limit at 1e6, which is past where the sky visibly stutters. It
 * also compared against a guess at the finest feature instead of the octave
 * scales above, and was out by a factor of four at its own limit.
 *
 * The *live* clock is held here too, in the engine's step. Clamping only the
 * stored copy left the session running past a limit its row was pinned at, so
 * a reload jumped the sky and the tide backwards -- which is the one thing
 * the pinned calendar was supposed to avoid.
 *
 * Clamped rather than refused on the way out, so an absurd row still sails.
 * What it costs a voyage that reached it is a pinned calendar at a steady
 * time of day, which is much better than the thing it also guards: a
 * hand-edited 1e300 makes `hour += dt` a no-op and stops the sun with nothing
 * reporting a fault.
 */
export const HOUR_LIMIT = 1e5;

/**
 * Read the voyage, or null if there is none to read.
 *
 * Null covers every way of not having one -- never sailed, storage denied,
 * hand-edited to nonsense -- because the caller's answer is the same in all
 * of them: start a new voyage. Nothing stored is trusted, on the same
 * argument as `loadSettings`: a bad row must never be able to break the game,
 * and here it could put the boat inside a continent.
 */
export function loadUnderway(): Underway | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<Underway>;
    if (typeof o !== 'object' || o === null) return null;
    if (!finite(o.seed) || !finite(o.at)) return null;
    // The whole of it: half a coordinate is a row this game has never
    // written. A row carrying only plane metres is one it wrote in a world
    // that no longer exists -- the island field -- and there is nowhere to put
    // her, so it is refused like any other row that cannot be sailed.
    if (!o.place || !finite(o.place.lat) || !finite(o.place.lon)) return null;
    const place = { lat: clampLat(o.place.lat), lon: wrapLon(o.place.lon) };
    // Absent rather than refused when it is missing or unreadable: every row
    // written before the clock was carried has no `hour`, and those are good
    // voyages. The caller falls back to the start hour, which is exactly what
    // every session did before this.
    //
    // Out of range counts as unreadable, and is not clamped. Clamping looks
    // like the kinder answer and is not: a negative hour clamped to zero is a
    // *readable* clock saying midnight, which the engine then opens the
    // voyage on -- before the hour it says the voyage began at. Falling back
    // to the start hour is the honest failure, and it is the one already
    // taken for an hour that is missing or not a number.
    const hour = readable(o.hour) ? o.hour : null;
    // On the same terms, and against the day rather than the clock's own
    // range: it is an hour of the day the voyage set out on, which is what
    // the Start time setting hands over -- so the bound is that setting's,
    // which `loadSettings` clamps to 0..24 *inclusive*. Written exclusive
    // first, which refused the one voyage begun at the top of the range.
    const began = finite(o.began) && o.began >= 0 && o.began <= 24 ? o.began : null;
    return { seed: o.seed, place, hour, began, at: o.at };
  } catch {
    return null;
  }
}

/**
 * Write it. Failures are swallowed: a private-mode browser that refuses to
 * store is a browser the game still has to be playable in, and losing the
 * voyage costs a passage rather than a session.
 */
export function saveUnderway(voyage: Omit<Underway, 'at'>, at = Date.now()): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...voyage,
        place: { lat: clampLat(voyage.place.lat), lon: wrapLon(voyage.place.lon) },
        // Clamped on the way out and refused on the way in, which sounds
        // inconsistent and is the point: this bounds what the game writes,
        // and `loadTrack`'s twin refuses what it did not. A voyage whose
        // clock somehow reached the limit is written at the limit and comes
        // back at it -- a pinned calendar at a steady time of day -- rather
        // than written past it and refused on the next open.
        hour: voyage.hour === null ? null : clamp(voyage.hour, 0, HOUR_LIMIT),
        began: voyage.began,
        at,
      }),
    );
  } catch {
    /* not worth telling anyone about */
  }
}

/** Forget it, so the only door left is a new voyage. */
export function clearUnderway(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* as above */
  }
}

/** Whether a stored voyage is the world these settings would sail. */
export const sameWorld = (voyage: Underway, world: { seed: number }): boolean =>
  voyage.seed === world.seed;
