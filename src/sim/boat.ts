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
import { FOIL_CD, FOIL_CL, SAIL_CD, SAIL_CL, sample } from './tables';
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
  leeway: number; // rad, angle between heading and actual track
  speed: number; // m/s through the water
  vmg: number; // m/s made good to windward (positive = upwind)
  hullDrag: number; // N
  keelLift: number; // N
  rudderForce: number; // N
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
    ...overrides,
  };
}

export interface StepOptions {
  /** For the polar solver: freeze the heading and disable the yaw degree of freedom. */
  lockHeading?: boolean;
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
 */
function apparentAtHeight(windVelW: Vec2, velW: Vec2, f: number): Vec2 {
  return sub(scale(windVelW, f), velW);
}

/** Signed apparent wind angle of an apparent wind vector; positive = from starboard. */
function awaOf(app: Vec2, heading: number): number {
  return wrapPi(compassAngle(scale(app, -1)) - heading);
}

const awaAtHeight = (windVelW: Vec2, velW: Vec2, heading: number, f: number): number =>
  awaOf(apparentAtHeight(windVelW, velW, f), heading);

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

  // --- 1. Geometry: hull axes and world velocity ---------------------------
  const fwd = compassVec(s.heading);
  const stb = rotCW90(fwd);
  const velW = add(scale(fwd, s.u), scale(stb, s.v));
  const speed = len(velW);

  // --- 2. Wind: true -> apparent -------------------------------------------
  // Everything in sailing starts here. The moment the boat moves, the sail
  // feels not the true wind but the true wind minus the boat's own velocity.
  const windVelW = scale(compassVec(env.twd), -env.tws); // the direction air travels
  // The reference height is where the quoted wind is quoted, so it is the f = 1
  // member of the same family every other height is drawn from.
  const appW = apparentAtHeight(windVelW, velW, 1);
  const aws = len(appW);
  const awa = awaOf(appW, s.heading); // measured from where it blows from
  const twa = wrapPi(env.twd - s.heading);

  // --- 3. Sail trim ---------------------------------------------------------
  const plan = sailPlan(cfg, s.reef, s.jibFurl);
  const zCg = cgHeight(cfg);
  const zRef = windRefHeight(cfg);

  // The head of the sail stands in a stronger true wind than the foot, and the
  // boat's velocity subtracted from it is the same at both, so the apparent
  // wind up there comes from further aft. The gap between the two is exactly
  // the twist the sail wants: match it and every part of the sail sits at the
  // same angle of attack. It comes out at a couple of degrees on a beat and
  // nearer twenty on a broad reach, which is why sails are trimmed almost flat
  // upwind and let right open downwind.
  const awaFoot = awaAtHeight(windVelW, velW, s.heading, shearFactor(plan.footHeight + zCg, zRef));
  const awaHead = awaAtHeight(windVelW, velW, s.heading, shearFactor(plan.headHeight + zCg, zRef));
  // The masthead is higher than any part of the sail and does not come down
  // with a reef, so it gets its own sample rather than reusing the head's.
  const awaMast = awaAtHeight(windVelW, velW, s.heading, shearFactor(cfg.mastHeight + zCg, zRef));

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
    const ap = apparentAtHeight(windVelW, velW, f);
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
  const leeway = speed > 0.05 ? wrapPi(compassAngle(velW) - s.heading) : 0;
  let keelLift = 0;
  let hullDrag = 0;
  let addedResistance = 0;
  // The keel's actual side force in hull axes. Needed by both the heel moment
  // and the yaw moment.
  let keelFy = 0;

  if (speed > 0.02) {
    const flowW = scale(norm(velW), -1); // water flow the hull sees
    const qWater = 0.5 * env.rhoWater * speed * speed;

    const bDeg = Math.abs(leeway) * RAD;
    const clk = sample(FOIL_CL, bDeg) * Math.cos(s.heel);
    // Same story as the sail: the more the boat slips sideways, the more speed
    // it loses to induced drag.
    const cdk = sample(FOIL_CD, bDeg) + (clk * clk) / (Math.PI * cfg.keelAR);
    keelLift = qWater * cfg.keelArea * clk;

    const kLiftDir = side(leeway) > 0 ? rotCW90(flowW) : rotCCW90(flowW);
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
  let mz = 0;
  if (speed > 0.05) {
    const uSafe = Math.max(Math.abs(s.u), 0.3) * Math.sign(s.u || 1);
    const vRud = s.v - s.r * cfg.rudderArm; // the stern swings sideways with yaw rate
    const alphaR = s.rudder + Math.atan2(vRud, uSafe);
    const qR = 0.5 * env.rhoWater * (uSafe * uSafe + vRud * vRud) * cfg.rudderArea;
    const clr = sample(FOIL_CL, Math.abs(alphaR) * RAD);
    const cdr = sample(FOIL_CD, Math.abs(alphaR) * RAD);
    // A positive angle of attack pushes the rudder to port, which kicks the
    // stern to port, which swings the bow to starboard.
    rudderForce = -side(alphaR) * qR * clr * Math.cos(s.heel);
    fy += rudderForce;
    fx -= qR * cdr;
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
  mz += cfg.weathervane * leeway * speed * speed;
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
  const rollAccel =
    (heelMoment - cfg.rm90 * Math.sin(s.heel - sea.rollSlope) - cfg.rollDamp * s.heelRate) /
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
  const aground = clamp((cfg.draft - sea.depth) / 0.8, 0, 1);
  if (aground > 0) {
    const bite = Math.exp(-dt * 6 * aground);
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
  s.pos = add(s.pos, scale(newVel, dt));

  // VMG: speed made good towards the wind. This is the number that decides the
  // best tacking angle.
  const vmg = dot(newVel, compassVec(env.twd));

  return {
    aws,
    awa,
    twa,
    sailAoA,
    luffing,
    awaMast,
    twist: s.twist,
    twistWanted,
    drive,
    sideForce,
    heelMoment,
    leeway,
    speed: len(newVel),
    vmg,
    hullDrag,
    keelLift,
    rudderForce,
    froude: len(newVel) / boatHullSpeed(cfg),
    sailFraction: plan.fraction,
    ceX: plan.ceX,
    addedResistance,
    aground,
  };
}
