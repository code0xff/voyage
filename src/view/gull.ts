import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { Vec2 } from '../sim/math';
import type { GullFlockSighting } from '../sim/wildlife';
import { CULL_MARGIN, creatureLoader, disposeGltfScene } from './creature';

interface GullAsset { model: THREE.Group; animations: readonly THREE.AnimationClip[] }
/** One copy of the authored group: its own skeleton, its own place in the loop. */
interface GullGroup {
  pivot: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
}
interface GullInstance {
  root: THREE.Group;
  groups: GullGroup[];
  materials: THREE.Material[];
}

/** Preserve the authored flock spacing while making one bird's wingspan one metre. */
function prepare(model: THREE.Group): THREE.Group {
  model.updateMatrixWorld(true);
  let firstBird: THREE.SkinnedMesh | null = null;
  model.traverse((object) => { if (!firstBird && object instanceof THREE.SkinnedMesh) firstBird = object; });
  const birdBounds = new THREE.Box3().setFromObject(firstBird ?? model);
  const birdSize = birdBounds.getSize(new THREE.Vector3());
  const sourceSpan = Math.max(birdSize.x, birdSize.y, birdSize.z);
  const flockBounds = new THREE.Box3().setFromObject(model);
  const centre = flockBounds.getCenter(new THREE.Vector3());
  const scale = 1 / sourceSpan;
  model.scale.setScalar(scale);
  model.position.set(-centre.x * scale, -centre.y * scale, -centre.z * scale);
  model.traverse((object) => { if (object instanceof THREE.Mesh) { object.castShadow = false; object.receiveShadow = false; } });
  return model;
}

/**
 * Put one group of the authored flock where the simulation says it is.
 *
 * Separated out and exported because the two lines in it are a convention and
 * not a look, which is the one kind of renderer work this project asserts --
 * see `creature.test.ts`. Both signs have a rule behind them and both are easy
 * to write the other way round: the scene is right-handed with sim north at
 * -Z, and its yaw therefore runs opposite to a compass, exactly as
 * `layOnWater` negates a heading.
 *
 * The turn is on the pivot rather than the model so that it rotates the whole
 * circuit the birds fly, not the birds within it. Rotating the model alone
 * leaves every group drifting the same way and only their headings differ,
 * which is the appearance this was written to fix.
 */
export function placeGroup(
  pivot: THREE.Object3D,
  member: { offset: Vec2; altitude: number; yaw: number },
): void {
  pivot.position.set(member.offset.x, member.altitude, -member.offset.y);
  pivot.rotation.y = -member.yaw;
}

export interface GullView {
  group: THREE.Group;
  update(flocks: readonly GullFlockSighting[], boat: Vec2, session: number, visibility: number, dt: number): void;
  dispose(): void;
}

export function createGullView(): GullView {
  const group = new THREE.Group();
  const instances = new Map<number, GullInstance>();
  let asset: GullAsset | null = null;
  let requested = false;
  let disposed = false;
  let lastSession = -1;

  const requestAsset = () => {
    if (asset || requested || disposed) return;
    requested = true;
    creatureLoader().load(
      '/assets/gull/seagulls.glb',
      (gltf) => {
        if (disposed) disposeGltfScene(gltf.scene);
        else asset = { model: prepare(gltf.scene), animations: gltf.animations };
      },
      undefined,
      () => {
        // Not retried. `requested` stays set, because a flock is on screen for
        // fourteen to eighteen seconds and clearing the guard here would ask
        // for a missing file on every frame of it -- hundreds of requests for an
        // answer that is not going to change. The calls carry on without it,
        // which is what they were doing before there was anything to draw.
      },
    );
  };

  const remove = (id: number, instance: GullInstance) => {
    group.remove(instance.root);
    for (const member of instance.groups) {
      member.mixer?.stopAllAction();
      member.mixer?.uncacheRoot(member.model);
      member.model.traverse((object) => { if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose(); });
    }
    for (const material of instance.materials) material.dispose();
    instances.delete(id);
  };

  return {
    group,
    update(flocks, boat, session, visibility, dt) {
      if (flocks.length > 0) requestAsset();
      if (session !== lastSession) { for (const [id, instance] of instances) remove(id, instance); lastSession = session; }
      const present = new Set(flocks.map((flock) => flock.id));
      for (const [id, instance] of instances) if (!present.has(id)) remove(id, instance);
      if (!asset) return;

      for (const flock of flocks) {
        let instance = instances.get(flock.id);
        if (!instance) {
          const root = new THREE.Group();
          const materials: THREE.Material[] = [];
          const groups: GullGroup[] = [];
          const clip = asset.animations[0] as THREE.AnimationClip | undefined;

          for (const member of flock.members) {
            const pivot = new THREE.Group();
            const model = cloneSkeleton(asset.model);
            model.traverse((object) => {
              if (!(object instanceof THREE.Mesh)) return;
              const source = Array.isArray(object.material) ? object.material : [object.material];
              const cloned = source.map((material) => {
                const copy = material.clone();
                copy.transparent = true;
                copy.depthWrite = false;
                materials.push(copy);
                return copy;
              });
              object.material = Array.isArray(object.material) ? cloned : cloned[0];
            });
            model.scale.multiplyScalar(member.wingspan);
            model.position.multiplyScalar(member.wingspan);
            pivot.add(model);
            placeGroup(pivot, member);
            root.add(pivot);

            const mixer = clip ? new THREE.AnimationMixer(model) : null;
            if (mixer && clip) {
              const action = mixer.clipAction(clip);
              // Two circuits keep the old, leisurely flight speed while leaving
              // enough time to watch. Stretching one circuit across the longer
              // sighting makes the wingbeats and turns look unnaturally slow.
              action.timeScale = clip.duration / (flock.duration * 0.5);
              action.play();
              // Start each group somewhere else in the loop. Without this they
              // beat in step however they are turned, which is the tell that
              // there is one animation behind all of them.
              //
              // Set on the action, in clip time. `mixer.setTime` looks like the
              // call for this and is not: it advances the mixer, so the action
              // arrives at `phase * duration * timeScale`. The timeScale above
              // runs 0.37 to 0.48 across the sighting lengths, so a full spread
              // of phases would have come out as the first 1.2 to 1.6 seconds
              // of a 3.3 second loop.
              action.time = member.phase * clip.duration;
            }
            groups.push({ pivot, model, mixer });
          }

          instance = { root, groups, materials };
          instances.set(flock.id, instance);
          group.add(root);
        }
        for (const member of instance.groups) member.mixer?.update(dt);
        const distance = Math.hypot(flock.pos.x - boat.x, flock.pos.y - boat.y);
        instance.root.visible = distance < visibility * CULL_MARGIN;
        if (!instance.root.visible) continue;
        for (const material of instance.materials) material.opacity = flock.opacity;
        instance.root.position.set(flock.pos.x, 0, -flock.pos.y);
      }
    },
    dispose() { disposed = true; for (const [id, instance] of instances) remove(id, instance); if (asset) disposeGltfScene(asset.model); asset = null; },
  };
}
