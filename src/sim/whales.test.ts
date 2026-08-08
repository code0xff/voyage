import { describe, expect, it } from 'vitest';
import { EMPTY_TERRAIN, Terrain, type TerrainQuery } from './terrain';
import { WhaleField } from './whales';

function record(seed: number, terrain: TerrainQuery = EMPTY_TERRAIN) {
  const whales = new WhaleField(seed);
  const seen: { id: number; x: number; y: number; heading: number; size: number; phase: string; seed: number }[] = [];
  for (let i = 0; i < 240 * 4; i++) {
    whales.update(0.25, { x: 0, y: 0 }, terrain);
    for (const whale of whales.events) {
      seen.push({ id: whale.id, x: whale.pos.x, y: whale.pos.y, heading: whale.heading, size: whale.size, phase: whale.phase, seed: whale.seed });
    }
  }
  return seen;
}

describe('whales', () => {
  it('offers a first sighting promptly in suitable water', () => {
    const whales = new WhaleField(20260806);
    let sighted = false;
    for (let i = 0; i < 20 * 4; i++) {
      whales.update(0.25, { x: 0, y: 0 }, EMPTY_TERRAIN, 0);
      if (whales.events.length > 0) sighted = true;
    }
    expect(sighted).toBe(true);
  });

  /**
   * Regression: the first sighting is deliberately guaranteed, and the delay
   * before it is one draw off a fresh generator. With the unstirred xorshift
   * that draw was ~0.310 for every small seed, so every world surfaced its
   * first whale 10.5 s in -- the most conspicuous place the seed could fail to
   * mean anything. See sim/rng.ts.
   */
  it('does not open every world at the same moment', () => {
    const firstSighting = (seed: number): number => {
      const whales = new WhaleField(seed);
      for (let step = 0; step < 60 * 120; step++) {
        whales.update(1 / 120, { x: 0, y: 0 }, EMPTY_TERRAIN, 0);
        if (whales.events.length > 0) return step / 120;
      }
      return -1;
    };

    const times = [1, 2, 3, 7, 99, 20260806].map(firstSighting);
    for (const at of times) expect(at).toBeGreaterThan(0);
    expect(new Set(times.map((at) => at.toFixed(1))).size).toBeGreaterThan(3);
  });

  it('replays encounters exactly from a seed', () => {
    expect(record(11)).toEqual(record(11));
  });

  it('gives different seeds different encounter streams', () => {
    expect(record(11)).not.toEqual(record(9812));
  });

  it('shows the complete surface-to-dive behaviour', () => {
    const phases = new Set(record(33).map((s) => s.phase));
    expect(phases).toEqual(new Set(['surfacing', 'blow', 'rolling', 'diving']));
  });

  it('only spawns in water deep enough to remain offshore', () => {
    const land = new Terrain([
      { pos: { x: 0, y: 0 }, radius: 200, height: 70, seed: 3 },
    ]);
    for (const sighting of record(7, land)) {
      expect(land.depthAt(sighting.x, sighting.y)).toBeGreaterThanOrEqual(18);
      expect(land.distanceToShore(sighting.x, sighting.y)).toBeGreaterThanOrEqual(120);
    }
  });

  it('stays silent when every candidate is too shallow', () => {
    const shallow: TerrainQuery = {
      elevationAt: () => -5,
      depthAt: () => 5,
      isAground: () => false,
      windExposure: () => 1,
      waveShelter: () => 1,
      distanceToShore: () => Infinity,
      bearingToShore: () => null,
    };
    expect(record(7, shallow)).toEqual([]);
  });
});
