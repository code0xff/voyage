import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { heightFieldFromBytes } from './heightfield';
import { RegionTerrain } from './region-terrain';
import { regionById } from './regions';
import { worldFromLatLon } from './geo';
import { DEG, RAD } from './math';
import { CRUISER } from './config';

const region = regionById('sf-bay');
if (!region) throw new Error('sf-bay region is missing');

const raw = readFileSync('public/terrain/sf-bay.bin');
const terrain = new RegionTerrain(
  region,
  heightFieldFromBytes(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), region),
);
const at = (lat: number, lon: number) => worldFromLatLon(region, lat, lon);
/** The breeze the city front is known for. */
const WESTERLY = 262 * DEG;

describe('depth and grounding', () => {
  it('floats the boat in the channels and grounds her on the islands', () => {
    const gate = at(37.8199, -122.4783);
    const rock = at(37.8267, -122.423); // Alcatraz
    expect(terrain.isAground(gate.x, gate.y, CRUISER.draft)).toBe(false);
    expect(terrain.isAground(rock.x, rock.y, CRUISER.draft)).toBe(true);
  });

  it('grounds her on the Berkeley flats, which is the point of them', () => {
    // Under two metres over a good deal of it, and this boat draws more.
    const p = at(37.86, -122.33);
    expect(terrain.depthAt(p.x, p.y)).toBeLessThan(CRUISER.draft + 1);
  });

  it('agrees with the raster inside the survey', () => {
    const p = at(37.83, -122.41);
    expect(terrain.depthAt(p.x, p.y)).toBeCloseTo(-terrain.height.elevationAt(p.x, p.y), 6);
  });
});

describe('the shore', () => {
  it('is far away in the middle of the bay and close alongside an island', () => {
    const mid = at(37.83, -122.41);
    const beside = at(37.8267, -122.4265); // just west of Alcatraz
    expect(terrain.distanceToShore(mid.x, mid.y)).toBeGreaterThan(
      terrain.distanceToShore(beside.x, beside.y),
    );
    expect(terrain.distanceToShore(beside.x, beside.y)).toBeLessThan(500);
  });

  it('is negative inland, so the field is signed and continuous', () => {
    const inland = at(37.7749, -122.4394); // well into San Francisco
    expect(terrain.distanceToShore(inland.x, inland.y)).toBeLessThan(0);
  });

  it('points at the shore it is actually near', () => {
    // A boat just west of Alcatraz should be told the beach is to the east.
    const p = at(37.8267, -122.4265);
    const b = terrain.bearingToShore(p.x, p.y);
    expect(b).not.toBeNull();
    const deg = (((b as number) * RAD) % 360 + 360) % 360;
    expect(deg).toBeGreaterThan(45);
    expect(deg).toBeLessThan(135);
  });

  it('has nothing to say off the chart', () => {
    expect(terrain.distanceToShore(50000, 0)).toBe(Infinity);
    expect(terrain.bearingToShore(50000, 0)).toBeNull();
  });
});

describe('shelter through the query interface', () => {
  it('blows through the Gate and parks you behind Angel Island', () => {
    const gate = at(37.8199, -122.4783);
    const angel = at(37.8609, -122.4326);
    const lee = { x: angel.x + 1980, y: angel.y + 278 };
    expect(terrain.windExposure(gate.x, gate.y, WESTERLY)).toBeGreaterThan(0.95);
    expect(terrain.windExposure(lee.x, lee.y, WESTERLY)).toBeLessThan(0.7);
  });

  it('rebuilds itself when the wind moves, without being told to', () => {
    const angel = at(37.8609, -122.4326);
    // The lee of Angel Island, and the water the same distance the other way.
    const east = { x: angel.x + 1980, y: angel.y + 278 };
    const west = { x: angel.x - 1980, y: angel.y - 278 };
    expect(terrain.windExposure(east.x, east.y, WESTERLY)).toBeLessThan(
      terrain.windExposure(west.x, west.y, WESTERLY),
    );
    const easterly = 82 * DEG;
    expect(terrain.windExposure(west.x, west.y, easterly)).toBeLessThan(
      terrain.windExposure(east.x, east.y, easterly),
    );
  });
});

/**
 * The edge of the survey.
 *
 * docs/real-map.md weighs an invisible wall against a fade into open sea and
 * picks the fade, because sailing off the edge of the surveyed area is what
 * actually happens and a wall in a game about going somewhere is the worst
 * available answer.
 */
describe('sailing off the chart', () => {
  it('opens into deep water rather than stopping dead', () => {
    const far = terrain.depthAt(region.grid.width * region.grid.cell, 0);
    expect(far).toBeGreaterThan(50);
    expect(terrain.isAground(region.grid.width * region.grid.cell, 0, CRUISER.draft)).toBe(false);
  });

  it('gives the wind and the sea back on the way out', () => {
    const x = terrain.height.halfWidth + 2000;
    expect(terrain.windExposure(x, 0, WESTERLY)).toBeCloseTo(1, 3);
    expect(terrain.waveShelter(x, 0, WESTERLY)).toBeCloseTo(1, 3);
  });

  it('crosses the boundary without a step in the depth', () => {
    // Walked across the eastern edge: the fade has to be continuous, or the
    // keel would find a cliff at a line drawn on nothing.
    const edge = terrain.height.halfWidth;
    let previous = terrain.depthAt(edge - 200, 0);
    for (let d = -150; d <= 1200; d += 50) {
      const depth = terrain.depthAt(edge + d, 0);
      expect(Math.abs(depth - previous)).toBeLessThan(15);
      previous = depth;
    }
  });

  it('is still finite a very long way out', () => {
    expect(Number.isFinite(terrain.depthAt(1e6, -1e6))).toBe(true);
    expect(Number.isFinite(terrain.windExposure(1e6, -1e6, WESTERLY))).toBe(true);
  });
});
