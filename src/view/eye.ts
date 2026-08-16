import * as THREE from 'three';

/**
 * Where the eye is and which way it faces.
 *
 * Lifted out of the render loop for one reason: these are the sign-sensitive
 * lines in the whole renderer, and while they were inline in a thousand-line
 * function nothing could look at them but a person. They had four different
 * conventions between two eyes and two axes before anyone noticed, and what
 * found it in the end was a player saying the controls felt wrong.
 *
 * Pure, so the rule they are supposed to obey can be asserted -- see
 * `eye.test.ts`. Nothing here reads the scene graph, the clock or the DOM. The
 * smoothing, the wave clamp and the deck eye's world position stay in the
 * render loop, because none of them can change which way a drag moves the sea.
 *
 * Coordinates as everywhere else: sim x is east and y is north, three x is
 * east, y is up and z is south, so three.z = -sim.y and the bow points along
 * local -Z.
 */

/** How much of her pitch and roll the head takes, 0..1. */
export const HEAD_PITCH = 0.8;
export const HEAD_ROLL = 0.6;

/**
 * What is left of that once the glasses are up.
 *
 * A helmsman with binoculars braces and lets the boat move under him: the
 * eyepieces hold the horizon while his knees take the sea. Magnification is
 * what makes this necessary rather than merely nice -- at five power the
 * residual swing is five times as wide across the field, and a view that
 * only ever swept the sky and the water was unusable for the one job the
 * glasses have, which is finding a blow.
 *
 * Not zero, deliberately. Perfectly welded to the horizon reads as a tripod
 * bolted to the sea rather than a person holding glasses, and the little
 * that is left is what says a body is doing the holding.
 */
export const BRACED = 0.12;

/**
 * Which way a head on deck is looking.
 *
 * Orientation is built rather than taken off the scene graph, because this is
 * where the stabilisation lives: heading is hers entirely, heel and pitch are
 * hers in part, and the look-around goes on top of all of it, so a head turned
 * to leeward stays turned to leeward as she comes up.
 *
 * **Both look-around terms are subtracted.** That is what puts this eye on the
 * same rule as the chase camera -- drag right and you look right, drag down and
 * you look down. Added, as they once were, this eye moved opposite the chase
 * camera on both axes, so the two views disagreed with each other as well as
 * with themselves.
 */
export function deckOrientation(
  boatPitch: number,
  boatHeading: number,
  boatHeel: number,
  yaw: number,
  pitch: number,
  /**
   * How much of her motion the head still takes, 1 with the naked eye and
   * `BRACED` behind the glasses. Scales the follow factors rather than
   * replacing them, so the braced view is the ordinary view with the sea
   * taken out of it -- and heading is untouched at any value, because which
   * way she points is not motion to be absorbed, it is where you are
   * looking.
   */
  follow = 1,
): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      boatPitch * HEAD_PITCH * follow - pitch,
      -boatHeading - yaw,
      -boatHeel * HEAD_ROLL * follow,
      'YXZ',
    ),
  );
}

/**
 * Where the chase camera wants to be: spherical about the boat, so the mouse
 * can swing the eye anywhere around her.
 *
 * Azimuth is measured from dead astern and added to the heading, which is what
 * keeps a chosen view fixed relative to the boat rather than to the compass.
 * Height rises with pitch, and the camera looks back at her from wherever this
 * puts it -- so a larger pitch is a higher eye looking further down, which is
 * the same way the deck eye ends up looking once its own sign is applied. That
 * the two agree is the thing the test pins down.
 *
 * @param heave the boat's heave, which the eye follows only partly: tracking it
 *   fully is nauseating
 */
export function chaseEyePosition(
  boatX: number,
  boatZ: number,
  boatHeading: number,
  heave: number,
  yaw: number,
  pitch: number,
  dist: number,
): THREE.Vector3 {
  const az = boatHeading + yaw;
  const horiz = Math.cos(pitch) * dist;
  return new THREE.Vector3(
    boatX - Math.sin(az) * horiz,
    3 + heave * 0.4 + Math.sin(pitch) * dist,
    boatZ + Math.cos(az) * horiz,
  );
}

/** What the chase camera looks at: her, a little above the waterline. */
export function chaseTarget(boatX: number, boatZ: number, heave: number): THREE.Vector3 {
  return new THREE.Vector3(boatX, 3 + heave * 0.6, boatZ);
}
