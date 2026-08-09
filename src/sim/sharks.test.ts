import { describe, expect, it } from 'vitest';
import { EMPTY_TERRAIN, Terrain, type TerrainQuery } from './terrain';
import { SharkField } from './sharks';

const STEP = 0.25;

interface Seen {
  id: number;
  x: number;
  y: number;
  heading: number;
  size: number;
  seed: number;
  diveT: number;
}

/** Hold a boat somewhere on a fixed heading and collect what swam past. */
function record(
  seed: number,
  terrain: TerrainQuery = EMPTY_TERRAIN,
  boat = { x: 0, y: 0 },
  boatHeading = 0,
  seconds = 2400,
): Seen[] {
  const sharks = new SharkField(seed);
  const seen: Seen[] = [];
  for (let t = 0; t < seconds; t += STEP) {
    sharks.update(STEP, boat, terrain, boatHeading);
    for (const shark of sharks.events) {
      seen.push({
        id: shark.id,
        x: shark.pos.x,
        y: shark.pos.y,
        heading: shark.heading,
        size: shark.size,
        seed: shark.seed,
        diveT: shark.diveT,
      });
    }
  }
  return seen;
}

describe('sharks', () => {
  /**
   * The test this file used to be was a determinism check that compared two
   * empty arrays: over the 200 s it ran, its seed never produced a sighting at
   * all, so every other property went unasserted. Every test below therefore
   * asserts it actually saw something before asserting anything about it.
   */
  it('produces sightings in open water', () => {
    for (const seed of [11, 12, 33, 9812]) {
      expect(record(seed).length).toBeGreaterThan(0);
    }
  });

  it('replays encounters exactly from a seed', () => {
    const first = record(12);
    expect(first.length).toBeGreaterThan(0);
    expect(first).toEqual(record(12));
  });

  it('gives different seeds different encounter streams', () => {
    expect(record(11)).not.toEqual(record(9812));
  });

  /**
   * Regression: `spawn` took the boat's heading as the bearing without an
   * offset, so every shark in every world appeared at exactly 0 degrees
   * relative -- dead ahead on the centreline -- and always crossed the same
   * way. The forward arc is the point (the chase camera looks over the bow);
   * the centreline is not.
   */
  it('opens across the forward arc rather than dead ahead', () => {
    const relative: number[] = [];
    for (const seed of [1, 2, 3, 4, 5, 11, 12, 33]) {
      const first = record(seed)[0];
      if (first) relative.push(Math.atan2(first.x, first.y));
    }

    expect(relative.length).toBeGreaterThan(4);
    // Inside the forward arc, so the sighting cannot be silently astern.
    for (const bearing of relative) expect(Math.abs(bearing)).toBeLessThan(0.9);
    // ...but spread across it, rather than every world using the centreline.
    expect(Math.max(...relative) - Math.min(...relative)).toBeGreaterThan(0.4);
    expect(relative.some((bearing) => bearing < -0.05)).toBe(true);
    expect(relative.some((bearing) => bearing > 0.05)).toBe(true);
  });

  it('stays in water it could swim in', () => {
    const land = new Terrain([{ pos: { x: 0, y: 0 }, radius: 200, height: 70, seed: 3 }]);
    // Offshore of a 200 m island, so the whole spawn arc is over real water.
    const seen = record(11, land, { x: 600, y: 0 });
    expect(seen.length).toBeGreaterThan(0);
    for (const shark of seen) {
      expect(land.depthAt(shark.x, shark.y)).toBeGreaterThanOrEqual(8);
    }
  });

  /**
   * The turn itself, on a terrain built to force it: a deep channel 200 m wide
   * that the shark's crossing track runs straight out of. It has to turn back
   * rather than swim up the bank -- the view has no way to hide an animal that
   * ends up inside an island.
   */
  it('turns off a shoal instead of swimming up it', () => {
    const channel: TerrainQuery = {
      elevationAt: (x) => (Math.abs(x) < 100 ? -20 : 2),
      depthAt: (x) => (Math.abs(x) < 100 ? 20 : 2),
      isAground: () => false,
      windExposure: () => 1,
      waveShelter: () => 1,
      distanceToShore: () => Infinity,
      bearingToShore: () => null,
    };

    const seen = record(11, channel);
    expect(seen.length).toBeGreaterThan(0);
    for (const shark of seen) expect(Math.abs(shark.x)).toBeLessThan(100);
    // It has to have actually run into the bank, or the test proves nothing.
    expect(Math.max(...seen.map((shark) => Math.abs(shark.x)))).toBeGreaterThan(90);
  });

  it('stays silent when every candidate is too shallow', () => {
    const shallow: TerrainQuery = {
      elevationAt: () => -2,
      depthAt: () => 2,
      isAground: () => false,
      windExposure: () => 1,
      waveShelter: () => 1,
      distanceToShore: () => Infinity,
      bearingToShore: () => null,
    };
    expect(record(11, shallow)).toEqual([]);
  });

  /** One encounter at a time, and a new one is a new animal, not a teleport. */
  it('shows one shark at a time and never reuses an id', () => {
    const sharks = new SharkField(12);
    const ids: number[] = [];
    for (let t = 0; t < 2400; t += STEP) {
      sharks.update(STEP, { x: 0, y: 0 }, EMPTY_TERRAIN, 0);
      expect(sharks.events.length).toBeLessThanOrEqual(1);
      const shark = sharks.events[0];
      if (shark && ids[ids.length - 1] !== shark.id) ids.push(shark.id);
    }
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sounds gradually at the end of an encounter', () => {
    const seen = record(12);
    const firstId = seen[0]?.id;
    const encounter = seen.filter((shark) => shark.id === firstId);

    expect(encounter.length).toBeGreaterThan(0);
    expect(encounter[0].diveT).toBe(0);
    const firstDive = encounter.findIndex((shark) => shark.diveT > 0);
    expect(firstDive).toBeGreaterThan(0);
    expect(firstDive * STEP).toBeGreaterThan(36);
    expect(firstDive * STEP).toBeLessThanOrEqual(36 + STEP);
    expect(encounter[firstDive].diveT).toBeLessThan(1);
    for (let i = 1; i < encounter.length; i++) {
      expect(encounter[i].diveT).toBeGreaterThanOrEqual(encounter[i - 1].diveT);
    }
    expect(encounter[encounter.length - 1].diveT).toBeGreaterThan(0.9);
  });

  /**
   * Two sightings on top of each other are one confused shape, not two animals.
   * Reported from the game: a shark drawn inside a whale.
   *
   * The whale is stood still here rather than simulated, because what is being
   * asserted is the shark's rule -- that it will neither open on top of another
   * animal nor swim into one -- and a moving whale would make the test depend
   * on where the encounter happened to put it.
   */
  it('neither opens on nor swims into another animal', () => {
    let checked = 0;

    for (const seed of [11, 12, 33, 9812]) {
      const sharks = new SharkField(seed);
      const boat = { x: 0, y: 0 };
      // Inside the spawn envelope but off to one side. Parked dead centre it
      // legitimately suppresses the encounter altogether, which asserts nothing.
      const whale = { pos: { x: 55, y: 55 } };

      for (let t = 0; t < 2400; t += STEP) {
        sharks.update(STEP, boat, EMPTY_TERRAIN, 0, [whale]);
        for (const shark of sharks.events) {
          checked++;
          expect(
            Math.hypot(shark.pos.x - whale.pos.x, shark.pos.y - whale.pos.y),
          ).toBeGreaterThanOrEqual(45);
        }
      }
    }

    expect(checked).toBeGreaterThan(0);
  });

  it('restarts its stream on reseed', () => {
    const reused = new SharkField(9812);
    for (let t = 0; t < 600; t += STEP) reused.update(STEP, { x: 0, y: 0 }, EMPTY_TERRAIN, 0);
    reused.reseed(12);

    const seen: number[] = [];
    for (let t = 0; t < 2400; t += STEP) {
      reused.update(STEP, { x: 0, y: 0 }, EMPTY_TERRAIN, 0);
      for (const shark of reused.events) seen.push(shark.pos.x);
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toEqual(record(12).map((shark) => shark.x));
  });
});
