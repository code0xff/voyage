import { describe, expect, it } from 'vitest';
import {
  ACTIVE_RANGE,
  IslandField,
  MAX_ACTIVE_ISLANDS,
  MAX_DENSITY,
  Terrain,
  WAKE_MAX,
  sameIslands,
  type Island,
} from './terrain';
import { WindField } from './wind';
import { CRUISER, DEFAULT_ENV } from './config';
import { initialState, step, type SeaState } from './boat';
import { knotsToMs, msToKnots } from './units';
import { DEG } from './math';

const island = (x: number, y: number, radius = 150, height = 60): Island => ({
  pos: { x, y },
  radius,
  height,
  seed: 7,
});

describe('terrain', () => {
  const terrain = new Terrain([island(0, 0)]);

  it('is land above water and sea below it', () => {
    expect(terrain.elevationAt(0, 0)).toBeGreaterThan(20); // the summit
    expect(terrain.depthAt(0, 0)).toBeLessThan(0); // dry
    expect(terrain.depthAt(1200, 0)).toBeGreaterThan(30); // offshore
  });

  it('shoals gradually rather than dropping off a cliff', () => {
    const near = terrain.depthAt(220, 0);
    const far = terrain.depthAt(500, 0);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
  });

  it('grounds a boat in the shallows but not offshore', () => {
    expect(terrain.isAground(1200, 0, CRUISER.draft)).toBe(false);
    expect(terrain.isAground(60, 0, CRUISER.draft)).toBe(true);
  });

  /**
   * Wind shadow is the whole reason islands exist here. If it did not work the
   * islands would be scenery, and sailing into a lee would cost nothing.
   */
  it('steals the wind downwind of an island and leaves upwind clear', () => {
    // Wind from the north: downwind of the island is to the south (-y).
    const twd = 0;
    const inLee = terrain.windExposure(0, -260, twd);
    const upwind = terrain.windExposure(0, 400, twd);
    const beside = terrain.windExposure(900, -260, twd);

    expect(inLee).toBeLessThan(0.6);
    expect(upwind).toBe(1);
    expect(beside).toBeCloseTo(1, 5);
  });

  it('lets the wind fill back in far downwind', () => {
    const close = terrain.windExposure(0, -260, 0);
    const distant = terrain.windExposure(0, -2500, 0);
    expect(distant).toBeGreaterThan(close);
    expect(distant).toBeGreaterThan(0.85);
  });

  it('rotates the shadow with the wind', () => {
    // Wind from the east: the lee moves to the west.
    const twd = 90 * DEG;
    expect(terrain.windExposure(-260, 0, twd)).toBeLessThan(0.6);
    expect(terrain.windExposure(0, -260, twd)).toBeCloseTo(1, 5);
  });

  it('shelters the sea further downwind than the wind, because waves need fetch', () => {
    const wind = terrain.windExposure(0, -700, 0);
    const wave = terrain.waveShelter(0, -700, 0);
    expect(wave).toBeLessThan(wind);
  });

  it('reports open water as fully exposed when there is no land', () => {
    const empty = new Terrain([]);
    expect(empty.windExposure(0, 0, 0)).toBe(1);
    expect(empty.waveShelter(0, 0, 0)).toBe(1);
    expect(empty.depthAt(0, 0)).toBeGreaterThan(30);
  });
});

/**
 * A coast is drawn by overlapping circles, because `elevationAt` takes the
 * highest of them and they therefore union into one continuous shore without a
 * new shape primitive. The shelter models compose one circle at a time, though,
 * and that is what has to be told they are all one piece of ground.
 */
describe('landmasses', () => {
  const shoreline = (land: number | undefined) =>
    new Terrain(
      // Six circles in a row along x, overlapping into one bank of land.
      Array.from({ length: 6 }, (_, i) => ({
        pos: { x: (i - 2.5) * 150, y: 0 },
        radius: 200,
        height: 60,
        seed: 100 + i,
        land,
      })),
    );

  /** What each circle of the coast would shelter if it were alone. */
  const alone = (t: Terrain, x: number, y: number, twd: number) =>
    t.islands.map((isl) => new Terrain([{ ...isl, land: undefined }]).waveShelter(x, y, twd));

  /**
   * The exact statement of the model, rather than an approximate one: a
   * landmass shelters precisely as hard as the strongest single piece of it,
   * because that is what taking the maximum within a group means. Asserting a
   * range here instead would have passed with the composition rule still wrong.
   */
  it('shelters behind a coast exactly as hard as its strongest single piece', () => {
    // Wind from the north, so downwind of the bank is to the south.
    const coast = shoreline(1);
    const asCoast = coast.waveShelter(0, -400, 0);
    expect(asCoast).toBeCloseTo(Math.min(...alone(coast, 0, -400, 0)), 12);
  });

  /**
   * The bug this exists to prevent. Six ungrouped circles multiply their wakes
   * together and produce a lee no headland of that size could make -- the
   * measurement below is what "eight times over" actually costs.
   */
  it('would over-shelter if the circles were not told they are one coast', () => {
    const asCoast = shoreline(1).waveShelter(0, -400, 0);
    const asIslands = shoreline(undefined).waveShelter(0, -400, 0);
    expect(asIslands).toBeLessThan(asCoast * 0.5);
  });

  it('takes the wind out once for a coast, not once per circle', () => {
    const coast = shoreline(1);
    const asCoast = coast.windExposure(0, -400, 0);
    const asIslands = shoreline(undefined).windExposure(0, -400, 0);
    expect(asIslands).toBeLessThan(asCoast);
    const strongest = Math.min(
      ...coast.islands.map((isl) =>
        new Terrain([{ ...isl, land: undefined }]).windExposure(0, -400, 0),
      ),
    );
    expect(asCoast).toBeCloseTo(strongest, 12);
  });

  it('still lets two separate landmasses each take their bite', () => {
    // In line downwind of each other: the second is sheltering water that the
    // first has already sheltered, and both should count.
    const two = new Terrain([
      { pos: { x: 0, y: 0 }, radius: 200, height: 60, seed: 1, land: 0 },
      { pos: { x: 0, y: -500 }, radius: 200, height: 60, seed: 2, land: 1 },
    ]);
    const near = new Terrain([{ pos: { x: 0, y: -500 }, radius: 200, height: 60, seed: 2 }]);
    expect(two.waveShelter(0, -900, 0)).toBeLessThan(near.waveShelter(0, -900, 0));
  });

  /**
   * The contract the water shader depends on. It walks the island list and
   * closes a landmass off when the id changes, which only works while a
   * landmass's pieces are adjacent -- and GLSL ES 1.00 offers no way to index
   * an array by a group id instead.
   */
  it('hands the shader its islands sorted by landmass', () => {
    const t = new Terrain([
      { pos: { x: 0, y: 0 }, radius: 100, height: 40, seed: 1, land: 2 },
      { pos: { x: 300, y: 0 }, radius: 100, height: 40, seed: 2 },
      { pos: { x: 600, y: 0 }, radius: 100, height: 40, seed: 3, land: 2 },
      { pos: { x: 900, y: 0 }, radius: 100, height: 40, seed: 4, land: 0 },
    ]);
    for (let i = 1; i < t.landGroup.length; i++) {
      expect(t.landGroup[i]).toBeGreaterThanOrEqual(t.landGroup[i - 1]);
    }
    // And an island that named no landmass is its own, never sharing with
    // another that also named none.
    expect(new Set(t.landGroup).size).toBe(3);
  });

  it('leaves a field of ungrouped islands composing exactly as it did', () => {
    // Each is its own landmass, so every group holds one member and the
    // grouped form collapses back to the plain product it replaced.
    const islands = Array.from({ length: 4 }, (_, i) => ({
      pos: { x: i * 700 - 1000, y: 0 },
      radius: 150,
      height: 50,
      seed: i + 7,
    }));
    const t = new Terrain(islands);
    let product = 1;
    for (const isl of islands) product *= new Terrain([isl]).waveShelter(0, -600, 0);
    expect(t.waveShelter(0, -600, 0)).toBeCloseTo(product, 12);
  });
});

describe('endless island field', () => {
  const field = (over: Partial<ConstructorParameters<typeof IslandField>[0]> = {}) =>
    new IslandField({ seed: 42, density: 0.4, keepClear: [], clearance: 130, ...over });

  it('is reproducible from a seed', () => {
    const a = field().active(3000, -1200, 0);
    const b = field().active(3000, -1200, 0);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('gives different worlds for different seeds', () => {
    const a = field().active(0, 0, 0);
    const b = field({ seed: 43 }).active(0, 0, 0);
    expect(a).not.toEqual(b);
  });

  /**
   * The whole point of hashing cells rather than generating a list: an island
   * has to still be there when you sail back to it, however you approach it.
   */
  it('puts the same island in the same place however you come upon it', () => {
    const f = field();
    const first = f.active(0, 0, 0);
    const target = first[0];
    // Sail well away, then back. The window is re-collected from scratch.
    f.active(9000, 9000, 0);
    const again = f.active(0, 0, 0);
    expect(again).toContainEqual(target);
  });

  it('keeps the marks it is told about in navigable water', () => {
    const marks = [
      { x: 0, y: 0 },
      { x: 0, y: 400 },
      { x: -120, y: -90 },
    ];
    const f = field({ density: 0.9, keepClear: marks });
    const t = new Terrain(f.active(0, 200, 0));
    for (const m of marks) {
      expect(t.depthAt(m.x, m.y)).toBeGreaterThan(CRUISER.draft * 2);
    }
  });

  it('is open ocean at zero density', () => {
    expect(field({ density: 0 }).active(0, 0, 0)).toEqual([]);
  });

  /**
   * The window handed to the physics is also the array the water shader loops
   * over, and that loop has a fixed length. Overrun it and the boat would feel
   * land the shader does not draw flat water for.
   */
  it('never hands out more islands than the shader can hold', () => {
    const f = field({ density: 1 }); // clamped to the maximum internally
    for (let x = 0; x < 20000; x += 1300) {
      expect(f.active(x, x * 0.4, 0).length).toBeLessThanOrEqual(MAX_ACTIVE_ISLANDS);
    }
  });

  /**
   * The load window is only honest if land outside it cannot be felt. A wake
   * that outlived the window would mean the wind changed depending on how far
   * away the boat happened to be when the islands were last collected.
   */
  it('reaches further than any wake can', () => {
    expect(ACTIVE_RANGE).toBeGreaterThan(WAKE_MAX);
    const beyond = new Terrain([island(0, WAKE_MAX + 1, 250, 120)]);
    // Wind from the north, so the boat is dead downwind of that island.
    expect(beyond.windExposure(0, 0, 0)).toBe(1);
    expect(beyond.waveShelter(0, 0, 0)).toBe(1);
  });

  /**
   * The cell cache is what gives islands a stable identity, and on a long
   * enough passage it would grow without limit, so it prunes what is far
   * astern. Nothing shorter than a very long passage reaches that threshold --
   * and whatever it drops has to come back exactly as it was.
   */
  it('keeps the cache bounded over a long passage without changing the world', () => {
    const f = field({ density: 0.22 });
    const home = f.active(0, 0, 0);
    let peak = 0;
    for (let d = 0; d < 200000; d += 400) {
      f.visible(d, d * 0.3);
      peak = Math.max(peak, f.cellCount);
    }
    expect(peak).toBeGreaterThan(2048); // the prune really was exercised
    expect(f.cellCount).toBeLessThan(2048);
    expect(f.active(0, 0, 0)).toEqual(home);
  });

  /**
   * The window's whole justification: what it leaves out cannot be felt.
   *
   * Both halves of that get checked here, because both were wrong once. Land
   * beyond ACTIVE_RANGE must not matter -- the first bound measured a wake
   * along its axis and forgot that it spreads, cutting off the last ninety
   * metres of it. And when the window is fuller than the shader can hold, what
   * gets dropped must not matter either -- dropping the furthest island cost
   * up to 0.30 of wind exposure at points the water grid actually samples,
   * because a wake points downwind and distance knows nothing about that.
   *
   * Sampling is at QUERY_REACH, not at the boat: at the boat the old rule
   * looked perfect, which is exactly why it survived review.
   */
  it('leaves out only what cannot be felt, in a crowded window', () => {
    const REACH = 650;
    let worst = 0;
    for (let seed = 1; seed <= 40; seed++) {
      // Wound right up, so the cap bites and there is land outside the window.
      const f = field({ seed, density: MAX_DENSITY });
      for (let i = 0; i < 4; i++) {
        const x = i * 613 + seed * 7;
        const y = i * 389 - seed * 11;
        for (let twd = 0; twd < 6.28; twd += 0.9) {
          const capped = new Terrain(f.active(x, y, twd));
          // Everything anywhere near, with no window and no cap at all.
          const everything = new Terrain(f.debugCollectAll(x, y, ACTIVE_RANGE * 3));
          for (let a = 0; a < 6.28; a += 0.8) {
            const qx = x + Math.cos(a) * REACH;
            const qy = y + Math.sin(a) * REACH;
            worst = Math.max(
              worst,
              Math.abs(capped.windExposure(qx, qy, twd) - everything.windExposure(qx, qy, twd)),
              Math.abs(capped.waveShelter(qx, qy, twd) - everything.waveShelter(qx, qy, twd)),
              Math.abs(capped.depthAt(qx, qy) - everything.depthAt(qx, qy)),
            );
          }
        }
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('recognises an unchanged window so the world is not rebuilt for nothing', () => {
    const f = field();
    // Ten metres is nothing next to a 1.9 km window: the same islands, and the
    // very same objects, must come back.
    expect(sameIslands(f.active(0, 0, 0), f.active(10, 0, 0))).toBe(true);
    expect(sameIslands(f.active(0, 0, 0), f.active(6000, 6000, 0))).toBe(false);
  });
});

describe('grounding physics', () => {
  it('stops the boat in shallow water but lets the sails work it off', () => {
    const s = initialState({ heading: 90 * DEG, u: 4 });
    const sea: SeaState = {
      h13: 0,
      heave: 0,
      pitchSlope: 0,
      rollSlope: 0,
      dir: 0,
      depth: 0.5, // well under the 1.8 m draft
    };
    const ctl = { rudder: 0, sheet: 0, twist: 0, autoTrim: true };
    for (let i = 0; i < 120 * 4; i++) step(s, CRUISER, DEFAULT_ENV, ctl, 1 / 120, { sea });
    expect(msToKnots(Math.hypot(s.u, s.v))).toBeLessThan(0.6);

    // Back in deep water it accelerates again rather than staying stuck.
    const deep: SeaState = { ...sea, depth: Infinity };
    for (let i = 0; i < 120 * 40; i++) step(s, CRUISER, DEFAULT_ENV, ctl, 1 / 120, { sea: deep });
    expect(msToKnots(Math.hypot(s.u, s.v))).toBeGreaterThan(2);
  });
});

describe('wind field with land', () => {
  it('reports the shadow through the sample it hands the physics', () => {
    const w = new WindField(knotsToMs(14), 0, 0, 0, 3);
    const open = w.sample({ x: 0, y: -260 }).tws;
    w.terrain = new Terrain([island(0, 0)]);
    const shadowed = w.sample({ x: 0, y: -260 });
    expect(shadowed.tws).toBeLessThan(open * 0.7);
    expect(shadowed.exposure).toBeLessThan(0.7);
  });

  /**
   * The renderer draws streaks from sampleInto() and the physics reads
   * sample(). They must agree, or the visible lee and the felt lee are in
   * different places.
   */
  it('agrees between the physics sample and the renderer batch sample', () => {
    const w = new WindField(knotsToMs(14), 0.3, 0.5, 0.2, 11);
    w.terrain = new Terrain([island(120, -80)]);
    w.update(12);
    const out: [number, number] = [0, 0];
    for (const p of [
      { x: 0, y: 0 },
      { x: 120, y: -400 },
      { x: -300, y: 250 },
    ]) {
      const a = w.sample(p);
      w.sampleInto(p.x, p.y, out);
      expect(out[0]).toBeCloseTo(a.gust * a.exposure, 6);
      expect(out[1]).toBeCloseTo(a.shift, 6);
    }
  });
});

/**
 * The shader uploads the landmass id plus one into a float slot where zero
 * already means "no island here", so the ids it is given have to be small
 * non-negative integers whatever an author wrote in the venue data.
 */
describe('landmass ids', () => {
  const at = (x: number, land?: number) => ({
    pos: { x, y: 0 },
    radius: 100,
    height: 40,
    seed: x,
    land,
  });

  it('renumbers whatever ids it was given densely from zero', () => {
    const t = new Terrain([at(0, -1), at(300, 9e9), at(600, -1), at(900, 7)]);
    expect([...t.landGroup].sort((a, b) => a - b)).toEqual([0, 0, 1, 2]);
  });

  it('keeps a negative id from reading as an empty slot in the shader', () => {
    // -1 + 1 = 0, and zero is how the shader is told there is no island there,
    // so this coast would have sheltered in the physics and not in the water.
    const t = new Terrain([at(0, -1), at(150, -1)]);
    for (const g of t.landGroup) expect(g).toBeGreaterThanOrEqual(0);
  });

  it('keeps ids far enough apart to stay distinct as a float', () => {
    // Two ids that differ by less than a float32 can resolve would have merged
    // into one landmass in the shader and stayed separate in the physics.
    const t = new Terrain([at(0, 16777216), at(400, 16777217)]);
    expect(new Set(t.landGroup).size).toBe(2);
    for (const g of t.landGroup) expect(g).toBeLessThan(16);
  });

  it('still groups together everything the author said was one coast', () => {
    const t = new Terrain([at(0, 5), at(300, 5), at(600, 5)]);
    expect(new Set(t.landGroup).size).toBe(1);
  });
});
