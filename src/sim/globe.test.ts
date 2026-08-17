import { describe, expect, it } from 'vitest';
import {
  METRES_PER_DEG_LAT,
  PLANE_DOMAIN,
  formatLatLon,
  greatCircle,
  initialBearing,
  metresPerDegLon,
  planeError,
  reproject,
  shortestLonDelta,
  toLatLon,
  toPlane,
  wrapLon,
} from './globe';

/**
 * The join between a round Earth and a flat sim.
 *
 * Asserted against arithmetic that can be checked by hand or against
 * published distances -- never against a second copy of the same formula.
 * The conversions are the kind of code where a sign or a cosine in the wrong
 * place is invisible until a boat is a hundred miles from where the chart
 * says, which is exactly the failure mode `eye.test.ts` exists for on the
 * other side of the project.
 */

/** A few real places, for the sums that have known answers. */
const GOLDEN_GATE = { lat: 37.82, lon: -122.48 };
const NEWPORT = { lat: 41.49, lon: -71.31 };
const EQUATOR = { lat: 0, lon: 0 };

describe('the plane and the globe', () => {
  it('round-trips a position through the plane', () => {
    for (const anchor of [GOLDEN_GATE, NEWPORT, EQUATOR, { lat: -33.87, lon: 151.21 }]) {
      for (const [x, y] of [
        [0, 0],
        [1200, -800],
        [-45_000, 30_000],
      ]) {
        const back = toPlane(anchor, toLatLon(anchor, x, y));
        expect(back.x).toBeCloseTo(x, 3);
        expect(back.y).toBeCloseTo(y, 3);
      }
    }
  });

  it('puts north up and east right', () => {
    // The sign convention the whole sim rests on, stated where the Earth
    // enters it: +y is north, +x is east.
    const north = toLatLon(GOLDEN_GATE, 0, 10_000);
    const east = toLatLon(GOLDEN_GATE, 10_000, 0);
    expect(north.lat).toBeGreaterThan(GOLDEN_GATE.lat);
    expect(north.lon).toBeCloseTo(GOLDEN_GATE.lon, 6);
    expect(east.lon).toBeGreaterThan(GOLDEN_GATE.lon);
    expect(east.lat).toBeCloseTo(GOLDEN_GATE.lat, 6);
  });

  it('shrinks a degree of longitude toward the pole', () => {
    // 111 km at the equator, half of it at 60 degrees, and nothing at the
    // pole. Written out because these are the numbers a chart is drawn from.
    expect(metresPerDegLon(0)).toBeCloseTo(METRES_PER_DEG_LAT, 6);
    expect(metresPerDegLon(60) / METRES_PER_DEG_LAT).toBeCloseTo(0.5, 3);
    expect(metresPerDegLon(90)).toBeCloseTo(0, 6);
    expect(metresPerDegLon(-60)).toBeCloseTo(metresPerDegLon(60), 6);
  });

  it('measures a passage the way a navigator would', () => {
    // The Golden Gate to Newport is 4,336 km great-circle -- checked against
    // an independent law-of-cosines sum, and the same code puts SFO to JFK
    // at 4,152 km against a published 4,152. (The first draft of this test
    // asserted 4,150 for *this* pair from memory, which is the SFO-JFK
    // figure: the sum was right and the expectation was wrong.)
    const km = greatCircle(GOLDEN_GATE, NEWPORT) / 1000;
    expect(km).toBeGreaterThan(4300);
    expect(km).toBeLessThan(4370);
    // And the plane is *not* that: over a leg this long it is out by tens of
    // kilometres, which is the whole reason this file exists.
    const flat = toPlane(GOLDEN_GATE, NEWPORT);
    const flatKm = Math.hypot(flat.x, flat.y) / 1000;
    expect(Math.abs(flatKm - km)).toBeGreaterThan(20);
  });

  it('is exact at zero and symmetric about it', () => {
    expect(greatCircle(NEWPORT, NEWPORT)).toBeCloseTo(0, 6);
    expect(greatCircle(GOLDEN_GATE, NEWPORT)).toBeCloseTo(greatCircle(NEWPORT, GOLDEN_GATE), 6);
  });

  it('starts a great circle north of the rhumb line, sailing west to east', () => {
    // The fact every navigator meets first: the short way from California to
    // Rhode Island starts *north* of due east, because the globe is not a
    // Mercator chart. Compared against the plane's own bearing rather than
    // against a number, so it is a statement about the two models.
    const gc = (initialBearing(GOLDEN_GATE, NEWPORT) * 180) / Math.PI;
    const flat = toPlane(GOLDEN_GATE, NEWPORT);
    const plane = (Math.atan2(flat.x, flat.y) * 180) / Math.PI;
    expect(gc).toBeLessThan(plane);
    expect(gc).toBeGreaterThan(45);
    expect(gc).toBeLessThan(90);
  });

  it('takes the short way round the date line', () => {
    expect(shortestLonDelta(179, -179)).toBeCloseTo(2, 9);
    expect(shortestLonDelta(-179, 179)).toBeCloseTo(-2, 9);
    expect(wrapLon(181)).toBeCloseTo(-179, 9);
    expect(wrapLon(-181)).toBeCloseTo(179, 9);
    // A hop across it is a hop, not a lap: 2 degrees at the equator is
    // about 222 km, and nothing here should produce 40,000.
    const near = { lat: 0, lon: 179 };
    const over = { lat: 0, lon: -179 };
    expect(greatCircle(near, over) / 1000).toBeLessThan(250);
    expect(Math.abs(toPlane(near, over).x) / 1000).toBeLessThan(250);
  });

  it('re-anchors without moving the world', () => {
    // The rule the engine must obey when the plane is re-pinned: a place on
    // the Earth is still in the same place afterwards, once every stored
    // plane position has been offset by the shift.
    const from = GOLDEN_GATE;
    const to = { lat: 38.6, lon: -123.9 };
    const mark = toPlane(from, { lat: 38.1, lon: -122.9 });
    const moved = reproject(from, to, mark.x, mark.y);
    const before = toLatLon(from, mark.x, mark.y);
    const after = toLatLon(to, moved.x, moved.y);
    // Within a metre over a hundred kilometres of shift. A single-vector
    // offset -- the first design -- measured 43 m out here, which is a
    // shoal's width and would move a mark off the chart it was drawn on.
    expect(Math.abs(after.lat - before.lat) * METRES_PER_DEG_LAT).toBeLessThan(1);
    expect(Math.abs(after.lon - before.lon) * metresPerDegLon(after.lat)).toBeLessThan(1);
  });

  it('reports the stretch that decides when to re-anchor', () => {
    expect(planeError(GOLDEN_GATE, 0, 0)).toBeCloseTo(0, 9);
    // Growing with distance, in every direction, and small where the plane
    // is meant to be used. Due *north* is nearly free -- a meridian is a
    // great circle -- and due east is where a plane really pays, which is
    // exactly what the first version of this function could not see: it
    // compared longitude scales and returned a flat zero for a course due
    // east, however long. A review found it by asking about ten thousand
    // kilometres of easting.
    // Measured across the range, due east from the Gate: 0.001% at 100 km,
    // 0.015% at 500, 0.06% at 1,000, 1.6% at 5,000. So a window is free, a
    // day's sail is nothing, and an ocean is where the anchor must move.
    const east100 = planeError(GOLDEN_GATE, 100_000, 0);
    const east1000 = planeError(GOLDEN_GATE, 1_000_000, 0);
    expect(east100).toBeLessThan(1e-4);
    expect(east1000).toBeGreaterThan(east100 * 5);
    expect(planeError(GOLDEN_GATE, 5_000_000, 0)).toBeGreaterThan(0.01);
    // And a working window is free: twenty kilometres costs less than a
    // part in a million, which is why the sim may go on using metres.
    expect(planeError(GOLDEN_GATE, 20_000, 20_000)).toBeLessThan(1e-6);
    // Due north costs nothing at any distance -- a meridian *is* a great
    // circle -- which is the asymmetry the old version mistook for the
    // whole error.
    expect(planeError(GOLDEN_GATE, 0, 1_000_000)).toBeLessThan(1e-9);
  });

  it('names the domain it is honest in, and is honest about why', () => {
    // The plane cannot cover a sphere: past a quarter of the planet the
    // shortest-longitude rule folds two plane positions onto one place, and
    // the round trip stops being a round trip. That is a precondition, not
    // a bug -- but it must be stated, and PLANE_DOMAIN states it.
    expect(PLANE_DOMAIN).toBeGreaterThan(100_000);
    expect(PLANE_DOMAIN).toBeLessThan(2_000_000);
    const inside = toPlane(GOLDEN_GATE, toLatLon(GOLDEN_GATE, PLANE_DOMAIN * 0.9, 0));
    expect(inside.x).toBeCloseTo(PLANE_DOMAIN * 0.9, 3);
    // Well outside it, the inversion aliases -- demonstrated rather than
    // asserted away, so nobody mistakes the domain for a suggestion.
    const wayOut = toPlane(GOLDEN_GATE, toLatLon(GOLDEN_GATE, 20_100_000, 0));
    expect(Math.abs(wayOut.x - 20_100_000)).toBeGreaterThan(1_000_000);
  });

  it('reads out as a navigator writes it', () => {
    expect(formatLatLon({ lat: 37.825, lon: -122.43 })).toBe("37°49.5'N 122°25.8'W");
    expect(formatLatLon({ lat: -33.87, lon: 151.21 })).toBe("33°52.2'S 151°12.6'E");
    // A hair under a whole degree: the minutes round to sixty and have to
    // carry. It printed 11°60.0'N, which is not a reading any chart
    // contains, and it was on screen in the menu before anyone noticed.
    expect(formatLatLon({ lat: 11.99997, lon: -122.65 })).toBe("12°0.0'N 122°39.0'W");
    expect(formatLatLon({ lat: -0.00001, lon: 179.99999 })).toBe("0°0.0'S 180°0.0'E");
  });
});
