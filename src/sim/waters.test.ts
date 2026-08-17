import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Earth } from './earth';
import { beltAt } from './climate';
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
      // Five kilometres clear, because the coast generator invents up to a
      // kilometre and a half of shoreline on top of the Earth's and the
      // spawn must not land in it. Both numbers are written out: they are
      // the claim, and importing the generator's own constants would make
      // this pass at any value including zero.
      expect(shore, `${w.id} is ${(shore / 1000).toFixed(1)} km off`).toBeGreaterThan(5_000);
      // And thirty at the outside, so there is a coast in the window she
      // sails in rather than an empty sea with a name on it.
      expect(shore, `${w.id} is ${(shore / 1000).toFixed(1)} km off`).toBeLessThan(30_000);
    }
  });

  it('gives her water under the keel at every one', () => {
    for (const w of WATERS) {
      const depth = earth.shorePatch(w.place, 5_000, 1000).floor(0, 0);
      // Twenty metres: past any shoal the coarse grid could be hiding, and
      // deeper than the boat's draft by an order.
      expect(depth, w.id).toBeGreaterThan(20);
    }
  });

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
