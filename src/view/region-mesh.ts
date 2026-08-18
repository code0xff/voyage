import * as THREE from 'three';
import type { RegionTerrain } from '../sim/region-terrain';
import type { SkyState } from '../sim/sky';

/**
 * The land, as a grid of tiles.
 *
 * The islands that preceded it were one polar mesh per circle, dense at the
 * shoreline where the shape was and sparse inland. A coast has no centre to be
 * polar about, so this tiles the square instead -- and it keeps the guarantee
 * that mattered: every vertex comes from the very `elevationAt` the physics
 * grounds the boat on, so the beach you can see is the beach you run onto.
 *
 * ## Only where there is land
 *
 * Four hundred tiles cover the region and most of them are open water, which
 * needs no mesh at all -- the sea is a shader. So each tile is measured once at
 * load and the empty ones are never built or considered again. For San
 * Francisco that discards roughly two thirds of the square before the first
 * frame.
 *
 * ## Only where you could see it
 *
 * Of what remains, tiles are built when they come within drawing range and
 * dropped when they fall well outside it, a couple per frame like the islands
 * before them. A 20 km region is far too much land to hold as geometry at once,
 * and it is all in the fog anyway.
 */

/** Metres across one tile. */
const TILE = 1000;
/** Vertices along a tile edge. At 1 km this samples every 25 m, the grid's own. */
const STEP = 41;
/**
 * Tiles built per frame. Each is about 1,600 vertices sampled through
 * elevationAt, which is enough work that a coastline arriving at once would
 * drop a frame.
 */
const BUILDS_PER_FRAME = 2;
/** How far tiles are drawn, m. Past the fog at any visibility, so they are born unseen. */
const DRAW_RANGE = 2800;
/**
 * Dropped beyond this, m. Wider than DRAW_RANGE on purpose: with one threshold,
 * a boat working to windward along the line would rebuild the same tile every
 * few seconds.
 */
const KEEP_RANGE = 3600;

/**
 * Below this, a tile is all water and is never built, m.
 *
 * Not zero, because the meshes carry an underwater skirt so the land does not
 * end in a cliff at the waterline -- a tile whose highest ground is a metre
 * down still has a beach to draw.
 */
const LAND_THRESHOLD = -4;
/** How far the skirt reaches below the surface, m. Matches islands.ts. */
const SKIRT = -3.5;

interface Tile {
  /** Tile indices, not metres. */
  tx: number;
  ty: number;
  /** Centre, in world metres. */
  cx: number;
  cy: number;
}

function tileMesh(
  terrain: RegionTerrain,
  tile: Tile,
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

  const x0 = tile.cx - TILE / 2;
  const y0 = tile.cy - TILE / 2;
  // Exactly the tile, with no overlap.
  //
  // The first version added a cell of it, meaning to make neighbours share
  // their boundary vertices, and achieved the opposite: the span became 1025 m
  // over 40 intervals, so the spacing was 25.625 m and no longer landed on the
  // 25 m grid at all. Adjacent tiles then covered the same 25 m strip with
  // vertices that did not coincide -- duplicated geometry to z-fight over.
  //
  // Spanning the tile exactly gives 25.000 m, which *is* the grid, and tile k
  // ends at the same x as tile k+1 begins. The boundary is shared by
  // construction, which is what the overlap was reaching for.
  const span = TILE;

  for (let j = 0; j < STEP; j++) {
    const y = y0 + (j / (STEP - 1)) * span;
    for (let i = 0; i < STEP; i++) {
      const x = x0 + (i / (STEP - 1)) * span;
      const e = terrain.elevationAt(x, y);
      pos.push(x, Math.max(e, SKIRT), -y);

      if (e < -0.4) c.copy(wet);
      else if (e < 1.6) c.copy(sand);
      else if (e < 28) c.lerpColors(sand, grass, Math.min((e - 1.6) / 14, 1));
      else c.lerpColors(grass, rock, Math.min((e - 28) / 45, 1));
      col.push(c.r, c.g, c.b);
    }
  }

  for (let j = 0; j < STEP - 1; j++) {
    for (let i = 0; i < STEP - 1; i++) {
      const a = j * STEP + i;
      const b = (j + 1) * STEP + i;
      // Wound counter-clockwise seen from above, so computeVertexNormals()
      // gives +Y and the land is lit by the sun rather than from beneath it.
      //
      // Not the winding islands.ts uses, and copying it was the mistake: there
      // the two indices run ring and segment around a pole, here they run north
      // and east across a plane, and (a, b, b+1) on this layout comes out
      // facing -Y. A back-facing MeshStandardMaterial is culled from above, so
      // the shore vanished exactly where a helmsman looks at it.
      idx.push(a, b + 1, b, a, a + 1, b + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

export interface RegionView {
  group: THREE.Object3D;
  /** Install a region, or null to show none. */
  setRegion(terrain: RegionTerrain | null): void;
  update(boatX: number, boatY: number, sky: SkyState): void;
  dispose(): void;
}

export function createRegionView(): RegionView {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  });

  let terrain: RegionTerrain | null = null;
  /** Tiles with land in them, decided once when the region is installed. */
  let candidates: Tile[] = [];
  const built = new Map<string, THREE.Mesh>();
  let pending: Tile[] = [];

  const key = (t: Tile) => `${t.tx},${t.ty}`;

  const drop = (k: string) => {
    const mesh = built.get(k);
    if (!mesh) return;
    group.remove(mesh);
    mesh.geometry.dispose();
    built.delete(k);
  };

  const clear = () => {
    for (const k of [...built.keys()]) drop(k);
    pending = [];
    candidates = [];
  };

  return {
    group,
    setRegion(next) {
      clear();
      terrain = next;
      if (!next) return;

      // Which tiles hold any land at all, measured once. Sampled on a coarse
      // lattice with a margin: a corner-only headland must not be missed, and a
      // false positive only costs one mesh that comes out flat.
      const halfW = next.height.halfWidth;
      const halfH = next.height.halfHeight;
      // The tile lattice lives where the field lives -- a re-windowed coast
      // hands over the same class with a moved origin, and tiles laid about
      // the world origin instead would sample the field's edge clamp and
      // build 20 km of flat ghost coast where the boat no longer is.
      const ox = next.height.originX;
      const oy = next.height.originY;
      const nx = Math.ceil((halfW * 2) / TILE);
      const ny = Math.ceil((halfH * 2) / TILE);
      for (let ty = 0; ty < ny; ty++) {
        for (let tx = 0; tx < nx; tx++) {
          const cx = ox - halfW + (tx + 0.5) * TILE;
          const cy = oy - halfH + (ty + 0.5) * TILE;
          let highest = -Infinity;
          for (let j = 0; j <= 8 && highest < LAND_THRESHOLD; j++) {
            for (let i = 0; i <= 8; i++) {
              const x = cx - TILE / 2 + (i / 8) * TILE;
              const y = cy - TILE / 2 + (j / 8) * TILE;
              const e = next.height.elevationAt(x, y);
              if (e > highest) highest = e;
            }
          }
          if (highest >= LAND_THRESHOLD) candidates.push({ tx, ty, cx, cy });
        }
      }
    },

    update(boatX, boatY, sky) {
      if (terrain) {
        // Tiles are square, so range is measured to the nearest point of the
        // tile rather than to its centre -- by the centre, a tile the boat is
        // standing on the edge of is half a kilometre away.
        const near = (t: Tile, range: number) => {
          const dx = Math.max(0, Math.abs(t.cx - boatX) - TILE / 2);
          const dy = Math.max(0, Math.abs(t.cy - boatY) - TILE / 2);
          return dx * dx + dy * dy <= range * range;
        };

        for (const k of [...built.keys()]) {
          const [tx, ty] = k.split(',').map(Number);
          const t = candidates.find((c) => c.tx === tx && c.ty === ty);
          if (!t || !near(t, KEEP_RANGE)) drop(k);
        }

        pending = candidates.filter((t) => !built.has(key(t)) && near(t, DRAW_RANGE));
        // Nearest first, so the land the player is most likely to be looking at
        // is the land that appears first.
        pending.sort(
          (a, b) =>
            (a.cx - boatX) ** 2 + (a.cy - boatY) ** 2 - ((b.cx - boatX) ** 2 + (b.cy - boatY) ** 2),
        );

        for (let i = 0; i < BUILDS_PER_FRAME && pending.length > 0; i++) {
          const t = pending.shift() as Tile;
          const mesh = tileMesh(terrain, t, material);
          built.set(key(t), mesh);
          group.add(mesh);
        }
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
