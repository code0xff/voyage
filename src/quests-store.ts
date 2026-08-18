import type { QuestPack, QuestState } from './sim/quest';
import { STARTER_PACK } from './sim/starter';

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
  /**
   * Every installed pack, having put the starter one in if this browser has
   * never held any. Declared here rather than left to the caller because
   * there are three callers and every one of them wants the same answer;
   * a later sync adapter owes the same.
   */
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
/**
 * The row that remembers the starter pack has been offered.
 *
 * Kept beside the watcher's state rather than in the packs -- the packs are
 * what is installed, and this is a fact about the browser. It is deliberately
 * *not* cleared by `forget`: forgetting what was noticed is about the
 * completions, and a starter pack that reappeared because you cleared your
 * records would be the game arguing with a decision you made.
 */
const SEEDED_KEY = 'starter';

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
/** And one check per session is enough; the answer cannot change under us. */
let seeded = false;
/** The one in flight, so two readers at once cannot both seed. */
let seeding: Promise<void> | null = null;

/**
 * Put the starter pack in, once ever in this browser, and only into a browser
 * that is holding no packs at all.
 *
 * **Both conditions, not just the mark.** The mark is new, so every browser
 * that already has this game has packs and no mark -- and one of those packs
 * may be an edited `first-miles`, because the starter used to ship as a file
 * under `public/` with that id. Seeding on the mark alone would have replaced
 * somebody's edited pack with the shipped one on the first read after the
 * update. A browser holding packs is not a new browser; it is marked and left
 * alone.
 *
 * The pack first and the mark second, on purpose: a crash between them costs
 * a repeated `put` of the same id next time, which is the same row. The other
 * order would cost the pack entirely.
 *
 * The mark is what makes removal stick. Without it the game would put back
 * the pack a player had just deleted on the next thing that read the list,
 * which is the most annoying bug this feature could have.
 */
async function seedOnce(): Promise<void> {
  if (seeded) return;
  // One flight for all callers: the engine and the two screens can ask at
  // once, and three of these interleaved would each read "no packs" and each
  // write. Idempotent as it happens -- one id, one row -- but it is a race,
  // and a race that is currently harmless is a race.
  seeding ??= (async () => {
    const asked = await open();
    if (!(await run<unknown>(asked, STATE, 'readonly', (s) => s.get(SEEDED_KEY)))) {
      const held = await open();
      if ((await run<number>(held, PACKS, 'readonly', (s) => s.count())) === 0) {
        const packs = await open();
        await run(packs, PACKS, 'readwrite', (s) => s.put(STARTER_PACK));
      }
      const mark = await open();
      await run(mark, STATE, 'readwrite', (s) => s.put(true, SEEDED_KEY));
    }
    seeded = true;
  })();
  try {
    await seeding;
  } finally {
    // Cleared either way. A failed flight must not be the answer every later
    // caller awaits -- the next one should try again.
    seeding = null;
  }
}

export const questStore: QuestStore = {
  async packs() {
    if (refused) return [];
    try {
      await seedOnce();
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
