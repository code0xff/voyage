import * as THREE from 'three';
import { sameIslands, type Island, type Terrain } from '../sim/terrain';
import type { SkyState } from '../sim/sky';

/**
 * Island meshes.
 *
 * Built by sampling the very same `elevationAt()` the physics grounds the boat
 * on, so the beach you can see is the beach you run onto. A separately authored
 * mesh would drift out of step with the depth field the first time either was
 * tweaked.
 *
 * Each island gets a polar grid centred on it: dense near the shoreline where
 * the interesting shape is, sparse inland where it is just a hill.
 *
 * The sea is endless, so this list is never final: islands arrive over the
 * horizon and fall astern for as long as the boat keeps sailing. Meshes are
 * therefore kept per island and reused -- an island that is still there after a
 * refresh keeps the mesh it already has, and only genuinely new land is built.
 * Rebuilding the lot every time the window slid would hitch the frame for
 * something the player cannot see.
 */

const RINGS = 26;
const SEGMENTS = 56;
/**
 * Meshes built per frame. Each is a few thousand vertices sampled through
 * elevationAt(), which is enough work that a crowded horizon appearing at once
 * would drop a frame. Two a frame clears any realistic backlog in well under a
 * second, and it is all happening in the fog anyway.
 */
const BUILDS_PER_FRAME = 2;

function islandMesh(
  terrain: Terrain,
  cx: number,
  cy: number,
  reach: number,
  material: THREE.Material,
): THREE.Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];

  const sand = new THREE.Color(0.74, 0.68, 0.55);
  const grass = new THREE.Color(0.28, 0.36, 0.24);
  const rock = new THREE.Color(0.42, 0.42, 0.44);
  const wet = new THREE.Color(0.34, 0.35, 0.33);
  const c = new THREE.Color();

  for (let r = 0; r <= RINGS; r++) {
    // Quadratic spacing keeps vertices where the shoreline is.
    const t = r / RINGS;
    const radius = reach * t * t;
    for (let s = 0; s <= SEGMENTS; s++) {
      const a = (s / SEGMENTS) * Math.PI * 2;
      const x = cx + Math.cos(a) * radius;
      const y = cy + Math.sin(a) * radius;
      const e = terrain.elevationAt(x, y);
      // Clamp underwater skirt so the mesh tucks below the sea rather than
      // extending to the seabed and poking through the water plane elsewhere.
      const h = Math.max(e, -3.5);
      pos.push(x, h, -y);

      if (e < -0.4) c.copy(wet);
      else if (e < 1.6) c.copy(sand);
      else if (e < 28) c.lerpColors(sand, grass, Math.min((e - 1.6) / 14, 1));
      else c.lerpColors(grass, rock, Math.min((e - 28) / 45, 1));
      col.push(c.r, c.g, c.b);
    }
  }

  const stride = SEGMENTS + 1;
  for (let r = 0; r < RINGS; r++) {
    for (let s = 0; s < SEGMENTS; s++) {
      const a = r * stride + s;
      const b = (r + 1) * stride + s;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

export interface IslandView {
  group: THREE.Object3D;
  setTerrain(terrain: Terrain): void;
  update(sky: SkyState): void;
  dispose(): void;
}

export function createIslandView(): IslandView {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  });

  // Islands are identified by object, not by position: the field hands back the
  // same object for the same piece of sea every time, so identity is exactly
  // "the island I already built".
  //
  // The neighbours are part of that key too. elevationAt() merges land that
  // shares a shelf, so a mesh built before its neighbour arrived is missing the
  // ground between them -- as much as a 374 m error in where the shore is --
  // and with nothing to invalidate it, the beach you see would stop being the
  // beach you run onto for as long as that island stayed loaded.
  const built = new Map<Island, { mesh: THREE.Mesh; deps: readonly Island[] }>();
  let pending: Island[] = [];
  let source: Terrain | null = null;

  const drop = (isl: Island) => {
    const hit = built.get(isl);
    if (!hit) return;
    group.remove(hit.mesh);
    hit.mesh.geometry.dispose();
    built.delete(isl);
  };

  const clear = () => {
    for (const isl of [...built.keys()]) drop(isl);
    pending = [];
    source = null;
  };

  return {
    group,
    setTerrain(terrain) {
      source = terrain;
      const wanted = new Set(terrain.islands);
      for (const isl of [...built.keys()]) {
        const hit = built.get(isl);
        if (!wanted.has(isl) || !sameIslands(hit!.deps, terrain.islandsAffecting(isl))) drop(isl);
      }
      // Nearest first: the field sorts by distance, so the land the player is
      // most likely to be looking at is built first.
      pending = terrain.islands.filter((isl) => !built.has(isl));
    },
    update(sky) {
      // Build a little at a time rather than all at once. `source` is the
      // terrain the mesh is sampled from, which must be the one the island came
      // in with -- neighbouring islands overlap, and elevationAt() takes the
      // highest of them.
      for (let i = 0; i < BUILDS_PER_FRAME && pending.length > 0 && source; i++) {
        const isl = pending.shift() as Island;
        // Reach past the shoreline so the underwater skirt is included.
        const reach = isl.radius * 1.55 + 40;
        const mesh = islandMesh(source, isl.pos.x, isl.pos.y, reach, material);
        built.set(isl, { mesh, deps: source.islandsAffecting(isl) });
        group.add(mesh);
      }

      // Land reads far too bright at night without this; the moon is not a sun.
      const k = 0.16 + sky.daylight * 0.84;
      material.color.setRGB(k, k, k);
    },
    dispose() {
      clear();
      material.dispose();
    },
  };
}
