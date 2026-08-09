import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Vec2 } from '../sim/math';
import type { WaveField } from '../sim/waves';
import type { Water } from './water';

/**
 * What the two animal views share.
 *
 * A whale and a shark are the same rendering problem twice: an authored GLB in
 * whatever units and orientation its author used, which has to end up swimming
 * along the scene's forward axis, at a length the simulation chose, with the
 * right amount of it under an opaque water surface. Only the numbers differ,
 * and keeping them as arguments is what makes it obvious that they do.
 */

/**
 * How far past the fog to keep drawing, as a fraction of visibility.
 *
 * Distance is measured from the *boat*, because that is what a sighting is
 * placed relative to, while the fog is measured from the camera -- which sits
 * astern of it. For anything ahead that makes the cull conservative and costs
 * nothing. For a sighting passing astern the camera is the nearer of the two,
 * so culling exactly at visibility would remove it while a few per cent of it
 * still showed through the haze.
 */
export const CULL_MARGIN = 1.05;

/**
 * A loader that can read the assets as they are actually stored.
 *
 * Both are `EXT_meshopt_compression` and the whale is `EXT_texture_webp` on top
 * of it, which between them take the pair from 4.6 MB to 620 kB -- the shark
 * alone from 3.9 MB to 509 kB, and it is all geometry: sixty-five thousand
 * vertices for an animal that is a few hundred pixels wide at the range it is
 * ever seen from.
 *
 * Meshopt rather than Draco, which compresses this shark five times smaller
 * again. Draco's decoder is a 300 kB wasm blob that has to be copied into
 * `public/` and fetched at runtime, which gives most of the saving straight
 * back and adds a build step and a second thing that can 404. The meshopt
 * decoder is a 25 kB ES module that bundles with everything else.
 *
 * A loader per call, and one decoder for all of them. `MeshoptDecoder` is a
 * module singleton with no per-file state, so there is nothing to keep apart;
 * the loader itself is a few fields and is not worth caching.
 */
export function creatureLoader(): GLTFLoader {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}

/**
 * How the water lies under an animal: fore-and-aft slope and athwartships
 * slope, in radians.
 *
 * Four samples of the surface, exactly as `sampleHull` in sim/waves.ts takes
 * them for the boat -- bow, stern, starboard, port, at 0.42 of the length and
 * half the beam -- and the same two arctangents. Deliberately a copy of that
 * shape rather than a new idea, because this is a sign problem and the boat's
 * version is the one that has been looked at on the water for a long time.
 *
 * The samples come from `water.surfaceHeight`, which is the height the animal
 * is already sitting at, and not from `waves.heightAt` as the boat's do. That
 * matters: `surfaceHeight` carries the grid fade and the land shelter, so out
 * near the edge of the wave grid, or in the lee of an island, an animal lying
 * on flat water would otherwise tilt to a swell that is not being drawn.
 */
export function waveTilt(
  water: Water,
  waves: WaveField,
  pos: Vec2,
  heading: number,
  length: number,
  beam: number,
): { pitch: number; roll: number } {
  const fx = Math.sin(heading);
  const fy = Math.cos(heading);
  // Starboard is the heading turned ninety degrees clockwise, as in sampleHull.
  const sx = fy;
  const sy = -fx;

  const half = length * 0.42;
  const hb = beam * 0.5;

  const bow = water.surfaceHeight(pos.x + fx * half, pos.y + fy * half, waves);
  const stern = water.surfaceHeight(pos.x - fx * half, pos.y - fy * half, waves);
  const stb = water.surfaceHeight(pos.x + sx * hb, pos.y + sy * hb, waves);
  const port = water.surfaceHeight(pos.x - sx * hb, pos.y - sy * hb, waves);

  return {
    pitch: Math.atan2(bow - stern, half * 2),
    roll: Math.atan2(stb - port, hb * 2),
  };
}

/**
 * Lay a body along that slope, so that its deck plane is the water's.
 *
 * Euler order 'YXZ' is R = Ry * Rx * Rz, so roll is applied first, then pitch,
 * then heading -- the same order `heelGroup` uses in scene.ts, where the note
 * records that any other order twists the hull badly at large angles.
 *
 * The roll is *not* negated, and the asymmetry with pitch is the whole of what
 * was hard here. The body faces local -Z and its up is +Y, which puts starboard
 * on local +X; a positive rotation about Z raises +X. `roll` is positive when
 * the starboard sample is the higher one, and a body lying on water that is
 * higher to starboard has its starboard side raised. So the two agree, unlike
 * pitch, which needs no sign of its own.
 *
 * This was first written by copying the boat -- `rotation.z = -heel` with a
 * hull settling at `heel = rollSlope`, per the righting moment in sim/boat.ts
 * -- on the reasoning that the boat has floated correctly for a long time and
 * re-deriving conventions is how this project gets sign errors. That was the
 * wrong instinct twice over. Measured against the analytic normal of a plane,
 * it came out mirrored: exactly twice the slope angle, at every heading where
 * the slope is athwartships and none where it is fore-and-aft. And the reason
 * is that the boat is itself inconsistent here -- `heel > 0` is starboard-down,
 * so a hull lying passively on that slope settles at `-rollSlope`, not
 * `+rollSlope`. Copying a thing does not make it right; `creature.test.ts` now
 * asks the water instead.
 */
export function layOnWater(
  object: THREE.Object3D,
  heading: number,
  tilt: { pitch: number; roll: number },
): void {
  object.rotation.set(tilt.pitch, -heading, tilt.roll, 'YXZ');
}

/**
 * Rotate, scale and centre an authored model so it is one metre long, swims
 * towards -Z, and floats with `waterline` of its height below the origin.
 *
 * Length is normalised to one so that the simulation's sighting size stays the
 * only scale decision in the feature -- the view never accumulates a second,
 * unrelated set of tuning numbers for how big an animal looks.
 *
 * The long axis is found from the bounds, so neither exporter's idea of an axis
 * order is baked in. **Which end of that axis is the head cannot be**, and the
 * caller has to say: bounds are symmetric about the thing that matters, so a
 * model authored the wrong way round aligns perfectly and swims backwards. That
 * is not hypothetical -- see `headTowardsPositiveZ` below.
 *
 * @param waterline fraction of the model's height that sits below y = 0, from
 *   the bottom of the bounds. The water is opaque from above, so this is what
 *   decides how much of the animal exists as far as the player is concerned.
 * @param headTowardsPositiveZ true when the head ends up at +Z once the long
 *   axis is on Z, so that this can turn it end for end. Everything else in the
 *   scene travels towards its own local -Z -- see the boat's yaw in scene.ts --
 *   and an animal is no different.
 */
export function normaliseToUnitLength(
  model: THREE.Group,
  waterline: number,
  headTowardsPositiveZ: boolean,
): THREE.Group {
  let bounds = new THREE.Box3().setFromObject(model);
  let dimensions = bounds.getSize(new THREE.Vector3());
  if (dimensions.x > dimensions.z && dimensions.x > dimensions.y) {
    model.rotation.y = Math.PI / 2;
  } else if (dimensions.y > dimensions.z) {
    model.rotation.x = Math.PI / 2;
  }

  // About the *world* Y and not the model's own: after the alignment above the
  // long axis lies on world Z whichever branch ran, but the model's local Y may
  // by then be pointing along it, and turning about that would roll the animal
  // onto its side instead of turning it round.
  if (headTowardsPositiveZ) {
    model.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.PI);
  }

  // Re-measured after rotating: the bounds above are the ones that chose the
  // rotation, and reusing them would scale by the wrong axis.
  model.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(model);
  const centre = bounds.getCenter(new THREE.Vector3());
  dimensions = bounds.getSize(new THREE.Vector3());

  const scale = 1 / dimensions.z;
  model.scale.setScalar(scale);
  model.position.set(
    -centre.x * scale,
    -(bounds.min.y + dimensions.y * waterline) * scale,
    -centre.z * scale,
  );

  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      // Nothing casts a shadow onto water it is mostly inside of; receiving one
      // from the rig as the boat passes is the part that reads.
      object.castShadow = false;
      object.receiveShadow = true;
    }
  });
  return model;
}

/**
 * Release everything a loaded GLB owns.
 *
 * Textures are the reason this is not a two-line loop: an embedded 1K texture
 * set is most of what these files weigh, and dropping the material without
 * dropping its maps leaves the whole of it resident on the GPU.
 */
export function disposeGltfScene(model: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) {
      materials.add(material);
      for (const texture of [
        material.map,
        material.alphaMap,
        material.aoMap,
        material.bumpMap,
        material.displacementMap,
        material.emissiveMap,
        material.lightMap,
        material.metalnessMap,
        material.normalMap,
        material.roughnessMap,
      ]) {
        texture?.dispose();
      }
    }
  });

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}
