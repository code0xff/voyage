import * as THREE from 'three';
import type { Terrain } from '../sim/terrain';
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
 */

const RINGS = 26;
const SEGMENTS = 56;

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

  const clear = () => {
    for (const child of [...group.children]) {
      group.remove(child);
      const m = child as THREE.Mesh;
      m.geometry?.dispose();
    }
  };

  return {
    group,
    setTerrain(terrain) {
      clear();
      for (const isl of terrain.islands) {
        // Reach past the shoreline so the underwater skirt is included.
        const reach = isl.radius * 1.55 + 40;
        group.add(islandMesh(terrain, isl.pos.x, isl.pos.y, reach, material));
      }
    },
    update(sky) {
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
