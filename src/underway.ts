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
 * **A place, and only a place.** Not the trim, not the heading, not the hour,
 * not the weather. Every session in this game is a departure -- she is put to
 * sea already sailing, trimmed and reefed for the conditions of the moment
 * (see `prepareDeparture`) -- and restoring an exact instant would fight that
 * rather than extend it. What is carried is what a session cannot re-derive:
 * the sea she is in, and where she had got to in it.
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
  /** ms since the epoch. The only thing a later sync could resolve on. */
  at: number;
}

const KEY = 'voyage.underway.v1';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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
    return { seed: o.seed, place, at: o.at };
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
