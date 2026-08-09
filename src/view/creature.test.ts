import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WaveField, sampleHull, type HullWaveSample } from '../sim/waves';
import { layOnWater, waveTilt } from './creature';
import type { Water } from './water';

/**
 * The animals lie on the sea the way water actually lies.
 *
 * A renderer test for the same reason `eye.test.ts` is one: this is a sign
 * problem, not a question of appearance, and there are four of them here.
 *
 * **It asks the water, and not the boat.** The first version of this asserted
 * that `layOnWater` reproduced exactly what scene.ts does to the hull, on the
 * reasoning that the boat has floated correctly for a long time. That test
 * passed and the code was wrong: measured against the analytic normal of a
 * plane the body came out mirrored athwartships, by exactly twice the slope
 * angle. The boat is inconsistent here itself -- `heel > 0` is starboard-down,
 * so a hull lying passively settles at `-rollSlope` and not the `+rollSlope`
 * that sim/boat.ts's righting moment implies -- so the test had blessed a bug
 * rather than caught one. A test written against another piece of code can only
 * ever say the two agree.
 *
 * A plane has a normal that no convention can argue with, so that is the
 * question now: put a body on a known slope, and does its own up point where
 * the water's does?
 *
 * What this does *not* cover, and it is worth being straight about it: the two
 * call sites. Delete the `layOnWater` line from `whale.ts` or `shark.ts` and
 * everything here still passes. Reaching them needs a loaded GLB and a browser,
 * so that half is verified the way this repository verifies renderer work --
 * by looking, at 6.4 m significant height where it is unmistakable.
 */

const flatWater = {
  surfaceHeight: (x: number, y: number, waves: WaveField) => waves.heightAt(x, y),
} as Water;

/** A sea with some shape to it, at a moment that is not t = 0. */
function sea(): WaveField {
  const waves = new WaveField(12, 0);
  waves.update(9.5);
  return waves;
}

const CASES = [
  { x: 0, y: 0, heading: 0, length: 15 },
  { x: 120, y: -40, heading: 1.1, length: 15 },
  { x: -300, y: 210, heading: 2.7, length: 18 },
  { x: 55, y: 90, heading: 4.4, length: 6 },
] as const;

describe('waveTilt', () => {
  it('reads the sea exactly as the boat does', () => {
    const waves = sea();
    const hull: HullWaveSample = { heave: 0, pitchSlope: 0, rollSlope: 0 };

    for (const c of CASES) {
      const beam = c.length * 0.25;
      sampleHull(waves, c.x, c.y, c.heading, c.length, beam, hull);
      const tilt = waveTilt(flatWater, waves, { x: c.x, y: c.y }, c.heading, c.length, beam);

      // The same four samples and the same two arctangents, so this is equality
      // rather than approximation. Anything else means the copy has drifted.
      expect(tilt.pitch).toBe(hull.pitchSlope);
      expect(tilt.roll).toBe(hull.rollSlope);
    }
  });

  it('finds a slope worth having at all', () => {
    const waves = sea();
    const tilts = CASES.map((c) =>
      waveTilt(flatWater, waves, { x: c.x, y: c.y }, c.heading, c.length, c.length * 0.25),
    );
    // Otherwise the equality above could be two zeroes agreeing with each other.
    expect(tilts.some((t) => Math.abs(t.pitch) > 0.01)).toBe(true);
    expect(tilts.some((t) => Math.abs(t.roll) > 0.01)).toBe(true);
  });
});

describe('layOnWater', () => {
  /**
   * A plane rising to the east by `slope`, and nothing else. For a height field
   * h(x, z) the normal is (-dh/dx, 1, -dh/dz), which is where the water's own
   * up points and is not open to interpretation.
   */
  function tiltedSea(slope: number) {
    return {
      water: { surfaceHeight: (x: number) => slope * x } as unknown as Water,
      normal: new THREE.Vector3(-slope, 1, 0).normalize(),
    };
  }

  it('points a body up the way the water does, at any heading', () => {
    for (const slope of [0.2, -0.35, 0.05]) {
      const { water, normal } = tiltedSea(slope);

      // Every quarter turn plus a few odd ones: the athwartships and the
      // fore-and-aft cases carry different signs, and only headings between
      // them exercise both at once.
      for (const heading of [0, 0.7, Math.PI / 2, 2.1, Math.PI, -Math.PI / 2, -2.4]) {
        const tilt = waveTilt(water, null as unknown as WaveField, { x: 0, y: 0 }, heading, 15, 3.75);
        const body = new THREE.Object3D();
        layOnWater(body, heading, tilt);
        body.updateMatrixWorld(true);

        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(body.quaternion);
        // A whole degree is far more than the arctangents can drift by; the
        // failure this guards against is a mirrored axis, which is twice the
        // slope -- 22 degrees on the first case here.
        expect(THREE.MathUtils.radToDeg(up.angleTo(normal))).toBeLessThan(1);
      }
    }
  });

  it('leaves a body upright on flat water, whichever way it faces', () => {
    const { water, normal } = tiltedSea(0);
    for (const heading of [0, 1.3, Math.PI, -2.2]) {
      const tilt = waveTilt(water, null as unknown as WaveField, { x: 0, y: 0 }, heading, 15, 3.75);
      const body = new THREE.Object3D();
      layOnWater(body, heading, tilt);
      body.updateMatrixWorld(true);

      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(body.quaternion);
      expect(up.angleTo(normal)).toBeLessThan(1e-9);
    }
  });

  it('still points the body where it is going', () => {
    const { water } = tiltedSea(0.2);
    for (const heading of [0, 1.3, Math.PI, -2.2]) {
      const tilt = waveTilt(water, null as unknown as WaveField, { x: 0, y: 0 }, heading, 15, 3.75);
      const body = new THREE.Object3D();
      layOnWater(body, heading, tilt);
      body.updateMatrixWorld(true);

      // The bow is local -Z; three z = -sim y, so this is the compass bearing.
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(body.quaternion);
      const bearing = Math.atan2(fwd.x, -fwd.z);
      const off = Math.abs(Math.atan2(Math.sin(bearing - heading), Math.cos(bearing - heading)));
      // Tilting must not have turned it: a wrong Euler order shows up here.
      expect(THREE.MathUtils.radToDeg(off)).toBeLessThan(2);
    }
  });
});
