import { beltAt } from './climate';
import { msToKnots } from './units';
import type { PassageRecord } from './passage';

/**
 * Quests, as data anyone can write.
 *
 * The physics is the platform and this is the content layer: a pack is a
 * JSON file of things worth doing, and a player installs one the way they
 * would install a map. That is the part of this project a community can
 * actually make -- nobody is going to contribute a hull model, and everybody
 * has an opinion about what is worth sailing to.
 *
 * **Not missions.** There is no accepting one, no failing one and no clock.
 * A quest is a description of something that would have been worth doing,
 * and it completes when the logbook shows it was done -- so playing is the
 * only way to make progress and there is never a wrong thing to be carrying.
 * That is also what makes a pack safe to install from a stranger: it can
 * only ever *notice*.
 *
 * **Data, never code.** This is the security decision the format is built
 * around. A quest that carried an expression -- a formula, a predicate, a
 * script -- would mean that installing someone's file runs their program in
 * your browser. So the vocabulary is closed: a fixed set of facts about a
 * passage, a fixed set of comparisons, and nothing else. A pack naming a
 * fact this build does not know is *rejected when it is installed*, with the
 * name of the thing it wanted, rather than quietly never completing.
 *
 * **What can be asked about is what was measured.** Every fact below is a
 * field the passage log already wrote down while the physics was running --
 * distance, the wind she was out in, how far she was laid over, what she
 * saw, where she was. Nothing here measures anything; it reads. That is why
 * a quest cannot be gamed by a pack author: they are choosing which true
 * things to point at, not defining truth.
 *
 * Pure and headless like the rest of `src/sim`: packs in, progress out.
 */

/** The format this build writes and understands. */
export const QUEST_FORMAT = 1;

/** A number a fact is held against. At least one bound must be given. */
export interface Bound {
  atLeast?: number;
  atMost?: number;
}

/**
 * The facts a quest may ask about, and the shape of the answer.
 *
 * Deliberately a list rather than a path into the record: a quest asking for
 * `sightings.whales` would be reaching into a data structure it does not own,
 * and the day that structure changes every pack in the world breaks. These
 * names are a contract.
 */
export type FactName =
  /** Sailed on the passage, nautical miles. */
  | 'miles'
  /** How long it took, hours. */
  | 'hours'
  /** Average speed over the ground, knots. */
  | 'avgSpeed'
  /** The best she made, knots. */
  | 'topSpeed'
  /** Mean true wind she was out in, knots. */
  | 'wind'
  /** The steepest she was laid over, degrees. */
  | 'heel'
  /** The biggest significant wave height she was in, metres. */
  | 'sea'
  /** How far south she got, degrees. Negative north of the equator. */
  | 'south'
  /** And north, likewise. */
  | 'north'
  /** Whales and sharks seen, counted as encounters rather than as steps. */
  | 'whales'
  | 'sharks'
  /** Photographs taken on the passage. */
  | 'photographs'
  /** Track over straight line: 1.0 is a ruled line, 1.4 is a beat. */
  | 'wandering';

/**
 * What a quest asks of one passage.
 *
 * `all` of these must hold on the *same* passage -- which is the only way to
 * ask for something interesting ("thirty knots and still on her feet") and
 * the reason a quest is not simply a list of separate conditions.
 */
export interface Ask {
  /** A measured number, held between bounds. */
  facts?: Partial<Record<FactName, Bound>>;
  /** The weather it was mostly made in. */
  weather?: string;
  /** The wind belt either end of it was in. */
  belt?: string;
  /** True if the two ends are on opposite sides of the equator. */
  crossedTheLine?: boolean;
  /** True if it began before dark and ended after it. */
  throughTheNight?: boolean;
  /** The world it was sailed in: a region id, or '' for the island field. */
  region?: string;
}

/** How the asks add up across a logbook. */
export type Counting =
  /** One passage answers the whole ask. The usual kind. */
  | { kind: 'once' }
  /** A number totalled over every passage that answers the ask. */
  | { kind: 'total'; fact: FactName; needs: number }
  /** How many passages answered it. */
  | { kind: 'passages'; needs: number }
  /** Distinct wind belts touched by the passages that answered it. */
  | { kind: 'belts'; needs: number };

/** One thing worth doing. */
export interface Quest {
  /** Unique inside its pack; the pack's id is prefixed on install. */
  id: string;
  /** What to call it, per language. `en` is required as the fallback. */
  name: Record<string, string>;
  /** One line on what it is, optional. */
  note?: Record<string, string>;
  ask: Ask;
  counting?: Counting;
}

/** A file of them. */
export interface QuestPack {
  format: number;
  id: string;
  name: string;
  author?: string;
  quests: Quest[];
}

/** Where a quest stands. */
export interface Progress {
  id: string;
  at: number;
  needs: number;
  done: boolean;
  /** ms since the epoch of the passage that completed it, or null. */
  doneAt: number | null;
}

const NM = 1852;
const RAD = 180 / Math.PI;

/**
 * The facts, read off a record.
 *
 * `undefined` means the record cannot say -- it was written before the field
 * existed, or in a world that has no answer. That is different from zero and
 * is kept different all the way through: a quest asking for whales is not
 * *failed* by an old passage that never counted them, it simply learns
 * nothing from it.
 */
const FACTS: Record<FactName, (p: PassageRecord) => number | undefined> = {
  miles: (p) => p.distance / NM,
  hours: (p) => p.duration / 3600,
  avgSpeed: (p) => msToKnots(p.avgSog),
  topSpeed: (p) => msToKnots(p.maxSog),
  wind: (p) => p.windKnots,
  heel: (p) => (p.maxHeel === undefined ? undefined : p.maxHeel * RAD),
  sea: (p) => p.maxSea,
  south: (p) =>
    p.fromPlace && p.toPlace ? Math.max(-p.fromPlace.lat, -p.toPlace.lat) : undefined,
  north: (p) =>
    p.fromPlace && p.toPlace ? Math.max(p.fromPlace.lat, p.toPlace.lat) : undefined,
  whales: (p) => p.sightings?.whales,
  sharks: (p) => p.sightings?.sharks,
  photographs: (p) => p.photographs,
  // Guarded rather than left to divide by zero: a passage that went nowhere
  // has no shape, and `Infinity` compared against a bound is a quest
  // completing on a boat that never moved.
  wandering: (p) => (p.direct > 0 ? p.distance / p.direct : undefined),
};

export const FACT_NAMES = Object.keys(FACTS) as FactName[];

/** Every belt the passage's two ends were in. */
function beltsOf(p: PassageRecord): string[] {
  const seen: string[] = [];
  for (const place of [p.fromPlace, p.toPlace]) {
    if (!place) continue;
    const belt = beltAt(place.lat);
    if (!seen.includes(belt)) seen.push(belt);
  }
  return seen;
}

/**
 * Does this passage answer the ask?
 *
 * `undefined` for "this record cannot say", which is not the same as `false`
 * -- the caller uses it to leave an old passage out of a total rather than
 * counting it as a zero.
 */
function answers(p: PassageRecord, ask: Ask): boolean | undefined {
  let knowable = true;
  for (const [name, bound] of Object.entries(ask.facts ?? {})) {
    const value = FACTS[name as FactName]?.(p);
    if (value === undefined) {
      knowable = false;
      continue;
    }
    if (bound.atLeast !== undefined && value < bound.atLeast) return false;
    if (bound.atMost !== undefined && value > bound.atMost) return false;
  }
  if (ask.region !== undefined && p.venue !== ask.region) return false;
  if (ask.weather !== undefined) {
    if (p.weather === undefined) knowable = false;
    else if (p.weather !== ask.weather) return false;
  }
  if (ask.belt !== undefined) {
    const belts = beltsOf(p);
    if (belts.length === 0) knowable = false;
    else if (!belts.includes(ask.belt)) return false;
  }
  if (ask.crossedTheLine !== undefined) {
    if (!p.fromPlace || !p.toPlace) knowable = false;
    else if (p.fromPlace.lat * p.toPlace.lat < 0 !== ask.crossedTheLine) return false;
  }
  if (ask.throughTheNight !== undefined) {
    if (p.startHour === undefined || p.endHour === undefined) knowable = false;
    else {
      // The world clock wraps, so a passage that ran past midnight ends on a
      // smaller number than it began. Sailed into the dark counts either way.
      const night = p.endHour < p.startHour || (p.startHour < 20 && p.endHour > 20);
      if (night !== ask.throughTheNight) return false;
    }
  }
  return knowable ? true : undefined;
}

/**
 * Where every quest in these packs stands, given this logbook.
 *
 * Nothing is stored: the logbook is the record and this is a function of it,
 * so deleting a passage takes back what it completed and no flag anywhere can
 * drift from the book.
 *
 * Oldest first inside, whatever order the store hands over, so `doneAt` is
 * the passage that *completed* it rather than the newest one that would have.
 */
export function questProgress(
  packs: readonly QuestPack[],
  records: readonly PassageRecord[],
): Progress[] {
  const sailed = [...records].sort((a, b) => a.startedAt - b.startedAt);
  const out: Progress[] = [];

  for (const pack of packs) {
    for (const quest of pack.quests) {
      const counting: Counting = quest.counting ?? { kind: 'once' };
      const needs = counting.kind === 'once' ? 1 : counting.needs;
      let at = 0;
      let doneAt: number | null = null;
      const belts = new Set<string>();

      for (const p of sailed) {
        if (answers(p, quest.ask) !== true) continue;
        if (counting.kind === 'once') at = 1;
        else if (counting.kind === 'passages') at += 1;
        else if (counting.kind === 'total') at += FACTS[counting.fact](p) ?? 0;
        else {
          for (const b of beltsOf(p)) belts.add(b);
          at = belts.size;
        }
        if (doneAt === null && at >= needs) doneAt = p.startedAt;
      }

      out.push({ id: `${pack.id}.${quest.id}`, at, needs, done: doneAt !== null, doneAt });
    }
  }
  return out;
}

/**
 * What was wrong with a pack, in a form the screen can translate.
 *
 * A reason rather than a boolean, because "this file was refused" with no
 * more than that is the worst possible answer to someone who has just
 * written a quest and is trying to find out why it does not work.
 */
export interface PackProblem {
  /** Which check failed. */
  kind:
    | 'notJson'
    | 'notAPack'
    | 'formatTooNew'
    | 'noQuests'
    | 'duplicateId'
    | 'unknownFact'
    | 'unknownField'
    | 'emptyBound'
    | 'noName';
  /** The quest it was found in, where that narrows it down. */
  quest?: string;
  /** The name it did not recognise, for the kinds that have one. */
  named?: string;
}

const ASK_FIELDS = [
  'facts',
  'weather',
  'belt',
  'crossedTheLine',
  'throughTheNight',
  'region',
];
const COUNTING_KINDS = ['once', 'total', 'passages', 'belts'];

/**
 * Read a pack, or say what is wrong with it.
 *
 * This is the security boundary, and the reason the format has no
 * expressions in it: everything below is a check that a *name* is one this
 * build knows. Nothing is ever evaluated, so the worst a hostile file can do
 * is be refused.
 *
 * Refused loudly and at *install* time, never at sailing time. A pack that
 * asked for a fact this build does not have would otherwise sit in the list
 * quietly never completing, and the author would have no way to tell that
 * from a quest that is merely hard.
 *
 * Unknown *fields* are refused too, rather than ignored. Ignoring them is how
 * a pack written for a later build half-works here -- some quests completing
 * and some silently unreachable -- and half-working is worse than refused for
 * a thing whose whole job is to be trusted.
 */
export function readPack(raw: unknown): { pack: QuestPack } | { problem: PackProblem } {
  if (typeof raw !== 'object' || raw === null) return { problem: { kind: 'notAPack' } };
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id || typeof o.name !== 'string' || !Array.isArray(o.quests)) {
    return { problem: { kind: 'notAPack' } };
  }
  if (typeof o.format !== 'number' || o.format > QUEST_FORMAT) {
    return { problem: { kind: 'formatTooNew' } };
  }
  if (o.quests.length === 0) return { problem: { kind: 'noQuests' } };

  const seen = new Set<string>();
  for (const q of o.quests as Record<string, unknown>[]) {
    if (typeof q?.id !== 'string' || !q.id) return { problem: { kind: 'notAPack' } };
    if (seen.has(q.id)) return { problem: { kind: 'duplicateId', quest: q.id } };
    seen.add(q.id);
    // English is the fallback every screen can fall back *to*, so a pack
    // without it has quests that cannot be named at all in some languages.
    const name = q.name as Record<string, string> | undefined;
    if (!name || typeof name.en !== 'string' || !name.en) {
      return { problem: { kind: 'noName', quest: q.id } };
    }
    const ask = q.ask as Record<string, unknown> | undefined;
    if (typeof ask !== 'object' || ask === null) return { problem: { kind: 'notAPack', quest: q.id } };
    for (const field of Object.keys(ask)) {
      if (!ASK_FIELDS.includes(field)) {
        return { problem: { kind: 'unknownField', quest: q.id, named: field } };
      }
    }
    for (const [fact, bound] of Object.entries((ask.facts ?? {}) as Record<string, Bound>)) {
      if (!FACT_NAMES.includes(fact as FactName)) {
        return { problem: { kind: 'unknownFact', quest: q.id, named: fact } };
      }
      // A bound with neither end holds everything, which is a quest that
      // completes on the first passage and reads like a mistake because it is.
      if (bound?.atLeast === undefined && bound?.atMost === undefined) {
        return { problem: { kind: 'emptyBound', quest: q.id, named: fact } };
      }
    }
    const counting = q.counting as Record<string, unknown> | undefined;
    if (counting) {
      if (typeof counting.kind !== 'string' || !COUNTING_KINDS.includes(counting.kind)) {
        return { problem: { kind: 'unknownField', quest: q.id, named: String(counting.kind) } };
      }
      if (counting.kind === 'total' && !FACT_NAMES.includes(counting.fact as FactName)) {
        return { problem: { kind: 'unknownFact', quest: q.id, named: String(counting.fact) } };
      }
    }
  }
  return { pack: raw as QuestPack };
}
