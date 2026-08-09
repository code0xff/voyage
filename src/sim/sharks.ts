import { compassVec, type Vec2 } from './math';
import { rng } from './rng';
import type { TerrainQuery } from './terrain';
import { CRUISER } from './config';

/**
 * Seeded shark encounters.
 *
 * A shark is a sighting and nothing more: it exerts no force, it does not seek
 * the boat, and losing it changes no outcome. Like the whale it lives here
 * rather than in the renderer so that its timing and its track are headless and
 * reproducible -- the view only has to make the event look alive.
 *
 * It differs from the whale in two ways that are deliberate. It passes close
 * enough to be recognised as a shark rather than a shape, and it stays up for
 * most of the encounter before sounding at the end: the interest is in a fin
 * holding a steady course across your bow, not in a performance.
 */
export interface SharkSighting {
  /** Stable for the life of this encounter, so the view can reuse its mesh. */
  id: number;
  /** World position, not an offset from the boat. */
  pos: Vec2;
  /** Compass direction the shark is travelling towards. */
  heading: number;
  /** Individual variation, in metres. */
  size: number;
  /** Seed for small visual differences that must not affect the simulation. */
  seed: number;
  /** End-of-encounter dive, from fully surfaced at 0 to submerged at 1. */
  diveT: number;
}

/**
 * Shallower than the whale's 18 m: a shark over a bank is not the mistake that
 * a whale over a bank is. It still needs enough water to be swimming in rather
 * than sitting on, and it is the same test the view uses to know the animal is
 * not inside an island.
 */
const MIN_DEPTH = 8;
const SPEED = 1.6;
/**
 * How long a sighting lasts, and how much of its tail is spent going down.
 *
 * Exported because `sharks.test.ts` asserts when the descent begins, and a
 * test that writes `36` has quietly decided these two may never be retuned.
 */
export const ENCOUNTER_DURATION = 42;
/** Long enough to read as a deliberate sounding rather than a disappearing mesh. */
export const DIVE_DURATION = 6;
// Close enough to read as an animal, far enough not to look staged. Below about
// 40 m the chase camera cannot hold both the boat and the fin in one frame.
const ENCOUNTER_RADIUS_MIN = 45;
const ENCOUNTER_RADIUS_MAX = 115;
// This stylised asset is treated as a large adult great-white-sized animal,
// around half the yacht's length. It is not a claim about an average shark.
const SHARK_LENGTH_MIN = CRUISER.loa * 0.45;
const SHARK_LENGTH_MAX = CRUISER.loa * 0.65;
/** How wide an arc ahead of the boat a sighting may open in, radians. */
const SPAWN_ARC = 1.6;
/** Fraction of eligible attempts that actually produce a shark. */
const ENCOUNTER_CHANCE = 0.35;

/**
 * How far a shark keeps from another animal, m.
 *
 * Two sightings on top of each other are one confused shape rather than two
 * animals. Sized off what is actually drawn: an 18 m whale reaches 9 m from its
 * centre and the footprint it lies in about 10 m, and a shark half that again,
 * so a little over thirty metres already separates them and this leaves margin.
 *
 * Not larger, and that is the constraint rather than the taste. A shark opens
 * between 45 m and 115 m inside an arc off the bow; an exclusion disc much
 * wider than this covers the whole of that envelope, and the animal then has
 * nowhere to be at all. At 90 m -- the first value tried -- a whale parked in
 * the middle of the arc suppressed every shark in every seed.
 */
const CLEAR_OF_OTHERS = 45;

/** What a shark keeps clear of. Structural, so this file need not know of whales. */
export interface Occupant {
  readonly pos: Vec2;
}

function clashes(x: number, y: number, others: readonly Occupant[]): boolean {
  for (const other of others) {
    if (Math.hypot(x - other.pos.x, y - other.pos.y) < CLEAR_OF_OTHERS) return true;
  }
  return false;
}

export class SharkField {
  readonly events: SharkSighting[] = [];

  private rand: () => number;
  private timer = 0;
  private age = 0;
  private nextId = 1;
  private active: SharkSighting | null = null;

  constructor(seed = 1) {
    this.rand = rng(seed ^ 0x5a4b);
    this.reseed(seed);
  }

  /** Restart the encounter stream with the world. */
  reseed(seed: number): void {
    this.rand = rng(seed ^ 0x5a4b);
    this.timer = 30 + this.rand() * 50;
    this.age = 0;
    this.nextId = 1;
    this.active = null;
    this.events.length = 0;
  }

  /**
   * @param others sightings already placed this step -- the whale -- that this
   *   one must not be drawn on top of. Read structurally rather than imported,
   *   so the two species stay independent of each other.
   */
  update(
    dt: number,
    boat: Vec2,
    terrain: TerrainQuery,
    boatHeading = 0,
    others: readonly Occupant[] = [],
  ): void {
    this.events.length = 0;

    if (this.active) {
      this.age += dt;
      if (this.age >= ENCOUNTER_DURATION) {
        this.active = null;
        this.age = 0;
        this.timer = 45 + this.rand() * 90;
        return;
      }

      this.active.diveT = Math.max(
        0,
        Math.min(1, (this.age - (ENCOUNTER_DURATION - DIVE_DURATION)) / DIVE_DURATION),
      );

      const dir = compassVec(this.active.heading);
      const nextX = this.active.pos.x + dir.x * SPEED * dt;
      const nextY = this.active.pos.y + dir.y * SPEED * dt;
      // Turns off a shoal rather than swimming up it, so the view never has to
      // hide an animal inside an island -- and off another animal for the same
      // reason, so two sightings never converge into one shape.
      if (terrain.depthAt(nextX, nextY) >= MIN_DEPTH && !clashes(nextX, nextY, others)) {
        this.active.pos.x = nextX;
        this.active.pos.y = nextY;
      } else {
        this.active.heading += Math.PI;
      }

      this.events.push(this.active);
      return;
    }

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 50 + this.rand() * 100;
    if (this.rand() > ENCOUNTER_CHANCE) return;

    const shark = this.findSpawn(boat, boatHeading, terrain, others);
    if (!shark) return;
    this.active = shark;
    this.age = 0;
    this.events.push(shark);
  }

  /**
   * The default chase camera looks over the boat's bow, so a sighting opens
   * somewhere in the forward arc. Somewhere in it, though, and not on the
   * centreline: taking the boat's heading as the bearing unchanged put every
   * shark in every world dead ahead at exactly 0 degrees, always crossing to
   * starboard, which reads as a scripted event rather than as an animal that
   * was already there.
   */
  private findSpawn(
    boat: Vec2,
    boatHeading: number,
    terrain: TerrainQuery,
    others: readonly Occupant[],
  ): SharkSighting | null {
    for (let attempt = 0; attempt < 10; attempt++) {
      const bearing = boatHeading + (this.rand() - 0.5) * SPAWN_ARC;
      const distance =
        ENCOUNTER_RADIUS_MIN + this.rand() * (ENCOUNTER_RADIUS_MAX - ENCOUNTER_RADIUS_MIN);
      const dir = compassVec(bearing);
      const pos = { x: boat.x + dir.x * distance, y: boat.y + dir.y * distance };
      if (terrain.depthAt(pos.x, pos.y) < MIN_DEPTH) continue;
      if (clashes(pos.x, pos.y, others)) continue;

      // Crossing rather than closing: the shark is going about its own business
      // and happens to pass, which is the only relationship it has to the boat.
      const heading = bearing + Math.PI * 0.5 + (this.rand() - 0.5) * 1.0;
      return {
        id: this.nextId++,
        pos,
        heading,
        size: SHARK_LENGTH_MIN + this.rand() * (SHARK_LENGTH_MAX - SHARK_LENGTH_MIN),
        seed: Math.floor(this.rand() * 0xffffffff),
        diveT: 0,
      };
    }
    return null;
  }
}
