import { wrap2Pi } from './math';

/**
 * The Earth, and the flat sheet the boat sails on.
 *
 * Everything else in `src/sim` works in metres on a plane: x east, y north,
 * distances by Pythagoras. That is exactly right inside a twenty-kilometre
 * window and exactly wrong across an ocean, and this file is the whole of the
 * reconciliation between the two.
 *
 * The arrangement is a **tangent plane anchored somewhere real**. A session
 * carries an anchor -- a latitude and longitude -- and the sim's (x, y) are
 * metres east and north *of that anchor*. Near it the plane and the globe
 * agree to within centimetres; far from it they do not, so the anchor moves
 * with the boat (see `reanchor`), the same trick the coast's sliding window
 * plays with its raster and for the same reason: keep the interesting part
 * of the world under a coordinate system that is honest there.
 *
 * What that buys, and what it costs. The physics, the waves, the terrain, the
 * chart and the logbook go on thinking in plane metres and none of them need
 * to change. In exchange, a passage that crosses a continent's worth of ocean
 * is a sequence of planes rather than one, and anything that stores a *plane*
 * position across a re-anchoring has to be moved with it -- which is why the
 * conversion below is exported as a pair rather than hidden.
 *
 * No projection library, no ellipsoid. A sphere of the IUGG mean radius is
 * good to a few parts in a thousand over any distance a boat covers in a day,
 * which is far inside the error of everything else here -- and unlike an
 * ellipsoid it can be read and checked by anyone.
 */

/** m. The IUGG mean radius; see the note above on why a sphere. */
export const EARTH_RADIUS = 6_371_008.8;

/** A place on the Earth, in degrees. */
export interface LatLon {
  lat: number;
  lon: number;
}

const DEG = Math.PI / 180;

/** Metres per degree of latitude. Constant on a sphere, which is half the point. */
export const METRES_PER_DEG_LAT = (EARTH_RADIUS * Math.PI) / 180;

/**
 * Metres per degree of longitude at this latitude.
 *
 * The cosine is the whole of why a plane cannot cover a planet: at 60 degrees
 * a degree of longitude is half what it is at the equator, and at the pole it
 * is nothing at all.
 */
export function metresPerDegLon(lat: number): number {
  return METRES_PER_DEG_LAT * Math.cos(lat * DEG);
}

/**
 * Where a plane position sits on the Earth.
 *
 * The inverse of `toPlane`, and its exact inverse at the anchor. The
 * longitude is wrapped into (-180, 180] so that a boat sailing west out of
 * the date line arrives at +179 rather than at -181, which is what every
 * chart and every readout expects.
 */
export function toLatLon(anchor: LatLon, x: number, y: number): LatLon {
  const lat = anchor.lat + y / METRES_PER_DEG_LAT;
  // The scale is taken at the *mean* of the two latitudes rather than at the
  // anchor: over a few hundred kilometres north-south the cosine changes
  // enough to bend a straight east-west course, and the mean halves that
  // error for one extra line.
  const perLon = metresPerDegLon((anchor.lat + lat) / 2);
  const lon = anchor.lon + (perLon > 1e-6 ? x / perLon : 0);
  return { lat: clampLat(lat), lon: wrapLon(lon) };
}

/** Where a place on the Earth sits on the plane. The inverse of `toLatLon`. */
export function toPlane(anchor: LatLon, place: LatLon): { x: number; y: number } {
  const dLat = place.lat - anchor.lat;
  // Shortest way round: a point just west of the date line is a short hop
  // from one just east of it, not a lap of the planet.
  const dLon = shortestLonDelta(anchor.lon, place.lon);
  const perLon = metresPerDegLon((anchor.lat + place.lat) / 2);
  return { x: dLon * perLon, y: dLat * METRES_PER_DEG_LAT };
}

/**
 * How far the plane has been stretched at this distance from its anchor, as a
 * fraction: 0 at the anchor, 0.01 where a hundred metres of a ten-kilometre
 * leg has gone astray.
 *
 * This is what decides when to re-anchor, and it is measured rather than
 * guessed: the east-west scale is the term that moves, so the error is the
 * change in the cosine over the latitude travelled.
 */
export function planeError(anchor: LatLon, x: number, y: number): number {
  const here = toLatLon(anchor, x, y);
  const atAnchor = metresPerDegLon(anchor.lat);
  const atHere = metresPerDegLon(here.lat);
  if (atAnchor < 1e-6) return 1;
  return Math.abs(atHere - atAnchor) / atAnchor;
}

/**
 * Carry a plane position from one anchor to another, through the Earth.
 *
 * Everything a session holds in plane metres -- the boat, her destination,
 * the chart's centre, a hand of ports of call -- has to come through here
 * when the anchor moves, and that is deliberately the caller's job: this
 * file cannot know what a session is carrying, and a silent partial move
 * would be far worse than a noisy one.
 *
 * Through the globe rather than by a single offset, which was the first
 * design and is wrong by an amount that matters: the plane's east-west
 * scale is taken at the mean of two latitudes, so the transform is not a
 * translation, and shifting a mark by one vector left it 43 m out over a
 * hundred-kilometre re-anchoring. Two conversions cost nothing at the rate
 * this happens -- once every few hundred kilometres -- and they are exact.
 */
export function reproject(from: LatLon, to: LatLon, x: number, y: number): { x: number; y: number } {
  return toPlane(to, toLatLon(from, x, y));
}

/**
 * Great-circle distance in metres, by the haversine.
 *
 * Not the plane's Pythagoras: this is the one a passage across an ocean is
 * actually measured by, and the difference between the two over a thousand
 * miles is tens of miles. Haversine rather than the law of cosines because
 * the latter loses its precision at exactly the short distances a chart cares
 * about.
 */
export function greatCircle(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = shortestLonDelta(a.lon, b.lon) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * The initial great-circle bearing from one place to another, compass rad.
 *
 * *Initial*, and that word is the whole difference from a rhumb line: a great
 * circle changes its bearing as it goes, which is why a course to steer and a
 * course made good are not the same thing on a long passage.
 */
export function initialBearing(a: LatLon, b: LatLon): number {
  const dLon = shortestLonDelta(a.lon, b.lon) * DEG;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return wrap2Pi(Math.atan2(y, x));
}

/** Degrees of longitude from a to b, by the short way round. */
export function shortestLonDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** Fold a longitude into (-180, 180]. */
export function wrapLon(lon: number): number {
  const d = ((lon + 180) % 360 + 360) % 360;
  return d - 180 === -180 ? 180 : d - 180;
}

/**
 * Hold a latitude inside the poles.
 *
 * Clamped rather than wrapped: sailing over the pole and coming down the far
 * side is a real thing on a globe and a nonsense on this plane, whose y axis
 * would have to reverse. The clamp is a wall, and it is the one place in the
 * world model that has one -- which is worth saying out loud rather than
 * discovering at 89 degrees north.
 */
export function clampLat(lat: number): number {
  return Math.max(-89.5, Math.min(89.5, lat));
}

/** For a readout: 37°49.5'N, 122°25.8'W. */
export function formatLatLon(p: LatLon): string {
  const one = (v: number, pos: string, neg: string) => {
    const hemi = v >= 0 ? pos : neg;
    const abs = Math.abs(v);
    const deg = Math.floor(abs);
    const min = (abs - deg) * 60;
    return `${deg}°${min.toFixed(1)}'${hemi}`;
  };
  return `${one(p.lat, 'N', 'S')} ${one(p.lon, 'E', 'W')}`;
}
