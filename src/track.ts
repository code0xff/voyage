import { clampLat, wrapLon, type LatLon } from './sim/globe';

/**
 * The track she has sailed on this voyage, carried from one session to the
 * next.
 *
 * `underway.ts` remembers *where she got to* and deliberately nothing else --
 * a place, and only a place, because every session here is a departure and
 * restoring an exact instant would fight that. This is the one thing that
 * argument does not cover. The track is not the boat's state and not the
 * world's: it is the record of what was done, the same kind of thing as the
 * logbook, and a record that a resumed voyage cannot re-derive because it is
 * the history of the voyage itself. Reopening off the same headland with the
 * water astern drawn empty reads as having sailed nowhere.
 *
 * Its own row rather than a field on `Underway`, for two reasons. That row is
 * three numbers and is refused whole when any of them is wrong; folding an
 * array of six hundred points into it would mean one bad coordinate losing
 * the position too, and the position is the one that matters. And they are
 * written at the same moment but wanted at different ones -- the menu reads
 * the position to label the "sail on" button before the engine exists, and
 * has no use for the track.
 *
 * Latitude and longitude, never plane metres, on `underway.ts`'s reasoning
 * exactly: the tangent plane is re-pinned under the boat every 200 km, so its
 * metres mean nothing tomorrow.
 *
 * localStorage rather than IndexedDB. It looks like it accumulates and does
 * not: the chart keeps a bounded window of the recent track (see `TRACK_MAX`)
 * and this row is that window, overwritten whole. Six hundred points at five
 * decimal places -- about a metre, finer than the twelve the track is sampled
 * at -- is some 13 KB, which sits beside the settings without straining the
 * few megabytes they share.
 */

/** The track a session was on when it was last written down. */
export interface Track {
  /** The seed that drew the world it was sailed in. */
  seed: number;
  /** Oldest first, the way the chart draws it. */
  points: LatLon[];
  /** ms since the epoch. The only thing a later sync could resolve on. */
  at: number;
}

const KEY = 'voyage.track.v1';

/**
 * Decimal places kept per coordinate.
 *
 * Five is about a metre, against a track sampled every twelve. Stored full
 * width the row is nearly three times the size for precision the chart could
 * not draw at any range it has: one metre is a fifth of a pixel on the
 * closest.
 */
const DP = 1e5;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Read the track, or null if there is none worth reading.
 *
 * Null covers every way of not having one, including a row that is only
 * partly readable: unlike the position, a track is nothing the game needs to
 * open, so there is no case for salvaging what can be parsed out of a
 * damaged one. Nothing stored is trusted, on `loadUnderway`'s argument.
 */
export function loadTrack(): Track | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { seed?: unknown; at?: unknown; p?: unknown };
    if (typeof o !== 'object' || o === null) return null;
    if (!finite(o.seed) || !finite(o.at)) return null;
    if (!Array.isArray(o.p)) return null;
    const points: LatLon[] = [];
    for (let i = 0; i < o.p.length; i += 2) {
      const lat: unknown = o.p[i];
      const lon: unknown = o.p[i + 1];
      // Flat pairs, so this also catches a row cut in the middle of a point:
      // an odd length reads its last longitude as undefined, which is not a
      // number, and there is no honest way to read that point anyway. A
      // separate length check was written here first and was dead -- kept
      // green by a mutation that should have failed a test and did not.
      if (!finite(lat) || !finite(lon)) return null;
      points.push({ lat: clampLat(lat), lon: wrapLon(lon) });
    }
    return { seed: o.seed, points, at: o.at };
  } catch {
    return null;
  }
}

/**
 * Write it. Failures are swallowed, and here it costs less than anywhere
 * else it is done: a browser that refuses to store loses a line on a chart.
 */
export function saveTrack(seed: number, points: readonly LatLon[], at = Date.now()): void {
  try {
    const p: number[] = [];
    for (const q of points) {
      p.push(Math.round(clampLat(q.lat) * DP) / DP, Math.round(wrapLon(q.lon) * DP) / DP);
    }
    localStorage.setItem(KEY, JSON.stringify({ seed, at, p }));
  } catch {
    /* not worth telling anyone about */
  }
}

/** Forget it: a new voyage has no track behind it. */
export function clearTrack(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* as above */
  }
}
