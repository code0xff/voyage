import { describe, expect, it } from 'vitest';
import { CRUISER } from './config';
import { CurrentField } from './current';
import { compassVec } from './math';
import { MAX_ACTIVE_ISLANDS, Terrain } from './terrain';
import { VENUES, venueById, venueCurrent, type Venue } from './venues';

/**
 * Venues are data, so what there is to test is not arithmetic but whether the
 * data still describes a place worth sailing. A venue that quietly stopped
 * offering its decision would look completely fine and be pointless.
 *
 * There are none today: San Francisco was the only one and it is a surveyed
 * region now. These run vacuously and are kept deliberately -- they are the
 * contract the next venue has to meet, and the cheapest moment to have written
 * them down was while the last one was still here to check them against. What
 * San Francisco used to prove about the tidal field is now proved against the
 * real bay, in region-terrain.test.ts.
 */

const fieldFor = (v: Venue) => {
  const terrain = new Terrain(v.islands);
  const cur = new CurrentField({ peak: venueCurrent(v), fullDepth: v.fullDepth });
  cur.terrain = terrain;
  return { terrain, cur };
};

describe('venues', () => {
  it('all fit in the island window, or the shader would drop land silently', () => {
    // A venue's land is fixed and handed over whole rather than streamed, so
    // anything past the cap is simply not there -- in the water shader first,
    // which would leave a shore that shelters nothing and is not drawn.
    for (const v of VENUES) {
      expect(v.islands.length).toBeLessThanOrEqual(MAX_ACTIVE_ISLANDS);
    }
  });

  it('are found by their own ids and by nothing else', () => {
    for (const v of VENUES) expect(venueById(v.id)).toBe(v);
    expect(venueById('atlantis')).toBeNull();
    expect(venueById('')).toBeNull();
  });

  it('put her to sea in water she can float in', () => {
    // The boat is placed 90 m downwind of the origin, so that is the point that
    // has to be afloat -- a venue whose land had crept over it would open with
    // the boat already aground. Checked where she actually starts rather than
    // at the origin, which is where the race course used to be built.
    for (const v of VENUES) {
      const { terrain } = fieldFor(v);
      const up = compassVec(v.windTwd);
      expect(terrain.isAground(-up.x * 90, -up.y * 90, CRUISER.draft)).toBe(false);
    }
  });
});

