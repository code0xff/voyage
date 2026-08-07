import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HeightField, heightFieldFromBytes } from './heightfield';
import { EDGE_FADE, RegionTerrain } from './region-terrain';
import { REGIONS, regionById } from './regions';
import { worldFromLatLon } from './geo';
import { DEG, RAD } from './math';
import { CRUISER } from './config';
import { CurrentField, setDriftVec } from './current';
import { dot, compassVec } from './math';
import { msToKnots } from './units';

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

/**
 * The decision San Francisco is known for, now over surveyed water.
 *
 * This was the `sf` venue's test and it is the reason that venue existed: a
 * hard summer westerly over a foul flood, so the beat out towards the Gate is
 * into the tide, and the way to sail it is to work the shallow water along the
 * city shore -- which costs wind and eventually the bottom.
 *
 * It moves here with the place. The venue drew its shore from seven circles and
 * a uniform shelf slope, so the inshore lane was as deep as someone decided it
 * should be; here it is as deep as it is, and the trade is a real one.
 */
describe('the city front, and the price of the inshore lane', () => {
  const c = region.conditions;
  const currents = new CurrentField({
    peak: setDriftVec(c.setDeg, c.driftKnots),
    fullDepth: c.fullDepth,
  });
  currents.terrain = terrain;
  /** Upwind: the direction the beat has to make good. */
  const up = compassVec(c.windTwd);
  /** Knots of stream against the beat. Positive is foul. */
  const foul = (p: { x: number; y: number }) => msToKnots(-dot(currents.sample(p), up));

  /*
   * Three points on one transect in towards the city shore, chosen by walking
   * the real soundings rather than by picking coordinates that sounded right --
   * which is how the first draft of this test put the inshore lane on a beach.
   *
   * 37.812: 17 m, well out.        37.808: 5.4 m, the lane.
   * 37.807: dry. The shoal is a hundred metres past the lane, not a slope
   * someone chose the gradient of, and that is the whole difference between
   * this and the venue it replaces.
   */
  const offshore = at(37.812, -122.44);
  const inshore = at(37.808, -122.44);
  const tooFar = at(37.807, -122.44);

  it('sets the flood against the beat, which is the whole point of the place', () => {
    // The regression the venue carried: an ebb runs out of the Gate within
    // twenty degrees of the way a westerly makes you beat, so it would carry
    // the boat towards the mark and leave nothing to escape.
    expect(foul(offshore)).toBeGreaterThan(1.2);
  });

  it('offers real shelter from the tide inshore', () => {
    // 1.4 kn foul out here, a fifth of that in the lane: nearly slack water.
    expect(foul(inshore)).toBeLessThan(foul(offshore) - 1);
  });

  /*
   * And charges for it. A lane that were only better would not be a decision,
   * it would be the answer, and the place would be a straight line.
   */
  it('charges depth for the tide it saves', () => {
    expect(terrain.depthAt(inshore.x, inshore.y)).toBeLessThan(
      terrain.depthAt(offshore.x, offshore.y) - 5,
    );
  });

  it('keeps the lane afloat, and puts the ground just past it', () => {
    expect(terrain.isAground(inshore.x, inshore.y, CRUISER.draft)).toBe(false);
    expect(terrain.isAground(tooFar.x, tooFar.y, CRUISER.draft)).toBe(true);
  });
});

/**
 * What each region is *for*, as a property rather than a description.
 *
 * Six regions is well past the point where "they are all different" needs
 * checking rather than asserting. Each was chosen because it is extreme on one
 * measured axis, and each of those is a number this holds.
 *
 * Two of the six were chosen *against* an argument that measurement refused.
 * Maine was going to be Penobscot Bay proper, because the Camden Hills stand
 * 398 m off the water and should make the biggest lee in the project; the
 * shelter field put it last of three, and San Francisco first by a factor of
 * four. What survived measurement there was pilotage, so Merchant Row shipped
 * instead. Three further candidates -- Long Island Sound, Charleston and
 * Biscayne Bay -- were baked and dropped for being extreme on nothing, or on
 * nothing but absences. Those reasons are recorded in `regions.ts`.
 *
 * Assertions are ratios and orderings rather than the measured figures, because
 * a resurvey is entitled to move a raster a little and must not be made to look
 * like a regression when it does.
 */
describe('the regions are each for something different', () => {
  const load = (id: string) => {
    const r = regionById(id);
    if (!r) throw new Error(`${id} region is missing`);
    const raw = readFileSync(`public${r.raster}`);
    const field = heightFieldFromBytes(
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
      r,
    );
    return new RegionTerrain(r, field);
  };

  /**
   * Sampled on a 100 m lattice: four times the grid, and far finer than any of
   * the differences being measured. Every region is profiled in one pass
   * because the claims are all comparative.
   */
  const profile = (id: string) => {
    const t = load(id);
    const span = 800 * 25;
    let sailable = 0;
    let tight = 0;
    let shoal = 0;
    let cells = 0;
    const depths: number[] = [];
    for (let y = -span / 2; y <= span / 2; y += 100) {
      for (let x = -span / 2; x <= span / 2; x += 100) {
        cells++;
        const d = t.depthAt(x, y);
        if (d <= 0) continue;
        depths.push(d);
        if (d <= CRUISER.draft + 1) {
          shoal++;
          continue;
        }
        sailable++;
        if (t.distanceToShore(x, y) < 200) tight++;
      }
    }
    depths.sort((a, b) => a - b);
    return {
      median: depths[Math.floor(depths.length / 2)],
      tight: tight / sailable,
      shoal: shoal / cells,
    };
  };

  const p = Object.fromEntries(
    REGIONS.map((r) => [r.id, profile(r.id)]),
  ) as Record<string, ReturnType<typeof profile>>;
  const others = (id: string) => REGIONS.filter((r) => r.id !== id).map((r) => p[r.id]);

  it('puts the boat close aboard far more often at Merchant Row', () => {
    // The claim the region was chosen on: 16% against 8% and 9% at the time.
    for (const o of others('merchant-row')) {
      expect(p['merchant-row'].tight).toBeGreaterThan(o.tight * 1.5);
    }
  });

  it('gives Puget Sound water no other region comes close to', () => {
    // 85 m median against 20 m for the next deepest: depth never decides there.
    for (const o of others('puget-sound')) {
      expect(p['puget-sound'].median).toBeGreaterThan(o.median * 2.5);
    }
  });

  it('leaves the least water under her at Chesapeake Bay', () => {
    // The opposite pole to Puget Sound, and the most water too shoal to sail.
    for (const o of others('chesapeake')) {
      expect(p['chesapeake'].median).toBeLessThan(o.median);
      expect(p['chesapeake'].shoal).toBeGreaterThan(o.shoal);
    }
  });

  it('gives Buzzards Bay the most water it can actually sail', () => {
    const span = 800 * 25;
    const sailableFraction = (id: string) => {
      const t = load(id);
      let cells = 0;
      let sail = 0;
      for (let y = -span / 2; y <= span / 2; y += 100) {
        for (let x = -span / 2; x <= span / 2; x += 100) {
          cells++;
          if (t.depthAt(x, y) > CRUISER.draft + 1) sail++;
        }
      }
      return sail / cells;
    };
    const bb = sailableFraction('buzzards-bay');
    for (const r of REGIONS) {
      if (r.id !== 'buzzards-bay') expect(bb).toBeGreaterThan(sailableFraction(r.id));
    }
  });
});
