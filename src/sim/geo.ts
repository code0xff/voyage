import type { Region } from './regions';
import type { Vec2 } from './math';

/**
 * Where a place on the earth is, on the world plane.
 *
 * A region's grid is projected UTM, so the world plane *is* the UTM grid with
 * its origin moved to the region centre: world x is metres of easting, world y
 * is metres of northing. That makes this conversion the only thing standing
 * between a latitude and longitude and a position in the simulation.
 *
 * It earns its place twice over. `scripts/fetch-terrain.ts` needs it to ask for
 * the right square of survey data, and the tests need it to state what they are
 * actually checking -- "Alcatraz is above water" is a claim anyone can verify
 * against a chart, where "sample 412, 388 is positive" is a claim about an
 * array. One implementation, so the raster and the assertions about it cannot
 * disagree about where anything is.
 */

/**
 * Forward UTM on the WGS84 ellipsoid.
 *
 * The standard truncated series, accurate to millimetres within a zone -- some
 * five orders of magnitude finer than the 25 m grid it places. Written out
 * rather than taken from a library because it is the only projection this
 * project will ever need, and a dependency to audit and pin is a poor trade for
 * thirty lines that have not changed since 1989.
 */
export function utmForward(lat: number, lon: number, zone: number): Vec2 {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const k0 = 0.9996;
  const lam0 = ((zone * 6 - 183) * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const lam = (lon * Math.PI) / 180;

  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = (e2 / (1 - e2)) * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lam - lam0);
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));

  return {
    x:
      k0 *
        N *
        (A +
          ((1 - T + C) * A ** 3) / 6 +
          ((5 - 18 * T + T ** 2 + 72 * C - (58 * e2) / (1 - e2)) * A ** 5) / 120) +
      500000,
    y:
      k0 *
      (M +
        N *
          Math.tan(phi) *
          (A ** 2 / 2 +
            ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
            ((61 - 58 * T + T ** 2 + 600 * C - (330 * e2) / (1 - e2)) * A ** 6) / 720)),
  };
}

/**
 * A latitude and longitude as a position on the world plane.
 *
 * Note what this does *not* correct for: world north is UTM grid north, which
 * at San Francisco is about 0.35 degrees west of true north. Every bearing the
 * game shows is therefore a grid bearing. That is below the half-degree the
 * compass is read to and far below what a helmsman could hold, and it buys a
 * plane with no distortion inside it -- which is worth more here than an
 * alignment nobody can perceive.
 */
export function worldFromLatLon(region: Region, lat: number, lon: number): Vec2 {
  const p = utmForward(lat, lon, region.utmZone);
  const o = utmForward(region.centre.lat, region.centre.lon, region.utmZone);
  return { x: p.x - o.x, y: p.y - o.y };
}
