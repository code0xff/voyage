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
 * the whole encounter instead of running a dive cycle: the interest is in a fin
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
}

/**
 * Shallower than the whale's 18 m: a shark over a bank is not the mistake that
 * a whale over a bank is. It still needs enough water to be swimming in rather
 * than sitting on, and it is the same test the view uses to know the animal is
 * not inside an island.
 */
const MIN_DEPTH = 8;
const SPEED = 1.6;
const ENCOUNTER_DURATION = 42;
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

  update(dt: number, boat: Vec2, terrain: TerrainQuery, boatHeading = 0): void {
    this.events.length = 0;

    if (this.active) {
      this.age += dt;
      if (this.age >= ENCOUNTER_DURATION) {
        this.active = null;
        this.age = 0;
        this.timer = 45 + this.rand() * 90;
        return;
      }

      const dir = compassVec(this.active.heading);
      const nextX = this.active.pos.x + dir.x * SPEED * dt;
      const nextY = this.active.pos.y + dir.y * SPEED * dt;
      // Turns off a shoal rather than swimming up it, so the view never has to
      // hide an animal inside an island.
      if (terrain.depthAt(nextX, nextY) >= MIN_DEPTH) {
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

    const shark = this.findSpawn(boat, boatHeading, terrain);
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
  private findSpawn(boat: Vec2, boatHeading: number, terrain: TerrainQuery): SharkSighting | null {
    for (let attempt = 0; attempt < 10; attempt++) {
      const bearing = boatHeading + (this.rand() - 0.5) * SPAWN_ARC;
      const distance =
        ENCOUNTER_RADIUS_MIN + this.rand() * (ENCOUNTER_RADIUS_MAX - ENCOUNTER_RADIUS_MIN);
      const dir = compassVec(bearing);
      const pos = { x: boat.x + dir.x * distance, y: boat.y + dir.y * distance };
      if (terrain.depthAt(pos.x, pos.y) < MIN_DEPTH) continue;

      // Crossing rather than closing: the shark is going about its own business
      // and happens to pass, which is the only relationship it has to the boat.
      const heading = bearing + Math.PI * 0.5 + (this.rand() - 0.5) * 1.0;
      return {
        id: this.nextId++,
        pos,
        heading,
        size: SHARK_LENGTH_MIN + this.rand() * (SHARK_LENGTH_MAX - SHARK_LENGTH_MIN),
        seed: Math.floor(this.rand() * 0xffffffff),
      };
    }
    return null;
  }
}
