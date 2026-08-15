import { describe, expect, it } from 'vitest';
import { anchorage } from './anchorage';
import { CALL_COUNT, CALL_RANGE_MAX, CALL_RANGE_MIN, offerCalls } from './calls';
import { coastHeightField } from './coast';
import { CRUISER } from './config';
import { RegionTerrain } from './region-terrain';
import { EMPTY_TERRAIN } from './terrain';
import { wrapPi } from './math';

/**
 * The offer, held to its one load-bearing promise: every place it deals can
 * actually be completed. The judge in every assertion is `anchorage()` itself
 * -- the same function that will judge the anchor when it is let go -- because
 * a restatement of the depth rules here would only prove the offer agrees
 * with a copy.
 */

const coast = (seed: number) => {
  const { region, height } = coastHeightField(seed);
  return new RegionTerrain(region, height);
};

const AT = { x: 0, y: 0 };

describe('an offer of ports of call', () => {
  it('deals only places the anchor can really be let go', () => {
    for (const seed of [13, 546, 1885135]) {
      const terrain = coast(seed);
      for (const twd of [0, 2.2]) {
        for (const pos of offerCalls(terrain, CRUISER, AT, twd, seed, 0)) {
          expect(anchorage(terrain, CRUISER, pos, 0, twd).canAnchor).toBe(true);
        }
      }
    }
  });

  it('keeps every place inside the offered range', () => {
    for (const pos of offerCalls(coast(13), CRUISER, AT, 0, 13, 0)) {
      const d = Math.hypot(pos.x, pos.y);
      expect(d).toBeGreaterThanOrEqual(CALL_RANGE_MIN);
      expect(d).toBeLessThanOrEqual(CALL_RANGE_MAX);
    }
  });

  it('deals the same hand twice, and a fresh one for the next offer', () => {
    const terrain = coast(13);
    expect(offerCalls(terrain, CRUISER, AT, 0, 13, 0)).toEqual(
      offerCalls(terrain, CRUISER, AT, 0, 13, 0),
    );
    const first = offerCalls(terrain, CRUISER, AT, 0, 13, 0);
    const next = offerCalls(terrain, CRUISER, AT, 0, 13, 1);
    expect(next.length).toBeGreaterThan(0);
    // Not merely a permutation: the next hand holds somewhere new.
    expect(
      next.some((p) => first.every((q) => Math.hypot(p.x - q.x, p.y - q.y) > 1)),
    ).toBe(true);
  });

  it('never deals two places that are one decision written twice', () => {
    const picks = offerCalls(coast(1885135), CRUISER, AT, 0, 1885135, 0);
    expect(picks.length).toBeGreaterThan(1);
    for (let i = 0; i < picks.length; i++) {
      for (let j = i + 1; j < picks.length; j++) {
        expect(
          Math.hypot(picks[i].x - picks[j].x, picks[i].y - picks[j].y),
        ).toBeGreaterThanOrEqual(700);
      }
    }
  });

  /**
   * The choice the mode exists to pose: which wind do I take. On a coast that
   * affords it, an offer spans more than one point of sail rather than dealing
   * four copies of the same reach.
   *
   * Seed 733116 with the wind at 2.1 rad is a witness, found by scanning: its
   * nearest anchorable water all lies on one point of sail, so an offer built
   * by plain nearest-first collapses to a single leg there while the coast
   * affords two. Seed 13 passed this test with the round-robin deleted, which
   * is a test of nothing.
   */
  it('poses a choice of winds where the coast affords one', () => {
    for (const [seed, twd] of [
      [13, 0],
      [733116, 2.1],
    ] as const) {
      const picks = offerCalls(coast(seed), CRUISER, AT, twd, seed, 0);
      expect(picks.length).toBeGreaterThanOrEqual(3);
      const legs = new Set(
        picks.map((p) => {
          const twa = Math.abs(wrapPi(twd - Math.atan2(p.x, p.y)));
          return twa < Math.PI / 3 ? 0 : twa < (2 * Math.PI) / 3 ? 1 : 2;
        }),
      );
      expect(legs.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('respects the count', () => {
    expect(offerCalls(coast(13), CRUISER, AT, 0, 13, 0).length).toBeLessThanOrEqual(CALL_COUNT);
  });

  /**
   * The empty answer is real. Open ocean with no islands has no anchorable
   * water anywhere -- EMPTY_TERRAIN answers 40 m everywhere, which the anchor
   * refuses as too deep to lie to -- and the offer must say so with an empty
   * hand rather than dealing places nobody can ever complete.
   */
  it('offers nothing where nothing can be anchored', () => {
    expect(offerCalls(EMPTY_TERRAIN, CRUISER, AT, 0, 13, 0)).toEqual([]);
  });
});
