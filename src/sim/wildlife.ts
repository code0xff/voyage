import { TAU, clamp, compassVec, type Vec2 } from './math';
import { rng } from './rng';
import type { TerrainQuery } from './terrain';

/**
 * Gulls: a coastal cue heard often and seen occasionally.
 *
 * Nothing here has a body, and that is still a decision. Whales, dolphins and
 * gulls were all *modelled by hand* early on, and all three were cut after
 * being looked at: a low-poly animal reads as geometry, not as life, and a bad
 * animal is worse than none, because it tells you the sea is a set. The whale
 * went through three shapes -- flukes and a sounding arch, a long capsule, a
 * smooth low dome -- and not one of them was a whale.
 *
 * That argument was about modelling, and it has not been overturned; it has
 * been sidestepped. The visible animals use authored, licensed assets that were
 * never ours to get wrong. A flock remains rare because even a good animation
 * loop reads as machinery when it becomes permanent scenery.
 *
 * What survives here is the part that never had the problem at all. Near a
 * shore you hear gulls, and sometimes a flock crosses nearby. Both do real
 * work: they are a bearing to land before the haze gives it up, which is exactly
 * how you find a coast from a small boat. Open water stays silent and empty.
 *
 * Seeded, so the same world sounds the same way -- the same rule the wind, the
 * weather and the islands already follow.
 */

export interface WildlifeEvent {
  /** Where the bird is, so the sound can be placed by distance. */
  pos: Vec2;
  /** 0..1 before distance is taken into account. */
  strength: number;
}

export interface GullFlockSighting {
  id: number;
  pos: Vec2;
  altitude: number;
  wingspan: number;
  duration: number;
  opacity: number;
}

interface ActiveFlock extends GullFlockSighting {
  age: number;
}

/** Gulls are audible within about this far of a shore, m. */
const GULL_RANGE = 800;

export class Wildlife {
  /** Filled during update(), drained by whoever plays the sounds. */
  readonly events: WildlifeEvent[] = [];
  readonly flocks: GullFlockSighting[] = [];

  private rand: () => number;
  private flockRand: () => number;
  private timer = 3;
  private flockTimer = 10;
  private nextFlockId = 1;
  private activeFlock: ActiveFlock | null = null;

  constructor(seed = 1) {
    this.rand = rng(seed ^ 0x5eed);
    this.flockRand = rng(seed ^ 0x6a11);
    this.flockTimer = 5 + this.flockRand() * 10;
  }

  /** Restart the sound event stream when a new seeded world begins. */
  reseed(seed: number): void {
    this.rand = rng(seed ^ 0x5eed);
    this.flockRand = rng(seed ^ 0x6a11);
    this.timer = 3;
    this.flockTimer = 5 + this.flockRand() * 10;
    this.nextFlockId = 1;
    this.activeFlock = null;
    this.events.length = 0;
    this.flocks.length = 0;
  }

  /**
   * The rate rises as the shore closes, so standing in towards an island fills
   * with noise and open water stays quiet.
   */
  update(dt: number, boat: Vec2, terrain: TerrainQuery): void {
    this.events.length = 0;
    this.updateFlock(dt, boat, terrain);

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 2.5 + this.rand() * 7;

    const shore = terrain.distanceToShore(boat.x, boat.y);
    if (!Number.isFinite(shore)) return;
    const closeness = clamp(1 - shore / GULL_RANGE, 0, 1);
    if (closeness < 0.05 || this.rand() > closeness) return;

    // Put the bird between you and the beach rather than at your masthead, so
    // the call fades in as you approach rather than switching on.
    //
    // Asked of the terrain rather than worked out from an island centre here.
    // A circle can only offer its middle, which put the gull over the hill; a
    // surveyed coast points at the piece of shore actually being closed with.
    const bearing = terrain.bearingToShore(boat.x, boat.y) ?? this.rand() * TAU;
    const spread = (this.rand() - 0.5) * 1.2;
    const dir = compassVec(bearing + spread);
    const range = 25 + this.rand() * Math.max(40, shore * 0.8);

    this.events.push({
      pos: { x: boat.x + dir.x * range, y: boat.y + dir.y * range },
      strength: 0.5 + closeness * 0.5,
    });
  }

  private updateFlock(dt: number, boat: Vec2, terrain: TerrainQuery): void {
    this.flocks.length = 0;
    this.flockTimer -= dt;
    if (this.activeFlock) {
      const flock = this.activeFlock;
      flock.age += dt;
      flock.opacity = Math.min(1, flock.age / 0.5, (flock.duration - flock.age) / 1.5);
      if (flock.age < flock.duration) {
        this.flocks.push(flock);
        return;
      }
      this.activeFlock = null;
    }

    if (this.flockTimer > 0) return;

    const shore = terrain.distanceToShore(boat.x, boat.y);
    const closeness = Number.isFinite(shore) ? clamp(1 - shore / 500, 0, 1) : 0;
    // Check again soon offshore; near a coast, 35–75 seconds between checks
    // keeps the authored loop an event rather than permanent scenery. A failed
    // check stretches the average interval without introducing another timer.
    this.flockTimer = closeness > 0 ? 75 - closeness * 40 : 20;
    if (closeness < 0.1 || this.flockRand() > 0.9) return;

    const shoreBearing = terrain.bearingToShore(boat.x, boat.y) ?? this.flockRand() * TAU;
    const bearing = shoreBearing + (this.flockRand() - 0.5) * 1.8;
    const distance = 50 + this.flockRand() * 90;
    const offset = compassVec(bearing);
    const baseAltitude = 10 + this.flockRand() * 16;
    const flock: ActiveFlock = {
      id: this.nextFlockId++,
      pos: { x: boat.x + offset.x * distance, y: boat.y + offset.y * distance },
      altitude: baseAltitude,
      // Slightly larger than life at this distance: readability wins by less
      // than half a metre, without turning the birds into aircraft.
      wingspan: 1.6 + this.flockRand() * 0.3,
      age: 0,
      duration: 6 + this.flockRand() * 2,
      opacity: 0,
    };
    this.activeFlock = flock;
    this.flocks.push(flock);
  }
}
