import * as THREE from 'three';
import type { BoatConfig } from '../sim/config';
import type { BoatState, Diagnostics } from '../sim/boat';
import { clamp, compassVec, side } from '../sim/math';
import { REEF_AREA_FACTOR } from '../sim/sailplan';
import type { WindField } from '../sim/wind';
import type { WaveField } from '../sim/waves';
import type { Course, RaceState } from '../sim/race';
import type { GhostSample } from '../sim/replay';
import type { Terrain } from '../sim/terrain';
import { createWater } from './water';
import { createCourseView } from './course';
import { createIslandView } from './islands';

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
  ghost: GhostSample | null;
  dt: number;
}

export interface SceneView {
  render(f: FrameInput): void;
  setTerrain(terrain: Terrain): void;
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

  // Transom (closes off the stern)
  const sternCentre = push(0, freeboardAt(0), L * 0.5);
  for (let j = 0; j < M * 2 - 2; j++) {
    idx.push(ring[0][j + 1], ring[0][j], sternCentre);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A triangular sail. Drawn in the local XY plane, then given a base rotation so
 * that -X (towards the clew) points aft (+Z). Rotating the containing group
 * about Y is then exactly the sheet angle.
 *
 * The physics core only ever sees one sail area, so this shape is purely visual.
 */
function sailGeometry(tack: [number, number], head: [number, number], clew: [number, number]) {
  // Do not close the path with a lineTo back to the start. The duplicate vertex
  // makes ShapeUtils.triangulateShape emit no triangles at all, and the sail
  // silently disappears.
  const shape = new THREE.Shape();
  shape.moveTo(tack[0], tack[1]);
  shape.lineTo(head[0], head[1]);
  shape.lineTo(clew[0], clew[1]);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateY(Math.PI / 2);
  return geo;
}

export function createScene(canvas: HTMLCanvasElement, cfg: BoatConfig): SceneView {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  // Fog and background must match for the horizon to dissolve naturally.
  const HORIZON = 0x1b2a3a;
  scene.background = new THREE.Color(HORIZON);
  scene.fog = new THREE.Fog(HORIZON, 260, 560);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 2000);

  scene.add(new THREE.HemisphereLight(0xcfe2f5, 0x223141, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(-60, 90, 40);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fc4e8, 0.9);
  fill.position.set(70, 40, -60);
  scene.add(fill);

  // --- Water --------------------------------------------------------------
  // Wave shape on the GPU, floating height on the CPU, from the same formula.
  const water = createWater(HORIZON, 260, 560);
  scene.add(water.mesh);

  const islandView = createIslandView();
  scene.add(islandView.group);

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

  // Streak seeds, relative to the boat. They drift with the wind and wrap around.
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
  const mastHeight = cfg.loa * 1.3;
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
  const mainSail = new THREE.Mesh(
    sailGeometry([0, 0.9], [0, mastHeight * 0.94], [-boomLen, 1.25]),
    sailMat,
  );
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
  const jibSail = new THREE.Mesh(
    sailGeometry([0, 0.35], [-forestay, mastHeight * 0.92], [-forestay * 1.75, 1.0]),
    sailMat,
  );
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

  function resize(): void {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  function render(f: FrameInput): void {
    const { state, diag, wind, waves, dt } = f;
    courseView.update(f.course, f.race, waves);
    courseView.setGhost(f.ghost);

    const bx = state.pos.x;
    const bz = -state.pos.y;

    water.update(waves, state.pos.x, state.pos.y, wind.baseTws, wind.baseTwd);

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
    rudderPivot.rotation.y = state.rudder;
    vanePivot.rotation.y = -diag.awa;

    // Make it visible that a luffing sail is not producing drive
    sailMat.opacity = 0.4 + 0.55 * diag.luffing;
    sailMat.color.setHex(diag.luffing > 0.9 ? SAIL : 0xa8b4c0);

    // Show reefing and furling. If the sails do not visibly shrink, the whole
    // mechanic is invisible.
    const rf = REEF_AREA_FACTOR[clamp(Math.round(state.reef), 0, REEF_AREA_FACTOR.length - 1)];
    // A reef folds down onto the boom, so the height goes first
    mainSail.scale.set(1, rf, Math.sqrt(rf));
    const jf = Math.max(1 - state.jibFurl, 0.001);
    // The geometry is rotateY(90)-ed, so local Z is the chord and Y the height.
    // Furling rolls the sail onto the forestay, so the chord goes first.
    jibSail.scale.set(1, 0.5 + 0.5 * jf, jf);
    jibSail.visible = state.jibFurl < 0.98;

    // Wind streaks drift with the true wind and wrap at the patch edge.
    // Length and brightness track the local puff strength, direction tracks the
    // local shift, so both "a puff is coming" and "that side has shifted" are
    // visible at a glance.
    const meanDir = compassVec(wind.baseTwd); // towards where it blows from
    const wx = -meanDir.x * wind.baseTws * dt;
    const wy = -meanDir.y * wind.baseTws * dt;
    const baseLen = 1.2 + wind.baseTws * 0.55;
    const half = FIELD / 2;
    for (let i = 0; i < STREAKS; i++) {
      let sx = seeds[i * 2] + wx;
      let sy = seeds[i * 2 + 1] + wy;
      if (sx > half) sx -= FIELD;
      else if (sx < -half) sx += FIELD;
      if (sy > half) sy -= FIELD;
      else if (sy < -half) sy += FIELD;
      seeds[i * 2] = sx;
      seeds[i * 2 + 1] = sy;

      const px = bx + sx;
      const py = state.pos.y + sy;
      const pz = bz - sy;

      wind.sampleInto(px, py, windOut);
      const gust = windOut[0];
      const len = baseLen * gust * gust; // exaggerated for visual contrast
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
      const back = 26 + diag.speed * 2.2;
      // The camera only partly follows the heave; tracking it fully is nauseating.
      const want = new THREE.Vector3(
        bx + Math.sin(state.heading) * -back,
        11 + diag.speed * 0.6 + state.heave * 0.4,
        bz + Math.cos(state.heading) * back,
      );
      camPos.lerp(want, jumped ? 1 : 1 - Math.exp(-dt / 0.5));
      camTarget.lerp(
        new THREE.Vector3(bx, 3 + state.heave * 0.6, bz),
        jumped ? 1 : 1 - Math.exp(-dt / 0.25),
      );
    } else {
      camPos.lerp(new THREE.Vector3(bx, 120, bz + 0.01), jumped ? 1 : 1 - Math.exp(-dt / 0.3));
      camTarget.lerp(new THREE.Vector3(bx, 0, bz), jumped ? 1 : 1 - Math.exp(-dt / 0.3));
    }
    camera.position.copy(camPos);
    camera.lookAt(camTarget);

    renderer.render(scene, camera);
  }

  return {
    render,
    resize,
    toggleCamera() {
      camMode = (camMode + 1) % 2;
    },
    setTerrain(terrain) {
      islandView.setTerrain(terrain);
      water.setTerrain(terrain);
    },
    dispose() {
      water.dispose();
      islandView.dispose();
      renderer.dispose();
    },
  };
}
