import { describe, expect, it } from 'vitest';
import { CRUISER } from './config';
import { CurrentField } from './current';
import { compassVec, dot } from './math';
import { MAX_ACTIVE_ISLANDS, Terrain } from './terrain';
import { msToKnots } from './units';
import { VENUES, venueById, venueCurrent, type Venue } from './venues';

/**
 * Venues are data, so what there is to test is not arithmetic but whether the
 * data still describes a place worth sailing. A venue that quietly stopped
 * offering its decision would look completely fine and be pointless.
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

/**
 * San Francisco is the venue the tidal field was built for, so it is the one
 * that has to prove the field is worth having.
 */
describe('San Francisco city front', () => {
  const v = venueById('sf')!;
  const { terrain, cur } = fieldFor(v);
  /** Upwind: the direction the beat has to make good. */
  const up = compassVec(v.windTwd);
  /** Knots of stream against the beat at a point. Positive is foul. */
  const foul = (x: number, y: number) => msToKnots(-dot(cur.sample({ x, y }), up));

  it('sets the tide against the beat, which is the whole point of the place', () => {
    // The first layout had the ebb, which runs out of the Gate within twenty
    // degrees of the way a westerly makes you beat -- so it carried the boat
    // towards the mark and there was nothing to escape. This is the regression.
    expect(foul(0, 0)).toBeGreaterThan(1.5);
  });

  it('offers real shelter from the tide inshore', () => {
    const offshore = foul(-190, 0);
    const inshore = foul(-190, -430);
    expect(inshore).toBeLessThan(offshore - 1);
  });

  /**
   * And charges for it. A lane that were only better would not be a decision,
   * it would be the answer, and the venue would be a straight line.
   */
  it('charges wind for the tide it saves', () => {
    const offshore = terrain.windExposure(-190, 0, v.windTwd);
    const inshore = terrain.windExposure(-190, -520, v.windTwd);
    expect(inshore).toBeLessThan(offshore * 0.9);
  });

  it('charges water for it too, without making the lane unusable', () => {
    // Shoaling all the way in, so there is a point past which it is a gamble...
    expect(terrain.depthAt(-190, -430)).toBeLessThan(terrain.depthAt(-190, 0));
    // ...but the useful part of the lane is still afloat for this boat.
    expect(terrain.isAground(-190, -430, CRUISER.draft)).toBe(false);
  });

  it('shoals steadily, so the gamble gets worse rather than arriving at once', () => {
    let last = Infinity;
    for (let y = -300; y >= -600; y -= 40) {
      const d = terrain.depthAt(-190, y);
      expect(d).toBeLessThan(last);
      last = d;
    }
  });

  it('draws its city shore as one landmass, not a row of islands', () => {
    // If the shore were separate islands its wakes would multiply and the
    // inshore lane would be a hole in the wind rather than a lane.
    const shore = v.islands.filter((i) => i.land !== undefined);
    expect(shore.length).toBeGreaterThan(4);
    expect(new Set(shore.map((i) => i.land)).size).toBe(1);
  });
});
