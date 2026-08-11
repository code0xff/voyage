import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { placeGroup } from './gull';

/**
 * Where a group of the flock ends up, which is a convention and not a look.
 *
 * A flock is several copies of one authored circuit, offset and turned away
 * from each other so that they mix instead of flying as one body. Both of those
 * are sign problems -- sim north is the scene's -Z, so an offset and a yaw each
 * change hand on the way through -- and signs are what this project gets wrong,
 * which is the same reason `creature.test.ts` and `eye.test.ts` exist.
 *
 * The offset is asserted against the world: sim north is the scene's -Z, and
 * getting it wrong puts a group on the far side of the flock, which no amount
 * of looking at one bird would show.
 *
 * **The yaw is asserted against the project's convention, which is a weaker
 * thing, and the difference is worth stating.** It pins that a compass-positive
 * turn comes out as a starboard turn in the scene, the same way `layOnWater`
 * does it. It cannot pin the asset's own forward, because that has never been
 * established -- and since the yaws are drawn uniformly over a full circle,
 * negating every one of them would leave the flock looking exactly the same.
 * So this catches the convention drifting away from the rest of the renderer,
 * and it does not catch the birds facing the wrong way; nothing but the asset
 * could tell you that.
 *
 * What this does not cover either: the call site, and whether any of it looks
 * like birds. Those need a GLB and a browser.
 */
describe('placeGroup', () => {
  it('puts a group where the simulation put it, with north at -Z', () => {
    const pivot = new THREE.Object3D();
    // 3 m east and 5 m north of the flock centre, 12 m up.
    placeGroup(pivot, { offset: { x: 3, y: 5 }, altitude: 12, yaw: 0 });

    expect(pivot.position.x).toBeCloseTo(3, 10);
    expect(pivot.position.y).toBeCloseTo(12, 10);
    // North is -Z. Getting this wrong puts the group on the far side of the
    // flock, which no amount of looking at one bird would show.
    expect(pivot.position.z).toBeCloseTo(-5, 10);
  });

  /**
   * The turn, taken as a compass bearing. A quarter turn to starboard from
   * north is east, so a group facing north before it is turned faces east
   * after -- and east in this scene is +X.
   */
  it('turns a group the way a compass does, not the way the scene does', () => {
    const pivot = new THREE.Object3D();
    placeGroup(pivot, { offset: { x: 0, y: 0 }, altitude: 0, yaw: Math.PI / 2 });
    pivot.updateMatrixWorld(true);

    // Whatever the asset's own forward is, take the group's local north --
    // -Z, the direction everything in this scene travels towards -- and ask
    // where a quarter turn to starboard has sent it.
    const pointed = new THREE.Vector3(0, 0, -1).applyQuaternion(pivot.quaternion);
    expect(pointed.x).toBeCloseTo(1, 10);
    expect(pointed.z).toBeCloseTo(0, 10);
  });

  /**
   * The general case, and the one that would catch a negation that happens to
   * be right at a quarter turn. A bearing in the simulation is (sin, cos); the
   * same bearing in the scene is (sin, -cos) after the z flip.
   */
  it('agrees with the simulation at any bearing', () => {
    for (const yaw of [0.4, 1.9, -2.7, 3.0]) {
      const pivot = new THREE.Object3D();
      placeGroup(pivot, { offset: { x: 0, y: 0 }, altitude: 0, yaw });
      pivot.updateMatrixWorld(true);

      const pointed = new THREE.Vector3(0, 0, -1).applyQuaternion(pivot.quaternion);
      expect(pointed.x).toBeCloseTo(Math.sin(yaw), 10);
      expect(pointed.z).toBeCloseTo(-Math.cos(yaw), 10);
    }
  });
});
