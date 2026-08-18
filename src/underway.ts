import { clampLat, wrapLon, type LatLon } from './sim/globe';
import type { Vec2 } from './sim/math';

/**
 * The voyage she is on, carried from one session to the next.
 *
 * The planet made this necessary and then the rest of the game asked for it
 * too. An endless coast that regenerated around the origin every time had
 * nothing worth remembering, but the moment the land became the Earth, a boat
 * that reached the Azores and reopened off San Francisco had had a passage
 * taken away from her. The same is true of the island field, which is just as
 * endless and just as reproducible from its seed -- and of a surveyed region,
 * which is small only in kilometres: twenty of them takes longer to look at
 * properly than anyone sails in one sitting.
 *
 * So the row is the *voyage* and not merely a position: which world, which
 * seed, and where in it. Restoring all four is what lets "sail on" mean what
 * it says even after the menu has been used to look at somewhere else.
 *
 * **A place, and only a place.** Not the trim, not the heading, not the hour,
 * not the weather. Every session in this game is a departure -- she is put to
 * sea already sailing, trimmed and reefed for the conditions of the moment
 * (see `prepareDeparture`) -- and restoring an exact instant would fight that
 * rather than extend it. What is carried is what a session cannot re-derive:
 * which sea she is in, and where she had got to in it.
 *
 * Two coordinates because there are two kinds of world. The endless coast is
 * pinned to a tangent plane that *moves* -- every 200 km the origin is
 * re-pinned under the boat -- so its plane metres mean nothing tomorrow and
 * the honest form is a latitude and longitude. Every other world has a plane
 * that never moves, and there the plane metres are exactly right. Each row
 * carries whichever its world uses.
 *
 * localStorage rather than IndexedDB, deliberately, and the rule in AGENTS.md
 * is the reason: the logbook lives in IndexedDB because it *accumulates*.
 * This is one row that is overwritten, which is what the settings are, and it
 * sits beside them. It carries a timestamp all the same, because the first
 * question a sync would ask about two copies of one row is which is newer.
 */

/** The voyage a session was on when it was last written down. */
export interface Underway {
  /** Region id, `coast` for the Earth, or '' for the island field. */
  region: string;
  /** The seed that drew it; a voyage resumed under another seed is another world. */
  seed: number;
  /** Where she was on the Earth, or null in a world that is not on it. */
  place: LatLon | null;
  /** Where she was in plane metres, or null where the plane moves under her. */
  pos: Vec2 | null;
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
    if (typeof o.region !== 'string') return null;
    if (!finite(o.seed) || !finite(o.at)) return null;
    // One of the two, and it has to be the whole of one: half a coordinate is
    // a row this game has never written.
    const place =
      o.place && finite(o.place.lat) && finite(o.place.lon)
        ? { lat: clampLat(o.place.lat), lon: wrapLon(o.place.lon) }
        : null;
    const pos = o.pos && finite(o.pos.x) && finite(o.pos.y) ? { x: o.pos.x, y: o.pos.y } : null;
    if (!place && !pos) return null;
    return { region: o.region, seed: o.seed, place, pos, at: o.at };
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
        place: voyage.place
          ? { lat: clampLat(voyage.place.lat), lon: wrapLon(voyage.place.lon) }
          : null,
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
export function sameWorld(
  voyage: Underway,
  world: { region: string; seed: number },
): boolean {
  return (
    voyage.region === world.region && voyage.seed === world.seed
  );
}
