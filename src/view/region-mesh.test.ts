import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HeightField } from '../sim/heightfield';
import { RegionTerrain } from '../sim/region-terrain';
import { regionById } from '../sim/regions';
import { skyState } from '../sim/sky';
import { createRegionView } from './region-mesh';

/** A compact surveyed coast, large enough to exercise the real tile builder. */
function meshTerrain(): RegionTerrain {
  const source = regionById('sf-bay');
  if (!source) throw new Error('sf-bay region is missing');
  const region = {
    ...source,
    id: 'region-mesh-test',
    grid: { ...source.grid, width: 40, height: 40, unit: 1 },
  };
  const samples = new Int16Array(region.grid.width * region.grid.height).fill(-20);
  for (let row = 14; row < 26; row++) {
    for (let col = 14; col < 26; col++) samples[row * region.grid.width + col] = 30;
  }
  return new RegionTerrain(region, new HeightField(samples, region));
}

function position(geometry: THREE.BufferGeometry, index: number): THREE.Vector3 {
  return new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), index);
}

describe('surveyed region mesh', () => {
  it('uses upward-facing triangles for the actual tile-building path', () => {
    const view = createRegionView();
    view.setRegion(meshTerrain());
    view.update(0, 0, skyState(12));

    expect(view.group.children).toHaveLength(1);
    const mesh = view.group.children[0] as THREE.Mesh;
    const geometry = mesh.geometry;
    const index = geometry.getIndex();
    expect(index).not.toBeNull();

    for (let i = 0; i < (index?.count ?? 0); i += 3) {
      const a = position(geometry, index!.getX(i));
      const b = position(geometry, index!.getX(i + 1));
      const c = position(geometry, index!.getX(i + 2));
      const normal = new THREE.Vector3().crossVectors(
        b.sub(a),
        c.sub(a),
      );
      expect(normal.y).toBeGreaterThan(0);
    }

    view.dispose();
  });

  it('samples one exact kilometre tile at the survey grid spacing', () => {
    const view = createRegionView();
    view.setRegion(meshTerrain());
    view.update(0, 0, skyState(12));

    const mesh = view.group.children[0] as THREE.Mesh;
    const positions = mesh.geometry.getAttribute('position');
    const xs = new Set<number>();
    const zs = new Set<number>();
    let highest = -Infinity;
    let lowest = Infinity;
    for (let i = 0; i < positions.count; i++) {
      xs.add(positions.getX(i));
      zs.add(positions.getZ(i));
      highest = Math.max(highest, positions.getY(i));
      lowest = Math.min(lowest, positions.getY(i));
    }

    expect(xs.size).toBe(41);
    expect(zs.size).toBe(41);
    expect(Math.min(...xs)).toBe(-500);
    expect(Math.max(...xs)).toBe(500);
    expect(Math.min(...zs)).toBe(-500);
    expect(Math.max(...zs)).toBe(500);
    expect(highest).toBeGreaterThan(0);
    expect(lowest).toBe(-3.5);

    view.dispose();
  });
});

/**
 * A moved window builds its land where the window is. The tile lattice is
 * laid out from the field's own origin; laid about the world origin instead,
 * a slid coast window would find no candidates anywhere near the boat and
 * build its 20 km of land as a ghost back where the session started.
 */
describe('a moved window', () => {
  it('lays its tiles about the window, not the world origin', () => {
    const source = regionById('sf-bay');
    if (!source) throw new Error('sf-bay region is missing');
    const region = {
      ...source,
      id: 'region-mesh-origin-test',
      grid: { ...source.grid, width: 40, height: 40, unit: 1 },
    };
    const origin = { x: 5000, y: -3000 };
    const samples = new Int16Array(1600).fill(-20);
    for (let row = 14; row < 26; row++) {
      for (let col = 14; col < 26; col++) samples[row * 40 + col] = 30;
    }
    const terrain = new RegionTerrain(region, new HeightField(samples, region, origin));
    const view = createRegionView();
    view.setRegion(terrain);
    view.update(origin.x, origin.y, skyState(12));

    expect(view.group.children).toHaveLength(1);
    const mesh = view.group.children[0] as THREE.Mesh;
    const positions = mesh.geometry.getAttribute('position');
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < positions.count; i++) {
      minX = Math.min(minX, positions.getX(i));
      maxX = Math.max(maxX, positions.getX(i));
      minZ = Math.min(minZ, positions.getZ(i));
      maxZ = Math.max(maxZ, positions.getZ(i));
    }
    // The land block sits at the window's centre: sim (5000, -3000), and
    // three's z is -y. A lattice about the world origin puts it 5 km west
    // and 3 km north of here.
    expect(minX).toBe(4500);
    expect(maxX).toBe(5500);
    expect(minZ).toBe(2500);
    expect(maxZ).toBe(3500);
    view.dispose();
  });
});
