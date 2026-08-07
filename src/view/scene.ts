import * as THREE from 'three';
import { cgHeight, type BoatConfig } from '../sim/config';
import type { BoatState, Diagnostics } from '../sim/boat';
import { clamp, compassVec, side } from '../sim/math';
import { REEF_AREA_FACTOR } from '../sim/sailplan';
import { ADVECTION, type WindField } from '../sim/wind';
import type { WaveField } from '../sim/waves';
import type { Course, RaceState } from '../sim/race';
import type { GhostSample } from '../sim/replay';
import type { Terrain } from '../sim/terrain';
import type { SkyState } from '../sim/sky';
import type { WeatherState } from '../sim/weather';
import { createWater } from './water';
import { createCourseView } from './course';
import { createIslandView } from './islands';
import { createRain } from './rain';
import { createSkyDome } from './skydome';
import { createBoatLights, lampLevel } from './lights';
import { createOrbit } from './orbit';

/**
 * Scene assembly.
 *
 * Coordinate mapping: sim (x=east, y=north) -> three (x=east, y=up, z=south),
 * so three.z = -sim.y and the bow points along local -Z.
 * A compass heading psi becomes mesh.rotation.y = -psi.
 *
 * What has to be legible here is the physics: heel angle, boom angle, rudder
 * angle, the wake (which is where leeway becomes visible) and the wind streaks.
 */

const HULL = 0x8b95a1;
const DECK = 0x5c6672;
const SAIL = 0xe8ecf1;
const ACCENT = 0x4fd1c5;

/**
 * Everything one frame needs. As positional arguments this would be eight
 * parameters, which is easy to get out of order at the call site.
 */
export interface FrameInput {
  state: BoatState;
  diag: Diagnostics;
  wind: WindField;
  waves: WaveField;
  course: Course;
  race: RaceState;
  sky: SkyState;
  weather: WeatherState;
  /**
   * World hours since the session began, unwrapped.
   *
   * `sky.hour` is the clock face and wraps at midnight; this is the clock. Sky
   * effects that accumulate -- the stars turning, the cloud drifting -- need
   * time that does not go backwards once a night.
   */
  elapsedHours: number;
  visibility: number;
  ghost: GhostSample | null;
  /** Whether the boat is showing her lights. */
  lightsOn: boolean;
  /** Bumped on every new session, so the view can drop what it was trailing. */
  session: number;
  dt: number;
}

export interface SceneView {
  render(f: FrameInput): void;
  /**
   * @param physics the island window the boat feels, shared with the water shader
   * @param visible the wider window that is merely drawn, out to the fog
   */
  setTerrain(physics: Terrain, visible: Terrain): void;
  toggleCamera(): void;
  resize(): void;
  dispose(): void;
}

/**
 * The hull. Simply extruding the deck outline gives vertical topsides and a
 * flat bottom, which reads as a barge. The boat is the centre of the whole
 * game, so it is built properly.
 *
 * Method: lay out stations from stern to bow and loft between them. Each
 * station is a quarter-ellipse rising from the keel to the deck; varying the
 * beam, depth and sheer along the length produces a real hull form.
 *
 * Coordinates: local -Z is the bow, and the waterline is at y = 0.
 */
function hullGeometry(cfg: BoatConfig): THREE.BufferGeometry {
  const N = 26; // stations from stern to bow
  const M = 7; // points per station (keel to deck)
  const halfB = cfg.beam / 2;
  const L = cfg.loa;
  const canoeDepth = 1.05; // canoe-body depth (the fin keel is added separately)

  // t: 0 = stern, 1 = bow
  const halfBeamAt = (t: number) =>
    halfB * Math.sqrt(Math.max(1 - Math.pow(t, 3.0), 0)) * (0.6 + 0.4 * Math.min(t / 0.22, 1));
  // Freeboard, the height above the waterline: 0.9-1.3 m on a 10 m yacht.
  // The sheer -- the deck line rising towards the bow -- is what stops it
  // looking like a box.
  const freeboardAt = (t: number) => 0.86 + 0.46 * t * t + 0.1 * (1 - t) * (1 - t);
  const depthAt = (t: number) => canoeDepth * (1 - 0.25 * t * t);

  const pos: number[] = [];
  const idx: number[] = [];

  const push = (x: number, y: number, z: number) => {
    pos.push(x, y, z);
    return pos.length / 3 - 1;
  };

  // Build each station as one row: port deck edge -> keel -> starboard deck edge
  const ring: number[][] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const z = L * 0.5 - t * L; // +Z (stern) -> -Z (bow)
    const hb = halfBeamAt(t);
    const deckRise = freeboardAt(t);
    const dep = depthAt(t); // depth below the waterline
    const row: number[] = [];
    for (let j = 0; j < M * 2 - 1; j++) {
      const k = j - (M - 1); // -(M-1) = port deck .. 0 = keel .. +(M-1) = starboard deck
      const a = (Math.abs(k) / (M - 1)) * (Math.PI / 2); // 0 = keel, pi/2 = deck
      const s = Math.sin(a);
      row.push(push(Math.sign(k) * hb * s, -dep + (dep + deckRise) * s * s, z));
    }
    ring.push(row);
  }

  // Hull sides
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < M * 2 - 2; j++) {
      const a = ring[i][j];
      const b = ring[i + 1][j];
      const c = ring[i + 1][j + 1];
      const d = ring[i][j + 1];
      idx.push(a, b, c, a, c, d);
    }
  }

  // Deck: join both deck edges to the centreline
  const centre: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    centre.push(push(0, freeboardAt(t) + 0.05, L * 0.5 - t * L));
  }
  for (let i = 0; i < N - 1; i++) {
    const pL = ring[i][0];
    const pL2 = ring[i + 1][0];
    const pR = ring[i][M * 2 - 2];
    const pR2 = ring[i + 1][M * 2 - 2];
    idx.push(pL, centre[i], centre[i + 1], pL, centre[i + 1], pL2);
    idx.push(centre[i], pR, pR2, centre[i], pR2, centre[i + 1]);
  }

  // Transom (closes off the stern).
  //
  // Winding matters here and is easy to get backwards, because this fan lies in
  // a single plane at the stern while every other face in the hull is lofted.
  // The stern ring runs port deck -> keel -> starboard deck, so taking its
  // points in that order with the centre last gives an outward (+Z, aft) normal.
  // Reversed, the transom is back-face culled and the hull is an open shell you
  // can see straight into from astern.
  const sternCentre = push(0, freeboardAt(0), L * 0.5);
  for (let j = 0; j < M * 2 - 2; j++) {
    idx.push(ring[0][j], ring[0][j + 1], sternCentre);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * How many horizontal panels a sail is built from.
 *
 * Nothing to do with the five strips the physics integrates; this number only
 * has to be enough for the twist to read as a curve rather than a fold.
 */
const SAIL_PANELS = 6;

interface Sail {
  geo: THREE.BufferGeometry;
  /** Height of the leech at each panel edge, and its offset aft of the luff. */
  leechY: number[];
  leechZ: number[];
  luffZ: number[];
}

/**
 * A triangular sail, built as a ladder of horizontal panels so that it can be
 * twisted.
 *
 * A single triangle cannot show twist at all: any three points are coplanar, so
 * swinging the head just tilts a flat sheet. The panels are what let the sail
 * be a surface with a shape in it.
 *
 * Arguments are (x, y) corners; -X (towards the clew) becomes aft (+Z), so
 * rotating the containing group about Y is exactly the sheet angle. The luff
 * runs tack to head and the leech clew to head, so the chord between them
 * closes to nothing at the masthead, which is where a triangular sail runs out
 * of cloth.
 *
 * The physics core only ever sees one equivalent sail, so this shape is purely
 * visual -- but the *twist* on it is not, and must be the angle the sail is
 * actually working at.
 */
function buildSail(
  tack: [number, number],
  head: [number, number],
  clew: [number, number],
): Sail {
  const zy = (p: [number, number]): [number, number] => [-p[0], p[1]];
  const [tz, ty] = zy(tack);
  const [hz, hy] = zy(head);
  const [cz, cy] = zy(clew);

  const pos: number[] = [];
  const index: number[] = [];
  const leechY: number[] = [];
  const leechZ: number[] = [];
  const luffZ: number[] = [];

  for (let i = 0; i <= SAIL_PANELS; i++) {
    const u = i / SAIL_PANELS;
    const lz = tz + (hz - tz) * u;
    const ly = ty + (hy - ty) * u;
    const rz = cz + (hz - cz) * u;
    const ry = cy + (hy - cy) * u;
    luffZ.push(lz);
    leechY.push(ry);
    leechZ.push(rz);
    pos.push(0, ly, lz, 0, ry, rz); // luff vertex, then leech vertex

    if (i > 0) {
      const a = (i - 1) * 2;
      index.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return { geo, leechY, leechZ, luffZ };
}

/**
 * Swing each panel's leech open by `twist` at the head, in proportion to its
 * height.
 *
 * Every panel rotates about the luff point at its *own* height, not about a
 * single vertical axis. For the mainsail the two are the same thing, since the
 * luff is the mast. For the jib they are not: its luff is the forestay, raked
 * aft, and rotating that about a vertical line through the stemhead would carry
 * the head of the sail away from the masthead it is hoisted to.
 */
function twistSail(sail: Sail, twist: number): void {
  const pos = sail.geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i <= SAIL_PANELS; i++) {
    const phi = twist * (i / SAIL_PANELS);
    const chord = sail.leechZ[i] - sail.luffZ[i];
    pos.setXYZ(i * 2 + 1, chord * Math.sin(phi), sail.leechY[i], sail.luffZ[i] + chord * Math.cos(phi));
  }
  pos.needsUpdate = true;
  sail.geo.computeVertexNormals();
}

export function createScene(canvas: HTMLCanvasElement, cfg: BoatConfig): SceneView {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  // Fog colour tracks the sky, so the horizon always dissolves into it.
  scene.fog = new THREE.Fog(0x1b2a3a, 260, 560);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 4000);

  // All three lights are driven by the time of day every frame.
  const hemi = new THREE.HemisphereLight(0xcfe2f5, 0x223141, 2.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fc4e8, 0.9);
  fill.position.set(70, 40, -60);
  scene.add(fill);

  const skyDome = createSkyDome();
  scene.add(skyDome.mesh);

  // --- Water --------------------------------------------------------------
  // Wave shape on the GPU, floating height on the CPU, from the same formula.
  const water = createWater();
  scene.add(water.far);
  scene.add(water.mesh);

  const islandView = createIslandView();
  scene.add(islandView.group);

  const rain = createRain();
  scene.add(rain.object);

  const courseView = createCourseView();
  scene.add(courseView.group);

  // --- Wind streaks -------------------------------------------------------
  // Colour and length come from the very same wind field the physics samples.
  // If the puff you can see and the puff you actually get were to disagree, the
  // player could not trust the display, and reading puffs -- the core of the
  // tactical game -- would stop working.
  const STREAKS = 900;
  const FIELD = 300; // m, square patch around the boat
  const streakPos = new Float32Array(STREAKS * 2 * 3);
  const streakCol = new Float32Array(STREAKS * 2 * 3);
  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
  streakGeo.setAttribute('color', new THREE.BufferAttribute(streakCol, 3));
  const streaks = new THREE.LineSegments(
    streakGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }),
  );
  streaks.frustumCulled = false;
  scene.add(streaks);

  // Seeds are world positions, not offsets from the boat.
  //
  // As offsets they travelled with the hull, so the most visible thing on the
  // water -- nine hundred bright lines -- sat perfectly still however fast you
  // were going, and the boat felt becalmed at six knots. In world coordinates
  // they stream past, which is the only close-range motion cue an empty ocean
  // has to offer.
  //
  // It is also the truthful arrangement: a puff is somewhere, and it stays
  // there while it drifts downwind, rather than being carried along by whoever
  // is looking at it.
  const seeds = new Float32Array(STREAKS * 2);
  // Scratch buffer reused STREAKS times per frame, to avoid 900 allocations.
  const windOut: [number, number] = [1, 0];
  for (let i = 0; i < STREAKS; i++) {
    seeds[i * 2] = (Math.random() - 0.5) * FIELD;
    seeds[i * 2 + 1] = (Math.random() - 0.5) * FIELD;
  }

  // --- Wake ---------------------------------------------------------------
  const WAKE_MAX = 900;
  const wakePos = new Float32Array(WAKE_MAX * 3);
  const wakeGeo = new THREE.BufferGeometry();
  wakeGeo.setAttribute('position', new THREE.BufferAttribute(wakePos, 3));
  wakeGeo.setDrawRange(0, 0);
  const wake = new THREE.Line(
    wakeGeo,
    new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.5 }),
  );
  wake.frustumCulled = false;
  scene.add(wake);
  let wakeCount = 0;
  let wakeTimer = 0;
  /** The session the trail belongs to. -1 so the first frame always clears. */
  let trailSession = -1;

  // --- Boat ---------------------------------------------------------------
  const boat = new THREE.Group(); // position and heading
  const heelGroup = new THREE.Group(); // heel and pitch
  boat.add(heelGroup);
  scene.add(boat);

  const hull = new THREE.Mesh(
    hullGeometry(cfg),
    new THREE.MeshStandardMaterial({ color: HULL, roughness: 0.6, metalness: 0.15 }),
  );
  heelGroup.add(hull);

  // Fin keel and bulb: the very thing the physics models as keelArea and
  // keelDepth. Seeing how it moves through the water as the boat heels matters.
  const keel = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, cfg.draft, cfg.loa * 0.26),
    new THREE.MeshStandardMaterial({ color: 0x5a646f, roughness: 0.6 }),
  );
  keel.position.set(0, -1.0 - cfg.draft / 2, 0.2);
  heelGroup.add(keel);

  const bulb = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, cfg.loa * 0.2, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x4a545f, roughness: 0.5 }),
  );
  bulb.rotation.x = Math.PI / 2;
  bulb.position.set(0, -1.0 - cfg.draft, 0.2);
  heelGroup.add(bulb);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.beam * 0.5, 0.62, cfg.loa * 0.3),
    new THREE.MeshStandardMaterial({ color: DECK, roughness: 0.7 }),
  );
  cabin.position.set(0, 1.28, -0.4);
  heelGroup.add(cabin);

  const DECK_Y = 1.02; // deck height at the mast, matching the hull freeboard

  // Length of stick above the deck. Derived from the physics' masthead height
  // rather than from a proportion of its own, so that the vane at the top of it
  // is drawn at the height whose wind it is being given.
  const mastHeight = cfg.mastHeight + cgHeight(cfg) - DECK_Y;

  // Navigation lights, the spreader flood and the cabin glow. They ride with
  // the hull, so they heel and pitch with her -- and so does the pool the
  // spreader throws, which is the point of hanging it up the mast.
  const boatLights = createBoatLights(cfg.loa, cfg.beam, DECK_Y, mastHeight);
  heelGroup.add(boatLights.group);
  const boomLen = cfg.loa * 0.42;
  const bowX = cfg.loa * 0.5;
  const forestay = bowX - cfg.mastX; // mast to stemhead = the jib's base

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.13, mastHeight, 8),
    new THREE.MeshStandardMaterial({ color: 0xd0d6dd, roughness: 0.4, metalness: 0.6 }),
  );
  mast.position.set(0, DECK_Y + mastHeight / 2, -cfg.mastX);
  heelGroup.add(mast);

  // Sails are thin surfaces that vanish into the background under lighting
  // alone, so a little emissive keeps them readable.
  const sailMat = new THREE.MeshStandardMaterial({
    color: SAIL,
    emissive: 0x30414f,
    roughness: 0.9,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95,
  });

  // Mainsail, rotating about the mast. The sheet angle goes straight in.
  const sailPivot = new THREE.Group();
  sailPivot.position.set(0, DECK_Y, -cfg.mastX);
  heelGroup.add(sailPivot);
  const main = buildSail([0, 0.9], [0, mastHeight * 0.94], [-boomLen, 1.25]);
  const mainSail = new THREE.Mesh(main.geo, sailMat);
  sailPivot.add(mainSail);

  const boom = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, boomLen, 6),
    new THREE.MeshStandardMaterial({ color: 0xc2c9d1, metalness: 0.5, roughness: 0.4 }),
  );
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, 0.9, boomLen / 2);
  sailPivot.add(boom);

  // Jib, rotating about the forestay. It opens less than the main.
  const jibPivot = new THREE.Group();
  jibPivot.position.set(0, DECK_Y, -bowX);
  heelGroup.add(jibPivot);
  const jib = buildSail([0, 0.35], [-forestay, mastHeight * 0.92], [-forestay * 1.75, 1.0]);
  const jibSail = new THREE.Mesh(jib.geo, sailMat);
  jibPivot.add(jibSail);

  // Masthead wind vane: shows where the apparent wind is coming from.
  const vane = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 1.4, 4),
    new THREE.MeshBasicMaterial({ color: ACCENT }),
  );
  vane.geometry.rotateX(-Math.PI / 2);
  vane.geometry.translate(0, 0, -0.9);
  const vanePivot = new THREE.Group();
  vanePivot.position.set(0, DECK_Y + mastHeight, -cfg.mastX);
  vanePivot.add(vane);
  heelGroup.add(vanePivot);

  const rudder = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 1.5, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x6f7a86, roughness: 0.6 }),
  );
  const rudderPivot = new THREE.Group();
  rudderPivot.position.set(0, -0.35, cfg.rudderArm);
  rudder.position.set(0, -0.5, 0.2);
  rudderPivot.add(rudder);
  heelGroup.add(rudderPivot);

  // --- Camera -------------------------------------------------------------
  let camMode = 0; // 0 = chase, 1 = top-down
  const camPos = new THREE.Vector3(0, 14, 30);
  const camTarget = new THREE.Vector3();
  // Scratch for the spreader lamp's world position, read every frame.
  const lampWorld = new THREE.Vector3();
  const orbit = createOrbit(canvas);

  function resize(): void {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  function render(f: FrameInput): void {
    const { state, diag, wind, waves, sky, dt } = f;

    // --- Sky, light and visibility ---
    // Weather thins the sun and thickens the air; time of day sets the colour.
    const overcast = 1 - f.weather.cloud * 0.72;
    sun.color.setRGB(sky.sunColor[0], sky.sunColor[1], sky.sunColor[2]);
    sun.intensity = sky.sunIntensity * overcast;
    sun.position.set(sky.sunDir[0] * 400, sky.sunDir[1] * 400 + 30, sky.sunDir[2] * 400);
    hemi.color.setRGB(sky.skyHorizon[0], sky.skyHorizon[1], sky.skyHorizon[2]);
    hemi.groundColor.setRGB(sky.waterDeep[0], sky.waterDeep[1], sky.waterDeep[2]);
    hemi.intensity = sky.ambientIntensity * (0.65 + f.weather.cloud * 0.35);
    fill.intensity = 0.25 + sky.daylight * 0.55;

    const fogColor = new THREE.Color(sky.fogColor[0], sky.fogColor[1], sky.fogColor[2]);
    scene.background = fogColor;
    (scene.fog as THREE.Fog).color.copy(fogColor);
    (scene.fog as THREE.Fog).near = f.visibility * 0.35;
    (scene.fog as THREE.Fog).far = f.visibility;
    // The mean wind, not the gust: a cloud deck does not shift with a puff.
    skyDome.update(sky, f.weather.cloud, f.elapsedHours, wind.baseTwd);
    islandView.update(sky);

    courseView.update(f.course, f.race, waves);
    courseView.setGhost(f.ghost);

    const bx = state.pos.x;
    const bz = -state.pos.y;

    // The lamps and the pool they throw on the water come off one number, so
    // the sea cannot be lit by a boat that is showing no lights.
    const lamp = lampLevel(f.lightsOn, sky.daylight);
    water.update(
      waves,
      state.pos.x,
      state.pos.y,
      wind.baseTws,
      wind.baseTwd,
      sky,
      f.visibility,
    );

    // The boat floats on the waves; heave, pitch and heel all come from the
    // integrated physics state.
    boat.position.set(bx, state.heave, bz);
    boat.rotation.y = -state.heading;
    // Euler order 'XZY' means R = RX * RZ (yaw is already applied by the
    // parent), i.e. roll first, then pitch -- the standard yaw-pitch-roll order
    // for a vessel. Any other order twists the boat badly at large heel.
    //
    // Sign: the bow points along local -Z, and a positive rotation about X
    // lifts (0,0,-1) towards +Y, so "bow up = positive pitch" goes into
    // rotation.x unchanged.
    heelGroup.rotation.set(state.pitch, 0, -state.heel, 'XZY');

    // The boom always swings to leeward; a change of tack is a gybe.
    const tack = side(diag.awa);
    sailPivot.rotation.y = -tack * state.sheet;
    jibPivot.rotation.y = -tack * state.sheet * 0.6;

    // Twist opens the head further to leeward, so it carries on in the same
    // direction the sheet already swung the sail. Both sails get the same
    // angle: the physics integrates one equivalent sail and has one twist for
    // it, and drawing the jib standing flat beside a twisted main would be
    // saying something about the model that is not true.
    twistSail(main, -tack * state.twist);
    twistSail(jib, -tack * state.twist);
    rudderPivot.rotation.y = state.rudder;
    vanePivot.rotation.y = -diag.awaMast;

    // Make it visible that a luffing sail is not producing drive
    sailMat.opacity = 0.4 + 0.55 * diag.luffing;
    sailMat.color.setHex(diag.luffing > 0.9 ? SAIL : 0xa8b4c0);

    // Show reefing and furling. If the sails do not visibly shrink, the whole
    // mechanic is invisible.
    const rf = REEF_AREA_FACTOR[clamp(Math.round(state.reef), 0, REEF_AREA_FACTOR.length - 1)];
    // A reef folds down onto the boom, so the height goes first. X and Z scale
    // together because a twisted sail lies partly across both, and shrinking
    // only one of them would swing the sail as it was reefed.
    mainSail.scale.set(Math.sqrt(rf), rf, Math.sqrt(rf));
    const jf = Math.max(1 - state.jibFurl, 0.001);
    // Local Z is the chord and Y the height. Furling rolls the sail onto the
    // forestay, so the chord goes first.
    jibSail.scale.set(jf, 0.5 + 0.5 * jf, jf);
    jibSail.visible = state.jibFurl < 0.98;

    // Wind streaks drift downwind with the puff pattern and wrap around the
    // boat. Length and brightness track the local puff strength, direction
    // tracks the local shift, so both "a puff is coming" and "that side has
    // shifted" are visible at a glance.
    const meanDir = compassVec(wind.baseTwd); // towards where it blows from
    // The same advection rate the puff field itself uses, or the streaks would
    // slide across the puffs they are drawn to show.
    const drift = wind.baseTws * ADVECTION * dt;
    const wx = -meanDir.x * drift;
    const wy = -meanDir.y * drift;
    const baseLen = 1.2 + wind.baseTws * 0.55;
    const half = FIELD / 2;
    for (let i = 0; i < STREAKS; i++) {
      let sx = seeds[i * 2] + wx;
      let sy = seeds[i * 2 + 1] + wy;
      // Wrap into the patch centred on the boat. Rounded rather than stepped
      // once, so a restart -- which teleports the boat -- brings the whole
      // field along instead of leaving it to crawl back over half a minute.
      sx -= Math.round((sx - state.pos.x) / FIELD) * FIELD;
      sy -= Math.round((sy - state.pos.y) / FIELD) * FIELD;
      seeds[i * 2] = sx;
      seeds[i * 2 + 1] = sy;

      const px = sx;
      const py = sy;
      const pz = -sy;

      // Shrink to nothing towards the edge of the patch. Streaks now cross it
      // at sailing speed rather than drifting across it, so without this they
      // wink in and out at the boundary several times a second. Length rather
      // than brightness because these lines blend normally: fading the colour
      // would leave a dark streak on a pale sea, which is more visible than
      // the pop it was meant to hide.
      const edge = Math.max(Math.abs(px - bx), Math.abs(py - state.pos.y)) / half;
      const fade = clamp((1 - edge) * 4, 0, 1);

      wind.sampleInto(px, py, windOut);
      const gust = windOut[0];
      const len = baseLen * gust * gust * fade; // exaggerated for visual contrast
      // Lulls dark and short, puffs bright and long
      const b = clamp((gust - 0.72) * 1.9, 0.06, 1);

      // Local wind direction. Bigger shifts fan the streaks out.
      const dirX = Math.sin(wind.baseTwd + windOut[1]);
      const dirY = Math.cos(wind.baseTwd + windOut[1]);

      // Streaks sit on the wave surface; on a flat plane they cut through it.
      const wh = waves.heightAt(px, py) + 0.12;
      const o = i * 6;
      streakPos[o] = px;
      streakPos[o + 1] = wh;
      streakPos[o + 2] = pz;
      streakPos[o + 3] = px - dirX * len;
      streakPos[o + 4] = wh;
      streakPos[o + 5] = pz + dirY * len;

      streakCol[o] = 0.22 + b * 0.5;
      streakCol[o + 1] = 0.34 + b * 0.55;
      streakCol[o + 2] = 0.42 + b * 0.55;
      streakCol[o + 3] = streakCol[o];
      streakCol[o + 4] = streakCol[o + 1];
      streakCol[o + 5] = streakCol[o + 2];
    }
    streakGeo.attributes.position.needsUpdate = true;
    streakGeo.attributes.color.needsUpdate = true;

    // Starting a session teleports the boat back to the line, and the track is
    // in world coordinates, so without this the next point is joined to the
    // last one of the previous session and a straight line is drawn clean
    // across the chart. Snapshot.session exists for exactly this and had simply
    // never been plumbed through to the view.
    if (f.session !== trailSession) {
      trailSession = f.session;
      wakeCount = 0;
      wakeTimer = 0;
      wakeGeo.setDrawRange(0, 0);
    }

    // The wake follows the actual track, not the heading, which is what makes
    // leeway visible.
    wakeTimer += dt;
    if (wakeTimer > 0.12) {
      wakeTimer = 0;
      if (wakeCount === WAKE_MAX) {
        wakePos.copyWithin(0, 3);
        wakeCount--;
      }
      wakePos[wakeCount * 3] = bx;
      wakePos[wakeCount * 3 + 1] = state.heave + 0.08;
      wakePos[wakeCount * 3 + 2] = bz;
      wakeCount++;
      wakeGeo.setDrawRange(0, wakeCount);
      wakeGeo.attributes.position.needsUpdate = true;
    }

    // Camera
    // Restarting a race teleports the boat, and a smoothed camera then flies
    // across the ocean for several seconds showing nothing. Snap instead.
    const jumped = camTarget.distanceTo(new THREE.Vector3(bx, 3, bz)) > 150;

    if (camMode === 0) {
      // Spherical about the boat, so the mouse can swing the eye anywhere
      // around her. Azimuth is measured from dead astern and added to the
      // heading, which is what keeps a chosen view fixed relative to the boat
      // rather than to the compass.
      const dist = (26 + diag.speed * 2.2) * orbit.zoom;
      const az = state.heading + orbit.yaw;
      const horiz = Math.cos(orbit.pitch) * dist;
      // The camera only partly follows the heave; tracking it fully is nauseating.
      const want = new THREE.Vector3(
        bx - Math.sin(az) * horiz,
        3 + state.heave * 0.4 + Math.sin(orbit.pitch) * dist,
        bz + Math.cos(az) * horiz,
      );
      // Half a second of smoothing is right for following the boat and far too
      // slow for following a hand: dragged with it, the view visibly trails the
      // mouse. Tighten it while the mouse has hold of the camera.
      const follow = orbit.dragging ? 0.06 : 0.5;
      camPos.lerp(want, jumped ? 1 : 1 - Math.exp(-dt / follow));
      camTarget.lerp(
        new THREE.Vector3(bx, 3 + state.heave * 0.6, bz),
        jumped ? 1 : 1 - Math.exp(-dt / 0.25),
      );

      // At a low orbit angle in a seaway the eye ends up inside a crest, which
      // renders as a full-screen flash of blue. Ride over the local surface
      // instead. Sim y is north, three z is south, hence the negation.
      const minY = waves.heightAt(camPos.x, -camPos.z) + 2;
      if (camPos.y < minY) camPos.y = minY;
    } else {
      camPos.lerp(
        new THREE.Vector3(bx, 120 * orbit.zoom, bz + 0.01),
        jumped ? 1 : 1 - Math.exp(-dt / 0.3),
      );
      camTarget.lerp(new THREE.Vector3(bx, 0, bz), jumped ? 1 : 1 - Math.exp(-dt / 0.3));
    }
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
    skyDome.mesh.position.copy(camPos);
    rain.update(f.weather.rain, wind.baseTws, wind.baseTwd, camera, dt);

    // Which lamps the camera can see depends on where it is round the boat,
    // because the sidelights are sectored the way the real ones are.
    const camBearing = Math.atan2(camPos.x - bx, -(camPos.z - bz)) - state.heading;
    boatLights.update(lamp, camBearing);

    // Where the spreader flood actually hangs, taken off the scene graph rather
    // than recomputed: the shader and the renderer then cannot disagree about
    // where the light is. She heels, the lamp swings out to leeward, and the
    // pool goes with it -- which is most of what makes it read as a light
    // rather than as a decal stuck under the boat.
    boat.updateMatrixWorld(true);
    boatLights.spreader.getWorldPosition(lampWorld);
    water.setLamp(lampWorld.x, -lampWorld.z, lamp, Math.max(lampWorld.y, 1));

    renderer.render(scene, camera);
  }

  return {
    render,
    resize,
    toggleCamera() {
      camMode = (camMode + 1) % 2;
    },
    setTerrain(physics, visible) {
      islandView.setTerrain(visible);
      water.setTerrain(physics);
    },
    dispose() {
      boatLights.dispose();
      orbit.dispose();
      water.dispose();
      islandView.dispose();
      rain.dispose();
      skyDome.dispose();
      renderer.dispose();
    },
  };
}
