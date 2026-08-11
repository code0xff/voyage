import { compassVec, type Vec2 } from './math';
import { giveWay } from './giveway';
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

/**
 * The shark's tuning of the give-way rule. See `giveway.ts` for why it needs
 * one at all and what each of these means.
 *
 * Reported from the game: a shark swimming through the hull. Measured before
 * changing anything, over 4561 encounters with the boat sailing a straight
 * course at six knots, 31.0% passed inside 20 m, 15.4% inside 10 m and 7.5%
 * inside 5 m, with the worst at 0.0 m -- dead centre. Standing still the worst
 * was 40.5 m, which is why this went unnoticed so long: every test in
 * `sharks.test.ts` parked the boat, and a shark on a fixed heading past a
 * stationary boat cannot hit it.
 *
 * After, at the same six knots: worst 20.1 m and nothing at all inside 20 m.
 * At 8.2 kn, the fastest the polar gives at the strongest wind the settings
 * allow, 15.5 m; with four knots of fair tide under that, 10.5 m. Nothing
 * inside 10 m at any speed, against a hull and a fin that meet at about 8 m.
 *
 * `LANE` is what sets that floor, and it is also where the character is spent,
 * which is why there is a limit to how safe this can be made: a fin crossing
 * your bow has to cross your track. At 26 m the median closest pass goes from
 * 34 m to 40 m, which is if anything better framing -- below about 40 m the
 * chase camera cannot hold both the boat and the fin.
 *
 * `NOTICE` mostly decides how early the deflection starts, and so how much of
 * it accumulates, but it is not free: 45 leaves too little lead and the floor
 * at 8.2 kn falls from 15.5 m to 14.4, and 40 to 12.5. 50 is the smallest that
 * keeps a shark clear at every speed the boat can actually make.
 */
const AVOID_NOTICE = 50;
const AVOID_LANE = 26;

/**
 * How fast it can come round, rad/s -- ten times the whale's.
 *
 * A shark is a third of the length and turns inside its own body; the whale's
 * 0.2 rad/s exists to stop something 18 m long pivoting like a dinghy, and
 * applying it here would only mean the turn never finishes in the seconds this
 * animal has. At 1.6 m/s this is a turning circle of about 0.8 m.
 */
const AVOID_TURN_RATE = 2.0;

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

  /**
   * How far apart the sightings are, as a multiple of the tuned spacing.
   *
   * One is the rate these were written at, larger is rarer, and `Infinity` is
   * none at all -- guarded explicitly in `update`, because a timer already
   * running when the slider reaches zero would otherwise let one more through.
   * The field is built before the setting is applied, so that is not a corner:
   * it is what happens every time. Set from the player's slider; see
   * `settings.ts`.
   */
  spacing = 1;

  private rand: () => number;
  private timer = 0;
  private age = 0;
  private nextId = 1;
  private active: SharkSighting | null = null;

  constructor(seed = 1) {
    this.rand = rng(seed ^ 0x5a4b);
    this.reseed(seed);
  }

  /** The next gap, in seconds, stretched by `spacing`. */
  private wait(base: number, spread: number): number {
    return (base + this.rand() * spread) * this.spacing;
  }

  /** Restart the encounter stream with the world. */
  reseed(seed: number): void {
    this.rand = rng(seed ^ 0x5a4b);
    this.timer = this.wait(30, 50);
    this.age = 0;
    this.nextId = 1;
    this.active = null;
    this.events.length = 0;
  }

  /**
   * @param boatHeading where the bow points, which is where the chase camera
   *   looks and so where a sighting may open.
   * @param others sightings already placed this step -- the whale -- that this
   *   one must not be drawn on top of. Read structurally rather than imported,
   *   so the two species stay independent of each other.
   * @param boatCourse the boat's track over ground, which is the line the shark
   *   has to get off. Distinct from the heading, and deliberately so: with a
   *   current running the boat crabs, and an animal that cleared the way the
   *   bow pointed would step into the way the hull is actually going.
   */
  update(
    dt: number,
    boat: Vec2,
    terrain: TerrainQuery,
    boatHeading = 0,
    others: readonly Occupant[] = [],
    boatCourse = boatHeading,
  ): void {
    this.events.length = 0;

    if (this.active) {
      this.age += dt;
      if (this.age >= ENCOUNTER_DURATION) {
        this.active = null;
        this.age = 0;
        this.timer = this.wait(45, 90);
        return;
      }

      this.active.diveT = Math.max(
        0,
        Math.min(1, (this.age - (ENCOUNTER_DURATION - DIVE_DURATION)) / DIVE_DURATION),
      );

      this.active.heading = giveWay(
        this.active.pos,
        this.active.heading,
        SPEED,
        boat,
        boatCourse,
        dt,
        AVOID_NOTICE,
        AVOID_LANE,
        AVOID_TURN_RATE,
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

    if (!Number.isFinite(this.spacing)) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.wait(50, 100);
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
