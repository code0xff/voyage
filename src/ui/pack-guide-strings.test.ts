import { describe, expect, it } from 'vitest';
import { BELTS } from '@/sim/climate';
import { COAST_ID } from '@/sim/coast';
import { WEATHER_KINDS } from '@/sim/weather';
import { NOW_FACTS, QUEST_FORMAT, TALLY_FACTS, readPack } from '@/sim/quest';
import { PACK_GUIDE_NAMES, PACK_GUIDE_NOW, PACK_GUIDE_TALLIES } from './pack-guide-strings';

/**
 * The guide claims to list everything a pack may name. This is that claim.
 *
 * It is the one thing about a page of prose that can be checked, and it is
 * the thing that matters: a guide that has fallen behind the reader teaches
 * a pack that will be refused, and a guide that runs ahead of it teaches one
 * that installs and can never complete. Both are silent.
 *
 * **Both directions, and the outward one goes through `readPack`.** Comparing
 * the guide to the same constants the reader is built from would only prove
 * two lists agree; what a reader of the guide is owed is that a pack written
 * from it *installs*. So every name printed here is put in a pack and handed
 * to the real function, and the shared constants are used only for the other
 * direction -- catching a name the world has that the guide has not.
 *
 * The names are quoted in backticks in the guide, which is what makes the
 * claim machine-readable: the markup a reader sees is also the assertion.
 */

/** Every `name` quoted in a string, which is how the guide marks a name. */
const quoted = (text: string): string[] => [...text.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

const meaningOf = (
  section: { terms?: { term: string; meaning: { en: string; ko: string } }[] },
  term: string,
) => section.terms?.find((t) => t.term === term)?.meaning;

/** Would this ask install? The reason, or null when the pack was taken. */
const refusal = (ask: unknown): string | null => {
  const read = readPack({
    format: QUEST_FORMAT,
    id: 'guide',
    name: 'From the guide',
    quests: [{ id: 'q', name: { en: 'x' }, ask }],
  });
  return 'problem' in read ? `${read.problem.kind} ${read.problem.named ?? ''}` : null;
};

describe('the quest pack guide', () => {
  it('prints only names a pack can be installed with', () => {
    for (const field of ['belt', 'weather', 'region']) {
      const meaning = meaningOf(PACK_GUIDE_NAMES, field);
      expect(meaning, field).toBeDefined();
      for (const name of quoted(meaning!.en)) {
        // `""` is how the guide writes the empty string, which is a real
        // world and the one that cannot be printed as itself.
        const value = name === '""' ? '' : name;
        expect(refusal({ now: { [field]: value } }), `${field}: ${name}`).toBeNull();
      }
    }
    // And the assertion above is worth something: a name that is not in the
    // guide is refused, so "everything listed installs" is not vacuous.
    expect(refusal({ now: { weather: 'foggy' } })).toContain('unknownName');
  });

  it('prints a bound the reader accepts for every fact it names', () => {
    for (const [scope, section] of [
      ['now', PACK_GUIDE_NOW],
      ['total', PACK_GUIDE_TALLIES],
    ] as const) {
      for (const { term } of section.terms ?? []) {
        expect(refusal({ [scope]: { facts: { [term]: { atLeast: 1 } } } }), term).toBeNull();
      }
    }
  });

  it('leaves nothing out that the world has', () => {
    // The other direction, and the only one the shared constants can answer:
    // a belt, a weather, a world or a fact that exists and is not written
    // down here is one nobody can use.
    const listed = (field: string) => quoted(meaningOf(PACK_GUIDE_NAMES, field)!.en).sort();
    expect(listed('belt')).toEqual([...BELTS].sort());
    expect(listed('weather')).toEqual([...WEATHER_KINDS].sort());
    expect(listed('region')).toEqual(['""', COAST_ID].sort());
    expect(PACK_GUIDE_NOW.terms?.map((t) => t.term).sort()).toEqual([...NOW_FACTS].sort());
    expect(PACK_GUIDE_TALLIES.terms?.map((t) => t.term).sort()).toEqual([...TALLY_FACTS].sort());
  });

  it('says the same names in both languages', () => {
    // A name is never translated, so the two lists have to be the same list.
    for (const field of ['belt', 'weather', 'region']) {
      const meaning = meaningOf(PACK_GUIDE_NAMES, field)!;
      expect(quoted(meaning.ko).sort(), field).toEqual(quoted(meaning.en).sort());
    }
  });
});
