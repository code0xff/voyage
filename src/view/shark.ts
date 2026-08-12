import * as THREE from 'three';
import { assetUrl } from '../asset';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { smoothstep, type Vec2 } from '../sim/math';
import type { SharkSighting } from '../sim/sharks';
import type { WaveField } from '../sim/waves';
import {
  CULL_MARGIN,
  creatureLoader,
  disposeGltfScene,
  layOnWater,
  normaliseToUnitLength,
  waveTilt,
} from './creature';
import type { Water } from './water';

const SHARK_ASSET_URL = assetUrl('/assets/shark/shark.glb');

/**
 * Where the model's own waterline sits, as a fraction of its height from the
 * belly up. Higher than the whale's 0.86 would put the flanks on show; this
 * leaves the back awash and the dorsal fin clear.
 */
const WATERLINE = 0.62;

/**
 * A further sink, as a fraction of body length.
 *
 * The water is opaque from above, so anything under it is simply gone, and the
 * two failures either side of this number are both worse than it: at a
 * realistic cruising depth the sighting is an empty patch of sea, and sitting
 * on the surface the animal reads as a boat. This is the setting where the back
 * is lost and the fin is not, which is the entire silhouette the encounter is
 * for. It is a visual choice and nothing in the simulation depends on it.
 */
const SINK = 0.025;

/** How far the body descends while sounding, as a fraction of its length. */
const DIVE_DEPTH = 0.18;

/**
 * Root height for a shark at the surface or sounding below it.
 *
 * Exported for `shark.test.ts`, which is what lets the descent be asserted
 * rather than looked at.
 */
export function sharkSurfaceY(surface: number, size: number, diveT: number): number {
  return surface - size * SINK - size * DIVE_DEPTH * smoothstep(0, 1, diveT);
}

/** Body beam as a fraction of length, for the slope samples. Sharks are slim. */
const BEAM = 0.18;

/**
 * This one is authored the right way round, unlike the whale, so nothing has to
 * be turned. Read off the mesh the same way: the +Z end is a blade 5.9 units
 * wide and 56.3 tall, which is a shark's vertical caudal fin, and over half the
 * vertices in the model sit in a compact section at the -Z end, which is where
 * a head with jaws and teeth in it would be.
 */
const HEAD_TOWARDS_POSITIVE_Z = false;

interface SharkAsset {
  model: THREE.Group;
  animations: readonly THREE.AnimationClip[];
}

interface SharkInstance {
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
}

export interface SharkView {
  group: THREE.Group;
  update(
    sightings: readonly SharkSighting[],
    boat: Vec2,
    water: Water,
    waves: WaveField,
    session: number,
    visibility: number,
    dt: number,
  ): void;
  dispose(): void;
}

export function createSharkView(): SharkView {
  const group = new THREE.Group();
  const instances = new Map<number, SharkInstance>();
  let asset: SharkAsset | null = null;
  let requested = false;
  let disposed = false;
  let lastSession = -1;

  /**
   * Fetched on the first sighting, not when the scene is built. This is the
   * largest asset in the project by some way, and a shark is the encounter a
   * player is least likely to be shown at all -- roughly one attempt in three
   * succeeds, and the attempts are a minute or more apart.
   */
  function requestAsset(): void {
    if (asset || requested || disposed) return;
    requested = true;
    creatureLoader().load(
      SHARK_ASSET_URL,
      (gltf) => {
        if (disposed) {
          disposeGltfScene(gltf.scene);
          return;
        }
        asset = {
          model: normaliseToUnitLength(gltf.scene, WATERLINE, HEAD_TOWARDS_POSITIVE_Z),
          animations: gltf.animations,
        };
      },
      undefined,
      () => {
        // The sighting stays in the simulation when the asset does not arrive.
        // There is no stand-in mesh: a box in the water is worse than nothing.
      },
    );
  }

  function makeInstance(sighting: SharkSighting, loaded: SharkAsset): SharkInstance {
    const root = new THREE.Group();
    // A plain clone would leave every SkinnedMesh bound to the template's
    // bones, so all sharks would share one pose. SkeletonUtils remaps them.
    const model = cloneSkeleton(loaded.model);
    // The template carries a 1/source-length normalisation, so this multiplies
    // rather than sets: assigning `size` would turn the source's own units into
    // metres and produce a shark the length of the bay. The origin correction
    // is normalised the same way and is not affected by the object's own scale,
    // so it has to be scaled with it or the body floats clear of the water.
    model.scale.multiplyScalar(sighting.size);
    model.position.multiplyScalar(sighting.size);
    root.add(model);

    const mixer = loaded.animations.length > 0 ? new THREE.AnimationMixer(model) : null;
    mixer?.clipAction(loaded.animations[0]).play();

    return { root, model, mixer };
  }

  function disposeInstance(id: number, instance: SharkInstance): void {
    group.remove(instance.root);
    instance.mixer?.stopAllAction();
    instance.mixer?.uncacheRoot(instance.model);
    // Geometry and materials belong to the template and are shared with every
    // clone, so they are not touched here. The skeleton -- and the bone texture
    // the renderer attaches to it -- is this instance's alone.
    instance.model.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
    });
    instances.delete(id);
  }

  return {
    group,
    update(sightings, boat, water, waves, session, visibility, dt) {
      if (session !== lastSession) {
        for (const [id, instance] of instances) disposeInstance(id, instance);
        lastSession = session;
      }

      // An encounter id is never reissued, so a mesh whose sighting has gone is
      // gone for good. Hiding it instead would leak a skeleton per encounter
      // over a long passage. The simulation shows one shark at a time, so this
      // is a scan of at most one id rather than a set built every frame.
      for (const [id, instance] of instances) {
        let present = false;
        for (const sighting of sightings) {
          if (sighting.id === id) {
            present = true;
            break;
          }
        }
        if (!present) disposeInstance(id, instance);
      }

      if (sightings.length > 0) requestAsset();
      if (!asset) return;

      for (const sighting of sightings) {
        let instance = instances.get(sighting.id);
        if (!instance) {
          instance = makeInstance(sighting, asset);
          instances.set(sighting.id, instance);
          group.add(instance.root);
        }

        // Kept on simulation time even while culled, so crossing back inside
        // visibility resumes the swim rather than a stale pose.
        instance.mixer?.update(dt);

        const distance = Math.hypot(sighting.pos.x - boat.x, sighting.pos.y - boat.y);
        instance.root.visible = distance < visibility * CULL_MARGIN;
        if (!instance.root.visible) continue;

        // The same surface the water shader draws, so the fin cuts the wave it
        // is actually on rather than one the CPU imagined.
        const surface = water.surfaceHeight(sighting.pos.x, sighting.pos.y, waves);
        // sim (x=east, y=north) -> three (x=east, y=up, z=south)
        instance.root.position.set(
          sighting.pos.x,
          sharkSurfaceY(surface, sighting.size, sighting.diveT),
          -sighting.pos.y,
        );
        // Along the sea, not flat on it, and by the same rule the whale and the
        // boat use. The fin is the whole of what shows, so a fin standing plumb
        // upright out of a sloping wave is exactly the tell to avoid.
        layOnWater(
          instance.root,
          sighting.heading,
          waveTilt(water, waves, sighting.pos, sighting.heading, sighting.size, sighting.size * BEAM),
        );
      }
    },
    dispose() {
      disposed = true;
      for (const [id, instance] of instances) disposeInstance(id, instance);
      if (asset) {
        disposeGltfScene(asset.model);
        asset = null;
      }
    },
  };
}
