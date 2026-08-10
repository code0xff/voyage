import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { orientWhaleWake, whaleWakeOffset } from './whale';

describe('whale view', () => {
  it('lays the long wake axis along the whale heading', () => {
    expect(whaleWakeOffset(0, 10, 0)).toEqual({ x: 0, y: 10 });
    expect(whaleWakeOffset(0, 10, Math.PI / 2).x).toBeCloseTo(10);
    expect(whaleWakeOffset(0, 10, Math.PI / 2).y).toBeCloseTo(0);
    const astern = whaleWakeOffset(0, -10, Math.PI / 2);
    expect(astern.x).toBeCloseTo(-10);
    expect(astern.y).toBeCloseTo(0);
  });

  it('renders sampled wake coordinates at the same point on the water', () => {
    const wake = new THREE.Object3D();
    const heading = 0.73;
    const across = 3;
    const forward = 7;
    const height = 1.4;
    const sampled = whaleWakeOffset(across, forward, heading);

    orientWhaleWake(wake, heading);
    wake.updateMatrixWorld(true);
    const rendered = new THREE.Vector3(across, forward, height).applyMatrix4(wake.matrixWorld);

    expect(rendered.x).toBeCloseTo(sampled.x);
    expect(-rendered.z).toBeCloseTo(sampled.y);
    expect(rendered.y).toBeCloseTo(height);
  });
});
