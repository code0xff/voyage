import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HeightField, heightFieldFromBytes } from './heightfield';
import { ShelterField } from './shelter';
import { regionById, type Region } from './regions';
import { worldFromLatLon } from './geo';
import { DEG } from './math';

/**
 * 10 km square at 25 m, in whole metres, so a test can place land by hand.
 *
 * Deliberately much larger than anything measured in it. Sampling clamps at the
 * grid edge, so a probe near one reads a held value rather than a computed one
 * -- which quietly turned an early version of these tests into assertions about
 * the clamp.
 */
const PLAIN: Region = {
  id: 'plain',
  name: 'Plain',
  area: '',
  brief: '',
  centre: { lat: 0, lon: 0 },
  utmZone: 31,
  grid: { width: 400, height: 400, cell: 25, unit: 1 },
  raster: '',
  source: '',
  licence: '',
  conditions: {
    windTwd: 0,
    windKnots: 12,
    gustiness: 0.4,
    seaScale: 1,
    setDeg: 90,
    driftKnots: 0,
    fullDepth: 20,
    startHour: 12,
  },
};

const W = PLAIN.grid.width;
const CELL = PLAIN.grid.cell;
const HALF = (W * CELL) / 2;

/** Open water 20 m deep, with whatever `paint` puts on it. */
function world(paint: (setLand: (x: number, y: number, h: number) => void) => void): ShelterField {
  const samples = new Int16Array(W * W).fill(-20);
  const setLand = (x: number, y: number, h: number) => {
    const col = Math.round((x + HALF) / CELL - 0.5);
    const row = Math.round((HALF - y) / CELL - 0.5);
    if (col < 0 || col >= W || row < 0 || row >= W) return;
    samples[row * W + col] = h;
  };
  paint(setLand);
  return new ShelterField(new HeightField(samples, PLAIN), W, W, CELL);
}

/** A solid square of land, `size` metres across, centred on (cx, cy). */
const block =
  (cx: number, cy: number, size: number, h: number) =>
  (setLand: (x: number, y: number, h: number) => void) => {
    for (let y = cy - size / 2; y <= cy + size / 2; y += CELL / 2) {
      for (let x = cx - size / 2; x <= cx + size / 2; x += CELL / 2) setLand(x, y, h);
    }
  };

/** Blowing from the west, so everything travels east and x is distance downwind. */
const WESTERLY = 270 * DEG;

describe('shelter from a single island', () => {
  const field = world(block(0, 0, 300, 60));
  field.update(WESTERLY);

  it('leaves open water upwind untouched', () => {
    expect(field.windExposureAt(-2000, 0)).toBeCloseTo(1, 2);
    expect(field.fetchAt(-2000, 0)).toBeGreaterThan(20000);
  });

  it('takes the wind out of the water downwind', () => {
    expect(field.windExposureAt(300, 0)).toBeLessThan(0.5);
  });

  it('gives it back with distance', () => {
    const near = field.windExposureAt(300, 0);
    const mid = field.windExposureAt(900, 0);
    const far = field.windExposureAt(2200, 0);
    expect(mid).toBeGreaterThan(near);
    expect(far).toBeGreaterThan(mid);
    expect(far).toBeCloseTo(1, 1);
  });

  it('resets the fetch behind the land and lets it build again', () => {
    expect(field.fetchAt(300, 0)).toBeLessThan(600);
    expect(field.fetchAt(2200, 0)).toBeGreaterThan(field.fetchAt(300, 0));
  });

  it('leaves the water beside the island alone', () => {
    // Abeam and well clear: the wake travels downwind, it does not radiate.
    expect(field.windExposureAt(0, 2000)).toBeCloseTo(1, 2);
  });

});

/**
 * The relationship the whole model exists to express, and the reason fetch is
 * kept as its own quantity rather than being read off the wind shadow: waves
 * need room to build, so flat water outlasts the breeze that was taken with it.
 *
 * It is a claim about *wide, low* land, which is worth being exact about
 * because it is not universal. Wind shadow scales with height and wave shelter
 * with width, so a tall narrow rock is the other way round -- Alcatraz is 39 m
 * high and 500 m wide, and its wind shadow slightly outlasts its flat water.
 * Asserting the property on a shape like that would have been asserting a
 * coincidence.
 */
describe('flat water outlasts the wind shadow behind wide low land', () => {
  const field = world(block(0, 0, 2000, 20));
  field.update(WESTERLY);

  it('has the breeze back long before the sea has rebuilt', () => {
    // 2.4 km downwind of a 2 km sandbank 20 m high.
    expect(field.windExposureAt(2400, 0)).toBeGreaterThan(0.95);
    expect(field.waveShelterAt(2400, 0)).toBeLessThan(0.6);
  });

  it('still has not finished rebuilding the sea two kilometres later', () => {
    expect(field.windExposureAt(4000, 0)).toBeCloseTo(1, 2);
    expect(field.waveShelterAt(4000, 0)).toBeLessThan(0.8);
    expect(field.waveShelterAt(4000, 0)).toBeGreaterThan(field.waveShelterAt(2400, 0));
  });
});

describe('shelter follows the wind', () => {
  const field = world(block(0, 0, 300, 60));

  it('puts the lee on the other side when the wind backs 180 degrees', () => {
    field.update(WESTERLY);
    const east = field.windExposureAt(400, 0);
    const west = field.windExposureAt(-400, 0);
    expect(east).toBeLessThan(west);

    field.update(90 * DEG); // now blowing from the east
    expect(field.windExposureAt(-400, 0)).toBeLessThan(field.windExposureAt(400, 0));
    expect(field.windExposureAt(-400, 0)).toBeCloseTo(east, 1);
  });

  it('shelters on a diagonal too, and not across it', () => {
    field.update(225 * DEG); // from the south-west, travelling north-east
    const downwind = field.windExposureAt(700, 700);
    const across = field.windExposureAt(700, -700);
    // Compared rather than thresholded: what matters is that the lee is on the
    // north-east side and the south-east side is clear, not the exact depth,
    // which a step length of root-two cells makes a poor thing to pin.
    expect(across).toBeGreaterThan(0.95);
    expect(downwind).toBeLessThan(across - 0.2);
  });

  it('is a function of the wind alone, so the same direction gives the same field', () => {
    field.update(WESTERLY);
    const a = field.windExposureAt(500, 120);
    field.update(30 * DEG);
    field.update(WESTERLY);
    expect(field.windExposureAt(500, 120)).toBeCloseTo(a, 10);
  });

  it('does not rebuild for a shift too small to move anything', () => {
    field.update(WESTERLY);
    expect(field.update(WESTERLY + 0.5 * DEG)).toBe(false);
    expect(field.update(WESTERLY + 5 * DEG)).toBe(true);
  });

  it('measures the shift the short way round, so it does not rebuild across north', () => {
    field.update(359.5 * DEG);
    expect(field.update(0.2 * DEG)).toBe(false);
  });
});

describe('how far a lee reaches', () => {
  /*
   * The bug this locks down, and the one a coastline provokes that a circle
   * never did.
   *
   * Shelter reaches about thirteen times the height of the land casting it, so
   * the sweep has to carry a height downwind. Carrying the *last* land cell
   * crossed is the obvious choice and it is wrong: ground is always lowest at
   * the water's edge, so a ray over Alcatraz crosses 39 m at the summit and
   * leaves over a 2.9 m beach. Keyed on the beach, a 500 m lee came out at
   * 100 m -- and every headland in the region was under-sheltered the same way,
   * silently, because the lee was still in the right *place*.
   */
  const lowShore = (h: number) => (setLand: (x: number, y: number, hh: number) => void) => {
    // A ridge 100 m high, with its last 100 m downwind shelving to `h`.
    block(-100, 0, 400, 100)(setLand);
    block(150, 0, 100, h)(setLand);
  };

  it('keys the lee on the summit, not on the beach it leaves over', () => {
    const tall = world(lowShore(100));
    const shelving = world(lowShore(3));
    tall.update(WESTERLY);
    shelving.update(WESTERLY);
    // A 3 m beach in front of a 100 m ridge must not shorten the ridge's lee.
    expect(shelving.windExposureAt(1200, 0)).toBeCloseTo(tall.windExposureAt(1200, 0), 1);
    expect(shelving.windExposureAt(1200, 0)).toBeLessThan(0.8);
  });

  /*
   * A 10 m islet must cast a 10 m islet's shadow even when a 100 m ridge is
   * throwing its own wake past it. Tested as a difference between a small islet
   * and a large one in otherwise identical worlds, because the ridge's residue
   * is present in both and cancels -- an absolute threshold here would have
   * been measuring the ridge.
   *
   * This caught a second route to the same inheritance, after the landmass
   * reset closed the first: `reach` was being averaged sideways along with
   * fetch and deficit, so the islet picked up the ridge's 1300 m decay length
   * from the water either side of it and threw a lee ten times too long. Reach
   * is a parameter and not an amount; only amounts diffuse.
   */
  it('does not let one landmass lend its height to the next', () => {
    const ridge = (setLand: (x: number, y: number, h: number) => void) =>
      block(-2000, 0, 200, 100)(setLand);
    const withIslet = (h: number) =>
      world((setLand) => {
        ridge(setLand);
        block(500, 0, 100, h)(setLand);
      });

    const small = withIslet(10);
    const large = withIslet(150);
    const isletAlone = world(block(500, 0, 100, 10));
    for (const f of [small, large, isletAlone]) f.update(WESTERLY);

    // 400 m past the islet: three times a 10 m islet's reach, a fifth of a
    // 150 m one's.
    expect(small.windExposureAt(950, 0)).toBeGreaterThan(large.windExposureAt(950, 0) + 0.3);
    // And it behaves as though the ridge were not there at all.
    expect(small.windExposureAt(950, 0)).toBeCloseTo(isletAlone.windExposureAt(950, 0), 1);
  });

  it('gives taller land a longer lee', () => {
    const low = world(block(0, 0, 300, 20));
    const high = world(block(0, 0, 300, 200));
    low.update(WESTERLY);
    high.update(WESTERLY);
    expect(high.windExposureAt(1500, 0)).toBeLessThan(low.windExposureAt(1500, 0));
  });
});

describe('the edge of the survey', () => {
  it('treats water at the upwind boundary as open sea beyond it', () => {
    const field = world(() => {});
    field.update(WESTERLY);
    // The very first column has nothing upwind of it inside the data. Water
    // there means the sea continues, which off the Golden Gate is the Pacific.
    expect(field.fetchAt(-HALF + 30, 0)).toBeGreaterThan(20000);
    expect(field.windExposureAt(-HALF + 30, 0)).toBeCloseTo(1, 2);
  });

  it('treats land at the upwind boundary as the start of the fetch', () => {
    // A wall down the whole western edge: there is a continent upwind, not an
    // ocean, and the water behind it must not be handed a full fetch.
    const field = world((setLand) => {
      for (let y = -HALF; y <= HALF; y += CELL / 2) setLand(-HALF + 30, y, 50);
    });
    field.update(WESTERLY);
    expect(field.fetchAt(-HALF + 200, 0)).toBeLessThan(1000);
  });

  it('stays finite outside the grid, where the renderer still asks', () => {
    const field = world(block(0, 0, 300, 60));
    field.update(WESTERLY);
    for (const [x, y] of [
      [1e5, 0],
      [-1e5, 5e4],
      [0, -1e6],
    ]) {
      expect(Number.isFinite(field.fetchAt(x, y))).toBe(true);
      expect(Number.isFinite(field.windExposureAt(x, y))).toBe(true);
      expect(Number.isFinite(field.waveShelterAt(x, y))).toBe(true);
    }
  });
});

describe('bounds', () => {
  const field = world(block(0, 0, 600, 300));
  field.update(WESTERLY);

  it('never becalms completely and never flattens completely', () => {
    for (let x = -2400; x <= 2400; x += 100) {
      for (let y = -2400; y <= 2400; y += 100) {
        const e = field.windExposureAt(x, y);
        const s = field.waveShelterAt(x, y);
        expect(e).toBeGreaterThanOrEqual(0.08);
        expect(e).toBeLessThanOrEqual(1);
        expect(s).toBeGreaterThanOrEqual(0.05);
        expect(s).toBeLessThanOrEqual(1);
      }
    }
  });
});

/**
 * The same field over the real place, where the answers can be argued about
 * from local knowledge rather than from the fixture.
 */
describe('San Francisco Bay in the summer westerly', () => {
  const region = regionById('sf-bay');
  if (!region) throw new Error('sf-bay region is missing');
  const raw = readFileSync('public/terrain/sf-bay.bin');
  const height = heightFieldFromBytes(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    region,
  );
  const field = new ShelterField(height, region.grid.width, region.grid.height, region.grid.cell);
  // The breeze the city front is known for: hard, from a little south of west.
  field.update(262 * DEG);

  const at = (lat: number, lon: number) => worldFromLatLon(region, lat, lon);

  it('blows through the Gate unhindered', () => {
    const p = at(37.8199, -122.4783);
    expect(field.windExposureAt(p.x, p.y)).toBeGreaterThan(0.95);
    expect(field.waveShelterAt(p.x, p.y)).toBeGreaterThan(0.9);
  });

  it('parks you in the lee of Angel Island', () => {
    // Two kilometres downwind of the summit, which is a real and painful place
    // to be on this course.
    const s = at(37.8609, -122.4326);
    const p = { x: s.x + 1980, y: s.y + 278 };
    expect(field.windExposureAt(p.x, p.y)).toBeLessThan(0.7);
  });

  it('gives Angel Island a longer lee than Alcatraz, because it is taller', () => {
    const angel = at(37.8609, -122.4326);
    const alcatraz = at(37.8267, -122.423);
    const downwind = (p: { x: number; y: number }, d: number) => ({
      x: p.x + 0.99 * d,
      y: p.y + 0.139 * d,
    });
    const a = downwind(angel, 2500);
    const b = downwind(alcatraz, 2500);
    expect(field.windExposureAt(a.x, a.y)).toBeLessThan(field.windExposureAt(b.x, b.y));
  });

  it('shelters the water under the city shore', () => {
    // Tucked in east of the city, downwind of a mile of San Francisco.
    const p = at(37.8, -122.375);
    expect(field.waveShelterAt(p.x, p.y)).toBeLessThan(0.6);
  });

  it('lets the sea build across the central bay', () => {
    const p = at(37.83, -122.41);
    expect(field.fetchAt(p.x, p.y)).toBeGreaterThan(3000);
  });
});
