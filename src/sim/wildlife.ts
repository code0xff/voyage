import { TAU, clamp, compassVec, type Vec2 } from './math';
import { rng } from './rng';
import type { TerrainQuery } from './terrain';

/**
 * Gulls: a coastal cue heard often and seen occasionally.
 *
 * Nothing here was ever *modelled by hand*, and that is still the decision.
 * Whales, dolphins and gulls were all built that way early on and all three
 * were cut after being looked at: a low-poly animal reads as geometry, not as
 * life, and a bad animal is worse than none, because it tells you the sea is a
 * set. The whale went through three shapes -- flukes and a sounding arch, a
 * long capsule, a smooth low dome -- and not one of them was a whale.
 *
 * That argument was about modelling, and it has not been overturned; it has
 * been sidestepped. The visible animals, this flock included, use authored and
 * licensed assets that were never ours to get wrong. Rarity is the other half
 * of it: even a good animation loop reads as machinery once it becomes
 * permanent scenery, which is why a flock is a thing that happens rather than
 * a thing that is there.
 *
 * The call came first and still does the navigational work. Near a shore you
 * hear gulls, and now and then a flock is circling within sight of you as well
 * -- circling, and not passing through: it holds its patch of sky long enough
 * to watch, the way birds do over something worth staying for. Both
 * say the same thing, which is that there is land, and say it before the haze
 * gives the land itself up. Open water stays silent and empty.
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

/**
 * One authored group within a flock.
 *
 * The asset is four birds on a single baked circuit, so a sighting was four
 * birds beating in step and showing the same silhouette at the same moment.
 * Several copies, turned away from each other and started at different points
 * in the loop, are four birds becoming twelve to twenty and no two of them
 * doing the same thing -- which is what a flock looks like and one copy could
 * not be tuned into.
 *
 * The yaw earns its place through the silhouette and not through the track.
 * The circuit is closed -- measured through three's own mixer, net displacement
 * over one loop is 0.000 m -- so it is a bird going round a ring 6 to 9 m
 * across, not a bird going anywhere, and turning the ring cannot stop a drift
 * there is none of. What it changes is that one group is banking away while
 * another is head on, instead of sixteen birds presenting the same profile.
 *
 * Worth recording because the first version of this comment claimed the
 * opposite: that the loop carried the birds 28 m before repeating and that
 * spreading the yaws cancelled it. The 28 m was never displacement, and it was
 * not even the path -- that is 12 to 20 m as drawn. A flock holding station
 * while you sail 50 m past it is the whole of why one looks like it is moving,
 * and that is parallax, which is correct and is not what this changes.
 */
export interface GullFlockMember {
  /** Where this group sits relative to the flock centre, m. */
  offset: Vec2;
  altitude: number;
  /**
   * How far this group's circuit is turned, radians, in the compass convention
   * the rest of the project uses -- `src/view/creature.ts` negates it for the
   * scene. It is a spread and not a bearing: the asset's own idea of forward
   * has never been established, so this says these groups face differently, and
   * nothing about which way any of them faces.
   */
  yaw: number;
  /** Where in the authored loop this group starts, 0..1. */
  phase: number;
  wingspan: number;
}

export interface GullFlockSighting {
  id: number;
  pos: Vec2;
  duration: number;
  opacity: number;
  members: readonly GullFlockMember[];
}

interface ActiveFlock extends GullFlockSighting {
  age: number;
}

/** Gulls are audible within about this far of a shore, m. */
const GULL_RANGE = 800;
/**
 * Two leisurely circuits: observable without becoming permanent scenery.
 *
 * Exported because `wildlife.test.ts` asserts how long a sighting lasts, and a
 * test that writes the seconds out has quietly decided these may never move.
 */
export const FLOCK_DURATION_MIN = 14;
export const FLOCK_DURATION_MAX = 18;

/**
 * How many copies of the authored group a flock is made of, and how far they
 * are scattered.
 *
 * Three is the floor because two read as a pair rather than as a flock, and
 * five the ceiling because the asset is four birds and twenty of them over one
 * patch of water is a colony, not a sighting near a coast.
 *
 * `SPREAD` is a radius, so a flock is up to 32 m across at 50 to 140 m off.
 * Chosen by looking rather than derived: the circuits themselves are only 6 to
 * 9 m across, so at any spread worth having the groups are separate clumps
 * rather than interleaved, and what decides the number is how much sky a flock
 * should take up. Much tighter reads as one dense knot; much wider stops
 * reading as one flock at all.
 */
const FLOCK_GROUPS_MIN = 3;
const FLOCK_GROUPS_MAX = 5;
const FLOCK_SPREAD = 16;

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

  /** The plane was re-pinned under the boat; see `WhaleField.repin`. */
  repin(d: Vec2): void {
    if (!this.activeFlock) return;
    this.activeFlock.pos.x += d.x;
    this.activeFlock.pos.y += d.y;
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
    // Low enough that every group still clears the 8 m the test guards, and
    // high enough that the highest is under 28 m -- birds stack, but a gull at
    // masthead height and a gull at thirty metres are not the same flock.
    const baseAltitude = 10 + this.flockRand() * 10;
    const groups = FLOCK_GROUPS_MIN + Math.floor(this.flockRand() * (FLOCK_GROUPS_MAX - FLOCK_GROUPS_MIN + 1));
    const members: GullFlockMember[] = [];
    for (let i = 0; i < groups; i++) {
      // A disc rather than a ring, so the groups do not come out evenly spaced
      // on a circle -- which is a shape the eye picks out immediately.
      const angle = this.flockRand() * TAU;
      const radius = Math.sqrt(this.flockRand()) * FLOCK_SPREAD;
      const at = compassVec(angle);
      members.push({
        offset: { x: at.x * radius, y: at.y * radius },
        altitude: baseAltitude + this.flockRand() * 6,
        // The full circle. A narrower spread leaves the drifts pointing broadly
        // the same way, which is the thing being fixed.
        yaw: this.flockRand() * TAU,
        phase: this.flockRand(),
        // Slightly larger than life at this distance: readability wins by less
        // than half a metre, without turning the birds into aircraft.
        wingspan: 1.6 + this.flockRand() * 0.3,
      });
    }
    const flock: ActiveFlock = {
      id: this.nextFlockId++,
      pos: { x: boat.x + offset.x * distance, y: boat.y + offset.y * distance },
      members,
      age: 0,
      duration:
        FLOCK_DURATION_MIN + this.flockRand() * (FLOCK_DURATION_MAX - FLOCK_DURATION_MIN),
      opacity: 0,
    };
    this.activeFlock = flock;
    this.flocks.push(flock);
  }
}
