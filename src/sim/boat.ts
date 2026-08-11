import {
  DEG,
  RAD,
  add,
  approach,
  clamp,
  compassAngle,
  compassVec,
  dot,
  len,
  norm,
  rotCCW90,
  rotCW90,
  scale,
  side,
  sub,
  wrapPi,
  type Vec2,
} from './math';
import { FOIL_CD, FOIL_CL, SAIL_CD, SAIL_CL, foilAoA, sample } from './tables';
import { boatHullSpeed, cgHeight, type BoatConfig, type Environment } from './config';
import {
  DEPOWER_HEEL,
  HEEL_TAU,
  SAIL_STRIPS,
  STRIP_AREA,
  STRIP_U,
  sailPlan,
  windRefHeight,
} from './sailplan';
import { shearFactor } from './shear';

/** Everything that gets integrated. This alone reproduces the boat. */
export interface BoatState {
  pos: Vec2; // m, world
  heading: number; // rad, compass
  u: number; // m/s surge (forward)
  v: number; // m/s sway (starboard positive) -- this is what leeway really is
  r: number; // rad/s yaw rate (starboard positive)
  heel: number; // rad, positive = heeled to starboard
  heelRate: number; // rad/s
  /**
   * rad, low-pass filtered |heel|: how far over the boat is *staying*.
   *
   * Controller state rather than physics, but it belongs here because it has to
   * survive between steps. The auto-trim depowers on this and never on the
   * instantaneous heel, which is not a detail: roll is a lightly damped 3.6 s
   * oscillation, and a trim control chasing it lands a quarter-period late,
   * which is antiphase with roll *rate*. That is negative damping, and it turned
   * the boat's steady state into a permanent 20-to-36-degree wallow.
   */
  heelAvg: number;
  pitch: number; // rad, positive = bow up
  pitchRate: number; // rad/s
  heave: number; // m, vertical displacement of the waterline
  sheet: number; // rad, boom angle off the centreline
  /** rad, how much further open the head of the sail is than the foot. */
  twist: number;
  rudder: number; // rad, positive = turning to starboard
  reef: number; // 0..MAX_REEF
  jibFurl: number; // 0..1
  /**
   * Sails handed and off her.
   *
   * The verb the boat was missing. Without it she could never actually be
   * stopped: three reefs still leaves 40% of the main, and a boat rounded up
   * under that took a minute to lose her way and sailed 36 m doing it -- far
   * enough, measured, to carry her out of the water she was trying to anchor in.
   */
  stowed: boolean;
}

/**
 * The state of the sea where the boat is. The physics does not need to know
 * about waves at all -- only what the water surface looks like right here.
 */
export interface SeaState {
  h13: number; // m, significant wave height -> added resistance
  heave: number; // m, local surface elevation
  pitchSlope: number; // rad, fore-and-aft slope
  rollSlope: number; // rad, athwartships slope
  /** Wave travel direction (compass rad), for the encounter-angle term. */
  dir: number;
  /** Water depth here, m. Infinity in deep water. */
  depth: number;
}

export const CALM: SeaState = {
  h13: 0,
  heave: 0,
  pitchSlope: 0,
  rollSlope: 0,
  dir: 0,
  depth: Infinity,
};

/** Helm input. The physics step sees nothing else. */
export interface Controls {
  rudder: number; // -1..1
  sheet: number; // -1..1 (negative trims in, positive eases)
  /** -1..1 (negative closes the leech, positive lets the head fall open). */
  twist: number;
  autoTrim: boolean;
}

/**
 * Force breakdown for one step. Purely for the HUD, graphs and debugging; it
 * never feeds back into the physics. Without being able to see *why* the boat
 * is going this speed, tuning is guesswork.
 */
export interface Diagnostics {
  aws: number; // apparent wind speed, m/s, at the reference height
  awa: number; // apparent wind angle, rad (signed, positive = from starboard)
  twa: number; // true wind angle, rad (signed)
  sailAoA: number; // sail angle of attack, rad, averaged over the sail's area
  luffing: number; // 0..1; 1 = drawing properly, 0 = flogging. Area-averaged.
  /**
   * rad, apparent wind angle at the masthead, which is not `awa`.
   *
   * The gradient is the whole reason these differ: the masthead stands in more
   * wind than the sail's centre of effort, so its apparent wind comes from
   * further aft -- by a couple of degrees on a beat and the better part of
   * twenty on a broad reach. This is what a masthead vane physically points
   * along, and drawing one with `awa` would have it lying about its own height.
   */
  awaMast: number;
  /**
   * m/s, apparent wind speed at the masthead. Stronger than `aws` by the same
   * gradient that turns the angle: about 12% on this rig.
   *
   * These two are what the instruments read, because a boat has one wind sensor
   * and it is at the masthead. `aws`/`awa` stay the reference-height pair the
   * physics is written in.
   */
  awsMast: number;
  twist: number; // rad, the twist actually set
  /**
   * rad, the twist that would make the most drive with the sheet as it is set.
   *
   * The gap between this and `twist` is what the player trims against, so it
   * has to be visible -- and it has to be the *power* optimum rather than the
   * gradient's spread of apparent wind, which the two only agree on while the
   * boom is free of the shrouds. Off the wind they diverge a long way, and a
   * readout marking the spread would have told the player to give away a
   * percent for being correctly trimmed.
   */
  twistWanted: number;
  drive: number; // N, forward component of the sail force
  sideForce: number; // N, side force (positive = to starboard)
  heelMoment: number; // N*m
  leeway: number; // rad, angle between heading and the track through the water
  speed: number; // m/s through the water -- BSP, what a log reads
  /**
   * m/s over the ground, and rad, the compass course over the ground.
   *
   * These differ from `speed` and `heading + leeway` by the current, and by
   * nothing else. In still water they are the same numbers under different
   * names; with a tide running they are the pair that says where the boat is
   * actually going, which is not a question the boat's own instruments through
   * the water can answer.
   */
  sog: number;
  cog: number;
  vmg: number; // m/s made good to windward over the ground (positive = upwind)
  hullDrag: number; // N
  keelLift: number; // N
  rudderForce: number; // N, athwartships
  /**
   * N, fore and aft. Positive is forward.
   *
   * Published because it was not, and that cost an investigation: the blade's
   * drag went straight into the surge while `rudderForce` reported only its
   * lift, so the one force that explained the boat's behaviour appeared in no
   * diagnostic at all. See `docs/keel-sternway.md`.
   */
  rudderDrag: number;
  froude: number; // speed / hull speed
  sailFraction: number; // effective area as a fraction of full sail
  ceX: number; // m, longitudinal centre of effort of the current plan
  addedResistance: number; // N, added resistance in waves
  /** 0 = afloat, 1 = hard aground. */
  aground: number;
}

export function initialState(overrides: Partial<BoatState> = {}): BoatState {
  return {
    pos: { x: 0, y: 0 },
    heading: 60 * DEG,
    // Start sailing, not stopped. Sailing is bistable: with no speed the
    // apparent wind swings aft and the boat struggles to get going at all.
    u: 2.6,
    v: 0,
    r: 0,
    heel: 0,
    heelRate: 0,
    heelAvg: 0,
    pitch: 0,
    pitchRate: 0,
    heave: 0,
    sheet: 20 * DEG,
    twist: 12 * DEG,
    rudder: 0,
    reef: 0,
    jibFurl: 0,
    stowed: false,
    ...overrides,
  };
}

export interface StepOptions {
  /** For the polar solver: freeze the heading and disable the yaw degree of freedom. */
  lockHeading?: boolean;
  /**
   * Whether the anchor is down.
   *
   * Held exactly as the ground holds her, because it is the same thing
   * happening: she stays where she is over the ground and the tide runs past
   * instead of carrying her. The only difference is that one of them is a
   * decision and the other is a mistake, and that difference lives in the HUD
   * rather than in the physics.
   */
  anchored?: boolean;
  /** Sea state where the boat is. Omit for flat water. */
  sea?: SeaState;
}

const SHEET_RATE = 35 * DEG; // rad/s, how fast the sheet can be worked
/**
 * rad/s, how fast twist can be changed.
 *
 * Slower than the sheet on purpose. Twist is set with the vang and the
 * traveller, which are ground on rather than thrown, and a control that snapped
 * between its limits would let the player chase every gust instead of settling
 * the sail for the leg they are on.
 */
const TWIST_RATE = 14 * DEG;
/**
 * rad of heel beyond `DEPOWER_HEEL` over which the auto-trim goes from
 * gradient-matched twist to fully twisted off.
 *
 * 24 plus 8 puts full twist at 32 degrees of *sustained* heel, and a reef
 * starts at 30, so the twist is about three-quarters on by the time the reef
 * pennant is touched. That ordering is the point -- the cheap depowering goes
 * in first and most of the way -- but it is not spent to the last degree, and
 * an earlier version of this comment claimed 32 was "a little under" 30, which
 * is not a thing 32 can be.
 */
const DEPOWER_BAND = 8 * DEG;
const RUDDER_RATE = 60 * DEG; // rad/s, how fast the helm can be moved

/** Still water, for an `Environment` that does not mention a current. */
const STILL: Vec2 = { x: 0, y: 0 };

/**
 * The twist that makes the most drive, given the sheet as it is set.
 *
 * The head wants the angle of attack the foot has ended up with, which while
 * the boom is free is the target angle -- making the twist exactly the
 * gradient's spread of apparent wind over the rig. Once the boom is against the
 * shrouds the sheet has run out of travel and the foot is stuck well past its
 * stall, and then there is a real choice: twist the head back to where the flow
 * reattaches, or leave it stalled alongside the foot.
 *
 * Which is faster is not a matter of taste, and is not the same at every angle.
 * Lift acts across the flow, so its forward component dies away as the boat
 * bears away, while stalled drag acts along it and grows. On a broad reach
 * reattaching the head is worth over 1%; by a dead run the same move throws
 * away almost all the drive, because a sail running square is doing its job
 * precisely by being stalled.
 *
 * So compare what the two would actually make at the head's own apparent wind,
 * out of the same tables the sail forces come from. Reading the crossover off
 * the tables beats writing the angle in by hand, because it then follows them
 * if they are ever retuned.
 */
function powerTwist(cfg: BoatConfig, awaFoot: number, awaHead: number, sheet: number): number {
  const aHead = Math.abs(awaHead);
  const sinH = Math.sin(aHead);
  const cosH = Math.cos(aHead);
  // Drive per unit dynamic pressure: lift acts across the apparent wind, drag
  // along it, and this is their forward component. Same decomposition as the
  // strip loop, which is why the two cannot disagree about what is fast.
  const driveAt = (aoa: number): number => {
    const d = Math.abs(aoa) * RAD;
    return sample(SAIL_CL, d) * sinH - sample(SAIL_CD, d) * cosH;
  };

  const footAoA = Math.abs(awaFoot) - sheet;
  const attached = Math.min(cfg.targetAoA, footAoA);
  const headAoA = driveAt(attached) > driveAt(footAoA) ? attached : footAoA;
  return clamp(aHead - sheet - headAoA, 0, cfg.maxTwist);
}

/**
 * The apparent wind vector at one height, given the wind gradient's speed factor
 * `f` there.
 *
 * The true wind up there, less the boat's own velocity -- which is the same at
 * every height. That asymmetry is the whole reason the apparent wind angle
 * varies with height at all.
 *
 * Everything that asks about the wind at a height goes through here, including
 * the strip loop, so the trim cannot end up aiming at an angle the sail is not
 * actually working at. That used to be two copies of one expression held in
 * step by a comment.
 *
 * The velocity subtracted is over the ground, and the parameter is named for it
 * because the difference has no visible symptom until there is a current, by
 * which time the wrong one would be four call sites deep.
 */
function apparentAtHeight(windVelW: Vec2, velGroundW: Vec2, f: number): Vec2 {
  return sub(scale(windVelW, f), velGroundW);
}

/**
 * Signed apparent wind angle of an apparent wind vector; positive = from
 * starboard.
 *
 * The guard is not defensive padding. `compassAngle` is `atan2`, and `atan2` of
 * two zeroes depends on their *signs*: a dead calm with the boat stopped builds
 * the apparent wind out of `tws * 0`, whose components come out as -0 or +0
 * according to where the wind was blowing from before it died. Measured, that
 * put the readout at 0 degrees for a northerly and 180 for a southerly -- a
 * gauge swinging between dead ahead and dead astern over a difference that does
 * not exist. There is no angle when there is no wind; report the one number that
 * at least does not flip.
 */
function awaOf(app: Vec2, heading: number): number {
  if (Math.abs(app.x) < 1e-9 && Math.abs(app.y) < 1e-9) return 0;
  return wrapPi(compassAngle(scale(app, -1)) - heading);
}

const awaAtHeight = (windVelW: Vec2, velGroundW: Vec2, heading: number, f: number): number =>
  awaOf(apparentAtHeight(windVelW, velGroundW, f), heading);

/**
 * One physics step. Call only with a fixed dt (1/120 s is the intended value).
 * Updates state in place and returns diagnostics.
 */
export function step(
  s: BoatState,
  cfg: BoatConfig,
  env: Environment,
  ctl: Controls,
  dt: number,
  opts: StepOptions = {},
): Diagnostics {
  const sea = opts.sea ?? CALM;

  // --- 1. Geometry: hull axes and the two velocities ------------------------
  //
  // `u` and `v` are the boat's velocity *through the water*, and everything the
  // hull, keel and rudder do is a function of that alone -- a boat carried along
  // by a current is not sailing through anything and feels no force from it.
  // Adding the current gives velocity *over the ground*, which is what the
  // position, the wind and the racing all care about. Keeping these two apart
  // is the whole of the current model; conflating them is the entire bug
  // surface.
  const fwd = compassVec(s.heading);
  const stb = rotCW90(fwd);
  const velWaterW = add(scale(fwd, s.u), scale(stb, s.v));
  const speed = len(velWaterW);
  // How hard the ground has hold of her. Needed here as well as at the
  // integration, because a boat the ground is holding is not being carried by
  // the tide, and that has to be true of the wind she feels and of where she
  // ends up alike -- one of them alone would have her stopped on the bank and
  // still feeling the breeze of a drift she is not making.
  const aground = clamp((cfg.draft - sea.depth) / 0.8, 0, 1);
  // What has hold of her, whichever it is. Kept apart from `aground` itself,
  // which is still only about the bottom: the alert and the diagnostic mean
  // "you have run out of water", and an anchored boat has not.
  const held = opts.anchored ? 1 : aground;
  // Chain and a hook set in the bottom hold a great deal harder than a keel
  // resting on it -- a grounded boat is dragged on and off by the sea, and an
  // anchored one is not. Measured: at the grounding's rate she crept 12 m in
  // two minutes under full sail in fourteen knots, which is a boat dragging.
  const holdRate = opts.anchored ? 40 : 6;
  const drift = scale(env.current ?? STILL, 1 - held);
  const velGroundW = add(velWaterW, drift);

  // --- 2. Wind: true -> apparent -------------------------------------------
  // Everything in sailing starts here. The moment the boat moves, the sail
  // feels not the true wind but the true wind minus the boat's own velocity.
  //
  // Over the ground, not through the water. The air is not carried along by the
  // current, so it is ground velocity that has to be subtracted from it -- which
  // is why a boat drifting in a calm with the tide feels a breeze from dead
  // ahead at exactly the drift, and why the still-water polar stops describing
  // her the moment there is a current.
  const windVelW = scale(compassVec(env.twd), -env.tws); // the direction air travels
  // The reference height is where the quoted wind is quoted, so it is the f = 1
  // member of the same family every other height is drawn from.
  const appW = apparentAtHeight(windVelW, velGroundW, 1);
  const aws = len(appW);
  const awa = awaOf(appW, s.heading); // measured from where it blows from
  const twa = wrapPi(env.twd - s.heading);

  // --- 3. Sail trim ---------------------------------------------------------
  const plan = sailPlan(cfg, s.reef, s.jibFurl, s.stowed);
  const zCg = cgHeight(cfg);
  const zRef = windRefHeight(cfg);

  // The head of the sail stands in a stronger true wind than the foot, and the
  // boat's velocity subtracted from it is the same at both, so the apparent
  // wind up there comes from further aft. The gap between the two is exactly
  // the twist the sail wants: match it and every part of the sail sits at the
  // same angle of attack. It comes out at a couple of degrees on a beat and
  // nearer twenty on a broad reach, which is why sails are trimmed almost flat
  // upwind and let right open downwind.
  const fFoot = shearFactor(plan.footHeight + zCg, zRef);
  const fHead = shearFactor(plan.headHeight + zCg, zRef);
  const awaFoot = awaAtHeight(windVelW, velGroundW, s.heading, fFoot);
  const awaHead = awaAtHeight(windVelW, velGroundW, s.heading, fHead);
  // The masthead is higher than any part of the sail and does not come down
  // with a reef, so it gets its own sample rather than reusing the head's.
  const appMast = apparentAtHeight(windVelW, velGroundW, shearFactor(cfg.mastHeight + zCg, zRef));
  const awaMast = awaOf(appMast, s.heading);
  const awsMast = len(appMast);

  // Sheet first, twist second, because the twist that makes most power depends
  // on where the boom has ended up -- and in particular on whether it has run
  // out of travel. Hence two passes over the same branch rather than one.
  if (ctl.autoTrim) {
    // Trim the *foot* to the target angle and let the twist carry the rest of
    // the sail up to the head. Sheeting to the mid-height wind instead, as the
    // untwisted model did, would leave the whole plan a third of the twist
    // under-trimmed.
    const wantSheet = clamp(Math.abs(awaFoot) - cfg.targetAoA, cfg.minSheet, cfg.maxSheet);
    s.sheet = approach(s.sheet, wantSheet, 0.6, dt);
  } else {
    s.sheet = clamp(s.sheet + ctl.sheet * SHEET_RATE * dt, cfg.minSheet, cfg.maxSheet);
  }

  // Computed in both modes and from the sheet actually set, because this is the
  // number the player is shown and trims against. Reporting it only while the
  // auto-trim is on would leave the readout dead in the one mode that needs it.
  const twistWanted = powerTwist(cfg, awaFoot, awaHead, s.sheet);

  if (ctl.autoTrim) {
    // Once the boat is overpowered, power is not what is wanted: the head is
    // the part with the longest lever on the heel, so letting it twist open
    // spills it while the foot keeps driving. What that buys is sail area --
    // measured hard on the wind in 20 knots, twisting off carries 65% of full
    // sail against 54% at the same 27 degrees of heel, and is 8% faster for it.
    // That is the real reason a crew reaches for the vang, and it comes before
    // reefing -- hence a band that starts at the auto-reef's target heel and is
    // fully on before the reef pennant is touched.
    const depower = clamp((s.heelAvg - DEPOWER_HEEL) / DEPOWER_BAND, 0, 1);
    s.twist = approach(s.twist, twistWanted + depower * (cfg.maxTwist - twistWanted), 1.5, dt);
  } else {
    s.twist = clamp(s.twist + ctl.twist * TWIST_RATE * dt, 0, cfg.maxTwist);
  }

  // --- 4. Sail aerodynamics -------------------------------------------------
  // Strip theory. The sail is cut into horizontal bands, and each one gets its
  // own height, its own true wind out of the gradient, hence its own apparent
  // wind angle, and its own sheet angle once twist is applied. A single force
  // at the centre of effort cannot express any of this: the whole point is that
  // the head and the foot are working at different angles at the same moment.
  const heelFac = Math.cos(s.heel); // heeling reduces the projected sail area
  const span = plan.headHeight - plan.footHeight;
  let sailFx = 0;
  let sailFy = 0;
  let sailHeel = 0; // N*m, accumulated with each strip's own lever arm
  let sailAoA = 0; // area-weighted, for the HUD
  let luffing = 0; // area-weighted: the head alone can be flogging

  for (let i = 0; i < SAIL_STRIPS; i++) {
    const z = plan.footHeight + STRIP_U[i] * span;
    const f = shearFactor(z + zCg, zRef);
    const ap = apparentAtHeight(windVelW, velGroundW, f);
    const awaI = awaOf(ap, s.heading);

    // The boom always swings to leeward, so the angle of attack is a
    // subtraction: apparent wind angle minus the sheet angle at this height.
    const aoa = Math.abs(awaI) - (s.sheet + s.twist * STRIP_U[i]);
    // A negative angle of attack means the wind is hitting the back of the
    // sail: it is luffing. Dropping the force to zero instantly makes the sim
    // jump, so fade it out over five degrees.
    const lf = clamp(1 + aoa / (5 * DEG), 0, 1);

    const awsI = len(ap);
    const q = 0.5 * env.rhoAir * awsI * awsI * plan.area * STRIP_AREA[i] * lf * heelFac;
    const aoaDeg = Math.abs(aoa) * RAD;
    const cl = sample(SAIL_CL, aoaDeg);
    // Induced drag. This term governs upwind performance: close-hauled, drive
    // is the small difference between a large forward lift component and a
    // large drag, so leaving it out lets the boat point impossibly high (a
    // 60-degree tacking angle). Strip theory keeps one aspect ratio for the
    // whole sail rather than inventing one per strip, which would be nonsense.
    const cd = sample(SAIL_CD, aoaDeg) + (cl * cl) / (Math.PI * cfg.sailAR);

    const flowI = norm(ap); // direction the air is moving at this height
    // Lift is perpendicular to the flow. With the wind from starboard, the
    // low-pressure side is 90 degrees clockwise from it. Each strip decides for
    // itself: close to a dead run the head can already be by the lee while the
    // foot is not, and forcing them onto the same side would fake a gybe.
    const liftDir = side(awaI) > 0 ? rotCW90(flowI) : rotCCW90(flowI);
    const stripF = add(scale(liftDir, q * cl), scale(flowI, q * cd));

    const fyI = dot(stripF, stb);
    sailFx += dot(stripF, fwd);
    sailFy += fyI;
    sailHeel += fyI * z;
    sailAoA += aoa * STRIP_AREA[i];
    luffing += lf * STRIP_AREA[i];
  }

  // Windage just shoves the boat along the apparent wind, sails or not. It is
  // hull, mast and rigging rather than sail, so it keeps the single
  // reference-height wind and acts at the centre of effort as it always did.
  const flow = norm(appW); // direction the air is moving
  const qWindage = 0.5 * env.rhoAir * aws * aws * cfg.windageArea * cfg.windageCd;
  const windageF = scale(flow, qWindage);
  const windageFy = dot(windageF, stb);

  let fx = sailFx + dot(windageF, fwd); // hull-frame fore-and-aft force
  let fy = sailFy + windageFy; // hull-frame athwartships force
  const drive = fx;
  const sideForce = fy;

  // --- 5. Keel and hull hydrodynamics --------------------------------------
  // A boat does not travel along its heading; it slips slightly sideways. That
  // angle -- leeway -- is the keel's angle of attack, and the lift it produces
  // is what balances the sail's side force. Without it the boat would just
  // slide downwind.
  //
  // Against the water track, never the ground track. Leeway is an angle of
  // attack, and a keel being carried sideways by a current is not at an angle to
  // anything. The two differ by the set, and reporting the ground track here
  // would have the boat generate keel lift out of the tide.
  const leeway = speed > 0.05 ? wrapPi(compassAngle(velWaterW) - s.heading) : 0;
  let keelLift = 0;
  let hullDrag = 0;
  let addedResistance = 0;
  // The keel's actual side force in hull axes. Needed by both the heel moment
  // and the yaw moment.
  let keelFy = 0;

  if (speed > 0.02) {
    const flowW = scale(norm(velWaterW), -1); // water flow the hull sees
    const qWater = 0.5 * env.rhoWater * speed * speed;

    // The keel's chord runs fore and aft, so the flow along it is `-u` and the
    // flow across it `-v`. Taken from the axis rather than from `leeway`, which
    // reads 180 degrees in sternway and clamped the tables to broadside.
    const bDeg = foilAoA(s.u, s.v);
    const clk = sample(FOIL_CL, bDeg) * Math.cos(s.heel);
    // Same story as the sail: the more the boat slips sideways, the more speed
    // it loses to induced drag.
    const cdk = sample(FOIL_CD, bDeg) + (clk * clk) / (Math.PI * cfg.keelAR);
    keelLift = qWater * cfg.keelArea * clk;

    // Lift is square to the flow, on whichever side of it resists the sideslip.
    // Chosen by the component athwartships rather than from `side(leeway)`,
    // because the perpendicular to the flow turns end for end when she goes
    // astern and the leeway does not describe which way that landed.
    const kPerp = rotCW90(flowW);
    const kLiftDir = dot(kPerp, stb) * s.v < 0 ? kPerp : rotCCW90(flowW);
    const keelF = add(scale(kLiftDir, keelLift), scale(flowW, qWater * cfg.keelArea * cdk));

    // Hull resistance: friction plus wave-making. As the Froude number
    // approaches one, a wall goes up.
    const fr = speed / boatHullSpeed(cfg);
    const wave = 1 + cfg.waveK * Math.pow(fr, 8);
    hullDrag = 0.5 * env.rhoWater * cfg.wettedArea * cfg.cf * speed * speed * wave;

    // Added resistance in waves. Scales with wave height squared and is worst
    // punching straight into them. Without it, more wind would simply mean more
    // speed, and the real decision to crack off a few degrees to ease the
    // pounding would disappear.
    if (sea.h13 > 0.02) {
      // Dot product of wave travel direction and heading; -1 means head-on.
      const enc = Math.cos(sea.dir - s.heading);
      const headSea = clamp(-enc, 0, 1);
      addedResistance =
        cfg.waveDragK * sea.h13 * sea.h13 * (0.22 + 0.78 * headSea) * clamp(speed / 2, 0.15, 1.4);
      hullDrag += addedResistance;
    }
    const hullF = scale(flowW, hullDrag);

    keelFy = dot(keelF, stb);
    fx += dot(keelF, fwd) + dot(hullF, fwd);
    fy += keelFy + dot(hullF, stb);
  }

  // --- 6. Rudder ------------------------------------------------------------
  s.rudder = approach(
    s.rudder,
    clamp(ctl.rudder, -1, 1) * cfg.maxRudder,
    (cfg.maxRudder / RUDDER_RATE) * 0.5,
    dt,
  );

  let rudderForce = 0;
  let rudderDrag = 0;
  let mz = 0;
  /*
   * The blade, worked in its own frame.
   *
   * Two things here were wrong for a long time and both only showed when she
   * had sternway. The angle came from `atan2(vRud, u)`, which reads 180 degrees
   * going astern and clamped `FOIL_CD` to broadside; and the drag was taken off
   * the surge unconditionally -- `fx -= qR * cdr` -- so it pushed her aft
   * whichever way she was actually moving, which is to say it *drove* her when
   * she was already going backwards. See `docs/keel-sternway.md`.
   *
   * The dynamic pressure came off a floor of 0.3 m/s as well, so a rudder
   * standing still in the water was given 54.8 N. Nothing needs the floor:
   * `atan2` wants no guard against a small denominator, and the only reason to
   * clamp was one that never applied.
   */
  const vRud = s.v - s.r * cfg.rudderArm; // the stern swings sideways with yaw rate
  // Her speed past the blade, and no floor under it. The old `uSafe` clamped
  // |u| up to 0.3 m/s before squaring it into the dynamic pressure, which gave
  // a rudder standing still in the water 54.8 N of thrust -- half of the pair
  // of errors that made the drift equilibrium look like one. `atan2` below
  // needs no guard against a small denominator.
  const rSpeed = Math.hypot(s.u, vRud);
  if (rSpeed > 0.05) {
    // Kept as the old signed angle, so forward flow is untouched: the helm
    // angle adds to the sideslip the stern actually feels.
    const alphaR = s.rudder + Math.atan2(vRud, s.u);
    const qR = 0.5 * env.rhoWater * rSpeed * rSpeed * cfg.rudderArea;
    // Folded onto the chord axis before it reaches the tables. Astern this read
    // 180 degrees and `sample` clamped it to broadside; a blade going backwards
    // is edge-on, exactly as it is going forwards.
    const aoa = foilAoA(Math.cos(alphaR), Math.sin(alphaR));
    const clr = sample(FOIL_CL, aoa);
    const cdr = sample(FOIL_CD, aoa);
    // A positive angle of attack pushes the rudder to port, which kicks the
    // stern to port, which swings the bow to starboard. Reversed when she has
    // sternway, because the water is then coming at the blade from behind --
    // which is why the helm works backwards going astern, as it does.
    // No `astern` factor here: `wrapPi` has already turned the angle end for
    // end, which is the reversal. Applying both cancels them and the helm goes
    // on working the same way round whichever way she is moving.
    const astern = s.u < 0 ? -1 : 1;
    rudderForce = -side(wrapPi(alphaR)) * qR * clr * Math.cos(s.heel);
    // Drag opposes her way through the water rather than always pointing aft.
    // Taken off the surge unconditionally, it pushed her astern when she was
    // already going astern, and drove the runaway in `docs/keel-sternway.md`.
    rudderDrag = -astern * qR * cdr;
    fx += rudderDrag;
    fy += rudderForce;
    mz += rudderForce * -cfg.rudderArm;
  }

  // --- 7. Yaw moments -------------------------------------------------------
  // Every hydrodynamic moment must scale with v^2 to stay dimensionally
  // consistent with the rudder. Leave even one of them at v^1 and that term
  // swamps the helm at low speed, which makes the boat impossible to steer.
  //
  // The sail force acts at the centre of effort, the keel force at the centre
  // of lateral resistance. The longitudinal gap between them ("lead") sets the
  // static balance, and the heel-driven luffing tendency turns it into weather
  // helm.
  mz += sideForce * plan.ceX;
  mz += keelFy * cfg.clrX;
  mz += -cfg.heelHelm * Math.sin(s.heel) * s.u * s.u;
  // Directional stability: positive leeway means the track is to starboard of
  // the heading, so the bow should swing to starboard to line up. Flip this
  // sign and it accelerates the luff-up instead of damping it, and the boat
  // becomes unsteerable.
  // The folded sideslip, not the track angle: exact sternway makes `leeway`
  // read +/-pi, which handed a term derived for small forward sideslip a huge
  // moment whose direction came from the sign of a numerical zero.
  mz += cfg.weathervane * Math.atan2(s.v, Math.abs(s.u)) * speed * speed;
  mz += -cfg.yawDamp * s.r * (0.6 + speed);

  // --- 8. Roll, pitch and heave --------------------------------------------
  // M = sum(Fy_i * z_i), where z is height above the centre of gravity.
  // The sail pushes to leeward from above, the keel resists from below
  // (-keelDepth). They form a couple, so they add rather than cancel. Reefing
  // lowers the sail's share of it, which is exactly why it reduces heel.
  //
  // The sail's term is summed strip by strip rather than taken as one force at
  // the centre of effort, and the two are not the same number: the wind is
  // strongest exactly where the lever is longest, so the gradient heels the
  // boat harder than its total side force alone would suggest.
  const heelMoment = sailHeel + windageFy * plan.ceHeight + keelFy * -cfg.keelDepth;

  // The righting moment is referenced to the **local water surface normal**,
  // not to vertical. The boat floats on the water, so when a wave tilts, the
  // boat is dragged with it. That single detail gives wave-induced rolling for
  // free, and because this is a second-order system it also produces heel
  // overshoot in gusts and the settling wobble after a tack. A quasi-static
  // model gives none of the three.
  //
  // The slope is *added* where the pitch below subtracts its own, and that is
  // not a slip. `pitchSlope` is positive bow-up and `s.pitch` is positive
  // bow-up, so the difference between them is the trim relative to the water.
  // Roll does not line up that way: `rollSlope` is positive starboard-*up*
  // (see sampleHull in waves.ts) while `s.heel` is positive starboard-*down*
  // (see "heels away from the wind" in boat.test.ts, where wind from starboard
  // gives negative heel). Subtracting one from the other took the difference
  // of two quantities measured in opposite directions, so a hull left to
  // itself settled leaning *into* the face of the wave instead of lying along
  // it, at twice the slope angle.
  //
  // Found from the renderer: the animals were given the same treatment by
  // copying this line, and measured against the analytic normal of a plane
  // they came out mirrored. The polar does not see it -- solvePolar sets
  // rollSlope to zero deliberately, since a rolling boat has no steady state
  // to find -- so nothing in the validation could ever have caught it.
  const rollAccel =
    (heelMoment - cfg.rm90 * Math.sin(s.heel + sea.rollSlope) - cfg.rollDamp * s.heelRate) /
    cfg.rollInertia;
  s.heelRate += rollAccel * dt;
  s.heel = clamp(s.heel + s.heelRate * dt, -1.4, 1.4);
  s.heelAvg = approach(s.heelAvg, Math.abs(s.heel), HEEL_TAU, dt);

  // Pitch follows the surface slope, with drive pressing the bow down a little.
  const trimMoment = -drive * plan.ceHeight * 0.35;
  const pitchAccel =
    (trimMoment - cfg.pitchStiff * (s.pitch - sea.pitchSlope) - cfg.pitchDamp * s.pitchRate) /
    cfg.pitchInertia;
  s.pitchRate += pitchAccel * dt;
  s.pitch = clamp(s.pitch + s.pitchRate * dt, -0.6, 0.6);

  // Heave: waves shorter than the hull are already averaged out by the
  // four-point sampling, so all that is left is buoyancy lag -- first order
  // is enough.
  s.heave = approach(s.heave, sea.heave, cfg.heaveTau, dt);

  // --- 9. Integration (semi-implicit Euler, 3-DOF in hull axes) -------------
  const mx = cfg.mass * cfg.addedMassSurge;
  const my = cfg.mass * cfg.addedMassSway;

  s.u += dt * (fx / mx + s.v * s.r);
  s.v += dt * (fy / my - s.u * s.r);

  // Grounding. Modelled as velocity damping rather than a contact force: a
  // stiff contact spring at this timestep would explode, and what matters for
  // gameplay is simply that the boat stops. It is deliberately not a total
  // freeze -- the sails can still work you off again, which is what happens.
  // `held` is worked out up in section 1, where the drift needs it.
  if (held > 0) {
    const bite = Math.exp(-dt * holdRate * held);
    s.u *= bite;
    s.v *= bite;
    s.r *= bite;
  }

  if (opts.lockHeading) {
    s.r = 0;
  } else {
    s.r += (dt * mz) / cfg.izz;
    s.heading += s.r * dt;
  }

  const newVel = add(scale(compassVec(s.heading), s.u), scale(rotCW90(compassVec(s.heading)), s.v));
  // The same `drift` the apparent wind was built from, so where she ends up and
  // what she feels getting there cannot disagree about the tide.
  const newVelGround = add(newVel, drift);
  s.pos = add(s.pos, scale(newVelGround, dt));
  const sog = len(newVelGround);

  // VMG: speed made good towards the wind. This is the number that decides the
  // best tacking angle -- and it is made good over the ground, because that is
  // where the marks are. In a foul tide it can be negative on a heading that is
  // sailing perfectly well.
  const vmg = dot(newVelGround, compassVec(env.twd));

  return {
    aws,
    awa,
    twa,
    sailAoA,
    luffing,
    awaMast,
    awsMast,
    twist: s.twist,
    twistWanted,
    drive,
    sideForce,
    heelMoment,
    leeway,
    speed: len(newVel),
    sog,
    // A course over the ground needs a track to measure; when there is none,
    // report the heading rather than the direction of the last rounding error.
    cog: sog > 0.05 ? compassAngle(newVelGround) : s.heading,
    vmg,
    hullDrag,
    keelLift,
    rudderForce,
    rudderDrag,
    froude: len(newVel) / boatHullSpeed(cfg),
    sailFraction: plan.fraction,
    ceX: plan.ceX,
    addedResistance,
    aground,
  };
}
