import { DEG } from './math';
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

  sailAR: number; // aspect ratio; governs induced drag CDi = CL^2 / (pi * AR)
  mastX: number; // m, mast position (rendering)
  minSheet: number; // rad, boom angle when sheeted hard in
  maxSheet: number; // rad, fully eased
  targetAoA: number; // rad, angle of attack the auto-trim aims for

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

  sailAR: 2.8,
  mastX: 1.2,
  minSheet: 11 * DEG,
  maxSheet: 85 * DEG,
  targetAoA: 19 * DEG,

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

export interface Environment {
  /** The direction the wind blows *from* (compass rad), as sailors quote it. */
  twd: number;
  /** True wind speed, m/s. */
  tws: number;
  rhoAir: number;
  rhoWater: number;
}

export const DEFAULT_ENV: Environment = {
  twd: 0, // northerly
  tws: 6.17, // 12 knots
  rhoAir: 1.225,
  rhoWater: 1025,
};
