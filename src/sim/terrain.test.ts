import { describe, expect, it } from 'vitest';
import { Terrain, generateArchipelago, type Island } from './terrain';
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

describe('archipelago generation', () => {
  it('is reproducible from a seed', () => {
    const opts = {
      seed: 42,
      count: 4,
      keepClear: [{ x: 0, y: 0 }],
      clearance: 100,
      minRange: 300,
      maxRange: 900,
      origin: { x: 0, y: 0 },
    };
    const a = generateArchipelago(opts);
    const b = generateArchipelago(opts);
    expect(a.islands).toEqual(b.islands);
  });

  it('keeps clear of the marks it is told about', () => {
    const marks = [
      { x: 0, y: 0 },
      { x: 0, y: 400 },
    ];
    const t = generateArchipelago({
      seed: 9,
      count: 6,
      keepClear: marks,
      clearance: 130,
      minRange: 200,
      maxRange: 900,
      origin: { x: 0, y: 200 },
    });
    for (const m of marks) {
      // A mark must stay in navigable water.
      expect(t.depthAt(m.x, m.y)).toBeGreaterThan(CRUISER.draft * 2);
    }
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
