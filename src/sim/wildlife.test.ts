import { describe, expect, it } from 'vitest';
import { FLOCK_DURATION_MAX, FLOCK_DURATION_MIN, Wildlife } from './wildlife';
import type { TerrainQuery } from './terrain';
import { openWater, roundIsland } from './land.fixture';

const OPEN = openWater();
const island = (x: number, y: number) => ({ x, y });

/** Sit a boat somewhere for a while and collect what it heard. */
function calls(
  seed: number,
  terrain: TerrainQuery,
  at: { x: number; y: number },
  seconds = 600,
) {
  const w = new Wildlife(seed);
  const boat = { ...at };
  const heard: { x: number; y: number }[] = [];
  for (let t = 0; t < seconds; t += 0.25) {
    w.update(0.25, boat, terrain);
    for (const e of w.events) heard.push({ ...e.pos });
  }
  return heard;
}

describe('gulls', () => {
  it('keeps a visible flock observable, nearby and separated from the next one', () => {
    const wildlife = new Wildlife(17);
    const land = roundIsland({ centre: island(0, 0) });
    const boat = { x: 350, y: 0 };
    const step = 0.25;
    let elapsed = 0;
    while (wildlife.flocks.length === 0 && elapsed < 20) {
      wildlife.update(step, boat, land);
      elapsed += step;
    }
    const first = wildlife.flocks[0];
    if (!first) throw new Error('expected the seeded first flock');
    const firstAt = elapsed;
    expect(firstAt).toBeGreaterThanOrEqual(5);
    expect(firstAt).toBeLessThanOrEqual(15.25);
    expect(Math.hypot(first.pos.x - boat.x, first.pos.y - boat.y)).toBeGreaterThanOrEqual(50);
    expect(Math.hypot(first.pos.x - boat.x, first.pos.y - boat.y)).toBeLessThanOrEqual(140);
    for (const member of first.members) {
      expect(member.wingspan).toBeGreaterThanOrEqual(1.6);
      expect(member.wingspan).toBeLessThanOrEqual(1.9);
    }

    const opacities = [first.opacity];
    while (wildlife.flocks.some((flock) => flock.id === first.id)) {
      wildlife.update(step, boat, land);
      elapsed += step;
      if (wildlife.flocks[0]?.id === first.id) opacities.push(wildlife.flocks[0].opacity);
    }
    // Derived, so retuning the flock does not fail a test about the fade.
    expect(elapsed - firstAt).toBeGreaterThanOrEqual(FLOCK_DURATION_MIN);
    expect(elapsed - firstAt).toBeLessThanOrEqual(FLOCK_DURATION_MAX + step);
    expect(opacities[0]).toBe(0);
    expect(Math.max(...opacities)).toBe(1);
    expect(opacities.at(-1)).toBeLessThan(0.2);

    while (wildlife.flocks.length === 0 && elapsed - firstAt < 80) {
      wildlife.update(step, boat, land);
      elapsed += step;
    }
    expect(wildlife.flocks[0]?.id).not.toBe(first.id);
    expect(elapsed - firstAt).toBeGreaterThanOrEqual(35);
    expect(elapsed - firstAt).toBeLessThanOrEqual(75.25);
  });

  it('shows a bounded, deterministic flock near land and none offshore', () => {
    const record = (at: { x: number; y: number }, step: number) => {
      const wildlife = new Wildlife(17);
      const seen: string[] = [];
      const land = roundIsland({ centre: island(0, 0) });
      for (let t = 0; t < 600; t += step) {
        wildlife.update(step, at, land);
        for (const flock of wildlife.flocks) {
          for (const member of flock.members) {
            expect(member.altitude).toBeGreaterThan(8);
            expect(member.altitude).toBeLessThan(28);
          }
          const shape = flock.members
            .map((m) => `${m.offset.x}/${m.offset.y}/${m.altitude}/${m.yaw}/${m.phase}`)
            .join(',');
          seen.push(`${flock.id}:${flock.pos.x}:${flock.pos.y}:${shape}:${flock.duration}`);
        }
      }
      return seen;
    };
    const near = record({ x: 350, y: 0 }, 0.25);
    expect(near.length).toBeGreaterThan(0);
    const encounters = new Set(near.map((sample) => sample.slice(0, sample.indexOf(':'))));
    expect(encounters.size).toBeGreaterThanOrEqual(7);
    expect(encounters.size).toBeLessThanOrEqual(15);
    expect(near).toEqual(record({ x: 350, y: 0 }, 0.25));
    expect(record({ x: 4000, y: 0 }, 0.25)).toHaveLength(0);
    // A flock holds its patch of sky, so there is no trajectory to compare --
    // what this pins is that the step size cannot change where one ends up.
    // It guards the day something here does start to move, and it already
    // catches a spawn whose draws depend on how the time was sliced.
    const cadenceLand = roundIsland({ centre: island(0, 0) });
    const advance = (wildlife: Wildlife, step: number, seconds: number) => {
      for (let elapsed = 0; elapsed < seconds - step / 2; elapsed += step) {
        wildlife.update(step, { x: 350, y: 0 }, cadenceLand);
      }
      return wildlife.flocks[0];
    };
    const slow = new Wildlife(17);
    const fast = new Wildlife(17);
    let spawned = false;
    for (let elapsed = 0; elapsed < 600 && !spawned; elapsed += 0.25) {
      slow.update(0.25, { x: 350, y: 0 }, cadenceLand);
      fast.update(0.25, { x: 350, y: 0 }, cadenceLand);
      spawned = slow.flocks.length > 0;
    }
    expect(spawned).toBe(true);
    const slowFlock = advance(slow, 0.25, 4);
    const fastFlock = advance(fast, 1 / 120, 4);
    if (!slowFlock || !fastFlock) throw new Error('the active flock ended before cadence comparison');
    expect(fastFlock.members.length).toBe(slowFlock.members.length);
    expect(fastFlock.members[0].altitude).toBeCloseTo(slowFlock.members[0].altitude, 8);
    expect(fastFlock.pos.x).toBeCloseTo(slowFlock.pos.x, 8);
    expect(fastFlock.pos.y).toBeCloseTo(slowFlock.pos.y, 8);
  });

  /**
   * Reported from the game: the birds read as going somewhere rather than
   * working a patch of sky.
   *
   * The asset is one baked circuit of four birds that carries them 28 m before
   * it repeats, so a flock of exactly one copy is a formation on passage, and
   * nothing about a single copy can be tuned out of that. A flock is now
   * several copies, and what makes them a flock rather than a queue is that
   * they are turned differently and started at different points in the loop.
   *
   * The bounds are written out rather than imported. They are the claim -- at
   * least three groups, mixed, facing different ways -- and read from the
   * constants they would assert that the flock has however many groups it has.
   */
  it('builds a flock from several groups that are mixed rather than in step', () => {
    const land = roundIsland({ centre: island(0, 0) });
    const wildlife = new Wildlife(17);
    const boat = { x: 350, y: 0 };
    const seen: (typeof wildlife.flocks)[number][] = [];

    for (let t = 0; t < 600; t += 0.25) {
      wildlife.update(0.25, boat, land);
      const flock = wildlife.flocks[0];
      if (flock && seen.at(-1)?.id !== flock.id) seen.push(flock);
    }
    expect(seen.length).toBeGreaterThan(4);

    for (const flock of seen) {
      expect(flock.members.length).toBeGreaterThanOrEqual(3);

      // Close enough that the circuits overlap and the birds mix. The authored
      // loop is 28 m across, so groups further apart than that are separate
      // sightings standing next to each other.
      for (const member of flock.members) {
        expect(Math.hypot(member.offset.x, member.offset.y)).toBeLessThanOrEqual(16);
      }
      // ...and not all in one place either, or there is nothing to mix.
      const spread = Math.max(
        ...flock.members.map((m) => Math.hypot(m.offset.x, m.offset.y)),
      );
      expect(spread).toBeGreaterThan(4);

      // The two that stop it being one body moving. Both are angles and phases
      // rather than positions, so a flock could satisfy the spread above and
      // still fly in perfect formation without them.
      //
      // Distinctness rather than a threshold, and deliberately: "not in step"
      // is exactly what it means for no two groups to share a value, and any
      // implementation that gives them all one yaw or one phase -- which is
      // what this replaced -- fails it outright rather than by a margin
      // somebody has to pick.
      expect(new Set(flock.members.map((m) => m.yaw)).size).toBe(flock.members.length);
      expect(new Set(flock.members.map((m) => m.phase)).size).toBe(flock.members.length);
    }

    // Distinctness cannot tell 0.001 apart from a full turn, so the spread is
    // checked once over every group in every flock, where there are enough
    // samples for the bound to be nowhere near the edge.
    const yaws = seen.flatMap((flock) => flock.members.map((m) => m.yaw));
    const phases = seen.flatMap((flock) => flock.members.map((m) => m.phase));
    expect(yaws.length).toBeGreaterThan(15);
    expect(Math.max(...yaws) - Math.min(...yaws)).toBeGreaterThan(Math.PI);
    expect(Math.max(...phases) - Math.min(...phases)).toBeGreaterThan(0.8);
  });

  it('replays exactly from a seed', () => {
    const land = roundIsland({ centre: island(0, 0) });
    expect(calls(11, land, { x: 420, y: 0 })).toEqual(calls(11, land, { x: 420, y: 0 }));
  });

  it('gives different seeds different birds', () => {
    const land = roundIsland({ centre: island(0, 0) });
    expect(calls(11, land, { x: 420, y: 0 })).not.toEqual(calls(9812, land, { x: 420, y: 0 }));
  });

  /**
   * The whole point of them: a cue that says land is near before the haze gives
   * it up. Silent offshore, frequent close in.
   */
  it('calls near a shore and not in open water', () => {
    const land = roundIsland({ centre: island(0, 0) });
    // 260 m off the beach of a 200 m island, and half a sea away from it.
    expect(calls(33, land, { x: 460, y: 0 }).length).toBeGreaterThan(0);
    expect(calls(33, land, { x: 4000, y: 0 }).length).toBe(0);
    expect(calls(33, OPEN, { x: 0, y: 0 }).length).toBe(0);
  });

  it('gets busier the closer in you are', () => {
    const land = roundIsland({ centre: island(0, 0) });
    const far = calls(7, land, { x: 850, y: 0 }).length;
    const near = calls(7, land, { x: 260, y: 0 }).length;
    expect(near).toBeGreaterThan(far);
  });

  /**
   * Regression: starting a new session reseeded the wind, the weather and the
   * islands but not the birds, so the gulls carried on from wherever the last
   * passage had left their stream. A world is meant to be reproducible from its
   * seed all the way through, and one carried-over generator was enough to make
   * the same seed sound different depending on what you had sailed before it.
   */
  it('restarts its stream on reseed, so a seed sounds the same however it is reached', () => {
    const land = roundIsland({ centre: island(0, 0) });
    const at = { x: 420, y: 0 };

    const reused = new Wildlife(9812);
    for (let t = 0; t < 400; t += 0.25) reused.update(0.25, { x: 4000, y: 0 }, land);
    reused.reseed(11);

    const heard: { x: number; y: number }[] = [];
    for (let t = 0; t < 600; t += 0.25) {
      reused.update(0.25, { ...at }, land);
      for (const e of reused.events) heard.push({ ...e.pos });
    }

    expect(heard.length).toBeGreaterThan(0);
    expect(heard).toEqual(calls(11, land, at));
  });

  /** A pending call must not be heard in the world that replaced it. */
  it('drops any event still in hand when it is reseeded', () => {
    const land = roundIsland({ centre: island(0, 0) });
    const w = new Wildlife(12);
    for (let t = 0; t < 900 && w.events.length === 0; t += 0.25) {
      w.update(0.25, { x: 350, y: 0 }, land);
    }
    expect(w.events.length).toBeGreaterThan(0);
    w.reseed(12);
    expect(w.events.length).toBe(0);
  });

  /** A call has to come from somewhere a bird could be, not from the masthead. */
  it('places calls off the boat, between it and the land', () => {
    const boat = { x: 350, y: 0 };
    const heard = calls(12, roundIsland({ centre: island(0, 0) }), boat, 900);
    expect(heard.length).toBeGreaterThan(0);
    for (const pos of heard) {
      expect(Math.hypot(pos.x - boat.x, pos.y - boat.y)).toBeGreaterThan(10);
      // Roughly shorewards: the offset is towards the island, not away from it.
      expect(pos.x).toBeLessThan(boat.x + 60);
      expect(Number.isFinite(pos.y)).toBe(true);
    }
  });
});
