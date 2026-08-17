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

  it('has no step in it anywhere, at any latitude', () => {
    /*
     * The one below walks the belt edges, which is where a step was expected
     * -- and a review found one at 3 degrees, where nothing was expected at
     * all: inside the doldrums every component was zero and the bearing fell
     * through to due north, then snapped 66 degrees the moment a boat crossed
     * out of them.
     *
     * So this walks the whole globe, and it tests continuity the only way
     * that cannot be argued with: a continuous function's worst jump halves
     * when the step halves, and a discontinuity's does not. That also lets
     * the honest fast rotation at the subtropical ridge through -- the wind
     * there really does swing round through south as the ridge is crossed,
     * over 7 knots of breeze -- while still failing a genuine jump.
     */
    const worst = (step: number) => {
      let most = 0;
      for (let lat = -90; lat + step <= 90; lat += step) {
        const a = deg(climateAt(lat).twd);
        const b = deg(climateAt(lat + step).twd);
        most = Math.max(most, Math.abs(((a - b + 540) % 360) - 180));
      }
      return most;
    };
    const coarse = worst(0.2);
    const fine = worst(0.1);
    expect(fine).toBeLessThan(coarse * 0.65);
    // And nothing anywhere turns the wind right round in six miles.
    expect(fine).toBeLessThan(60);
  });

  it('blows from the east where the two trades meet', () => {
    // The doldrums are where the north-east and the south-east trades
    // cancel, so what is left is easterly -- and it must arrive there by
    // swinging through, not by falling back to a default. It read due north
    // for the whole belt before a review asked.
    expect(deg(climateAt(0).twd)).toBeCloseTo(90, 0);
    expect(deg(climateAt(2).twd)).toBeGreaterThan(70);
    expect(deg(climateAt(2).twd)).toBeLessThan(90);
    expect(deg(climateAt(-2).twd)).toBeGreaterThan(90);
    expect(deg(climateAt(-2).twd)).toBeLessThan(110);
  });

  it('turns the polar easterlies round with the hemisphere', () => {
    // North-east in the north and south-east in the south, like the trades
    // and for the same reason: the surface flow runs away from the pole. The
    // meridional term was missing outright, so both poles blew due east.
    const north = deg(climateAt(75).twd);
    const south = deg(climateAt(-75).twd);
    expect(north).toBeGreaterThan(30);
    expect(north).toBeLessThan(85);
    expect(south).toBeGreaterThan(95);
    expect(south).toBeLessThan(150);
    // Mirrored about due east, to within a degree.
    expect(Math.abs(north + south - 180)).toBeLessThan(1);
  });

  it('gives the south its extra wind in the westerlies and nowhere else', () => {
    // The Southern Ocean is the model's single asymmetry. Applied to the
    // whole blended term it also fell on the horse latitudes underneath,
    // which made the southern subtropical high blow a quarter harder than
    // the northern one -- a claim no pilot chart makes, and the opposite of
    // what this file says about itself.
    for (const lat of [0, 10, 20, 25, 31]) {
      expect(knots(climateAt(lat).tws), `${lat} vs ${-lat}`).toBeCloseTo(
        knots(climateAt(-lat).tws),
        6,
      );
    }
    // And in the westerlies proper it is there, a quarter of it.
    expect(knots(climateAt(-50).tws) / knots(climateAt(50).tws)).toBeCloseTo(1.25, 2);
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
