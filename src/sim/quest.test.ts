import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUEST_FORMAT, questProgress, readPack, type QuestPack } from './quest';
import { knotsToMs } from './units';
import type { PassageRecord } from './passage';

/**
 * Quest packs, as data from a stranger.
 *
 * Two things are being asserted here and they pull in opposite directions:
 * that a pack can express something worth sailing to, and that a pack cannot
 * do anything *else*. The second is why the format has no expressions in it,
 * and most of this file is about the refusals -- a hostile or simply mistaken
 * file has to be turned away at install with a reason, never accepted and
 * then quietly unreachable.
 */

const NM = 1852;
let stamp = 1_700_000_000_000;

/** A passage, with only the parts a test cares about spelled out. */
function passage(over: Partial<PassageRecord> = {}): PassageRecord {
  stamp += 3_600_000;
  return {
    id: `p${stamp}`,
    startedAt: stamp,
    duration: 3600,
    distance: 6 * NM,
    from: { x: 0, y: 0 },
    to: { x: 100, y: 0 },
    direct: 6 * NM,
    avgSog: knotsToMs(6),
    maxSog: knotsToMs(7),
    venue: 'coast',
    windKnots: 12,
    ...over,
  } as PassageRecord;
}

/** A pack of one quest, so a test can say what it means in one place. */
function pack(quest: Record<string, unknown>): QuestPack {
  return {
    format: QUEST_FORMAT,
    id: 'test',
    name: 'Test pack',
    quests: [{ id: 'q', name: { en: 'A quest' }, ...quest }],
  } as unknown as QuestPack;
}

const only = (p: QuestPack, records: PassageRecord[]) => questProgress([p], records)[0];

describe('a quest pack', () => {
  it('completes on the passage that answered it, and names it by pack', () => {
    const p = pack({ ask: { facts: { miles: { atLeast: 50 } } } });
    const short = only(p, [passage({ distance: 20 * NM })]);
    expect(short.done).toBe(false);
    expect(short.id).toBe('test.q');

    const long = passage({ distance: 60 * NM });
    const later = passage({ distance: 90 * NM });
    const done = only(p, [long, later]);
    expect(done.done).toBe(true);
    // The one that completed it, not the newest that would have.
    expect(done.doneAt).toBe(long.startedAt);
  });

  it('asks for everything on the same passage, which is the whole point', () => {
    // Thirty knots and still on her feet: two facts about one passage. Two
    // separate quests could be satisfied by two separate days, and that is a
    // different and much easier thing.
    const p = pack({ ask: { facts: { wind: { atLeast: 30 }, heel: { atMost: 35 } } } });
    const apart = [
      passage({ windKnots: 34, maxHeel: 0.9 }),
      passage({ windKnots: 10, maxHeel: 0.2 }),
    ];
    expect(only(p, apart).done).toBe(false);
    expect(only(p, [passage({ windKnots: 34, maxHeel: 0.4 })]).done).toBe(true);
  });

  it('learns nothing from a passage that cannot say, rather than counting it against', () => {
    // Records written before a field existed leave it out. A quest about
    // whales is not *failed* by a passage that never counted them -- and it
    // is not completed by one either.
    const p = pack({ ask: { facts: { whales: { atLeast: 1 } } } });
    expect(only(p, [passage()]).done).toBe(false);
    expect(only(p, [passage({ sightings: { whales: 0, sharks: 0 } })]).done).toBe(false);
    expect(only(p, [passage({ sightings: { whales: 2, sharks: 0 } })]).done).toBe(true);
  });

  it('does not let a passage that went nowhere have a shape', () => {
    // `wandering` is track over straight line, and a passage with no straight
    // line at all would divide by zero -- which compares true against any
    // bound and completes a quest on a boat that never moved.
    const p = pack({ ask: { facts: { wandering: { atMost: 1.2 } } } });
    expect(only(p, [passage({ distance: 0, direct: 0 })]).done).toBe(false);
    expect(only(p, [passage({ distance: 11 * NM, direct: 10 * NM })]).done).toBe(true);
  });

  it('totals a fact across the passages that answered', () => {
    const p = pack({
      ask: { facts: { miles: { atLeast: 10 } } },
      counting: { kind: 'total', fact: 'miles', needs: 100 },
    });
    const book = [
      passage({ distance: 40 * NM }),
      // Under the ask, so it does not count towards the total either.
      passage({ distance: 5 * NM }),
      passage({ distance: 40 * NM }),
    ];
    expect(only(p, book).at).toBeCloseTo(80, 6);
    expect(only(p, book).done).toBe(false);
    expect(only(p, [...book, passage({ distance: 30 * NM })]).done).toBe(true);
  });

  it('counts belts by where the passages were, not by how many there were', () => {
    const p = pack({ ask: {}, counting: { kind: 'belts', needs: 3 } });
    const at = (lat: number) => passage({ fromPlace: { lat, lon: 0 }, toPlace: { lat, lon: 1 } });
    // Three passages, two belts: the same belt twice is still one.
    expect(only(p, [at(15), at(20), at(-45)]).at).toBe(2);
    expect(only(p, [at(15), at(-45), at(1)]).at).toBe(3);
    expect(only(p, [at(15), at(-45), at(1)]).done).toBe(true);
  });

  it('reads the night off the world clock, midnight included', () => {
    const p = pack({ ask: { throughTheNight: true } });
    expect(only(p, [passage({ startHour: 20.5, endHour: 4 })]).done).toBe(true);
    expect(only(p, [passage({ startHour: 9, endHour: 15 })]).done).toBe(false);
  });

  it('forgets what a deleted passage completed', () => {
    // The reason nothing is stored. The logbook is the record and this is a
    // function of it, so removing the passage removes what it earned rather
    // than leaving a claim nothing supports.
    const p = pack({ ask: { facts: { sea: { atLeast: 4 } } } });
    expect(only(p, [passage({ maxSea: 4.5 })]).done).toBe(true);
    expect(only(p, []).done).toBe(false);
  });
});

describe('reading a pack from a stranger', () => {
  const good = {
    format: QUEST_FORMAT,
    id: 'southern',
    name: 'Southern Ocean',
    quests: [{ id: 'horn', name: { en: 'Round the Horn' }, ask: { facts: { south: { atLeast: 55 } } } }],
  };

  it('takes one that is what it says it is', () => {
    const read = readPack(good);
    expect('pack' in read && read.pack.id).toBe('southern');
  });

  it('refuses anything that is not a pack, without throwing', () => {
    for (const bad of [null, 3, 'southern', [], {}, { format: 1, id: 'x' }]) {
      const read = readPack(bad);
      expect('problem' in read, JSON.stringify(bad)).toBe(true);
    }
  });

  it('refuses a fact this build does not have, and says which', () => {
    // The security-relevant one. A pack written against a later build must be
    // turned away at install with the name of the thing it wanted -- accepted
    // and silently unreachable is the failure that cannot be diagnosed.
    const read = readPack({
      ...good,
      quests: [{ id: 'q', name: { en: 'x' }, ask: { facts: { barometer: { atMost: 990 } } } }],
    });
    expect('problem' in read && read.problem.kind).toBe('unknownFact');
    expect('problem' in read && read.problem.named).toBe('barometer');
  });

  it('refuses a field this build does not have, rather than ignoring it', () => {
    // Ignoring unknown fields is how a pack half-works: some quests complete
    // and some are quietly impossible. Half-working is worse than refused for
    // a thing whose whole job is to be trusted.
    const read = readPack({
      ...good,
      quests: [{ id: 'q', name: { en: 'x' }, ask: { withCrew: 3 } }],
    });
    expect('problem' in read && read.problem.kind).toBe('unknownField');
    expect('problem' in read && read.problem.named).toBe('withCrew');
  });

  it('refuses a bound with no bound in it', () => {
    const read = readPack({
      ...good,
      quests: [{ id: 'q', name: { en: 'x' }, ask: { facts: { miles: {} } } }],
    });
    expect('problem' in read && read.problem.kind).toBe('emptyBound');
  });

  it('refuses a format from the future', () => {
    const read = readPack({ ...good, format: QUEST_FORMAT + 1 });
    expect('problem' in read && read.problem.kind).toBe('formatTooNew');
  });

  it('refuses two quests with one id, and one with no English name', () => {
    const twice = readPack({
      ...good,
      quests: [good.quests[0], { ...good.quests[0], name: { en: 'again' } }],
    });
    expect('problem' in twice && twice.problem.kind).toBe('duplicateId');
    const unnamed = readPack({
      ...good,
      quests: [{ id: 'q', name: { ko: '이름' }, ask: {} }],
    });
    expect('problem' in unnamed && unnamed.problem.kind).toBe('noName');
  });

  it('never evaluates anything it was given', () => {
    // The format has no expressions in it, and this is what that means: a
    // pack carrying something that *looks* like code is refused as an unknown
    // field, not run, not parsed further, not touched.
    let ran = false;
    const hostile = {
      ...good,
      quests: [
        {
          id: 'q',
          name: {
            get en() {
              ran = true;
              return 'x';
            },
          },
          ask: { when: '(() => { throw new Error("ran") })()' },
        },
      ],
    };
    const read = readPack(hostile);
    expect('problem' in read && read.problem.kind).toBe('unknownField');
    // The getter above is the test's own tripwire: reading a name is fine,
    // but nothing in the ask is ever executed or coerced.
    expect(ran).toBe(true);
  });
});

/**
 * The packs that ship with the game, read the way an installed one is.
 *
 * They are the format's own documentation -- someone writing a pack will
 * copy one of these -- so a shipped pack that the reader refuses would be
 * worse than a wrong comment. Read from disk rather than from a fixture,
 * because what has to be valid is the file, not a copy of it.
 */
describe('the packs that ship with it', () => {
  const dir = new URL('../../public/quests/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

  it('ships some', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('reads every one of them', () => {
    for (const file of files) {
      const raw = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
      const read = readPack(raw);
      expect('pack' in read, `${file}: ${JSON.stringify('problem' in read && read.problem)}`).toBe(
        true,
      );
    }
  });

  it('is sailed, not simply held', () => {
    // Every shipped quest has to be completable by something the logbook can
    // actually contain. A quest asking for what no passage can record would
    // be a promise the game cannot keep, and there is no way to notice that
    // except by trying to complete it.
    const packs = files.map((f) => {
      const read = readPack(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
      if (!('pack' in read)) throw new Error(`${f} did not read`);
      return read.pack;
    });
    const book: PassageRecord[] = [];
    // A long hard leg in the far south, through the night, in fog, across
    // the line, in every belt -- one book that answers everything.
    // Every belt has to be in here, the polar one included -- it is past
    // sixty degrees, which is the whole reason it does not belong in a pack
    // called First miles.
    for (const lat of [70, 55.5, 31, 15, 1]) {
      book.push(
        passage({
          distance: 300 * NM,
          // A track a tenth longer than the straight line: sailed, not
          // wandered. The default fixture leaves `direct` at six miles,
          // which makes every one of these a 50x meander.
          direct: 273 * NM,
          windKnots: 34,
          maxHeel: 0.4,
          maxSea: 5,
          startHour: 20.5,
          endHour: 4,
          weather: 'fog',
          avgSog: knotsToMs(lat === 1 ? 2 : 7),
          fromPlace: { lat: -lat, lon: 20 },
          toPlace: { lat: lat === 1 ? 1 : -lat, lon: 21 },
          sightings: { whales: 3, sharks: 1 },
          photographs: 4,
        }),
      );
    }
    for (const p of questProgress(packs, book)) {
      expect(p.done, `${p.id} stands at ${p.at} of ${p.needs}`).toBe(true);
    }
  });
});
