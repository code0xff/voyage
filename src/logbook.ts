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

const run = <T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> =>
  open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = body(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );

/**
 * The real store, or a store that quietly holds nothing.
 *
 * Private browsing and some embedded webviews refuse IndexedDB outright, and a
 * sailing game must not fail to start over a logbook. Losing the record is a
 * disappointment; a black screen is a bug.
 */
export function createLogStore(): LogStore {
  const available = typeof indexedDB !== 'undefined';
  if (!available) {
    return {
      list: () => Promise.resolve([]),
      add: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
  }
  return {
    async list() {
      const all = await run<PassageRecord[]>('readonly', (s) => s.getAll());
      return all.sort((a, b) => b.startedAt - a.startedAt);
    },
    add: (record) => run('readwrite', (s) => s.put(record)).then(() => undefined),
    remove: (id) => run('readwrite', (s) => s.delete(id)).then(() => undefined),
    clear: () => run('readwrite', (s) => s.clear()).then(() => undefined),
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
