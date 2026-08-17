import { describe, expect, it } from 'vitest';
import { BELT_EDGES, beltAt, climateAt, climateSpeed, componentsToTwd } from './climate';

/**
 * The wind belts, against what a pilot chart says.
 *
 * These are not invented numbers to be pinned to themselves: the trades
 * blow from the north-east in one hemisphere and the south-east in the
 * other, the westerlies are the reverse, the Southern Ocean is the windiest
 * water on Earth and the doldrums are the calmest. Every assertion below is
 * one of those facts, which is what makes them worth having -- and which is
 * why the first version of this model failed them, putting the north-east
 * trades in the south-west.
 */

const deg = (rad: number) => (rad * 180) / Math.PI;
const knots = (ms: number) => ms / 0.514444;

describe('the wind belts', () => {
  it('blows the north-east trades from the north-east', () => {
    for (const lat of [10, 15, 20, 25]) {
      const from = deg(climateAt(lat).twd);
      expect(from, `at ${lat}N`).toBeGreaterThan(30);
      expect(from, `at ${lat}N`).toBeLessThan(85);
    }
  });

  it('blows the south-east trades from the south-east', () => {
    for (const lat of [-10, -15, -20, -25]) {
      const from = deg(climateAt(lat).twd);
      expect(from, `at ${-lat}S`).toBeGreaterThan(95);
      expect(from, `at ${-lat}S`).toBeLessThan(150);
    }
  });

  it('turns the wind right round in the westerlies', () => {
    // North: from the south-west. South: from the north-west. Both are
    // "from the west" with the meridional lean reversed, which is the
    // hemisphere rule the trades obey the other way.
    for (const lat of [40, 50, 60]) {
      const from = deg(climateAt(lat).twd);
      expect(from, `at ${lat}N`).toBeGreaterThan(200);
      expect(from, `at ${lat}N`).toBeLessThan(270);
    }
    for (const lat of [-40, -50, -60]) {
      const from = deg(climateAt(lat).twd);
      expect(from, `at ${-lat}S`).toBeGreaterThan(270);
      expect(from, `at ${-lat}S`).toBeLessThan(340);
    }
  });

  it('makes the Southern Ocean the hardest water on the planet', () => {
    // The one asymmetry in the model, and the reason Cape Horn is Cape
    // Horn: the same belt with no continent in its way.
    const north = knots(climateAt(50).tws);
    const south = knots(climateAt(-50).tws);
    expect(south).toBeGreaterThan(north * 1.15);
    expect(south).toBeGreaterThan(25);
  });

  it('empties the doldrums and the horse latitudes', () => {
    // Calm, but never dead: a belt with no wind at all would be a wall
    // across the planet rather than a hard passage.
    for (const lat of [0, 2, -2]) {
      const kn = knots(climateAt(lat).tws);
      expect(kn).toBeGreaterThan(1);
      expect(kn).toBeLessThan(8);
    }
    for (const lat of [31, -31]) {
      expect(knots(climateAt(lat).tws)).toBeLessThan(11);
    }
    // And they are calms *between* winds: the trades either side are far
    // stronger, which is what makes crossing one a decision.
    expect(knots(climateAt(15).tws)).toBeGreaterThan(knots(climateAt(0).tws) * 2);
    expect(knots(climateAt(15).tws)).toBeGreaterThan(knots(climateAt(31).tws) * 1.5);
  });

  it('changes belt without a step in the wind', () => {
    // The seams are days of sailing, not lines: crossing one, neither the
    // speed nor the direction may jump. Walked at a tenth of a degree --
    // about six miles -- either side of every boundary.
    for (const edge of [...BELT_EDGES, ...BELT_EDGES.map((e) => -e)]) {
      for (const side of [-0.1, 0.1]) {
        const a = climateAt(edge + side - 0.1);
        const b = climateAt(edge + side + 0.1);
        expect(Math.abs(knots(a.tws) - knots(b.tws)), `speed at ${edge}`).toBeLessThan(2);
        const turn = Math.abs(deg(a.twd) - deg(b.twd));
        expect(Math.min(turn, 360 - turn), `direction at ${edge}`).toBeLessThan(20);
      }
    }
  });

  it('names the belt by where you are, not by how hard it blows', () => {
    expect(beltAt(0)).toBe('doldrums');
    expect(beltAt(-20)).toBe('trades');
    expect(beltAt(31)).toBe('horse');
    expect(beltAt(-45)).toBe('westerlies');
    expect(beltAt(70)).toBe('polar');
    // Symmetric: the same latitude north and south is the same belt, even
    // though the southern one blows harder.
    for (const lat of [0, 12, 31, 45, 70]) expect(beltAt(-lat)).toBe(beltAt(lat));
  });

  it('reads a bearing the way a compass does', () => {
    // North is 0 and east is 90, so the arguments go (fromEast, fromNorth).
    // Reversed -- which is the mistake this model made -- a north-east
    // trade comes out of the south-west.
    expect(deg(componentsToTwd(0, 1))).toBeCloseTo(0, 6);
    expect(deg(componentsToTwd(1, 0))).toBeCloseTo(90, 6);
    expect(deg(componentsToTwd(0, -1))).toBeCloseTo(180, 6);
    expect(deg(componentsToTwd(-1, 0))).toBeCloseTo(270, 6);
    expect(deg(componentsToTwd(1, 1))).toBeCloseTo(45, 6);
  });

  it('scales the player\'s own wind rather than replacing it', () => {
    // The setting still means something: a slider at 25 knots is a hard
    // sail everywhere. What the belts decide is the *shape* -- the doldrums
    // always softer than the setting, the southern westerlies always
    // harder.
    const setting = 12 * 0.514444;
    expect(knots(climateSpeed(setting, climateAt(15)))).toBeCloseTo(12, 0);
    expect(knots(climateSpeed(setting, climateAt(0)))).toBeLessThan(6);
    expect(knots(climateSpeed(setting, climateAt(-50)))).toBeGreaterThan(18);
    // And a harder setting is harder everywhere, belts and all.
    const gale = 25 * 0.514444;
    for (const lat of [0, 15, 31, -50]) {
      expect(climateSpeed(gale, climateAt(lat))).toBeGreaterThan(
        climateSpeed(setting, climateAt(lat)),
      );
    }
  });
});
