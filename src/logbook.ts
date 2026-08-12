import type { PassageRecord } from './sim/passage';

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

const unavailable = <T>(): Promise<T> =>
  Promise.reject(new Error('IndexedDB is unavailable in this browser'));

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
      db ? body(db) : Promise.reject<T>(new Error('IndexedDB is unavailable in this browser')),
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

/** Version stamp on an exported file, so a future format can recognise this one. */
export const EXPORT_VERSION = 1;

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
    // in. Accepting a version this code has never seen would mean guessing at
    // the shape of a format written by a later one.
    if (o.version !== EXPORT_VERSION) return null;

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
      }));
  } catch {
    return null;
  }
}
