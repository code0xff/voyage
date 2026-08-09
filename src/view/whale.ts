import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { Vec2 } from '../sim/math';
import { rng } from '../sim/rng';
import type { WaveField } from '../sim/waves';
import type { SkyState } from '../sim/sky';
import type { WhalePhase, WhaleSighting } from '../sim/whales';
import {
  CULL_MARGIN,
  creatureLoader,
  disposeGltfScene,
  layOnWater,
  normaliseToUnitLength,
  waveTilt,
} from './creature';
import type { Water } from './water';

const WHALE_ASSET_URL = '/assets/whale/humpback-whale.glb';

/**
 * Where the model's own waterline sits, as a fraction of its height from the
 * belly up. High, so the back breaks the surface and the belly stays hidden
 * rather than the whole animal appearing to float on the water like a hull.
 */
const WATERLINE = 0.86;

/**
 * This model is authored head-towards-+Z, so it has to be turned end for end.
 *
 * Read off the mesh, because the bounding box cannot tell you and the eye is
 * not much better at 300 m in haze: slicing the body along its long axis, the
 * -Z end is a blade 2.50 m across and 0.11 m thick -- flukes, and nothing else
 * on a whale is that shape -- while the widest section by far, 4.93 m, sits at
 * +1.3 to +2.1, which is the pectoral flippers. A humpback's flippers are about
 * a third of the way back from the snout, and those are 30% of the length from
 * the +Z end. The head is at +Z.
 *
 * Without this the whale travelled flukes-first and blew from its tail. Both
 * followed from one assumption, and the spout position below was always written
 * for the model as it is now: -Z is the head.
 */
const HEAD_TOWARDS_POSITIVE_Z = true;

/**
 * How a whale is actually spotted, and what these three numbers are for.
 *
 * Not by its back. An encounter opens at 220-560 m and an adult shows about
 * 0.57 m of itself above an opaque surface, which is three and a half pixels
 * at the near end of that and under two at the far: dark on dark, at any
 * distance it is ever seen from. What a lookout sees first is the blow, and
 * after that the footprint -- the flat pale patch a surfacing animal leaves,
 * which lies flat on the water and therefore shows its whole area to someone
 * looking across at it.
 *
 * So the blow and the foam do the work of being seen, and the body is what
 * rewards looking. That is the right way round for the thing being depicted as
 * well as the one that reads.
 */

/**
 * Extra height while blowing and rolling, as a fraction of body length.
 *
 * Deliberately small. A whale lying at the surface shows its back and dorsal
 * and no more, and the alternative -- lowering WATERLINE so more of the model
 * clears the water at all times -- puts the flanks permanently on show and
 * turns the animal into a hull. This lifts roughly 0.45 m on a 15 m whale,
 * taking the exposed back from about 0.57 m to 1.0 m, and only while it is up.
 */
const SURFACED_LIFT = 0.03;

/**
 * Body beam as a fraction of length, for the slope samples only.
 *
 * Off the model's own proportions less the flippers, which reach far wider
 * than the body and would have it reading the sea at arm's length. Nothing but
 * the athwartships arctangent depends on it, and only weakly.
 */
const BEAM = 0.25;

/**
 * The footprint's radius, as a fraction of body length, and how far its rings
 * are subdivided. It has to be tessellated because it is laid on the wave
 * surface vertex by vertex rather than floated flat above it -- see
 * `layFootprint`.
 */
const FOAM_RADIUS = 0.42;
const FOAM_RINGS = 3;
const FOAM_SEGMENTS = 28;
/** Clear of the water by enough not to z-fight the surface it is lying on. */
const FOAM_LIFT = 0.06;

/** Droplets in the spout. Eighteen was a wisp; this is a column. */
const BLOW_POINTS = 44;

/**
 * Height of the spout, m, and its droplet size.
 *
 * A humpback blows about three metres, near enough regardless of how big the
 * individual is, so this is in metres rather than body lengths. A 3.2 m
 * column stands about 19 px at 220 m and still 8 px at 560 m, which makes it
 * the one part of the encounter that survives the range -- the old 1.5 m of
 * 0.16 m droplets was under a pixel per droplet and did not.
 *
 * Being noticed is all it has to do. Turning what was noticed into an animal
 * is the binoculars' job; see BINOCULAR_POWER in scene.ts.
 */
const BLOW_HEIGHT = 3.2;
const BLOW_DROPLET = 0.55;

interface WhaleAsset {
  model: THREE.Group;
  animations: readonly THREE.AnimationClip[];
}

interface WhaleInstance {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  model: THREE.Object3D;
  foam: THREE.Mesh;
  foamMaterial: THREE.MeshBasicMaterial;
  blow: THREE.Points;
  blowGeometry: THREE.BufferGeometry;
  blowMaterial: THREE.PointsMaterial;
  blowSeeds: readonly [number, number, number][];
  mixer: THREE.AnimationMixer | null;
  size: number;
}

function loadWhaleAsset(onLoad: (asset: WhaleAsset) => void, onError: () => void): void {
  creatureLoader().load(
    WHALE_ASSET_URL,
    (gltf) => onLoad({ model: gltf.scene, animations: gltf.animations }),
    undefined,
    onError,
  );
}

/**
 * A soft radial falloff for the footprint.
 *
 * The patch used to be a RingGeometry -- an annulus with a hard inner and
 * outer edge, in one flat colour. At any size worth seeing that reads as a
 * translucent circle drawn on the sea, which is the exact failure `wildlife.ts`
 * records for the hand-modelled animals: geometry, not life. A gradient has no
 * edge to recognise.
 *
 * Built once and shared. It is 64 pixels because it is pure falloff and any
 * more would be storing the same curve at greater expense.
 */
let footprintTexture: THREE.Texture | null = null;

function getFootprintTexture(): THREE.Texture {
  if (footprintTexture) return footprintTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // Brightest a little off centre: the slick a whale leaves is a ring of
    // smoothed water around the disturbance, not a spot of paint at the middle.
    gradient.addColorStop(0, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.85)');
    gradient.addColorStop(0.7, 'rgba(255,255,255,0.28)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  footprintTexture = new THREE.CanvasTexture(canvas);
  return footprintTexture;
}

/**
 * The scatter of the spout, fixed per whale.
 *
 * Off the simulation's seed rather than off Math.random, for the same reason
 * everything else here is: the same world has to look the same way twice, and
 * a spout that reshuffles on every replay would be the one thing in the scene
 * that does not.
 */
function seededBlowPoints(seed: number): readonly [number, number, number][] {
  const next = rng(seed);
  const points: [number, number, number][] = [];
  for (let i = 0; i < BLOW_POINTS; i++) {
    // Narrow in plan and tall in elevation: a column, not a cloud. The taper
    // comes from `next()` being cubed below, which crowds the droplets low and
    // lets a few carry to the top the way a real spout thins out.
    points.push([(next() - 0.5) * 0.42, next(), (next() - 0.5) * 0.28]);
  }
  return points;
}

/**
 * Put every vertex of the footprint on the water it is supposed to be lying on.
 *
 * The mesh is in the XY plane and turned flat, so after the rotation its local
 * +Z is world up and its local +Y is world -Z, which is sim north. That makes
 * the sim coordinate of a vertex (pos.x + lx, pos.y + ly) and its height the
 * local z -- which is what gets written here, straight from the same
 * `surfaceHeight` the whale and the water shader both use, so a mark on the
 * water cannot be on water the shader is not drawing.
 */
function layFootprint(whale: WhaleInstance, pos: Vec2, water: Water, waves: WaveField): void {
  whale.foam.position.set(pos.x, 0, -pos.y);
  const attr = whale.foam.geometry.attributes.position as THREE.BufferAttribute;
  const scale = whale.foam.scale.x;
  for (let i = 0; i < attr.count; i++) {
    const lx = attr.getX(i) * scale;
    const ly = attr.getY(i) * scale;
    attr.setZ(i, water.surfaceHeight(pos.x + lx, pos.y + ly, waves) + FOAM_LIFT);
  }
  attr.needsUpdate = true;
}

function makeInstance(size: number, seed: number, asset: WhaleAsset): WhaleInstance {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  // A normal Object3D clone leaves SkinnedMesh bones pointing at the template.
  // SkeletonUtils remaps them to each sighting's own animated skeleton.
  const model = cloneSkeleton(asset.model);
  // Preserve the template's 1/source-length normalization. Replacing it with
  // `size` turns the source's 22.8-unit body into a 300+ metre animal.
  model.scale.multiplyScalar(size);
  // The template's origin correction is normalized to one body length. Object
  // position is not affected by its own scale, so scale the correction too or
  // the mesh rises several metres above the water when the whale is enlarged.
  model.position.multiplyScalar(size);
  bodyGroup.add(model);
  root.add(bodyGroup);

  const mixer = asset.animations.length > 0 ? new THREE.AnimationMixer(model) : null;
  if (mixer) mixer.clipAction(asset.animations[0]).play();

  const foamMaterial = new THREE.MeshBasicMaterial({
    color: 0xc5d9dc,
    map: getFootprintTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  // Tessellated, because every vertex is put on the wave surface each frame.
  // A single flat quad -- which is what the old ring was -- cuts through the
  // swell it is supposed to be lying on, and the crescent that stays above
  // water slides round the patch as the waves pass under it. That is the
  // "circle that keeps turning": not an animation, an intersection.
  const foam = new THREE.Mesh(
    new THREE.RingGeometry(size * 0.02, size * FOAM_RADIUS, FOAM_SEGMENTS, FOAM_RINGS),
    foamMaterial,
  );
  // Laid in the world rather than on the whale: it is a mark left on the water,
  // so it must not swing when the animal turns under it.
  foam.rotation.x = -Math.PI / 2;
  foam.frustumCulled = false;

  const blowGeometry = new THREE.BufferGeometry();
  blowGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(new Float32Array(BLOW_POINTS * 3), 3),
  );
  const blowMaterial = new THREE.PointsMaterial({
    color: 0xd4e3e2,
    size: BLOW_DROPLET,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const blow = new THREE.Points(blowGeometry, blowMaterial);
  // The authored skeleton extends from a negative-Z head towards the tail.
  // Keep the spout on the body group so it follows the whale into a dive.
  blow.position.set(0, size * 0.07, -size * 0.38);
  bodyGroup.add(blow);

  return {
    root,
    bodyGroup,
    model,
    foam,
    foamMaterial,
    blow,
    blowGeometry,
    blowMaterial,
    blowSeeds: seededBlowPoints(seed),
    mixer,
    size,
  };
}

function smooth(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function phaseAmount(phase: WhalePhase, t: number): number {
  return phase === 'blow' ? Math.sin(Math.PI * t) : phase === 'surfacing' ? smooth(t) : 0;
}

function disposeInstance(group: THREE.Group, whale: WhaleInstance): void {
  group.remove(whale.root);
  group.remove(whale.foam);
  whale.mixer?.stopAllAction();
  whale.mixer?.uncacheRoot(whale.model);
  // SkeletonUtils creates an independent skeleton (and, after rendering, an
  // independent bone texture) for every encounter. Geometry and materials are
  // shared with the template, but these per-instance GPU resources are not.
  whale.model.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
  });
  whale.blowGeometry.dispose();
  whale.foam.geometry.dispose();
  whale.foamMaterial.dispose();
  whale.blowMaterial.dispose();
}

export interface WhaleView {
  group: THREE.Group;
  update(
    sightings: readonly WhaleSighting[],
    boat: Vec2,
    water: Water,
    waves: WaveField,
    session: number,
    sky: SkyState,
    visibility: number,
    dt: number,
  ): void;
  dispose(): void;
}

export function createWhaleView(): WhaleView {
  const group = new THREE.Group();
  const instances = new Map<number, WhaleInstance>();
  let clock = 0;
  let lastSession = -1;
  let asset: WhaleAsset | null = null;
  let requested = false;
  let disposed = false;

  /**
   * Fetched on the first sighting rather than when the scene is built.
   *
   * Encounters are uncommon by design and the first one is eight to sixteen
   * seconds away at the earliest, so paying 800 kB of the initial load for an
   * animal that may not appear for minutes -- and, for the shark, may not
   * appear at all -- is the whole cost of the feature charged to every player
   * before the boat has moved. The encounter lasts half a minute; the fetch
   * does not.
   */
  function requestAsset(): void {
    if (asset || requested || disposed) return;
    requested = true;
    loadWhaleAsset(
      (loaded) => {
        if (disposed) {
          disposeGltfScene(loaded.model);
          return;
        }
        asset = {
          model: normaliseToUnitLength(loaded.model, WATERLINE, HEAD_TOWARDS_POSITIVE_Z),
          animations: loaded.animations,
        };
      },
      () => {
        // The encounter remains in the simulation if an optional visual asset
        // fails to load; there is no placeholder mesh to confuse the player.
      },
    );
  }

  return {
    group,
    update(sightings, boat, water, waves, session, sky, visibility, dt) {
      clock += dt;
      if (session !== lastSession) {
        for (const whale of instances.values()) disposeInstance(group, whale);
        instances.clear();
        lastSession = session;
      }

      // An encounter id never comes back, so discard its mesh as soon as the
      // sim removes it. Hiding an ever-growing map would leak a geometry per
      // sighting during a long passage.
      for (const [id, whale] of instances) {
        let present = false;
        for (const sighting of sightings) {
          if (sighting.id === id) {
            present = true;
            break;
          }
        }
        if (!present) {
          disposeInstance(group, whale);
          instances.delete(id);
        } else {
          whale.root.visible = false;
        }
      }

      if (sightings.length > 0) requestAsset();
      if (!asset) return;

      for (const sighting of sightings) {
        let whale = instances.get(sighting.id);
        if (!whale) {
          whale = makeInstance(sighting.size, sighting.seed, asset);
          instances.set(sighting.id, whale);
          group.add(whale.root);
          // In the world, not on the animal -- see makeInstance.
          group.add(whale.foam);
        }

        // Keep authored swimming motion on simulation time even while culled;
        // otherwise crossing the visibility boundary resumes a stale pose.
        whale.mixer?.update(dt);

        const distance = Math.hypot(sighting.pos.x - boat.x, sighting.pos.y - boat.y);
        whale.root.visible = distance < visibility * CULL_MARGIN;
        // The footprint is a sibling now, so it has to be culled alongside.
        if (!whale.root.visible) {
          whale.foam.visible = false;
          continue;
        }

        const surface = water.surfaceHeight(sighting.pos.x, sighting.pos.y, waves);
        const phase = sighting.phase;
        const t = sighting.phaseT;
        const wave = Math.sin(clock * 1.7 + sighting.seed * 0.00001);
        const rise = phase === 'surfacing' ? whale.size * 0.08 * (smooth(t) - 1) : 0;
        const dive = phase === 'diving' ? smooth(t) : 0;
        // Up while it is up. Fades in over the surfacing, holds through the
        // blow and the roll, and is already gone by the time the dive starts
        // taking the whole body down.
        const lift =
          whale.size *
          SURFACED_LIFT *
          (phase === 'surfacing' ? smooth(t) : phase === 'diving' ? 1 - smooth(t) : 1);

        whale.root.position.set(sighting.pos.x, surface, -sighting.pos.y);
        // Lying along the sea rather than flat on it. An eighteen-metre animal
        // spans a fair part of a wave, and one held level while the water under
        // it tilts is the sort of thing that reads as a prop rather than as
        // something floating. The dive and the idle sway below compose on top,
        // because those are movements of the body and this is the water.
        layOnWater(
          whale.root,
          sighting.heading,
          waveTilt(water, waves, sighting.pos, sighting.heading, whale.size, whale.size * BEAM),
        );
        whale.bodyGroup.position.y = rise + lift - dive * whale.size * 0.18;
        whale.bodyGroup.rotation.set(-dive * 0.35, wave * 0.012, wave * 0.025);

        const blow = phaseAmount(phase, t);
        whale.blowMaterial.opacity = blow * (0.6 + sky.daylight * 0.4);
        const points = whale.blowGeometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < whale.blowSeeds.length; i++) {
          const [x, h, z] = whale.blowSeeds[i];
          // Cubed, so the droplets bunch near the blowhole and thin towards the
          // top. A uniform column reads as a bar of paint rather than as spray.
          const height = BLOW_HEIGHT * h * h * h * (0.25 + blow * 0.75);
          // Spread widens with height: a spout leaves narrow and opens out.
          const spread = 0.35 + (height / BLOW_HEIGHT) * 1.6;
          points.setXYZ(
            i,
            x * whale.size * 0.18 * spread + Math.sin(clock * 2 + i) * 0.05 * blow,
            height,
            z * whale.size * 0.12 * spread,
          );
        }
        points.needsUpdate = true;

        // The footprint: the flat pale patch a surfacing whale leaves. Held at
        // a real strength through the blow and the roll rather than at the
        // 0.22 it used to sit at, because at these ranges it is doing more of
        // the work of being seen than the animal is.
        // The footprint. Its strength is a slick, not a paint mark: the texture
        // carries the falloff and this only says how much of it there is.
        const foam = phase === 'surfacing' ? smooth(t) : phase === 'diving' ? 1 - smooth(t) : 0.55;
        whale.foamMaterial.opacity = foam * (0.18 + sky.daylight * 0.28);
        const foamScale = 0.75 + foam * 0.5;
        // Z is left alone: the heights written by layFootprint are already in
        // world metres, and scaling them would lift the patch off the sea.
        whale.foam.scale.set(foamScale, foamScale, 1);
        whale.foam.visible = whale.foamMaterial.opacity > 0.004;
        if (whale.foam.visible) layFootprint(whale, sighting.pos, water, waves);
      }
    },
    dispose() {
      disposed = true;
      for (const whale of instances.values()) disposeInstance(group, whale);
      instances.clear();
      if (asset) {
        disposeGltfScene(asset.model);
        asset = null;
      }
      // Module-level and shared by every instance, so no instance can own it.
      // Each material only references it; disposing a material leaves it
      // resident, and a scene rebuilt after this would make a second one.
      footprintTexture?.dispose();
      footprintTexture = null;
    },
  };
}
