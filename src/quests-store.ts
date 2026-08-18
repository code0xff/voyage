import type { QuestPack, QuestState } from './sim/quest';

/**
 * Where installed packs and what they have noticed are kept.
 *
 * **Its own database, not a table in the logbook's.** They are independent
 * features with independent schemas, and sharing one would mean every change
 * to how quests are stored forces a version bump the logbook has to migrate
 * through -- for a feature it knows nothing about. The logbook is passages;
 * this is quests.
 *
 * IndexedDB rather than localStorage for the same reason the logbook uses it:
 * this **accumulates**. Packs are other people's files, of no fixed size, and
 * a player who installs a dozen of them should not be spending the five
 * megabytes the settings and the carried voyage share.
 *
 * Behind an interface for the reason AGENTS.md gives: local-first *and then*
 * sync, so a server adapter is another implementation rather than a rewrite
 * of everything that reads a quest.
 */

export interface QuestStore {
  /** Every installed pack. */
  packs(): Promise<QuestPack[]>;
  /** Add one, or replace the one with the same id. */
  install(pack: QuestPack): Promise<void>;
  /** Remove a pack. What it noticed is left alone; see `forget`. */
  remove(id: string): Promise<void>;
  /** What the watcher has seen so far, or null if it has never run. */
  state(): Promise<QuestState | null>;
  save(state: QuestState): Promise<void>;
  /** Throw the tallies and the completions away. Packs stay installed. */
  forget(): Promise<void>;
}

const DB = 'voyage.quests';
const PACKS = 'packs';
const STATE = 'state';
const VERSION = 1;
/** The single row the watcher's state lives in. */
const STATE_KEY = 'state';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Keyed on the pack's own id, so installing the same pack twice is a
      // replacement rather than a duplicate -- which is what a player who
      // downloads a newer version of one means by it.
      if (!db.objectStoreNames.contains(PACKS)) db.createObjectStore(PACKS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STATE)) db.createObjectStore(STATE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * One request in one transaction, resolved when the transaction *commits*.
 *
 * The same shape and the same reasoning as the logbook's: in IndexedDB
 * durability is the transaction completing, and a request that succeeded can
 * still be rolled back. The connection is closed on every way out, because a
 * transaction that aborts never fires `oncomplete` and the write that fails
 * is the one that happens when the disk is full -- exactly when the next one
 * needs the handle.
 */
const run = <T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  body: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let result: T;
    const tx = db.transaction(store, mode);
    const req = body(tx.objectStore(store));
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
 * A store that refuses everything, for a browser that will not open one.
 *
 * Quests are the one part of this game that is nobody's voyage: losing them
 * costs a list, not a passage. So a refusal here is quiet -- the screen shows
 * nothing rather than an error, and sailing is unaffected.
 */
const NOTHING: QuestStore = {
  packs: async () => [],
  install: async () => {},
  remove: async () => {},
  state: async () => null,
  save: async () => {},
  forget: async () => {},
};

/** One refusal is enough; see the logbook's note on the same latch. */
let refused = false;

export const questStore: QuestStore = {
  async packs() {
    if (refused) return [];
    try {
      const db = await open();
      return await run<QuestPack[]>(db, PACKS, 'readonly', (s) => s.getAll());
    } catch {
      refused = true;
      return NOTHING.packs();
    }
  },
  async install(pack) {
    if (refused) return;
    try {
      const db = await open();
      await run(db, PACKS, 'readwrite', (s) => s.put(pack));
    } catch {
      refused = true;
    }
  },
  async remove(id) {
    if (refused) return;
    try {
      const db = await open();
      await run(db, PACKS, 'readwrite', (s) => s.delete(id));
    } catch {
      refused = true;
    }
  },
  async state() {
    if (refused) return null;
    try {
      const db = await open();
      return (await run<QuestState | undefined>(db, STATE, 'readonly', (s) =>
        s.get(STATE_KEY),
      )) ?? null;
    } catch {
      refused = true;
      return null;
    }
  },
  async save(state) {
    if (refused) return;
    try {
      const db = await open();
      await run(db, STATE, 'readwrite', (s) => s.put(state, STATE_KEY));
    } catch {
      refused = true;
    }
  },
  async forget() {
    if (refused) return;
    try {
      const db = await open();
      await run(db, STATE, 'readwrite', (s) => s.delete(STATE_KEY));
    } catch {
      refused = true;
    }
  },
};
