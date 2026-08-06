import * as THREE from 'three';
import { DEG, clamp, wrapPi } from '../sim/math';

/**
 * The boat's lights after dark.
 *
 * These are the real ones. A sailing vessel under way shows a red light to
 * port, a green to starboard and a white astern, and each is *sectored*: the
 * sidelights are visible from dead ahead to a little abaft the beam on their
 * own side, and the sternlight covers what is left. That is the whole point of
 * them -- the colour you can see tells another vessel which way you are going,
 * and seeing both red and green at once means someone is coming straight at you.
 *
 * So the sectors are honoured rather than faked with three lamps that are
 * always on. It costs one angle comparison per lamp per frame, and it means the
 * chase camera swinging round the stern sees the colours come and go exactly as
 * they should.
 *
 * There is no navigation consequence to any of this -- nothing else is out here
 * to see them. It is worth doing because a boat sailing through the dark with
 * no lights reads as an unlit prop, and because the cabin glow is the only
 * thing that makes her look inhabited.
 */

/**
 * How lit the lamps are, 0..1.
 *
 * Fading with the light rather than snapping on at a threshold: dusk is
 * gradual and so is reaching for the switch. It lives out here because the
 * water shader needs the same number to pool the light on the sea, and a
 * second copy of the curve would let the pool and the lamps drift apart.
 */
export function lampLevel(on: boolean, daylight: number): number {
  return on ? clamp(1 - daylight * 1.35, 0, 1) : 0;
}

/** Sidelights: dead ahead to 22.5 degrees abaft the beam. */
const SIDE_ARC = 112.5 * DEG;
/** Sternlight covers the remaining 135 degrees. */
const STERN_ARC = 135 * DEG;

interface Lamp {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  glow: THREE.PointLight;
  /** Centre of the visible sector, relative to the bow (rad, +ve to starboard). */
  centre: number;
  arc: number;
}

export interface BoatLights {
  group: THREE.Object3D;
  /**
   * The spreader flood, so its world position can be read off the scene graph.
   * The water shader throws the pool from wherever this actually is.
   */
  spreader: THREE.Object3D;
  /**
   * @param level   how lit the lamps are, from lampLevel()
   * @param bearing bearing of the camera from the boat, relative to her bow
   */
  update(level: number, bearing: number): void;
  dispose(): void;
}

export function createBoatLights(
  loa: number,
  beam: number,
  deckY: number,
  mastHeight: number,
): BoatLights {
  const group = new THREE.Group();
  const lamps: Lamp[] = [];

  const addLamp = (
    colour: number,
    pos: [number, number, number],
    centre: number,
    arc: number,
    intensity: number,
  ) => {
    const material = new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      // Lit from within, so it must not take the scene's lighting.
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), material);
    mesh.position.set(...pos);
    const glow = new THREE.PointLight(colour, 0, 9, 2);
    glow.position.set(...pos);
    group.add(mesh, glow);
    lamps.push({ mesh, material, glow, centre, arc });
    glow.userData.base = intensity;
  };

  const bow = -loa * 0.42;
  const stern = loa * 0.46;
  const halfB = beam * 0.36;

  // Port red, starboard green, each looking forward over its own side.
  addLamp(0xff2d2d, [-halfB, deckY + 0.25, bow + 0.6], -SIDE_ARC / 2, SIDE_ARC, 1.6);
  addLamp(0x22ff5a, [halfB, deckY + 0.25, bow + 0.6], SIDE_ARC / 2, SIDE_ARC, 1.6);
  // Sternlight, white, looking aft.
  addLamp(0xfff2d0, [0, deckY + 0.3, stern - 0.4], Math.PI, STERN_ARC, 1.4);

  // The spreader flood.
  //
  // Not a navigation light either, and the only one here that is meant to
  // *illuminate* rather than to be seen. Real yachts carry one on the spreaders
  // pointing down, for working the deck at night, and it is the honest way to
  // get light onto the water: a source up the mast throws a round pool, where
  // a lamp at deck level only ever smeared one. Hung at a bit over half the
  // rig, which is where the lower spreaders are.
  const spreader = new THREE.Object3D();
  spreader.position.set(0, deckY + mastHeight * 0.55, -0.2);
  group.add(spreader);
  const spreaderLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff0d2, transparent: true, toneMapped: false }),
  );
  spreader.add(spreaderLamp);
  const spreaderMat = spreaderLamp.material as THREE.MeshBasicMaterial;

  // The cabin. Not a navigation light -- it is what makes her look lived in,
  // and it is the only warm thing in the frame at night.
  const cabinMat = new THREE.MeshBasicMaterial({
    color: 0xffb257,
    transparent: true,
    toneMapped: false,
  });
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(beam * 0.5, 0.34, loa * 0.26), cabinMat);
  cabin.position.set(0, deckY + 0.32, -0.4);
  group.add(cabin);
  const cabinGlow = new THREE.PointLight(0xffa94d, 0, 14, 2);
  cabinGlow.position.set(0, deckY + 0.6, -0.4);
  group.add(cabinGlow);

  return {
    group,
    spreader,
    update(level, bearing) {
      group.visible = level > 0.01;
      if (!group.visible) return;

      for (const lamp of lamps) {
        // Inside its sector or not. The half-arc test is on the shortest angle
        // to the sector's centreline, which wraps correctly at the stern.
        const off = Math.abs(wrapPi(bearing - lamp.centre));
        const visible = off <= lamp.arc / 2;
        // A little softness at the edge, so a lamp does not blink as the
        // camera crosses the boundary.
        const edge = clamp((lamp.arc / 2 - off) / (6 * DEG), 0, 1);
        lamp.material.opacity = level * (visible ? 0.35 + 0.65 * edge : 0.08);
        lamp.mesh.visible = true;
        lamp.glow.intensity = (lamp.glow.userData.base as number) * level * (visible ? edge : 0);
      }

      spreaderMat.opacity = level * 0.9;
      cabinMat.opacity = level * 0.55;
      cabinGlow.intensity = level * 2.4;
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | undefined;
        mat?.dispose();
      });
    },
  };
}
