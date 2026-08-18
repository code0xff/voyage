import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  QUEST_FORMAT,
  emptyQuestState,
  questProgress,
  readPack,
  watch,
  type Ask,
  type QuestPack,
  type QuestState,
  type Sample,
} from './quest';

/**
 * Quest packs, as data from a stranger.
 *
 * Two things pull in opposite directions here: a pack has to be able to
 * express something worth sailing to, and a pack must not be able to do
 * anything *else*. The second is why the format has no expressions in it,
 * and why half of this file is about refusals -- a hostile or simply
 * mistaken file has to be turned away at install with a reason, never
 * accepted and then quietly unreachable.
 */

/** A sample of a quiet afternoon, with only what a test cares about changed. */
function sample(over: Partial<Sample> = {}): Sample {
  return {
    place: { lat: 37.8, lon: -122.6 },
    belt: 'westerlies',
    weather: 'fair',
    region: 'coast',
    wind: 12,
    heel: 8,
    sea: 1,
    speed: 5,
    depth: 40,
    hour: 12,
    miles: 0,
    hours: 0,
    whales: 0,
    sharks: 0,
    photographs: 0,
    ...over,
  };
}

/** A pack of one quest, so a test says what it means in one place. */
function pack(ask: Ask, id = 'q'): QuestPack {
  return {
    format: QUEST_FORMAT,
    id: 'test',
    name: 'Test pack',
    quests: [{ id, name: { en: 'A quest' }, ask }],
  };
}

/** Feed samples in order and return everything that completed, in order. */
function sail(p: QuestPack, samples: Sample[]): { done: string[]; state: QuestState } {
  let state = emptyQuestState();
  const done: string[] = [];
  let at = 1_700_000_000_000;
  for (const s of samples) {
    at += 2000;
    const step = watch([p], s, state, at);
    state = step.state;
    done.push(...step.completed);
  }
  return { done, state };
}

describe('watching a quest while she sails', () => {
  it('completes the moment the ask holds, and only once', () => {
    const p = pack({ now: { facts: { wind: { atLeast: 30 } } } });
    const { done } = sail(p, [sample({ wind: 12 }), sample({ wind: 34 }), sample({ wind: 36 })]);
    expect(done).toEqual(['test.q']);
  });

  it('asks for everything at the same sample, which is the whole point', () => {
    // Thirty knots and still on her feet. Two conditions met on two
    // different afternoons is a different and much easier thing, and a
    // format that could not tell them apart would not be worth having.
    const p = pack({ now: { facts: { wind: { atLeast: 30 }, heel: { atMost: 35 } } } });
    const apart = sail(p, [sample({ wind: 34, heel: 48 }), sample({ wind: 10, heel: 5 })]);
    expect(apart.done).toEqual([]);
    const together = sail(p, [sample({ wind: 34, heel: 26 })]);
    expect(together.done).toEqual(['test.q']);
  });

  it('knows where she is, which a logbook summary never could', () => {
    // The reason this is watched rather than read afterwards: passing within
    // fifty miles of the Horn is not something a finished passage records.
    const horn = { lat: -55.98, lon: -67.27 };
    const p = pack({ now: { near: { ...horn, within: 50 } } });
    const past = sail(p, [
      sample({ place: { lat: -50, lon: -67.27 } }),
      sample({ place: { lat: -55.5, lon: -67.4 } }),
    ]);
    expect(past.done).toEqual(['test.q']);
    // Three hundred miles away on the same latitude is not the Horn, which
    // is exactly what a latitude-only quest could not say.
    const wide = sail(p, [sample({ place: { lat: -55.98, lon: -58 } })]);
    expect(wide.done).toEqual([]);
  });

  it('has no place at all in a world that is not on the Earth', () => {
    const p = pack({ now: { near: { lat: 0, lon: 0, within: 100 } } });
    expect(sail(p, [sample({ place: null })]).done).toEqual([]);
    const south = pack({ now: { facts: { south: { atLeast: 40 } } } });
    expect(sail(south, [sample({ place: null })]).done).toEqual([]);
  });

  it('adds up what she does, and starts the passage tally again on a new one', () => {
    const p = pack({ passage: { facts: { miles: { atLeast: 100 } } } });
    const leg = (miles: number, began = false) => sample({ miles, passageBegan: began });
    // Ninety miles, then a new passage: the tally goes back to nothing, so
    // ninety more does not finish the first hundred.
    const restarted = sail(p, [leg(50), leg(40), leg(50, true), leg(40)]);
    expect(restarted.done).toEqual([]);
    expect(restarted.state.passage.miles).toBeCloseTo(90, 6);
    // And the total kept counting through both.
    expect(restarted.state.total.miles).toBeCloseTo(180, 6);
    const straight = sail(p, [leg(50), leg(60)]);
    expect(straight.done).toEqual(['test.q']);
  });

  it('counts the belts she sails through, not the ones she ends in', () => {
    // The fact a summary cannot give: a passage from seventy north to
    // seventy south touches all five, and its two endpoints know one each.
    const p = pack({ passage: { facts: { belts: { atLeast: 5 } } } });
    const through = ['polar', 'westerlies', 'horse', 'trades', 'doldrums'];
    const { done, state } = sail(p, through.map((belt) => sample({ belt })));
    expect(state.passage.belts).toEqual(through);
    expect(done).toEqual(['test.q']);
  });

  it('counts a passage only when one is finished', () => {
    const p = pack({ total: { facts: { passages: { atLeast: 2 } } } });
    const { done, state } = sail(p, [
      sample({ passageBegan: true }),
      sample({ passageFinished: true }),
      sample({ passageBegan: true }),
      sample({ passageFinished: true }),
    ]);
    expect(state.total.passages).toBe(2);
    expect(done).toEqual(['test.q']);
  });

  it('says or with `any`, and still requires the rest', () => {
    const p = pack({
      any: [{ now: { weather: 'fog' } }, { now: { weather: 'squall' } }],
      now: { facts: { wind: { atLeast: 20 } } },
    });
    expect(sail(p, [sample({ weather: 'fog', wind: 10 })]).done).toEqual([]);
    expect(sail(p, [sample({ weather: 'fair', wind: 30 })]).done).toEqual([]);
    expect(sail(p, [sample({ weather: 'squall', wind: 30 })]).done).toEqual(['test.q']);
  });

  it('reports progress for the counted asks and refuses to invent it for the rest', () => {
    const counted = pack({ total: { facts: { miles: { atLeast: 1000 } } } });
    const { state } = sail(counted, [sample({ miles: 240 })]);
    expect(questProgress(counted.quests[0], state)).toEqual({ at: 240, needs: 1000 });
    // A place is a yes or a no. A bar that sat at zero and then jumped would
    // be worse than no bar, so there is none.
    const place = pack({ now: { near: { lat: 0, lon: 0, within: 10 } } });
    expect(questProgress(place.quests[0], state)).toBeNull();
  });
});

describe('reading a pack from a stranger', () => {
  const good = {
    format: QUEST_FORMAT,
    id: 'southern',
    name: 'Southern Ocean',
    quests: [
      {
        id: 'horn',
        name: { en: 'Round the Horn' },
        ask: { now: { near: { lat: -55.98, lon: -67.27, within: 50 } } },
      },
    ],
  };
  const problemOf = (raw: unknown) => {
    const read = readPack(raw);
    return 'problem' in read ? read.problem : null;
  };
  const withAsk = (ask: unknown) => ({
    ...good,
    quests: [{ id: 'q', name: { en: 'x' }, ask }],
  });

  it('takes one that is what it says it is', () => {
    const read = readPack(good);
    expect('pack' in read && read.pack.id).toBe('southern');
  });

  it('refuses anything that is not a pack, without throwing', () => {
    for (const bad of [null, 3, 'southern', [], {}, { format: 1, id: 'x' }]) {
      expect(problemOf(bad), JSON.stringify(bad)).not.toBeNull();
    }
  });

  it('refuses a fact this build does not have, and says which', () => {
    // A pack written against a later build must be turned away at install
    // with the name of the thing it wanted. Accepted and silently
    // unreachable is the failure nobody can diagnose.
    expect(problemOf(withAsk({ now: { facts: { barometer: { atMost: 990 } } } }))).toEqual({
      kind: 'unknownFact',
      quest: 'q',
      named: 'barometer',
    });
    // And a tally fact asked of `now`, which is a different mistake with the
    // same answer.
    expect(problemOf(withAsk({ now: { facts: { miles: { atLeast: 10 } } } }))?.kind).toBe(
      'unknownFact',
    );
  });

  it('refuses a field this build does not have, rather than ignoring it', () => {
    // Ignoring unknown fields is how a pack half-works: some quests complete
    // and some are quietly impossible. Half-working is worse than refused
    // for a thing whose whole job is to be trusted.
    expect(problemOf(withAsk({ whenever: { wind: 30 } }))).toEqual({
      kind: 'unknownField',
      quest: 'q',
      named: 'whenever',
    });
    expect(problemOf(withAsk({ now: { withCrew: 3 } }))?.named).toBe('withCrew');
  });

  it('refuses an ask that asks nothing', () => {
    // It would complete on the first sample, which is never what was meant.
    expect(problemOf(withAsk({}))?.kind).toBe('emptyAsk');
    expect(problemOf(withAsk({ any: [] }))?.kind).toBe('emptyAsk');
  });

  it('refuses a bound with no bound in it', () => {
    expect(problemOf(withAsk({ now: { facts: { wind: {} } } }))?.kind).toBe('emptyBound');
    expect(problemOf(withAsk({ now: { facts: { wind: null } } }))?.kind).toBe('emptyBound');
  });

  it('refuses a place that is not one', () => {
    for (const near of [
      { lat: 91, lon: 0, within: 10 },
      { lat: 0, lon: 200, within: 10 },
      { lat: 0, lon: 0, within: 0 },
      { lat: 0, lon: 0 },
      { lat: '0', lon: 0, within: 10 },
      null,
    ]) {
      expect(problemOf(withAsk({ now: { near } })), JSON.stringify(near)).not.toBeNull();
    }
  });

  it('refuses a number of passages inside one passage', () => {
    // A passage cannot contain a number of passages, and a pack that asked
    // for it would never complete.
    expect(problemOf(withAsk({ passage: { facts: { passages: { atLeast: 2 } } } }))).toEqual({
      kind: 'unknownFact',
      quest: 'q',
      named: 'passages',
    });
  });

  it('checks inside every branch of an or', () => {
    expect(
      problemOf(withAsk({ any: [{ now: { weather: 'fog' } }, { now: { facts: { barometer: { atMost: 1 } } } }] }))
        ?.kind,
    ).toBe('unknownFact');
  });

  it('refuses a format from the future, two quests with one id, and one with no English name', () => {
    expect(problemOf({ ...good, format: QUEST_FORMAT + 1 })?.kind).toBe('formatTooNew');
    expect(problemOf({ ...good, quests: [good.quests[0], good.quests[0]] })?.kind).toBe(
      'duplicateId',
    );
    expect(problemOf({ ...good, quests: [{ id: 'q', name: { ko: '이름' }, ask: good.quests[0].ask }] })?.kind).toBe(
      'noName',
    );
  });

  it('never evaluates anything it was given', () => {
    // The format has no expressions in it, and this is what that means: a
    // pack carrying something that looks like code is refused as an unknown
    // field. It is not run, not parsed further, not coerced.
    const hostile = withAsk({ when: '(() => { throw new Error("ran") })()' });
    expect(problemOf(hostile)?.kind).toBe('unknownField');
  });
});

/**
 * The packs that ship with the game, read and then sailed.
 *
 * They double as the format's documentation -- anyone writing a pack will
 * copy one -- so a shipped pack the reader refuses would be worse than a
 * wrong comment. And reading is not enough: a quest asking for something no
 * sample can carry is a promise the game cannot keep, and the only way to
 * notice is to try to complete it.
 */
describe('the packs that ship with it', () => {
  const dir = new URL('../../public/quests/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const packs = files.map((f) => {
    const read = readPack(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
    if (!('pack' in read)) throw new Error(`${f}: ${JSON.stringify(read.problem)}`);
    return read.pack;
  });

  it('ships some, and reads every one', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(packs.length).toBe(files.length);
  });

  it('can be sailed, every quest of it', () => {
    // One long voyage that answers everything: south past the Horn in a
    // gale, up through every belt, across the line, into fog, close inshore
    // at night, and through Gibraltar.
    let state = emptyQuestState();
    let at = 1_700_000_000_000;
    const feed = (s: Sample) => {
      at += 2000;
      state = watch(packs, s, state, at).state;
    };

    feed(sample({ passageBegan: true, place: { lat: -55.98, lon: -67.27 }, belt: 'westerlies' }));
    // A hundred and twenty miles below forty south, in thirty-four knots,
    // kept on her feet.
    for (let i = 0; i < 12; i++) {
      feed(
        sample({
          place: { lat: -50, lon: -67 },
          belt: 'westerlies',
          wind: 34,
          heel: 26,
          speed: 7,
          miles: 10,
        }),
      );
    }
    feed(sample({ place: { lat: -31, lon: -40 }, belt: 'horse', miles: 10 }));
    feed(sample({ place: { lat: -15, lon: -35 }, belt: 'trades', speed: 7, miles: 40 }));
    feed(sample({ place: { lat: 0.2, lon: -30 }, belt: 'doldrums', speed: 1, miles: 10 }));
    feed(sample({ place: { lat: 70, lon: -20 }, belt: 'polar', miles: 10 }));
    feed(sample({ place: { lat: 35.95, lon: -5.6 }, belt: 'westerlies', weather: 'fog', speed: 4, depth: 12, hour: 23, miles: 10 }));
    // And a thousand miles in the book, over the passages it took.
    for (let i = 0; i < 100; i++) feed(sample({ miles: 10 }));
    feed(sample({ passageFinished: true }));

    for (const p of packs) {
      for (const q of p.quests) {
        const id = `${p.id}.${q.id}`;
        expect(state.done[id] !== undefined, `${id} was never completed`).toBe(true);
      }
    }
  });
});
