import { compassVec, type Vec2 } from './math';
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
const ENCOUNTER_RADIUS_MIN = 220;
const ENCOUNTER_RADIUS_MAX = 560;
const WHALE_SPEED = 1.8;
const FIRST_ENCOUNTER_DELAY = 8;
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
        const dir = compassVec(this.active.heading);
        const nextX = this.active.pos.x + dir.x * WHALE_SPEED * dt;
        const nextY = this.active.pos.y + dir.y * WHALE_SPEED * dt;
        // A whale turns away from shoal water rather than being allowed to
        // beach. The view never has to hide an event inside an island.
        if (suitable(nextX, nextY, terrain)) {
          this.active.pos.x = nextX;
          this.active.pos.y = nextY;
        } else {
          this.active.heading += Math.PI;
        }

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
