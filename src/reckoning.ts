import { clampLat, wrapLon, type LatLon } from './sim/globe';

/**
 * Where she got to, carried from one session to the next.
 *
 * The planet made this necessary. An endless coast that regenerated around
 * the origin every time had nothing worth remembering -- every session was
 * the same water, so starting where you left off would have meant nothing.
 * On the Earth it means everything: a boat that reached the Azores and
 * reopened off San Francisco has had a passage taken away from her, and a
 * circumnavigation is impossible in principle rather than merely long.
 *
 * **A position, and only a position.** Not the trim, not the heading, not the
 * hour, not the weather. Every session in this game is a departure -- she is
 * put to sea already sailing, trimmed and reefed for the conditions of the
 * moment (see `prepareDeparture`) -- and restoring an exact instant would
 * fight that rather than extend it. What is carried is the one thing the
 * session cannot re-derive: which sea she is in.
 *
 * localStorage rather than IndexedDB, deliberately, and the rule in AGENTS.md
 * is the reason: the logbook lives in IndexedDB because it *accumulates*.
 * This is one row of two numbers that is overwritten, which is exactly what
 * the settings are, and it sits beside them.
 *
 * It is a row with a timestamp all the same. A server adapter is meant to be
 * possible later, and the first question sync asks about two copies of one
 * value is which of them is newer.
 */

/** A remembered position, and when it was written. */
export interface Reckoning extends LatLon {
  /** ms since the epoch. The only thing a later sync could resolve on. */
  at: number;
}

const KEY = 'voyage.reckoning.v1';

/**
 * Read the last position, or null if there is none to read.
 *
 * Null covers every way of not having one -- never sailed, storage denied,
 * hand-edited to nonsense -- because the caller's answer is the same in all
 * of them: open where the game opens. Nothing stored is trusted, on the same
 * argument as `loadSettings`: a bad row must never be able to break the
 * game, and here it could put the boat inside a continent.
 */
export function loadReckoning(): Reckoning | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<Reckoning>;
    // All three or none. The timestamp is the only thing a later sync could
    // resolve two copies on, so a row without a usable one is a row that
    // cannot be reasoned about -- and it is not a row this game has ever
    // written, which makes it something else's. Defaulting it to zero,
    // which is what this did, quietly turned a half-written row into a
    // valid one: a review pointed it out.
    if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon) || !Number.isFinite(o.at)) {
      return null;
    }
    return {
      lat: clampLat(o.lat as number),
      lon: wrapLon(o.lon as number),
      at: o.at as number,
    };
  } catch {
    return null;
  }
}

/**
 * Write it. Failures are swallowed: a private-mode browser that refuses to
 * store is a browser the game still has to be playable in, and losing the
 * position costs a passage rather than a session.
 */
export function saveReckoning(place: LatLon, at = Date.now()): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ lat: clampLat(place.lat), lon: wrapLon(place.lon), at }),
    );
  } catch {
    /* not worth telling anyone about */
  }
}

/** Forget it, so the next departure is from where the game opens. */
export function clearReckoning(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* as above */
  }
}
