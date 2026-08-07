import { DEG, type Vec2 } from './math';
import { hullSpeed } from './units';

/**
 * Boat particulars. Every value here is a tuning knob.
 *
 * The core development loop of this project is: change one number, run
 * `npm run polar`, and see which way the polar diagram moved.
 */
export interface BoatConfig {
  name: string;

  // --- Hull ---
  mass: number; // kg (displacement)
  loa: number; // m, length overall
  beam: number; // m
  lwl: number; // m, waterline length -- sets hull speed
  draft: number; // m (rendering)

  wettedArea: number; // m^2
  cf: number; // friction coefficient (an effective value including form drag)
  waveK: number; // wave-making coefficient; higher = harder hull-speed wall

  // --- Sails ---
  // Main and jib are kept separate. If only the total area mattered they could
  // be merged, but keeping them apart is what lets reefing and furling move the
  // centre of effort -- and that is where the real decision comes from:
  // "shortening the main alone pushes CE forward into lee helm, so roll up
  // some jib too".
  mainArea: number; // m^2
  mainCeHeight: number; // m above the centre of gravity
  mainCeX: number; // m, longitudinal (negative = aft)
  jibArea: number;
  jibCeHeight: number;
  jibCeX: number;

  /**
   * m, vertical extent of the full sail plan, foot to head.
   *
   * Only used for the wind gradient: it is what turns the centre of effort into
   * a sail with a top and a bottom that see different winds.
   */
  sailSpan: number;

  sailAR: number; // aspect ratio; governs induced drag CDi = CL^2 / (pi * AR)
  mastX: number; // m, mast position (rendering)
  /**
   * m, height of the masthead above the centre of gravity.
   *
   * Where the wind instruments live. Unlike the head of the sail it does not
   * move when the boat reefs, and the renderer builds its mast from this same
   * number, so the vane drawn up there and the wind reported up there cannot
   * drift apart.
   */
  mastHeight: number;
  minSheet: number; // rad, boom angle when sheeted hard in
  maxSheet: number; // rad, fully eased
  targetAoA: number; // rad, angle of attack the auto-trim aims for
  /**
   * rad, how far the head may be twisted open beyond the foot.
   *
   * Twist is a magnitude, like the sheet, not a signed angle: the head of a
   * sail falls away to leeward and never hooks to windward, because the leech
   * has nothing to hold it up there.
   */
  maxTwist: number;

  // --- Windage ---
  // Hull, mast and rigging simply being pushed by the wind. Not negligible
  // upwind.
  windageArea: number; // m^2
  windageCd: number;

  // --- Keel and rudder ---
  keelArea: number; // m^2, lateral area
  keelAR: number; // aspect ratio
  keelDepth: number; // m below the centre of gravity
  clrX: number; // m, longitudinal centre of lateral resistance; CE - CLR = "lead"
  rudderArea: number; // m^2
  rudderArm: number; // m aft of the centre of gravity
  maxRudder: number; // rad

  // --- Stability ---
  rm90: number; // N*m, righting moment at 90 deg heel. RM(phi) = rm90 * sin(phi)
  rollInertia: number; // kg*m^2 -- dominated by the rig and the keel bulb
  rollDamp: number; // N*m*s/rad
  pitchInertia: number; // kg*m^2
  pitchStiff: number; // N*m/rad; a long waterline makes this large
  pitchDamp: number;
  heaveTau: number; // s, vertical follow time constant
  waveDragK: number; // added resistance in waves

  // --- Inertia and damping ---
  izz: number; // kg*m^2, yaw inertia
  addedMassSurge: number; // added-mass multiplier fore/aft
  addedMassSway: number; // added-mass multiplier athwartships (water must be shoved sideways)
  yawDamp: number;
  weathervane: number; // directional stability
  heelHelm: number; // tendency to luff up as the boat heels
}

/** A 10 m cruising sloop. Hull speed about 7.3 kn. */
export const CRUISER: BoatConfig = {
  name: 'Voyager 33',

  mass: 4500,
  loa: 10.0,
  beam: 3.2,
  lwl: 9.0,
  draft: 1.8,

  wettedArea: 25,
  cf: 0.0042,
  waveK: 9,

  mainArea: 30,
  mainCeHeight: 5.9,
  mainCeX: -1.1,
  jibArea: 25,
  jibCeHeight: 5.2,
  jibCeX: 2.4,

  // Foot 2.5 m above the water, head 14 m up: a 13 m stick on a 10 m boat.
  sailSpan: 11.5,

  sailAR: 2.8,
  mastX: 1.2,
  // 14.0 m above the water, just clear of the head of a full mainsail.
  mastHeight: 13.3,
  minSheet: 11 * DEG,
  maxSheet: 85 * DEG,
  targetAoA: 19 * DEG,
  maxTwist: 30 * DEG,

  windageArea: 9,
  windageCd: 0.85,

  keelArea: 3.2,
  keelAR: 2.4,
  keelDepth: 1.1,
  clrX: 0.25,
  rudderArea: 0.9,
  rudderArm: 4.2,
  maxRudder: 35 * DEG,

  rm90: 58000,
  // Natural roll period T = 2*pi*sqrt(I/rm90) = 3.6 s, damping ratio ~0.18.
  // These two numbers are the boat's personality: large is sluggish, small is
  // twitchy.
  rollInertia: 19000,
  rollDamp: 12000,
  // Pitch is far stiffer and better damped than roll (period 2.2 s, zeta 0.45).
  pitchInertia: 26000,
  pitchStiff: 212000,
  pitchDamp: 66000,
  heaveTau: 0.28,
  waveDragK: 60,

  izz: 4500 * 2.6 * 2.6,
  addedMassSurge: 1.06,
  addedMassSway: 1.7,
  yawDamp: 26000,
  weathervane: 1200,
  heelHelm: 1400,
};

export const boatHullSpeed = (c: BoatConfig): number => hullSpeed(c.lwl);

/**
 * m, height of the centre of gravity above the water.
 *
 * Not a separate number: the keel reaches `keelDepth` below the CG and `draft`
 * below the surface, so the difference is the freeboard of the CG. Heights in
 * the physics are measured from the CG because that is where the moments act;
 * the wind gradient needs them from the water, because that is what slows the
 * wind down.
 */
export const cgHeight = (c: BoatConfig): number => c.draft - c.keelDepth;

export interface Environment {
  /** The direction the wind blows *from* (compass rad), as sailors quote it. */
  twd: number;
  /** True wind speed, m/s, at `windRefHeight` above the water. */
  tws: number;
  rhoAir: number;
  rhoWater: number;
  /**
   * m/s, world frame: the velocity of the water itself. Set and drift.
   *
   * Optional, and absent means still water. That is not laziness about a
   * default: a polar is a still-water measurement by definition, so the solver
   * and every test tuned against it must be unable to acquire a current by
   * accident. Leaving the field off says so in the type.
   *
   * Note this is a *velocity*, the direction the water goes, which is how a
   * tidal atlas quotes a set -- and the opposite of the convention for `twd`,
   * which is where the wind comes from. The two are quoted that way at sea and
   * changing one of them here to match the other would only move the confusion
   * to the boundary with the player.
   */
  current?: Vec2;
}

/**
 * Whether there is enough tide under the boat to matter.
 *
 * Two readouts turn themselves off when there is -- the layline advice and the
 * polar's live marker -- because both are built on a still-water polar and stop
 * meaning what they say once the water is moving. They have to agree about when
 * that starts, or the boat could be given a layline by one and refused a polar
 * marker by the other.
 *
 * A tenth of a knot over a windward leg is a couple of metres, which is smaller
 * than the mark is.
 */
export const hasCurrent = (env: Environment): boolean =>
  !!env.current && Math.hypot(env.current.x, env.current.y) > 0.05;

export const DEFAULT_ENV: Environment = {
  twd: 0, // northerly
  tws: 6.17, // 12 knots
  rhoAir: 1.225,
  rhoWater: 1025,
};
