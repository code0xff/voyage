import { compassVec, type Vec2 } from './math';
import { giveWay } from './giveway';
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
 * at this range there is very little to see -- an adult shows about 0.4 m of
 * back above an opaque surface, only a few pixels at 220 m -- and that turned
 * out to be the wrong repair. It changed the world to suit the camera.
 *
 * What it needed instead was something to see it *with*, and a reason to look.
 * The blow reaches 3.2 m and stands about 19 px at 220 m, which is a mark on
 * the water you notice; the glasses in view/scene.ts then magnify it up to
 * twelve times, which is a whale. Spotting and then looking is what actually happens, and it
 * leaves the sighting where it belongs.
 */
const ENCOUNTER_RADIUS_MIN = 220;
const ENCOUNTER_RADIUS_MAX = 560;
const WHALE_SPEED = 1.8;
const FIRST_ENCOUNTER_DELAY = 8;

/**
 * The whale's tuning of the give-way rule. See `giveway.ts` for why an animal
 * needs one at all and what each of these means.
 *
 * The collision course that argument describes is, for this animal, asin(1.8 /
 * 3.09) = 0.62 rad off the bow at six knots -- well inside the arc a sighting
 * may open in.
 *
 * Both are far larger than the shark's 50 and 26, and neither is a scaling of
 * them. A whale hears a hull a long way before it can see one, so a boat that
 * keeps coming should meet an animal that quietly stops being where it was
 * going to be. The measured reason is the same fact seen from the other side:
 * at 0.2 rad/s the turn itself takes tens of seconds, so the animal has to have
 * started long before the boat is on it. Measured at the worst speed over the
 * ground the boat can make -- 8.1 kn of boat with four knots of fair tide under
 * it -- 110 m, which is what this was while the rule was radial, gives a worst
 * pass of 13.0 m; for something 18 m long that is a contact. 160 m puts it at
 * 25.9 m. 220 m would give 43.5, but 220 is also the closest a sighting can
 * open, so the whale would be giving way from the moment it appeared.
 *
 * `LANE` is wide because the animal is, and because it can afford to be: a
 * sighting opens 220 m off, so even 100 m leaves the median encounter untouched
 * at 233 m. Below it the whale gives way too late to finish -- 60 m measures
 * 23.5 m worst against this 25.9 -- and above it nothing more is bought.
 *
 * At these distances the clock keeps the two apart on its own -- a boat covers
 * about 100 m in the 32.5 s an encounter lasts -- so this is not the only thing
 * standing between them. It should still fire: a whale that holds its course
 * into an approaching hull is the wrong animal.
 */
const AVOID_NOTICE = 160;
const AVOID_LANE = 100;

/**
 * How fast it can come round, rad/s.
 *
 * At 1.8 m/s this is a turning circle of about 9 m -- half a body length, which
 * is tight for something this size and is meant to be: the limit exists so the
 * turn is a curve rather than the instant reversal the shoal rule used to be,
 * not to make the animal ponderous. From AVOID_NOTICE against the fastest
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
  private active: WhaleSighting | null = null;
  private firstEncounter = true;

  constructor(seed = 1) {
    this.rand = rng(seed ^ 0x5ea41e);
    this.reseed(seed);
  }

  /** The next gap, in seconds, stretched by `spacing`. */
  private wait(base: number, spread: number): number {
    return (base + this.rand() * spread) * this.spacing;
  }

  /** Restart the encounter stream with the world. */
  reseed(seed: number): void {
    this.rand = rng(seed ^ 0x5ea41e);
    this.timer = this.wait(FIRST_ENCOUNTER_DELAY, FIRST_ENCOUNTER_DELAY);
    this.age = 0;
    this.nextId = 1;
    this.active = null;
    this.firstEncounter = true;
    this.events.length = 0;
  }

  /**
   * @param boatHeading where the bow points, which is where the chase camera
   *   looks and so where a sighting may open.
   * @param boatCourse the boat's track over ground, which is the line the whale
   *   has to get off. Distinct from the heading, and deliberately so: with a
   *   current running the boat crabs, and an animal that cleared the way the
   *   bow pointed would step into the way the hull is actually going.
   */
  update(
    dt: number,
    boat: Vec2,
    terrain: TerrainQuery,
    boatHeading = 0,
    boatCourse = boatHeading,
  ): void {
    this.events.length = 0;

    if (this.active) {
      this.age += dt;
      if (this.age >= ENCOUNTER_DURATION) {
        this.active = null;
        this.timer = this.wait(18, 30);
        this.age = 0;
      } else {
        this.active.heading = giveWay(
          this.active.pos,
          this.active.heading,
          WHALE_SPEED,
          boat,
          boatCourse,
          dt,
          AVOID_NOTICE,
          AVOID_LANE,
          AVOID_TURN_RATE,
        );
        this.swim(dt, terrain);

        const phase = phaseAt(this.age);
        this.active.phase = phase.name;
        this.active.phaseT = phase.t;
        this.events.push(this.active);
        return;
      }
    }

    if (!Number.isFinite(this.spacing)) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.wait(14, 24);

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
   * The plane was re-pinned under the boat; see `WaveField.repin`.
   *
   * A sighting holds a world position, so an encounter in progress has to be
   * carried across or the animal is suddenly two hundred kilometres away --
   * culled by the renderer, and gone mid-blow. Rare, because an encounter
   * lasts seconds and a re-pin is two hundred kilometres of sailing apart, and
   * still the invariant the pin's own comment states: nothing in the water may
   * be left behind in the plane it was written in.
   */
  repin(d: Vec2): void {
    if (!this.active) return;
    this.active.pos.x += d.x;
    this.active.pos.y += d.y;
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
