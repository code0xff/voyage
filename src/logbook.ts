import type { PassageRecord } from './sim/passage';
import { WEATHER_KINDS, type WeatherKind } from './sim/weather';

/**
 * The logbook: every passage she has made.
 *
 * Behind an interface because the persistence decision in AGENTS.md is
 * local-first *and then* sync, not local-only. A server adapter should be
 * another implementation of `LogStore` rather than a rewrite of everything that
 * reads a passage — so nothing outside this file knows where the records live,
 * and every method is async even though the local one need not be.
 *
 * IndexedDB rather than localStorage, for the one reason that decided it: this
 * grows. A few hundred passages of a few hundred bytes is nothing to IndexedDB
 * and is a real fraction of localStorage's five megabytes -- which the ghost
 * recorder used to pack into a flat array of rounded values just to fit.
 */

export interface LogStore {
  /** Most recent first. */
  list(): Promise<PassageRecord[]>;
  add(record: PassageRecord): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

const DB = 'voyage';
const STORE = 'passages';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // Keyed on the record's own id, and indexed on when she sailed, because
        // "most recent first" is the only order a logbook is ever read in.
        db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * One request in one transaction, resolved when the transaction *commits*.
 *
 * Not when the request succeeds, which is the tempting and wrong place: in
 * IndexedDB durability is defined by the transaction completing, and a write
 * whose request succeeded can still be rolled back afterwards. Resolving on the
 * request would have reported a passage as logged that was never written.
 *
 * The connection is closed on every way out. A transaction that aborts never
 * fires `oncomplete`, so closing only there leaked a handle per failed write --
 * and the write that fails is the one that happens when the disk is full, which
 * is exactly when the next one needs it.
 */
const run = <T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let result: T;
    const tx = db.transaction(STORE, mode);
    const req = body(tx.objectStore(STORE));
    req.onsuccess = () => {
      result = req.result;
    };
    const fail = () => {
      db.close();
      reject(tx.error ?? req.error);
    };
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onabort = fail;
    tx.onerror = fail;
  });

/**
 * The store cannot be opened at all, as opposed to a write that failed.
 *
 * A class rather than a message, because the caller has to tell the two apart
 * and matching on prose is a test that breaks when someone rewords an error.
 * The distinction is the whole of the difference between "say so once, quietly"
 * and "tell them, this passage did not get saved": one is a fact about the
 * browser and the other is about a voyage they just made.
 *
 * "Unavailable" is per store instance and not a verdict on the browser. The
 * latch below stops retrying after one refusal, so an open that failed for a
 * passing reason stays failed for this session -- which is why nothing built on
 * this should tell the player their browser cannot do it.
 */
export class LogStoreUnavailable extends Error {
  constructor() {
    super('the local logbook is unavailable');
    this.name = 'LogStoreUnavailable';
  }
}

const unavailable = <T>(): Promise<T> => Promise.reject(new LogStoreUnavailable());

const NOTHING: LogStore = {
  list: () => unavailable<PassageRecord[]>(),
  add: () => unavailable<void>(),
  remove: () => unavailable<void>(),
  clear: () => unavailable<void>(),
};

/**
 * The store, degrading to one that holds nothing if the browser will not have it.
 *
 * Checking that `indexedDB` exists is not enough, and that was the bug: private
 * browsing and some embedded webviews expose the object and then refuse to open
 * a database, throwing a SecurityError or failing on quota. So the fallback is
 * decided by the first `open()` rather than by feature detection, and once it
 * has failed the store stays unavailable instead of retrying on every write.
 *
 * The line it draws: a refusal to *store at all* is still an error, because a
 * player who is told they have a logbook must not be shown a promise that is
 * actually a no-op. A transaction that fails after the database opened is
 * reported for the same reason: it is a real error about a real passage.
 *
 * They are not the same error, though, and `LogStoreUnavailable` is how they
 * are told apart. Reported identically, the first one -- which is a standing
 * condition, true for every passage of the session -- arrives with the urgency
 * of the second and repeats at the end of every voyage.
 */
export function createLogStore(): LogStore {
  if (typeof indexedDB === 'undefined') return NOTHING;

  let unavailable = false;
  const connect = (): Promise<IDBDatabase | null> => {
    if (unavailable) return Promise.resolve(null);
    return open().catch(() => {
      unavailable = true;
      return null;
    });
  };

  const withDb = <T>(body: (db: IDBDatabase) => Promise<T>): Promise<T> =>
    connect().then((db) =>
      db ? body(db) : Promise.reject<T>(new LogStoreUnavailable()),
    );

  return {
    list: () =>
      withDb((db) =>
        run<PassageRecord[]>(db, 'readonly', (s) => s.getAll()).then((all) =>
          all.sort((a, b) => b.startedAt - a.startedAt),
        ),
      ),
    add: (record) =>
      withDb((db) => run(db, 'readwrite', (s) => s.put(record)).then(() => undefined)),
    remove: (id) =>
      withDb((db) => run(db, 'readwrite', (s) => s.delete(id)).then(() => undefined)),
    clear: () =>
      withDb((db) => run(db, 'readwrite', (s) => s.clear()).then(() => undefined)),
  };
}

/**
 * The logbook, shared.
 *
 * One store rather than one per owner: the engine writes to it and the menu
 * reads it, and two instances would be two answers to one question the moment a
 * delete or an import touched only one of them. It is app-level persistence
 * like the settings are, not something the engine owns -- which also means the
 * menu can read it before an engine exists.
 */
export const logbook: LogStore = createLogStore();

/**
 * Version stamp on an exported file, so a future format can recognise this one.
 *
 * 5 added `photographs`; 4 `maxHeel` and `maxSea`; 3 `startHour`, `endHour` and
 * `weather`; 2 `sightings`. Bumped on every added field even though the
 * additions are optional and read either way, because that is what lets a later
 * program tell a record that saw nothing from one written before there was any
 * counting.
 */
export const EXPORT_VERSION = 5;

export interface LogExport {
  format: 'voyage-logbook';
  version: number;
  exportedAt: number;
  passages: PassageRecord[];
}

export const toExport = (passages: PassageRecord[], now: number): LogExport => ({
  format: 'voyage-logbook',
  version: EXPORT_VERSION,
  exportedAt: now,
  passages,
});

/**
 * Records out of an exported file, or null if it is not one.
 *
 * The durability answer that needs no server: the logbook becomes a file the
 * player keeps. Validated rather than trusted, because the file has been out of
 * this program's hands and may have been edited, truncated or be something else
 * entirely that happens to end in .json.
 */
export function fromExport(raw: string): PassageRecord[] | null {
  try {
    const o = JSON.parse(raw) as Partial<LogExport>;
    if (o.format !== 'voyage-logbook' || !Array.isArray(o.passages)) return null;
    // The version is stamped on the way out, so it has to be read on the way
    // in -- but only a *later* one is unreadable, and that was worth separating
    // out. A later format may have changed what a field this code thinks it
    // knows means, and there is no guessing at that. An older one has only ever
    // added optional fields, so a version 1 file is a current file that is
    // silent about what it saw, which is precisely what those fields are
    // optional in order to say. Refusing it on an equality check -- which is
    // what this was until the version first moved -- would throw away a
    // player's own exported logbook the day the format grew.
    // An integer in range, because that is the only thing this program has ever
    // written. A range test alone let 5.5 through as "not newer than 5", which
    // is a version no program has ever stamped and so says nothing at all about
    // the shape underneath it.
    if (!Number.isInteger(o.version) || (o.version as number) < 1 || (o.version as number) > EXPORT_VERSION) {
      return null;
    }

    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    // Durations, distances and speeds cannot be negative -- no passage produces
    // one, so a negative is a hand-edited file rather than a fact, and letting
    // one through would put a boat that sailed minus four hundred metres in the
    // logbook. Coordinates are signed and stay that way.
    const size = (v: unknown) => Math.max(0, num(v));
    const vec = (v: unknown) => {
      const p = v as { x?: unknown; y?: unknown };
      return { x: num(p?.x), y: num(p?.y) };
    };
    // Whole animals. Everything else here is a measurement and may be
    // fractional; a sighting is a thing that happened or did not, so 2.5 whales
    // is a hand-edited file and not a fact.
    const count = (v: unknown) => Math.floor(size(v));
    // Absent from every record written before the field existed. Left absent
    // rather than filled with zeros, because "saw nothing" and "does not say"
    // are different claims and only one of them is true of an old record.
    const sightings = (v: unknown) => {
      // An array is not this shape, and `typeof [] === 'object'` would have let
      // one through as a sighting of nothing. That matters here more than it
      // does for `vec` above, which has no absence to protect: the whole point
      // of this field being optional is that "saw nothing" and "does not say"
      // are different claims, and a malformed value is the second.
      if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
      const s = v as { whales?: unknown; sharks?: unknown };
      return { whales: count(s.whales), sharks: count(s.sharks) };
    };
    // A time of day, or nothing. Dropped rather than repaired when it is out of
    // the day: unlike a negative distance there is no honest correction -- 30
    // o'clock is neither 24 nor 6 -- and a record that cannot say when it
    // happened should say that instead of naming an hour nobody sailed in.
    const hour = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 24 ? v : undefined;
    // Checked against the list rather than merely for being a string, because
    // this one is read back as a key: an unknown kind would reach a lookup that
    // has no row for it.
    const weather = (v: unknown) =>
      WEATHER_KINDS.includes(v as WeatherKind) ? (v as WeatherKind) : undefined;
    // One record per id within a file. Sequential `put`s would otherwise let a
    // duplicate silently overwrite the one before it, so the import would
    // report more passages than it stored.
    const seen = new Set<string>();
    return o.passages
      .filter((p): p is PassageRecord => typeof p?.id === 'string' && p.id.length > 0)
      .filter((p) => !seen.has(p.id) && (seen.add(p.id), true))
      .map((p) => ({
        id: p.id,
        startedAt: size(p.startedAt),
        duration: size(p.duration),
        distance: size(p.distance),
        from: vec(p.from),
        to: vec(p.to),
        direct: size(p.direct),
        avgSog: size(p.avgSog),
        maxSog: size(p.maxSog),
        venue: typeof p.venue === 'string' ? p.venue : '',
        windKnots: size(p.windKnots),
        sightings: sightings(p.sightings),
        startHour: hour(p.startHour),
        endHour: hour(p.endHour),
        weather: weather(p.weather),
        // Absent stays absent, so an old record is not made to claim flat
        // calm; present is clamped non-negative like every other magnitude,
        // since neither a heel nor a wave height can be less than none.
        maxHeel: p.maxHeel === undefined ? undefined : size(p.maxHeel),
        maxSea: p.maxSea === undefined ? undefined : size(p.maxSea),
        // Whole photographs, like whole animals, and absent on an old record.
        photographs: p.photographs === undefined ? undefined : count(p.photographs),
      }));
  } catch {
    return null;
  }
}
