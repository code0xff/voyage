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
 * and is a real fraction of localStorage's five megabytes, which `replay.ts` is
 * already packing a ghost into a flat array to fit.
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

const NOTHING: LogStore = {
  list: () => Promise.resolve([]),
  add: () => Promise.resolve(),
  remove: () => Promise.resolve(),
  clear: () => Promise.resolve(),
};

/**
 * The store, degrading to one that holds nothing if the browser will not have it.
 *
 * Checking that `indexedDB` exists is not enough, and that was the bug: private
 * browsing and some embedded webviews expose the object and then refuse to open
 * a database, throwing a SecurityError or failing on quota. So the fallback is
 * decided by the first `open()` rather than by feature detection, and once it
 * has failed the store stays a no-op instead of retrying on every write.
 *
 * The line it draws: a refusal to *store at all* is silent, because a sailing
 * game must not fail over a logbook. A transaction that fails after the
 * database opened is reported, because that is a real error about a real
 * passage and the player should be told rather than shown a logbook that
 * quietly is not theirs.
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

  const withDb = <T>(fallback: T, body: (db: IDBDatabase) => Promise<T>): Promise<T> =>
    connect().then((db) => (db ? body(db) : fallback));

  return {
    list: () =>
      withDb<PassageRecord[]>([], (db) =>
        run<PassageRecord[]>(db, 'readonly', (s) => s.getAll()).then((all) =>
          all.sort((a, b) => b.startedAt - a.startedAt),
        ),
      ),
    add: (record) =>
      withDb(undefined, (db) => run(db, 'readwrite', (s) => s.put(record)).then(() => undefined)),
    remove: (id) =>
      withDb(undefined, (db) => run(db, 'readwrite', (s) => s.delete(id)).then(() => undefined)),
    clear: () =>
      withDb(undefined, (db) => run(db, 'readwrite', (s) => s.clear()).then(() => undefined)),
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
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const vec = (v: unknown) => {
      const p = v as { x?: unknown; y?: unknown };
      return { x: num(p?.x), y: num(p?.y) };
    };
    return o.passages
      .filter((p): p is PassageRecord => typeof p?.id === 'string' && p.id.length > 0)
      .map((p) => ({
        id: p.id,
        startedAt: num(p.startedAt),
        duration: num(p.duration),
        distance: num(p.distance),
        from: vec(p.from),
        to: vec(p.to),
        direct: num(p.direct),
        avgSog: num(p.avgSog),
        maxSog: num(p.maxSog),
        venue: typeof p.venue === 'string' ? p.venue : '',
        windKnots: num(p.windKnots),
      }));
  } catch {
    return null;
  }
}
