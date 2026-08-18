import type { LatLon } from './globe';

/**
 * Quests: things worth doing, written as data by anyone.
 *
 * The design and the format are set out in `docs/quests.md`. The two
 * decisions that shape this file:
 *
 * **Data, never code.** A quest carrying an expression would mean that
 * installing someone's file runs their program in your browser. The
 * vocabulary is closed -- named facts, two bounds, one combinator -- and a
 * pack naming anything this build does not know is refused when it is
 * installed rather than sitting in the list quietly never completing.
 *
 * **Watched while sailing, not read out of the logbook.** A logbook entry is
 * a summary: it knows where a passage began and ended, and cannot know that
 * she passed within twenty miles of the Horn on the way. Every interesting
 * quest is about something that happened *during* a passage, so the engine
 * samples the world every few seconds and hands it here.
 *
 * Pure and headless like the rest of `src/sim`: samples and tallies in,
 * tallies and completions out. It keeps no state of its own and reads no
 * clock -- the caller stamps completions with the time.
 */

/** The format this build writes and understands. */
export const QUEST_FORMAT = 2;

/** A number held between bounds. At least one end must be given. */
export interface Bound {
  atLeast?: number;
  atMost?: number;
}

/** What is true at this instant. */
export type NowFact =
  /** True wind she is in, knots. */
  | 'wind'
  /** How far she is laid over, degrees, unsigned. */
  | 'heel'
  /** Significant wave height, metres. */
  | 'sea'
  /** Over the ground, knots. */
  | 'speed'
  /** Under the keel, metres. */
  | 'depth'
  /** The world clock, 0 to 24. */
  | 'hour'
  | 'latitude'
  | 'longitude'
  /** How far south or north she is, degrees. Negative the other way. */
  | 'south'
  | 'north';

/** What has piled up, over a passage or over all of them. */
export type TallyFact =
  | 'miles'
  | 'hours'
  | 'whales'
  | 'sharks'
  | 'photographs'
  /** Distinct wind belts sailed through -- the one a summary could not give. */
  | 'belts'
  /** Completed passages. Only ever counted over `total`. */
  | 'passages';

export const NOW_FACTS: NowFact[] = [
  'wind',
  'heel',
  'sea',
  'speed',
  'depth',
  'hour',
  'latitude',
  'longitude',
  'south',
  'north',
];

export const TALLY_FACTS: TallyFact[] = [
  'miles',
  'hours',
  'whales',
  'sharks',
  'photographs',
  'belts',
  'passages',
];

/** Somewhere on the Earth, and how near counts as being there. */
export interface Near {
  lat: number;
  lon: number;
  /** Nautical miles. */
  within: number;
}

export interface NowAsk {
  facts?: Partial<Record<NowFact, Bound>>;
  near?: Near;
  belt?: string;
  weather?: string;
  region?: string;
}

export interface TallyAsk {
  facts?: Partial<Record<TallyFact, Bound>>;
}

/**
 * What a quest asks. Everything named must hold at the same sample, which is
 * what lets one say "a hundred miles into this passage, and standing in past
 * the Horn". `any` is the only way to say *or*.
 */
export interface Ask {
  now?: NowAsk;
  passage?: TallyAsk;
  total?: TallyAsk;
  any?: Ask[];
}

export interface Quest {
  id: string;
  /** Per language. `en` is required and is what every other falls back to. */
  name: Record<string, string>;
  note?: Record<string, string>;
  ask: Ask;
}

export interface QuestPack {
  format: number;
  id: string;
  name: string;
  author?: string;
  quests: Quest[];
}

/**
 * One look at the world, taken every few seconds.
 *
 * The instantaneous values are what they say. The counted ones are *since
 * the last sample*, so the watcher can add them up without the engine
 * keeping a second set of books.
 */
export interface Sample {
  /** Where she is, or null in a world that is not on the Earth. */
  place: LatLon | null;
  /** The wind belt she is in, or null where the belts do not apply. */
  belt: string | null;
  weather: string;
  /** The world: a region id, or '' for the island field. */
  region: string;
  wind: number;
  heel: number;
  sea: number;
  speed: number;
  depth: number;
  hour: number;
  /** Since the previous sample. */
  miles: number;
  hours: number;
  whales: number;
  sharks: number;
  photographs: number;
  /** True on the sample where a passage begins, and where one completes. */
  passageBegan?: boolean;
  passageFinished?: boolean;
}

/** What has piled up. */
export interface Tally {
  miles: number;
  hours: number;
  whales: number;
  sharks: number;
  photographs: number;
  /** Kept as the set itself, because "how many" cannot be added up blindly. */
  belts: string[];
  passages: number;
}

/** Everything the watcher remembers between samples. */
export interface QuestState {
  passage: Tally;
  total: Tally;
  /** Quest id to when it completed, ms since the epoch. */
  done: Record<string, number>;
}

const emptyTally = (): Tally => ({
  miles: 0,
  hours: 0,
  whales: 0,
  sharks: 0,
  photographs: 0,
  belts: [],
  passages: 0,
});

export const emptyQuestState = (): QuestState => ({
  passage: emptyTally(),
  total: emptyTally(),
  done: {},
});

const EARTH_NM = 60; // nautical miles in a degree of latitude, near enough

/** Nautical miles between two places, flat-Earth over the short distances asked about. */
function milesApart(a: LatLon, b: LatLon): number {
  const dLat = (a.lat - b.lat) * EARTH_NM;
  const dLon = (a.lon - b.lon) * EARTH_NM * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

function held(value: number | undefined, bound: Bound): boolean {
  if (value === undefined) return false;
  if (bound.atLeast !== undefined && value < bound.atLeast) return false;
  if (bound.atMost !== undefined && value > bound.atMost) return false;
  return true;
}

function nowValue(fact: NowFact, s: Sample): number | undefined {
  switch (fact) {
    case 'wind':
      return s.wind;
    case 'heel':
      return s.heel;
    case 'sea':
      return s.sea;
    case 'speed':
      return s.speed;
    case 'depth':
      return s.depth;
    case 'hour':
      return s.hour;
    // A world that is not on the Earth has no latitude, and a quest asking
    // for one there is not failed so much as unanswerable -- which comes to
    // the same thing here: it does not hold.
    case 'latitude':
      return s.place?.lat;
    case 'longitude':
      return s.place?.lon;
    case 'south':
      return s.place ? -s.place.lat : undefined;
    case 'north':
      return s.place?.lat;
  }
}

const tallyValue = (fact: TallyFact, t: Tally): number =>
  fact === 'belts' ? t.belts.length : t[fact];

function nowHolds(ask: NowAsk, s: Sample): boolean {
  for (const [fact, bound] of Object.entries(ask.facts ?? {})) {
    if (!held(nowValue(fact as NowFact, s), bound as Bound)) return false;
  }
  if (ask.near) {
    if (!s.place) return false;
    if (milesApart(s.place, ask.near) > ask.near.within) return false;
  }
  if (ask.belt !== undefined && s.belt !== ask.belt) return false;
  if (ask.weather !== undefined && s.weather !== ask.weather) return false;
  if (ask.region !== undefined && s.region !== ask.region) return false;
  return true;
}

function tallyHolds(ask: TallyAsk, t: Tally): boolean {
  for (const [fact, bound] of Object.entries(ask.facts ?? {})) {
    if (!held(tallyValue(fact as TallyFact, t), bound as Bound)) return false;
  }
  return true;
}

/** Does the whole ask hold at this sample? */
export function asks(ask: Ask, s: Sample, state: QuestState): boolean {
  if (ask.any) {
    if (!ask.any.some((branch) => asks(branch, s, state))) return false;
  }
  if (ask.now && !nowHolds(ask.now, s)) return false;
  if (ask.passage && !tallyHolds(ask.passage, state.passage)) return false;
  if (ask.total && !tallyHolds(ask.total, state.total)) return false;
  // An ask with nothing in it holds, and is refused at install for exactly
  // that reason -- see `readPack`.
  return true;
}

/**
 * Fold one sample in, and say what completed on it.
 *
 * The tallies are advanced first, so a quest asking for a hundred miles is
 * answered by the sample that carries the hundredth -- not by the one after
 * it. Completions are stamped by the caller's clock, because `src/sim` does
 * not have one.
 */
export function watch(
  packs: readonly QuestPack[],
  sample: Sample,
  state: QuestState,
  at: number,
): { state: QuestState; completed: string[] } {
  const passage: Tally = sample.passageBegan ? emptyTally() : { ...state.passage, belts: [...state.passage.belts] };
  const total: Tally = { ...state.total, belts: [...state.total.belts] };

  for (const t of [passage, total]) {
    t.miles += sample.miles;
    t.hours += sample.hours;
    t.whales += sample.whales;
    t.sharks += sample.sharks;
    t.photographs += sample.photographs;
    if (sample.belt && !t.belts.includes(sample.belt)) t.belts.push(sample.belt);
  }
  if (sample.passageFinished) total.passages += 1;

  const next: QuestState = { passage, total, done: { ...state.done } };
  const completed: string[] = [];
  for (const pack of packs) {
    for (const quest of pack.quests) {
      const id = `${pack.id}.${quest.id}`;
      if (next.done[id] !== undefined) continue;
      if (!asks(quest.ask, sample, next)) continue;
      next.done[id] = at;
      completed.push(id);
    }
  }
  return { state: next, completed };
}

/**
 * How far along a quest is, for a bar that can move.
 *
 * Only the counted asks can answer this -- "within fifty miles of the Horn"
 * is a yes or a no and pretending otherwise would be a bar that sits at zero
 * and then jumps. The first counted bound found is the one reported, which
 * is the one a quest of that shape is really about.
 */
export function questProgress(
  quest: Quest,
  state: QuestState,
): { at: number; needs: number } | null {
  for (const [scope, tally] of [
    ['passage', state.passage],
    ['total', state.total],
  ] as const) {
    const ask = quest.ask[scope];
    for (const [fact, bound] of Object.entries(ask?.facts ?? {})) {
      const needs = (bound as Bound).atLeast;
      if (needs !== undefined) {
        return { at: Math.min(tallyValue(fact as TallyFact, tally), needs), needs };
      }
    }
  }
  return null;
}

/**
 * What was wrong with a pack, in a form the screen can translate.
 *
 * A reason rather than a boolean, because "refused" with nothing more is the
 * worst possible answer to someone who has just written a quest and is
 * trying to find out why it does not work.
 */
export interface PackProblem {
  kind:
    | 'notAPack'
    | 'formatTooNew'
    | 'noQuests'
    | 'duplicateId'
    | 'unknownFact'
    | 'unknownField'
    | 'emptyBound'
    | 'emptyAsk'
    | 'noName'
    | 'badNear';
  quest?: string;
  named?: string;
}

const ASK_SCOPES = ['now', 'passage', 'total', 'any'];
const NOW_FIELDS = ['facts', 'near', 'belt', 'weather', 'region'];

type Refusal = PackProblem | null;

function checkBounds(
  facts: Record<string, unknown>,
  allowed: readonly string[],
  quest: string,
): Refusal {
  for (const [fact, bound] of Object.entries(facts)) {
    if (!allowed.includes(fact)) return { kind: 'unknownFact', quest, named: fact };
    const b = bound as Bound | null;
    // A bound with neither end holds everything, which is a quest that
    // completes on the first sample and reads like a mistake because it is.
    if (!b || typeof b !== 'object' || (b.atLeast === undefined && b.atMost === undefined)) {
      return { kind: 'emptyBound', quest, named: fact };
    }
  }
  return null;
}

/** One ask, and everything nested inside it. */
function checkAsk(ask: unknown, quest: string): Refusal {
  if (typeof ask !== 'object' || ask === null) return { kind: 'notAPack', quest };
  const a = ask as Record<string, unknown>;
  const fields = Object.keys(a);
  // An ask that asks nothing completes on the first sample, which is never
  // what anyone meant to write.
  if (fields.length === 0) return { kind: 'emptyAsk', quest };
  for (const field of fields) {
    if (!ASK_SCOPES.includes(field)) return { kind: 'unknownField', quest, named: field };
  }
  if (a.now !== undefined) {
    if (typeof a.now !== 'object' || a.now === null) return { kind: 'notAPack', quest };
    const now = a.now as Record<string, unknown>;
    for (const field of Object.keys(now)) {
      if (!NOW_FIELDS.includes(field)) return { kind: 'unknownField', quest, named: field };
    }
    const bad = checkBounds((now.facts ?? {}) as Record<string, unknown>, NOW_FACTS, quest);
    if (bad) return bad;
    if (now.near !== undefined) {
      const near = now.near as Near | null;
      const ok =
        near &&
        typeof near === 'object' &&
        [near.lat, near.lon, near.within].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
        Math.abs(near.lat) <= 90 &&
        Math.abs(near.lon) <= 180 &&
        near.within > 0;
      if (!ok) return { kind: 'badNear', quest };
    }
  }
  for (const scope of ['passage', 'total'] as const) {
    if (a[scope] === undefined) continue;
    if (typeof a[scope] !== 'object' || a[scope] === null) return { kind: 'notAPack', quest };
    const t = a[scope] as Record<string, unknown>;
    for (const field of Object.keys(t)) {
      if (field !== 'facts') return { kind: 'unknownField', quest, named: field };
    }
    const bad = checkBounds((t.facts ?? {}) as Record<string, unknown>, TALLY_FACTS, quest);
    if (bad) return bad;
    // `passages` counts completed passages, which only ever means the whole
    // book: a passage cannot contain a number of passages.
    if (scope === 'passage' && (t.facts as Record<string, unknown>)?.passages !== undefined) {
      return { kind: 'unknownFact', quest, named: 'passages' };
    }
  }
  if (a.any !== undefined) {
    if (!Array.isArray(a.any) || a.any.length === 0) return { kind: 'emptyAsk', quest };
    for (const branch of a.any) {
      const bad = checkAsk(branch, quest);
      if (bad) return bad;
    }
  }
  return null;
}

/**
 * Read a pack, or say what is wrong with it.
 *
 * This is the security boundary, and the reason the format has no
 * expressions in it: everything below checks that a *name* is one this build
 * knows. Nothing is ever evaluated, so the worst a hostile file can do is be
 * refused.
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
    const name = q.name as Record<string, string> | undefined;
    if (!name || typeof name.en !== 'string' || !name.en) {
      return { problem: { kind: 'noName', quest: q.id } };
    }
    const bad = checkAsk(q.ask, q.id);
    if (bad) return { problem: bad };
  }
  return { pack: raw as unknown as QuestPack };
}
