import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { Vec2 } from '../sim/math';
import type { GullFlockSighting } from '../sim/wildlife';
import { CULL_MARGIN, creatureLoader, disposeGltfScene } from './creature';

interface GullAsset { model: THREE.Group; animations: readonly THREE.AnimationClip[] }
interface GullInstance {
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
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
    instance.mixer?.stopAllAction();
    instance.mixer?.uncacheRoot(instance.model);
    instance.model.traverse((object) => { if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose(); });
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
          const model = cloneSkeleton(asset.model);
          const materials: THREE.Material[] = [];
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
          model.scale.multiplyScalar(flock.wingspan);
          model.position.multiplyScalar(flock.wingspan);
          root.add(model);
          const mixer = asset.animations.length > 0 ? new THREE.AnimationMixer(model) : null;
          if (mixer) {
            const action = mixer.clipAction(asset.animations[0]);
            // Two circuits keep the old, leisurely flight speed while leaving
            // enough time to watch. Stretching one circuit across the longer
            // sighting makes the wingbeats and turns look unnaturally slow.
            action.timeScale = asset.animations[0].duration / (flock.duration * 0.5);
            action.play();
          }
          instance = { root, model, mixer, materials };
          instances.set(flock.id, instance);
          group.add(root);
        }
        instance.mixer?.update(dt);
        const distance = Math.hypot(flock.pos.x - boat.x, flock.pos.y - boat.y);
        instance.root.visible = distance < visibility * CULL_MARGIN;
        if (!instance.root.visible) continue;
        for (const material of instance.materials) material.opacity = flock.opacity;
        instance.root.position.set(flock.pos.x, flock.altitude, -flock.pos.y);
      }
    },
    dispose() { disposed = true; for (const [id, instance] of instances) remove(id, instance); if (asset) disposeGltfScene(asset.model); asset = null; },
  };
}
