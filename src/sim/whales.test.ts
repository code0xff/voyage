import { describe, expect, it } from 'vitest';
import { EMPTY_TERRAIN, type TerrainQuery } from './terrain';
import { roundIsland } from './land.fixture';
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

  /**
   * Nothing in this simulation collides, so without a rule of its own the hull
   * passes straight through the animal. Spawn geometry cannot prevent that --
   * the player can turn -- so this drives the boat at the whale as hard as it
   * can and asks that they never touch.
   *
   * 20 m is half a whale, half a boat and a few metres: the distance below
   * which the two would be visibly interpenetrating rather than merely close.
   */
  it('is not run down by a boat holding a course into it', () => {
    const BOAT_SPEED = 3.09; // 6 kn, the polar's answer on a beam reach
    /**
     * Started from a dead-on collision course inside the range the whale
     * reacts at, so this measures the rule and not the spawn radius. Left to
     * sail from wherever a sighting opens, a boat covers about 100 m in the
     * 32.5 s an encounter lasts and cannot reach one at all -- which is what
     * currently keeps them apart, and is exactly the protection this rule has
     * to replace when the distances come down.
     *
     * **The course is aimed once and then held.** A boat that re-aims every
     * step is not defended against and cannot be: it makes 3.09 m/s against
     * the whale's 1.8, and a pursuer that keeps pointing at something slower
     * than itself catches it whatever the quarry steers. That is kinematics,
     * not a gap in the rule -- measured worst approach under active pursuit is
     * 0.00 m at every starting range. Keeping a whale from a helmsman who has
     * decided to run one down needs it to be able to outrun him, which is a
     * different change. What this rule owes is that sailing normally never
     * puts the hull through an animal, and that is what is asserted.
     */
    const START = 60;
    let worst = Infinity;
    let closedWith = 0;

    for (const seed of [1, 2, 3, 7, 11, 33, 99, 4711, 20260806]) {
      const whales = new WhaleField(seed);
      const boat = { x: 0, y: 0 };
      let course: { x: number; y: number } | null = null;

      for (let step = 0; step < 120 * 90; step++) {
        whales.update(1 / 120, boat, EMPTY_TERRAIN, 0);
        const whale = whales.events[0];
        if (!whale) {
          course = null;
          continue;
        }

        if (!course) {
          // Put the helm where it can do damage, once per encounter: right
          // astern of the whale and pointed at it.
          boat.x = whale.pos.x;
          boat.y = whale.pos.y - START;
          course = { x: 0, y: 1 };
          closedWith++;
          continue;
        }

        const range = Math.hypot(whale.pos.x - boat.x, whale.pos.y - boat.y);
        worst = Math.min(worst, range);
        boat.x += course.x * BOAT_SPEED * (1 / 120);
        boat.y += course.y * BOAT_SPEED * (1 / 120);
      }
    }

    expect(closedWith).toBeGreaterThan(8);
    expect(worst).toBeGreaterThan(20);
  });

  /**
   * The rule above is tested from a course laid on deliberately. This is the
   * ordinary case it exists to protect, and it is the one that guards the
   * spawn distances: a boat sailing straight, whales opening wherever the
   * simulation puts them.
   *
   * It is what would catch someone bringing the encounter closer again without
   * the rest of the change. At the current 220-560 m the worst approach over
   * this set is 125.8 m, so the assertion has a great deal of room; what it
   * guards is the spawn distances rather than the give-way rule, which at these
   * ranges and six knots barely has to do anything. The rule itself is asserted
   * by the test above and in `giveway.test.ts`.
   */
  it('keeps its distance from a boat that simply sails on, at real spawn ranges', () => {
    const BOAT_SPEED = 3.09;
    let worst = Infinity;
    let encounters = 0;

    for (let seed = 1; seed <= 150; seed++) {
      const whales = new WhaleField(seed);
      const boat = { x: 0, y: 0 };
      let open = false;

      for (let step = 0; step < 120 * 100; step++) {
        whales.update(1 / 120, boat, EMPTY_TERRAIN, 0);
        boat.y += BOAT_SPEED * (1 / 120); // holds her course, due north

        const whale = whales.events[0];
        if (!whale) {
          open = false;
          continue;
        }
        if (!open) {
          open = true;
          encounters++;
        }
        worst = Math.min(worst, Math.hypot(whale.pos.x - boat.x, whale.pos.y - boat.y));
      }
    }

    expect(encounters).toBeGreaterThan(100);
    expect(worst).toBeGreaterThan(20);
  });

  /**
   * The other half of the same rule: a whale pinned between the boat and a bank
   * must turn along the bank rather than be turned onto the boat, into the
   * bank, and back again -- which is a whale shaking in place at 120 Hz.
   */
  it('keeps moving when the boat pins it against shoal water', () => {
    // Deep only to the north; everything south of the line is unswimmable.
    const bank: TerrainQuery = {
      elevationAt: (_x, y) => (y > 0 ? -30 : 2),
      depthAt: (_x, y) => (y > 0 ? 30 : 1),
      isAground: () => false,
      windExposure: () => 1,
      waveShelter: () => 1,
      distanceToShore: (_x, y) => (y > 0 ? Infinity : 0),
      bearingToShore: () => null,
    };

    const whales = new WhaleField(11);
    const boat = { x: 0, y: 0 };
    let travelled = 0;
    let previous: { x: number; y: number } | null = null;

    for (let step = 0; step < 120 * 90; step++) {
      whales.update(1 / 120, boat, bank, 0);
      const whale = whales.events[0];
      if (!whale) continue;
      // Sit the boat just north of it, so the only way clear is along the bank.
      boat.x = whale.pos.x;
      boat.y = whale.pos.y + 30;
      if (previous) travelled += Math.hypot(whale.pos.x - previous.x, whale.pos.y - previous.y);
      previous = { x: whale.pos.x, y: whale.pos.y };
      expect(bank.depthAt(whale.pos.x, whale.pos.y)).toBeGreaterThanOrEqual(18);
    }

    // It has to have gone somewhere rather than vibrated on the spot.
    expect(travelled).toBeGreaterThan(20);
  });

  it('only spawns in water deep enough to remain offshore', () => {
    const land = roundIsland();
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

  /**
   * How often she meets one, which the player sets.
   *
   * These were written as a rare event -- this file's own docblock calls a
   * whale "an event the player can notice for a few seconds" -- and measured
   * they were 46 an hour and in sight 42% of the time, which is scenery. The
   * spacing is the multiple that fixes it and the slider that varies it.
   */
  it('meets fewer of them the wider the spacing is set', () => {
    const perHour = (spacing: number) => {
      let seen = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const whales = new WhaleField(seed);
        whales.spacing = spacing;
        let open = false;
        for (let step = 0; step < 120 * 1800; step++) {
          whales.update(1 / 120, { x: 0, y: 0 }, EMPTY_TERRAIN, 0);
          const on = whales.events.length > 0;
          if (on && !open) seen++;
          open = on;
        }
      }
      return seen / (8 * 0.5);
    };

    const often = perHour(2);
    const seldom = perHour(20);
    expect(often).toBeGreaterThan(seldom * 3);
    expect(seldom).toBeGreaterThan(0);
  });

  /**
   * And none at all means none. Guarded on the spacing rather than left to the
   * timer: the field is built before the setting reaches it, so a first
   * encounter -- which this one guarantees -- was already scheduled and came
   * through anyway. Measured before the guard, 0.3 an hour with the slider at
   * zero.
   */
  it('shows none at all when the spacing is infinite', () => {
    const whales = new WhaleField(17);
    whales.spacing = Infinity;
    // Counted and asserted once, rather than asserted inside the loop. An hour
    // at 120 Hz is 432,000 steps and `expect` is not free: the per-step version
    // spent four seconds of its ten-second budget on the assertion rather than
    // on the simulation, and timed out on CI while passing here. The first
    // offending step is kept so a failure still says when, which is the only
    // thing the per-step form gave that this does not.
    let sightings = 0;
    let firstAt = -1;
    for (let step = 0; step < 120 * 3600; step++) {
      whales.update(1 / 120, { x: 0, y: 0 }, EMPTY_TERRAIN, 0);
      if (whales.events.length > 0) {
        sightings += whales.events.length;
        if (firstAt < 0) firstAt = step;
      }
    }
    expect({ sightings, firstAt }).toEqual({ sightings: 0, firstAt: -1 });
  });
});
