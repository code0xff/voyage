import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Earth, GLOBE_4M, ShorePatch, cellMetres } from './earth';

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
// Resolved from this file rather than from the working directory: vitest is
// normally run from the repo root, but a CI step that runs it from anywhere
// else would fail here for a reason that has nothing to do with the code.
const buf = readFileSync(new URL('../../public/terrain/globe-4m.bin', import.meta.url));
const samples = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
const earth = new Earth(samples);

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
    // The cell east of the last column is the first column, and the test has
    // to *prove* that rather than merely find the Pacific calm on both
    // sides: a review swapped the wrap for a clamp and this passed, because
    // mid-ocean either side of 180 is deep water whatever the sampler does.
    //
    // So the claim is made where clamping and wrapping must differ. Inside
    // the last half-cell the interpolation reaches across the join; clamped
    // it holds the last column instead, so the value stops changing. Sampled
    // across that half-cell, a wrapped grid keeps moving and a clamped one
    // goes flat.
    const step = GLOBE_4M.arcMinutes / 60;
    const edge = 180 - step / 2;
    const a = earth.elevationAt({ lat: 44.3, lon: edge + step * 0.1 });
    const b = earth.elevationAt({ lat: 44.3, lon: edge + step * 0.45 });
    const clampedWouldBe = earth.elevationAt({ lat: 44.3, lon: edge - 1e-9 });
    expect(Math.abs(b - a)).toBeGreaterThan(0.5);
    expect(Math.abs(b - clampedWouldBe)).toBeGreaterThan(0.5);
    // And it is a join, not a cliff: crossing the line is no bigger a step
    // than crossing the same distance anywhere else.
    const across = Math.abs(
      earth.elevationAt({ lat: 44.3, lon: 179.98 }) - earth.elevationAt({ lat: 44.3, lon: -179.98 }),
    );
    const elsewhere = Math.abs(
      earth.elevationAt({ lat: 44.3, lon: 150 }) - earth.elevationAt({ lat: 44.3, lon: 150.04 }),
    );
    expect(across).toBeLessThan(Math.max(200, elsewhere * 4));
  });

  it('reads a cell at the coordinates that cell carries', () => {
    // The decisive test for the sampling convention, and the one the coast
    // walk below was too loose to be: take a raw sample straight out of the
    // array, work out the latitude and longitude the *fetcher* gave it --
    // the first 60-arcsecond cell of its block, half a source step in --
    // and ask the sampler for exactly that place. Anything but an exact hit
    // means the reader and the writer disagree about where the planet is.
    // On the surveyed rasters' half-output-step convention this misses by
    // 1.5 arc-minutes, which is the 2.8 km displacement a review found.
    const { width, arcMinutes } = GLOBE_4M;
    const step = arcMinutes / 60;
    const half = 1 / 60 / 2;
    for (const [row, col] of [
      [600, 1200],
      [1000, 3000],
      [1500, 4800],
    ] as [number, number][]) {
      const raw = samples[row * width + col];
      const place = { lat: 90 - half - row * step, lon: -180 + half + col * step };
      expect(earth.elevationAt(place)).toBeCloseTo(raw, 6);
    }
  });

  it('measures a diagonal corner as a diagonal, not as an edge', () => {
    // The chamfer's half-step correction has to be half of *whichever step
    // produced the distance*: one across an edge, root two across a
    // diagonal. Taking a flat half cell off a diagonal left the waterline
    // 350 m out at a corner, which a review found with a mask like this
    // one. Built by hand rather than from the globe, because the claim is
    // about the transform and not about any coast.
    // One corner of land, everything else sea, at kilometre spacing. The
    // centre cell's nearest land is *only* reachable across the diagonal,
    // which is the case the two corrections disagree about: root two cells
    // less half a diagonal is 707 m, and less a flat half cell is 914.
    const land = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0]);
    const patch = new ShorePatch(land, 3, 1000, 1000);
    const centre = Math.abs(patch.at(0, 0));
    expect(centre).toBeGreaterThan(650);
    expect(centre).toBeLessThan(780);
  });

  it('samples where the fetcher actually took them', () => {
    // The subsample keeps the *first* source cell of each block, so samples
    // sit half a source step in -- not half an output step, which is the
    // surveyed rasters' convention and would put the whole planet 2.8 km
    // north-east of itself. Asserted through a place with a hard edge: the
    // Gate's own latitude, walked across the California coast, must cross
    // the waterline within a cell of where the coarse grid says it does.
    const step = GLOBE_4M.arcMinutes / 60;
    let crossing = 0;
    for (let lon = -123.5; lon < -121.5; lon += step / 8) {
      if (earth.isLand({ lat: 37.82, lon })) {
        crossing = lon;
        break;
      }
    }
    // The real coast at this latitude is near -122.5; a 1.5 arc-minute
    // (2.8 km, 0.025 degree) shift is well inside this bound, so it would
    // fail before the fix and passes after it.
    expect(crossing).toBeGreaterThan(-122.56);
    expect(crossing).toBeLessThan(-122.44);
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
