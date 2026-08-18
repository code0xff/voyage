import { describe, expect, it } from 'vitest';
import { BELTS } from '@/sim/climate';
import { COAST_ID } from '@/sim/coast';
import { REGIONS } from '@/sim/regions';
import { WEATHER_KINDS } from '@/sim/weather';
import { NOW_FACTS, TALLY_FACTS } from '@/sim/quest';
import { PACK_GUIDE_NAMES, PACK_GUIDE_NOW, PACK_GUIDE_TALLIES } from './pack-guide-strings';

/**
 * The guide claims to list everything a pack may name. This is that claim.
 *
 * It is the one thing about a page of prose that can be checked, and it is
 * the thing that matters: a guide that has fallen behind the reader teaches
 * a pack that will be refused, and a guide that lists something the reader
 * has never heard of teaches one that cannot complete. Both are silent, and
 * both are the exact failure `readPack` refuses a file for.
 *
 * The names are compared as sets in both directions, which is why the guide
 * quotes each of them in backticks: the markup a reader sees is also what
 * makes the claim machine-readable.
 */

/** Every `name` quoted in a string, which is how the guide marks a name. */
const quoted = (text: string): string[] => [...text.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

const meaningOf = (
  section: { terms?: { term: string; meaning: { en: string; ko: string } }[] },
  term: string,
) => section.terms?.find((t) => t.term === term)?.meaning;

describe('the quest pack guide', () => {
  it('lists every belt, every weather and every world, and nothing else', () => {
    const expected: Record<string, string[]> = {
      belt: [...BELTS],
      weather: [...WEATHER_KINDS],
      region: ['""', COAST_ID, ...REGIONS.map((r) => r.id)],
    };
    for (const [field, names] of Object.entries(expected)) {
      const meaning = meaningOf(PACK_GUIDE_NAMES, field);
      expect(meaning, field).toBeDefined();
      // Both languages, because a name is not translated and a list that
      // fell behind in one of them is a guide that is wrong for its reader.
      for (const lang of ['en', 'ko'] as const) {
        expect(quoted(meaning![lang]).sort(), `${field} in ${lang}`).toEqual([...names].sort());
      }
    }
  });

  it('has a line for every fact the reader will accept', () => {
    // The other half: a fact that exists and is not written down here is a
    // fact nobody can use.
    expect(PACK_GUIDE_NOW.terms?.map((t) => t.term).sort()).toEqual([...NOW_FACTS].sort());
    expect(PACK_GUIDE_TALLIES.terms?.map((t) => t.term).sort()).toEqual([...TALLY_FACTS].sort());
  });
});
