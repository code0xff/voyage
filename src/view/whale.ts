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
  normaliseToUnitLength,
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
  for (let i = 0; i < 18; i++) points.push([(next() - 0.5) * 0.42, next(), (next() - 0.5) * 0.28]);
  return points;
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
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const foam = new THREE.Mesh(new THREE.RingGeometry(size * 0.16, size * 0.34, 32), foamMaterial);
  foam.rotation.x = -Math.PI / 2;
  foam.position.y = 0.04;
  root.add(foam);

  const blowGeometry = new THREE.BufferGeometry();
  blowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(18 * 3), 3));
  const blowMaterial = new THREE.PointsMaterial({
    color: 0xd4e3e2,
    size: 0.16,
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
        }

        // Keep authored swimming motion on simulation time even while culled;
        // otherwise crossing the visibility boundary resumes a stale pose.
        whale.mixer?.update(dt);

        const distance = Math.hypot(sighting.pos.x - boat.x, sighting.pos.y - boat.y);
        whale.root.visible = distance < visibility * CULL_MARGIN;
        if (!whale.root.visible) continue;

        const surface = water.surfaceHeight(sighting.pos.x, sighting.pos.y, waves);
        const phase = sighting.phase;
        const t = sighting.phaseT;
        const wave = Math.sin(clock * 1.7 + sighting.seed * 0.00001);
        const rise = phase === 'surfacing' ? whale.size * 0.08 * (smooth(t) - 1) : 0;
        const dive = phase === 'diving' ? smooth(t) : 0;

        whale.root.position.set(sighting.pos.x, surface, -sighting.pos.y);
        whale.root.rotation.set(0, -sighting.heading, 0);
        whale.bodyGroup.position.y = rise - dive * whale.size * 0.18;
        whale.bodyGroup.rotation.set(-dive * 0.35, wave * 0.012, wave * 0.025);

        const blow = phaseAmount(phase, t);
        whale.blowMaterial.opacity = blow * (0.45 + sky.daylight * 0.45);
        const points = whale.blowGeometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < whale.blowSeeds.length; i++) {
          const [x, h, z] = whale.blowSeeds[i];
          const lift = h * (0.35 + blow * 1.15);
          points.setXYZ(
            i,
            x * whale.size * 0.18 + Math.sin(clock * 2 + i) * 0.025 * blow,
            lift,
            z * whale.size * 0.12,
          );
        }
        points.needsUpdate = true;

        const foam = phase === 'surfacing' ? smooth(t) : phase === 'diving' ? 1 - smooth(t) : 0.22;
        whale.foamMaterial.opacity = foam * (0.18 + sky.daylight * 0.34);
        const foamScale = 0.65 + foam * 0.75;
        whale.foam.scale.set(foamScale, foamScale, foamScale);
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
    },
  };
}
