import { describe, expect, it } from 'vitest';
import {
  ACTIVE_RANGE,
  IslandField,
  MAX_ACTIVE_ISLANDS,
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

describe('endless island field', () => {
  const field = (over: Partial<ConstructorParameters<typeof IslandField>[0]> = {}) =>
    new IslandField({ seed: 42, density: 0.4, keepClear: [], clearance: 130, ...over });

  it('is reproducible from a seed', () => {
    const a = field().active(3000, -1200);
    const b = field().active(3000, -1200);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('gives different worlds for different seeds', () => {
    const a = field().active(0, 0);
    const b = field({ seed: 43 }).active(0, 0);
    expect(a).not.toEqual(b);
  });

  /**
   * The whole point of hashing cells rather than generating a list: an island
   * has to still be there when you sail back to it, however you approach it.
   */
  it('puts the same island in the same place however you come upon it', () => {
    const f = field();
    const first = f.active(0, 0);
    const target = first[0];
    // Sail well away, then back. The window is re-collected from scratch.
    f.active(9000, 9000);
    const again = f.active(0, 0);
    expect(again).toContainEqual(target);
  });

  it('keeps the marks it is told about in navigable water', () => {
    const marks = [
      { x: 0, y: 0 },
      { x: 0, y: 400 },
      { x: -120, y: -90 },
    ];
    const f = field({ density: 0.9, keepClear: marks });
    const t = new Terrain(f.active(0, 200));
    for (const m of marks) {
      expect(t.depthAt(m.x, m.y)).toBeGreaterThan(CRUISER.draft * 2);
    }
  });

  it('is open ocean at zero density', () => {
    expect(field({ density: 0 }).active(0, 0)).toEqual([]);
  });

  /**
   * The window handed to the physics is also the array the water shader loops
   * over, and that loop has a fixed length. Overrun it and the boat would feel
   * land the shader does not draw flat water for.
   */
  it('never hands out more islands than the shader can hold', () => {
    const f = field({ density: 1 }); // clamped to the maximum internally
    for (let x = 0; x < 20000; x += 1300) {
      expect(f.active(x, x * 0.4).length).toBeLessThanOrEqual(MAX_ACTIVE_ISLANDS);
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

  it('recognises an unchanged window so the world is not rebuilt for nothing', () => {
    const f = field();
    // Ten metres is nothing next to a 1.9 km window: the same islands, and the
    // very same objects, must come back.
    expect(sameIslands(f.active(0, 0), f.active(10, 0))).toBe(true);
    expect(sameIslands(f.active(0, 0), f.active(6000, 6000))).toBe(false);
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
    const ctl = { rudder: 0, sheet: 0, autoTrim: true };
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
