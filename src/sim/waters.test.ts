import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Earth } from './earth';
import { beltAt } from './climate';
import { coastHeightField } from './coast';
import { CLEAR_DAY } from './weather';
import { WATERS, waterAt, waterById } from './waters';

/**
 * Every departure, against the planet she will actually be sailing.
 *
 * This is the test the list exists for. A coordinate written from memory is
 * a session that opens inside a continent, and three of the first draft's
 * were exactly that -- Iceland, the Falklands and Golfo Nuevo, all of them
 * dry land at the latitude and longitude they were remembered at. Nothing
 * short of asking the raster catches that, so the raster is asked.
 */
const buf = readFileSync(new URL('../../public/terrain/globe-4m.bin', import.meta.url));
const earth = new Earth(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2));

describe('the departures', () => {
  it('is water at every one of them', () => {
    for (const w of WATERS) {
      expect(earth.isLand(w.place), w.id).toBe(false);
    }
  });

  it('stands each one off its coast, near enough to see it', () => {
    for (const w of WATERS) {
      // Signed: negative afloat. Measured over a window wide enough that a
      // place with no land within it reads as saturated rather than as a
      // number, which is the case the upper bound is here to catch.
      const shore = -earth.shorePatch(w.place, 40_000, 2000).at(0, 0);
      // Two and a half kilometres clear, because the coast generator invents
      // up to a kilometre and a half of shoreline on top of the Earth's and
      // the spawn must not land in it. Both numbers are written out: they
      // are the claim, and importing the generator's own constants would
      // make this pass at any value including zero.
      expect(shore, `${w.id} is ${(shore / 1000).toFixed(1)} km off`).toBeGreaterThan(2_500);
      // And eight at the outside. The window she sails in is twenty
      // kilometres square, so a coast twelve off -- which is where these
      // were first put -- is a smudge in one corner or outside it
      // altogether, and every departure opens on an empty sea.
      expect(shore, `${w.id} is ${(shore / 1000).toFixed(1)} km off`).toBeLessThan(8_000);
    }
  });

  it('picks water the Earth itself calls water', () => {
    for (const w of WATERS) {
      const depth = earth.shorePatch(w.place, 5_000, 1000).floor(0, 0);
      // Five metres, and no more is asked of the *coarse* grid: four
      // kilometres off a real coast is a real shelf, and some of these are
      // properly shoal there -- the Golden Gate's own bar reads fourteen.
      // What the boat actually floats in is the generated depth, which the
      // window test above holds to ten metres all round the spawn. This one
      // is only here to refuse a lagoon the grid has rounded into the sea.
      expect(depth, `${w.id} has ${depth.toFixed(0)} m`).toBeGreaterThan(5);
    }
  });

  it('opens each one with a coast in sight and water to sail out of', () => {
    /*
     * The test the list is really for, and the one it did not have: not how
     * far the coarse shoreline is, but what she can actually see when the
     * world is built around her. The first version of this file put every
     * departure twelve kilometres off, which passed a distance check and
     * opened on an empty sea in all eleven -- there was no telling one from
     * another, which is the whole point of having a list.
     *
     * Built exactly as the engine builds it: the Earth's shoreline for this
     * window, handed to the generator, at the window's own origin.
     *
     * Over several seeds, because the game rolls a new one every session and
     * the shoreline detail is drawn from it -- up to a kilometre and a half
     * of wander on top of the Earth's coast. The first version of this test
     * used seed 13 alone and would have passed a departure that opens in
     * eight metres of water on every other seed.
     */
    for (const w of WATERS) {
      const patch = earth.shorePatch(w.place, 10_000);
      for (const seed of [13, 546, 1764]) {
      const { height } = coastHeightField(seed, { x: 0, y: 0 }, patch);
      let land = 0;
      let n = 0;
      for (let x = -9800; x <= 9800; x += 400) {
        for (let y = -9800; y <= 9800; y += 400) {
          n++;
          if (height.elevationAt(x, y) > 0) land++;
        }
      }
      const where = `${w.id} on seed ${seed}`;
      // In sight, which is what this test is named for and what it did not
      // check: land within the distance a clear day reaches. Every departure
      // passed the old test with its coast four kilometres off and the haze
      // stopping at 1.6 km, so all eleven opened on an empty sea.
      let nearest = Infinity;
      for (let x = -9800; x <= 9800; x += 100) {
        for (let y = -9800; y <= 9800; y += 100) {
          if (height.elevationAt(x, y) > 0) nearest = Math.min(nearest, Math.hypot(x, y));
        }
      }
      expect(nearest, `${where}: nearest land is ${(nearest / 1000).toFixed(1)} km`).toBeLessThan(
        CLEAR_DAY,
      );
      // A tenth of the window at least: a coast to look at and to sail
      // along, not a rock on the horizon.
      expect(land / n, `${where} shows ${((land / n) * 100).toFixed(1)}% land`).toBeGreaterThan(0.1);
      // And not so much that she is in a bay with no way out.
      expect(land / n, `${where} shows ${((land / n) * 100).toFixed(1)}% land`).toBeLessThan(0.6);
      // Ten metres of water all round the spawn, out to where she has
      // gathered way -- the same promise, at the same radii, that
      // `coast.test.ts` makes of every seed on the open coast. Written out
      // rather than imported for the reason given there: it is the claim.
      for (let a = 0; a < 12; a++) {
        for (const r of [0, 90, 200, 300]) {
          const x = Math.sin((a / 12) * Math.PI * 2) * r;
          const y = Math.cos((a / 12) * Math.PI * 2) * r;
          expect(-height.elevationAt(x, y), `${where} at ${r} m`).toBeGreaterThan(10);
        }
      }
      }
    }
  }, 60_000);

  it('covers the belts rather than ten versions of one sea', () => {
    // The point of the planet is that the seas differ, so a list that was
    // all temperate coast would be a list of scenery. Four of the five
    // belts, and both hemispheres.
    const belts = new Set(WATERS.map((w) => beltAt(w.place.lat)));
    expect(belts.size).toBeGreaterThanOrEqual(4);
    // The two that are a *condition* rather than a coast, and the two the
    // planet was opened for: a place where the wind goes out, and one where
    // it never does.
    expect(belts.has('doldrums')).toBe(true);
    expect(WATERS.some((w) => w.place.lat < -50)).toBe(true);
    expect(WATERS.some((w) => w.place.lat > 20)).toBe(true);
    expect(WATERS.some((w) => w.place.lat < -20)).toBe(true);
    // And all round the world, not one ocean: east and west of both the
    // prime meridian and the date line's neighbourhood.
    expect(WATERS.some((w) => w.place.lon > 100)).toBe(true);
    expect(WATERS.some((w) => w.place.lon < -100)).toBe(true);
  });

  it('has no two departures in the same water, and no repeated id', () => {
    const ids = new Set(WATERS.map((w) => w.id));
    expect(ids.size).toBe(WATERS.length);
    for (const w of WATERS) {
      const others = WATERS.filter((o) => o !== w);
      for (const o of others) {
        const km = Math.hypot(o.place.lat - w.place.lat, o.place.lon - w.place.lon) * 111;
        expect(km, `${w.id} and ${o.id}`).toBeGreaterThan(50);
      }
    }
  });

  it('recognises a position as being at one, and only nearby', () => {
    const cadiz = waterById('cadiz')!;
    expect(waterAt(cadiz.place)?.id).toBe('cadiz');
    // A mile off is still Cádiz; twenty is the open sea.
    expect(waterAt({ lat: cadiz.place.lat + 0.01, lon: cadiz.place.lon })?.id).toBe('cadiz');
    expect(waterAt({ lat: cadiz.place.lat + 0.2, lon: cadiz.place.lon })).toBeNull();
    expect(waterById('nowhere')).toBeNull();
  });
});
