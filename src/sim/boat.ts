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
import { boatHullSpeed, type BoatConfig, type Environment } from './config';
import { sailPlan } from './sailplan';

/** Everything that gets integrated. This alone reproduces the boat. */
export interface BoatState {
  pos: Vec2; // m, world
  heading: number; // rad, compass
  u: number; // m/s surge (forward)
  v: number; // m/s sway (starboard positive) -- this is what leeway really is
  r: number; // rad/s yaw rate (starboard positive)
  heel: number; // rad, positive = heeled to starboard
  heelRate: number; // rad/s
  pitch: number; // rad, positive = bow up
  pitchRate: number; // rad/s
  heave: number; // m, vertical displacement of the waterline
  sheet: number; // rad, boom angle off the centreline
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
  autoTrim: boolean;
}

/**
 * Force breakdown for one step. Purely for the HUD, graphs and debugging; it
 * never feeds back into the physics. Without being able to see *why* the boat
 * is going this speed, tuning is guesswork.
 */
export interface Diagnostics {
  aws: number; // apparent wind speed, m/s
  awa: number; // apparent wind angle, rad (signed, positive = from starboard)
  twa: number; // true wind angle, rad (signed)
  sailAoA: number; // sail angle of attack, rad
  luffing: number; // 0..1; 1 = drawing properly, 0 = flogging
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
    pitch: 0,
    pitchRate: 0,
    heave: 0,
    sheet: 20 * DEG,
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
const RUDDER_RATE = 60 * DEG; // rad/s, how fast the helm can be moved

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
  const appW = sub(windVelW, velW);
  const aws = len(appW);
  const awa = wrapPi(compassAngle(scale(appW, -1)) - s.heading); // measured from where it blows from
  const twa = wrapPi(env.twd - s.heading);

  const tack = side(awa); // +1 = wind from starboard, -1 = from port

  // --- 3. Sail trim ---------------------------------------------------------
  if (ctl.autoTrim) {
    const want = clamp(Math.abs(awa) - cfg.targetAoA, cfg.minSheet, cfg.maxSheet);
    s.sheet = approach(s.sheet, want, 0.6, dt);
  } else {
    s.sheet = clamp(s.sheet + ctl.sheet * SHEET_RATE * dt, cfg.minSheet, cfg.maxSheet);
  }

  // The boom always swings to leeward, so the angle of attack is a subtraction:
  // apparent wind angle minus boom angle. That is the whole of sail geometry.
  const sailAoA = Math.abs(awa) - s.sheet;

  // A negative angle of attack means the wind is hitting the back of the sail:
  // it is luffing. Dropping the force to zero instantly makes the sim jump, so
  // fade it out over five degrees.
  const luffing = clamp(1 + sailAoA / (5 * DEG), 0, 1);

  // --- 4. Sail aerodynamics -------------------------------------------------
  const heelFac = Math.cos(s.heel); // heeling reduces the projected sail area
  const plan = sailPlan(cfg, s.reef, s.jibFurl);
  const qAir = 0.5 * env.rhoAir * aws * aws * plan.area * luffing * heelFac;
  const aoaDeg = Math.abs(sailAoA) * RAD;
  const cl = sample(SAIL_CL, aoaDeg);
  // Induced drag. This term governs upwind performance: close-hauled, drive is
  // the small difference between a large forward lift component and a large
  // drag, so leaving it out lets the boat point impossibly high (a 60-degree
  // tacking angle).
  const cd = sample(SAIL_CD, aoaDeg) + (cl * cl) / (Math.PI * cfg.sailAR);

  const flow = norm(appW); // direction the air is moving
  // Lift is perpendicular to the flow. With the wind from starboard, the
  // low-pressure side is 90 degrees clockwise from it.
  const liftDir = tack > 0 ? rotCW90(flow) : rotCCW90(flow);
  // Windage just shoves the boat along the apparent wind, sails or not.
  const qWindage = 0.5 * env.rhoAir * aws * aws * cfg.windageArea * cfg.windageCd;
  const sailF = add(scale(liftDir, qAir * cl), scale(flow, qAir * cd + qWindage));

  let fx = dot(sailF, fwd); // hull-frame fore-and-aft force
  let fy = dot(sailF, stb); // hull-frame athwartships force
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
  // The sail pushes to leeward from above (+ceHeight), the keel resists from
  // below (-keelDepth). They form a couple, so they add rather than cancel.
  // Reefing lowers plan.ceHeight, which is exactly why it reduces heel.
  const heelMoment = sideForce * plan.ceHeight + keelFy * -cfg.keelDepth;

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
