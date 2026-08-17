import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Earth, GLOBE_4M, cellMetres } from './earth';

/**
 * The coarse Earth, against places whose answers are known.
 *
 * This file reads the shipped raster off disk, which no other sim test does
 * -- and it is the point rather than a shortcut: what is being asserted is
 * that *this* grid, the one the game will sail, has the Sahara in Africa and
 * water in the Atlantic. A synthetic fixture would test the sampler and
 * leave the thing that has actually gone wrong twice -- the orientation of
 * the data -- untested.
 */
const buf = readFileSync('public/terrain/globe-4m.bin');
const earth = new Earth(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2));

describe('the coarse Earth', () => {
  it('puts the continents where they are', () => {
    // Dry land, wet sea, and the two ice sheets that must read as land or
    // the boat sails under them -- the bedrock grid's failure, kept here as
    // the guard against picking it again.
    const land: [string, number, number][] = [
      ['Sahara', 25, 10],
      ['Himalaya', 28, 87],
      ['Amazon basin', -3, -60],
      ['Australia', -25, 133],
      ['East Antarctica', -80, 0],
      ['Greenland', 72, -40],
    ];
    const sea: [string, number, number][] = [
      ['Mid-Atlantic', 30, -40],
      ['Mariana', 11, 142],
      ['Arctic', 85, 0],
      ['Sea of Japan', 40, 135],
      ['South Pacific', -30, -140],
    ];
    for (const [name, lat, lon] of land) {
      expect(earth.isLand({ lat, lon }), name).toBe(true);
    }
    for (const [name, lat, lon] of sea) {
      expect(earth.isLand({ lat, lon }), name).toBe(false);
    }
  });

  it('has the deeps deep and the mountains high', () => {
    // Not exact values -- this is a 7 km grid and the peaks are averaged
    // away -- but the orders of magnitude are the data's own claim.
    expect(earth.elevationAt({ lat: 11, lon: 142 })).toBeLessThan(-5000);
    expect(earth.elevationAt({ lat: 28, lon: 87 })).toBeGreaterThan(3000);
    expect(earth.elevationAt({ lat: 30, lon: -40 })).toBeLessThan(-2000);
  });

  it('wraps at the date line instead of stretching a seam', () => {
    // The cell east of the last column is the first column. Sampled either
    // side of 180 the sea is the same sea, and a clamped sampler would
    // instead smear the last column across the join.
    const west = earth.elevationAt({ lat: 0, lon: 179.97 });
    const east = earth.elevationAt({ lat: 0, lon: -179.97 });
    expect(Math.abs(west - east)).toBeLessThan(400);
    // And the wrap is continuous: a step across the line is no bigger than
    // a step of the same size well away from it.
    const step = Math.abs(
      earth.elevationAt({ lat: 0, lon: 179.9 }) - earth.elevationAt({ lat: 0, lon: -179.9 }),
    );
    const inland = Math.abs(
      earth.elevationAt({ lat: 0, lon: 150 }) - earth.elevationAt({ lat: 0, lon: 150.2 }),
    );
    expect(step).toBeLessThan(Math.max(400, inland * 3));
  });

  it('measures a coast as a signed distance, sea negative', () => {
    // A few hundred metres off the Golden Gate is close to shore and wet;
    // the middle of the Sahara is dry and far from any.
    const offshore = earth.shoreDistance({ lat: 37.82, lon: -122.6 });
    expect(offshore).toBeLessThan(0);
    expect(Math.abs(offshore)).toBeLessThan(20_000);
    expect(earth.shoreDistance({ lat: 25, lon: 10 })).toBeGreaterThan(0);
  });

  it('saturates rather than reporting a shoreline on another planet', () => {
    // The chamfer's sentinel, times a spacing, is 10^12 m -- which the
    // generator would happily build a shelf against. A patch with no land
    // in it can only honestly say "at least this far".
    const mid = earth.shoreDistance({ lat: 30, lon: -40 });
    expect(mid).toBeLessThan(0);
    expect(Math.abs(mid)).toBeLessThan(100_000);
    const desert = earth.shoreDistance({ lat: 25, lon: 10 });
    expect(desert).toBeLessThan(100_000);
  });

  it('is smooth enough to build a coast on', () => {
    // The generator slopes a beach against this, so it must not step: two
    // points a hundred metres apart cannot differ by more than that.
    const patch = earth.shorePatch({ lat: 37.82, lon: -122.6 }, 10_000);
    let worst = 0;
    for (let y = -9000; y <= 9000; y += 500) {
      for (let x = -9000; x <= 9000; x += 500) {
        worst = Math.max(worst, Math.abs(patch.at(x, y) - patch.at(x + 100, y)));
      }
    }
    expect(worst).toBeLessThanOrEqual(150);
  });

  it('reports the cell size the whole design rests on', () => {
    // Written out because it is the claim that decides what the coarse grid
    // may and may not be used for: about 7 km, so it places coastlines and
    // never soundings.
    expect(cellMetres(GLOBE_4M) / 1000).toBeGreaterThan(6.5);
    expect(cellMetres(GLOBE_4M) / 1000).toBeLessThan(8);
  });

  it('refuses a raster of the wrong size', () => {
    expect(() => new Earth(new Int16Array(100))).toThrow(/expected/);
  });
});
