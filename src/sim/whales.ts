import { clamp, compassAngle, compassVec, wrapPi, type Vec2 } from './math';
import { rng } from './rng';
import type { TerrainQuery } from './terrain';
import { CRUISER } from './config';

/** The short, observable part of a whale encounter. */
export type WhalePhase = 'surfacing' | 'blow' | 'rolling' | 'diving';

export interface WhaleSighting {
  /** Stable for the life of this encounter, so the view can reuse its mesh. */
  id: number;
  /** World position, not an offset from the boat. */
  pos: Vec2;
  /** Compass direction the whale is travelling towards. */
  heading: number;
  /** Individual variation, in metres. */
  size: number;
  phase: WhalePhase;
  /** Progress through the current behaviour, 0..1. */
  phaseT: number;
  /** Seed for small visual differences that must not affect the simulation. */
  seed: number;
}

const SURFACE_DEPTH = 18;
const MIN_SHORE_DISTANCE = 120;
/**
 * How far off a sighting opens, m.
 *
 * Far, and deliberately so: a whale is an animal already out in its own water,
 * not one staged alongside. It was brought in to 80-200 m for a while because
 * at this range there is very little to see -- an adult shows about 0.57 m of
 * back above an opaque surface, four pixels at 220 m -- and that turned out to
 * be the wrong repair. It changed the world to suit the camera.
 *
 * What it needed instead was something to see it *with*, and a reason to look.
 * The blow reaches 3.2 m and stands about 19 px at 220 m, which is a mark on
 * the water you notice; the glasses in view/scene.ts then magnify five times,
 * which is a whale. Spotting and then looking is what actually happens, and it
 * leaves the sighting where it belongs.
 */
const ENCOUNTER_RADIUS_MIN = 220;
const ENCOUNTER_RADIUS_MAX = 560;
const WHALE_SPEED = 1.8;
const FIRST_ENCOUNTER_DELAY = 8;

/**
 * The range at which a whale starts giving way to the boat, m.
 *
 * There is no collision anywhere in this simulation, so without a rule of its
 * own nothing stops the hull passing straight through the animal -- and the
 * spawn geometry cannot prevent it, because the player can turn. Worse, the
 * crossing track this feature generates contains an exact collision course: a
 * whale is on a constant bearing when the boat's speed across the line of
 * sight matches the whale's own, which is asin(1.8 / 3.09) = 0.62 rad off the
 * bow at six knots -- well inside the arc a sighting may open in.
 *
 * Set far enough out that the whale is not seen to notice at the last moment.
 * A whale hears a hull a long way before it can see one, so a boat that keeps
 * coming meets an animal that quietly stops being where it was going to be,
 * which is both what happens and what keeps the two apart.
 *
 * At the distances above the clock keeps the two apart on its own -- a boat
 * covers about 100 m in the 32.5 s an encounter lasts, and a converging one
 * closes to roughly 62 m at worst -- so this is no longer the only thing
 * standing between them. It still fires, because 62 m is inside it, and it
 * should: a whale that holds its course into an approaching hull is the wrong
 * animal. Kept at the value tuned when the encounter was brought close, which
 * cost nothing to leave and is the margin that survives if it ever is again.
 */
const AVOID_RANGE = 110;

/**
 * How fast it can come round, rad/s.
 *
 * At 1.8 m/s this is a turning circle of about 9 m -- half a body length, which
 * is tight for something this size and is meant to be: the limit exists so the
 * turn is a curve rather than the instant reversal the shoal rule used to be,
 * not to make the animal ponderous. From AVOID_RANGE against the fastest
 * closing this feature can produce there are ten seconds in hand, and this
 * spends them on 115 degrees.
 */
const AVOID_TURN_RATE = 0.2;

/** Quarter turns tried, in order, when the water ahead is too shallow. */
const ESCAPE_TURNS = [Math.PI * 0.5, -Math.PI * 0.5, Math.PI];
// Adult humpbacks are roughly one-and-a-half Voyager 33s long. Keeping this
// relative to LOA makes the renderer, the boat and both animal species share
// one metre scale instead of accumulating unrelated visual tuning numbers.
const WHALE_LENGTH_MIN = CRUISER.loa * 1.5;
const WHALE_LENGTH_MAX = CRUISER.loa * 1.8;

const PHASES: readonly { name: WhalePhase; duration: number }[] = [
  { name: 'surfacing', duration: 5.5 },
  { name: 'blow', duration: 4.0 },
  // This is the part the player needs time to find with the camera: the back
  // stays up and travels across the view instead of vanishing after one pose.
  { name: 'rolling', duration: 14.0 },
  { name: 'diving', duration: 9.0 },
];
const ENCOUNTER_DURATION = PHASES.reduce((sum, phase) => sum + phase.duration, 0);

function suitable(x: number, y: number, terrain: TerrainQuery): boolean {
  const depth = terrain.depthAt(x, y);
  const shore = terrain.distanceToShore(x, y);
  return depth >= SURFACE_DEPTH && shore >= MIN_SHORE_DISTANCE;
}

function phaseAt(age: number): { name: WhalePhase; t: number } {
  let elapsed = age;
  for (const phase of PHASES) {
    if (elapsed <= phase.duration) {
      return { name: phase.name, t: Math.max(0, Math.min(1, elapsed / phase.duration)) };
    }
    elapsed -= phase.duration;
  }
  const last = PHASES[PHASES.length - 1];
  return { name: last.name, t: 1 };
}

/**
 * Rare, seeded whale encounters.
 *
 * This is deliberately not a population model. A whale is an event the player
 * can notice for a few seconds, not another force acting on the hull. Keeping
 * the encounter here makes its timing and its route headless and reproducible;
 * the renderer is responsible only for making the event look alive.
 */
export class WhaleField {
  readonly events: WhaleSighting[] = [];

  private rand: () => number;
  private timer = 0;
  private age = 0;
  private nextId = 1;
  private active: WhaleSighting | null = null;
  private firstEncounter = true;

  constructor(seed = 1) {
    this.rand = rng(seed ^ 0x5ea41e);
    this.reseed(seed);
  }

  /** Restart the encounter stream with the world. */
  reseed(seed: number): void {
    this.rand = rng(seed ^ 0x5ea41e);
    this.timer = FIRST_ENCOUNTER_DELAY + this.rand() * FIRST_ENCOUNTER_DELAY;
    this.age = 0;
    this.nextId = 1;
    this.active = null;
    this.firstEncounter = true;
    this.events.length = 0;
  }

  update(dt: number, boat: Vec2, terrain: TerrainQuery, boatHeading = 0): void {
    this.events.length = 0;

    if (this.active) {
      this.age += dt;
      if (this.age >= ENCOUNTER_DURATION) {
        this.active = null;
        this.timer = 18 + this.rand() * 30;
        this.age = 0;
      } else {
        this.giveWay(boat, dt);
        this.swim(dt, terrain);

        const phase = phaseAt(this.age);
        this.active.phase = phase.name;
        this.active.phaseT = phase.t;
        this.events.push(this.active);
        return;
      }
    }

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 14 + this.rand() * 24;

    // The first eligible sea gets one sighting so the feature can be discovered
    // without waiting for a rare event that may happen behind the camera. After
    // that, encounters return to their deliberately uncommon rate.
    if (!this.firstEncounter && this.rand() > 0.68) return;

    const whale = this.findSpawn(boat, boatHeading, terrain);
    if (!whale) return;
    this.active = whale;
    this.age = 0;
    this.firstEncounter = false;
    this.events.push(whale);
  }

  /**
   * Bend the whale's course away from the boat, at a limited rate.
   *
   * Rate-limited rather than assigned, or the animal would snap round to face
   * directly away the instant the boat crossed AVOID_RANGE, which reads as a
   * thing reacting to a trigger rather than as a whale.
   *
   * Urgency scales the turn with how close the boat has come, so a distant
   * pass barely deflects the track -- the encounter is still an animal going
   * about its own business -- while a boat driven straight at it gets the full
   * rate. Nothing here acts on the boat: the whale gives way, and the helmsman
   * feels nothing, which is the whole reason this lives outside the physics.
   */
  private giveWay(boat: Vec2, dt: number): void {
    const whale = this.active;
    if (!whale) return;

    const offX = whale.pos.x - boat.x;
    const offY = whale.pos.y - boat.y;
    const range = Math.hypot(offX, offY);
    // Exactly on the boat there is no direction to flee in, and asking for one
    // would be atan2(0, 0). Hold course; the next step will have an answer.
    if (range >= AVOID_RANGE || range < 1e-6) return;

    const away = compassAngle({ x: offX, y: offY });
    const urgency = 1 - range / AVOID_RANGE;
    const rate = AVOID_TURN_RATE * urgency * dt;
    whale.heading += clamp(wrapPi(away - whale.heading), -rate, rate);
  }

  /**
   * Move, or turn off water too shallow to move into.
   *
   * The obstructed case tries a quarter turn each way before it will reverse.
   * Reversing first was the original rule and does not survive giveWay(): a
   * whale pinned between the boat and a bank would be turned away from the
   * boat, meet the bank, be turned back onto the boat, and shake in place at
   * 120 Hz without ever moving. Turning along the bank is also simply what the
   * animal would do, and it leaves the encounter running.
   */
  private swim(dt: number, terrain: TerrainQuery): void {
    const whale = this.active;
    if (!whale) return;

    const step = WHALE_SPEED * dt;
    for (const turn of [0, ...ESCAPE_TURNS]) {
      const dir = compassVec(whale.heading + turn);
      const nextX = whale.pos.x + dir.x * step;
      const nextY = whale.pos.y + dir.y * step;
      if (!suitable(nextX, nextY, terrain)) continue;
      whale.heading += turn;
      whale.pos.x = nextX;
      whale.pos.y = nextY;
      return;
    }
    // Boxed in on every side. Hold station rather than beach: the encounter is
    // short and the boat is the thing that will move first.
  }

  private findSpawn(boat: Vec2, boatHeading: number, terrain: TerrainQuery): WhaleSighting | null {
    for (let attempt = 0; attempt < 10; attempt++) {
      // The default chase camera looks over the boat's bow. A sighting in the
      // forward arc can still pass abeam, but it cannot be silently behind the
      // camera before the player has had a chance to discover the feature.
      const bearing = boatHeading + (this.rand() - 0.5) * 1.6;
      const distance =
        ENCOUNTER_RADIUS_MIN + this.rand() * (ENCOUNTER_RADIUS_MAX - ENCOUNTER_RADIUS_MIN);
      const dir = compassVec(bearing);
      const pos = {
        x: boat.x + dir.x * distance,
        y: boat.y + dir.y * distance,
      };
      if (!suitable(pos.x, pos.y, terrain)) continue;

      // Crossing rather than pointing straight at the boat makes the event
      // feel like an animal already travelling through its own water.
      const heading = bearing + Math.PI * 0.5 + (this.rand() - 0.5) * 1.0;
      return this.createSighting(pos, heading);
    }
    return null;
  }

  private createSighting(pos: Vec2, heading: number): WhaleSighting {
    return {
      id: this.nextId++,
      pos,
      heading,
      size: WHALE_LENGTH_MIN + this.rand() * (WHALE_LENGTH_MAX - WHALE_LENGTH_MIN),
      phase: 'surfacing',
      phaseT: 0,
      seed: Math.floor(this.rand() * 0xffffffff),
    };
  }
}
