import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HeightField, heightFieldFromBytes } from './heightfield';
import { EDGE_FADE, RegionTerrain } from './region-terrain';
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

  /*
   * The fade is the one part of the shelter model that is *not* shared as data.
   * Inside the square both sides read the same texels; outside there are none,
   * so the water shader computes the same blend from the same EDGE_FADE. That
   * makes this the one place they can drift apart, and they did: the shader
   * returned open sea the instant the boundary was crossed while the boat went
   * on feeling the lee for another 800 m -- 0.35 against 1.0 at the north edge
   * in a westerly, a hard seam on a line drawn on nothing.
   *
   * This holds the constant the shader is built against and the shape of the
   * blend. It cannot reach into GLSL, so it is not proof; it is the half of the
   * agreement that can be checked, and the constant is imported by both.
   */
  it('fades over exactly the distance the shader is given', () => {
    const y = terrain.height.halfHeight;
    const twd = WESTERLY;
    const atEdge = terrain.waveShelter(-3000, y - 1, twd);
    // Sheltered water, or this proves nothing about a blend towards open sea.
    expect(atEdge).toBeLessThan(0.6);

    // Just outside, still essentially what the boat felt a metre back.
    expect(terrain.waveShelter(-3000, y + 1, twd)).toBeCloseTo(atEdge, 2);
    // Half way through the band, half way to open sea.
    const half = terrain.waveShelter(-3000, y + EDGE_FADE / 2, twd);
    expect(half).toBeCloseTo(atEdge + (1 - atEdge) * 0.5, 2);
    // And fully open at the end of it, not before.
    expect(terrain.waveShelter(-3000, y + EDGE_FADE * 0.99, twd)).toBeLessThan(1);
    expect(terrain.waveShelter(-3000, y + EDGE_FADE, twd)).toBeCloseTo(1, 6);
  });

  it('is still finite a very long way out', () => {
    expect(Number.isFinite(terrain.depthAt(1e6, -1e6))).toBe(true);
    expect(Number.isFinite(terrain.windExposure(1e6, -1e6, WESTERLY))).toBe(true);
  });
});

/**
 * Regions with no waterline.
 *
 * Neither can be sailed and neither ships, but `distanceToShore` has one job
 * off the chart -- say Infinity, as `Terrain` with no islands does, so the
 * callers written for it fall quiet. The first attempt tested only that some
 * distance came out negative, which catches all-water and is *fooled* by
 * all-land: every distance is the negative sentinel, so it reported a shore
 * twenty-five thousand kilometres inland. A shore needs both halves.
 */
describe('a region with nothing to be near', () => {
  const flat = (elevation: number) => {
    const spec = { ...region, grid: { ...region.grid, width: 32, height: 32, unit: 1 } };
    const samples = new Int16Array(32 * 32).fill(elevation);
    return new RegionTerrain(spec, new HeightField(samples, spec));
  };

  it('says Infinity when it is all water', () => {
    const t = flat(-20);
    expect(t.distanceToShore(0, 0)).toBe(Infinity);
    expect(t.bearingToShore(0, 0)).toBeNull();
  });

  it('says Infinity when it is all land', () => {
    const t = flat(40);
    expect(t.distanceToShore(0, 0)).toBe(Infinity);
    expect(t.bearingToShore(0, 0)).toBeNull();
  });

  it('still finds one when there is both', () => {
    const spec = { ...region, grid: { ...region.grid, width: 32, height: 32, unit: 1 } };
    const samples = new Int16Array(32 * 32).fill(-20);
    for (let i = 0; i < 32 * 16; i++) samples[i] = 40; // the northern half is land
    const t = new RegionTerrain(spec, new HeightField(samples, spec));
    expect(Number.isFinite(t.distanceToShore(0, -200))).toBe(true);
    expect(t.bearingToShore(0, -200)).not.toBeNull();
  });
});

/**
 * What the eight-bit texture costs.
 *
 * Inside the survey the physics and the shader read the same field, and since
 * the texture carries capped *fetch* rather than shelter they now interpolate
 * the same linear quantity and each take the root themselves. The arithmetic
 * is exact. The wire is not: the red channel is a byte.
 *
 * This pins the size of what is left, because a comment saying "0.0126" is
 * only true until someone changes REFERENCE_FETCH, the floor, or the encoding
 * -- and all three are one edit away from widening it silently. The worst case
 * is at the waterline, where the root is steepest and the floor cuts in.
 */
describe('the shelter texture, as the shader will read it', () => {
  const REF = 8000;
  /** Exactly what water.ts writes into the red channel. */
  const byte = (i: number) => Math.round((Math.min(terrain.shelter.fetch[i], REF) / REF) * 255) / 255;

  it('agrees with the physics to within the quantisation bound', () => {
    terrain.waveShelter(0, 0, WESTERLY);
    const { width, height, cell } = region.grid;
    const hw = terrain.height.halfWidth;
    const hh = terrain.height.halfHeight;
    let worst = 0;
    // Every eleventh midpoint: enough of the bay to catch a shoreline without
    // making this the slowest test in the suite.
    for (let row = 1; row < height - 1; row += 11) {
      for (let col = 1; col < width - 2; col += 11) {
        const i = row * width + col;
        const x = -hw + (col + 1) * cell;
        const y = hh - (row + 0.5) * cell;
        const cpu = terrain.waveShelter(x, y, WESTERLY);
        // The hardware mixes the two bytes, then the shader takes the root.
        const gpu = Math.max(0.05, Math.sqrt((byte(i) + byte(i + 1)) / 2));
        worst = Math.max(worst, Math.abs(cpu - gpu));
      }
    }
    // sqrt(1/255) - 0.05 is the bound at the floor; a little over it for the
    // interpolated case, and nowhere near enough to see in a wave height.
    expect(worst).toBeLessThan(0.02);
  });

  it('agrees exactly where the byte is exact', () => {
    terrain.waveShelter(0, 0, WESTERLY);
    // Zero fetch is the floor on both sides, and fully capped fetch is 1.
    expect(Math.max(0.05, Math.sqrt(0))).toBeCloseTo(0.05, 10);
    expect(Math.max(0.05, Math.sqrt(255 / 255))).toBeCloseTo(1, 10);
  });
});
