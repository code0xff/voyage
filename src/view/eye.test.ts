import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { chaseEyePosition, chaseTarget, deckOrientation } from './eye';
import { dragTo } from './orbit';

/**
 * A renderer test, which this repository does not otherwise have.
 *
 * AGENTS.md says tests cover the physics core and the rules and not the
 * renderer, and that is right for almost all of it: what a shader looks like
 * has to be seen, and no assertion is going to tell you the water reads as
 * water. This is the exception, and it is worth being clear about why.
 *
 * The camera's response to a drag is not a matter of appearance. It is four
 * signs, and signs are the thing this project gets wrong most often -- the
 * conventions note in `sim/math.ts` exists for the same reason. These four had
 * drifted into *four different conventions* across two eyes and two axes, and
 * nothing caught it: it survived every test run, every screenshot, and a code
 * review, and what found it in the end was a player saying the controls felt
 * wrong. That is a rule with a truth value, not a look.
 *
 * The test drives the real chain -- `dragTo` for the gesture, then the same
 * pose functions the render loop calls -- and asks the only question that
 * matters: **when the hand goes one way, does the sea go the same way?** It is
 * deliberately not a restatement of the rule against itself; flip either sign
 * in `dragTo`, or either sign in `deckOrientation`, and it fails.
 */

/** Roughly the field the scene uses; only the sign of the answer depends on it. */
const camera = () => new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 4000);

/** A mark on the water well ahead of her. sim (0, 500) -> three (0, 0, -500). */
const MARK = new THREE.Vector3(0, 0, -500);

/** Where the mark lands on screen, in NDC: x right, y up. */
function onScreen(cam: THREE.PerspectiveCamera): { x: number; y: number } {
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const p = MARK.clone().project(cam);
  return { x: p.x, y: p.y };
}

/** The deck eye, posed by the same function the render loop uses. */
function deckView(yaw: number, pitch: number): { x: number; y: number } {
  const cam = camera();
  cam.position.set(0, 2.5, 0);
  cam.quaternion.copy(deckOrientation(0, 0, 0, yaw, pitch));
  return onScreen(cam);
}

/** The chase eye, likewise, at its steady state -- the smoothing only delays it. */
function chaseView(yaw: number, pitch: number): { x: number; y: number } {
  const cam = camera();
  cam.position.copy(chaseEyePosition(0, 0, 0, 0, yaw, pitch, 40));
  cam.lookAt(chaseTarget(0, 0, 0));
  return onScreen(cam);
}

/** Where each eye rests, from `framePitchFor` in scene.ts. */
const DECK_REST = { yaw: 0, pitch: 0 };
const CHASE_REST = { yaw: 0, pitch: 0.3 };

const EYES = [
  { name: 'deck', view: deckView, rest: DECK_REST },
  { name: 'chase', view: chaseView, rest: CHASE_REST },
] as const;

describe('the eye follows the hand', () => {
  it.each(EYES)('$name: dragging right slides the sea right', ({ view, rest }) => {
    const before = view(rest.yaw, rest.pitch);
    const dragged = dragTo(rest.yaw, rest.pitch, 60, 0);
    const after = view(dragged.yaw, dragged.pitch);

    expect(after.x).toBeGreaterThan(before.x);
  });

  it.each(EYES)('$name: dragging left slides the sea left', ({ view, rest }) => {
    const before = view(rest.yaw, rest.pitch);
    const dragged = dragTo(rest.yaw, rest.pitch, -60, 0);
    const after = view(dragged.yaw, dragged.pitch);

    expect(after.x).toBeLessThan(before.x);
  });

  it.each(EYES)('$name: dragging down slides the sea down', ({ view, rest }) => {
    const before = view(rest.yaw, rest.pitch);
    const dragged = dragTo(rest.yaw, rest.pitch, 0, 50);
    const after = view(dragged.yaw, dragged.pitch);

    expect(after.y).toBeLessThan(before.y);
  });

  it.each(EYES)('$name: dragging up slides the sea up', ({ view, rest }) => {
    const before = view(rest.yaw, rest.pitch);
    const dragged = dragTo(rest.yaw, rest.pitch, 0, -50);
    const after = view(dragged.yaw, dragged.pitch);

    expect(after.y).toBeGreaterThan(before.y);
  });

  /**
   * The property the four cases above are really about, stated once. Both eyes
   * were internally inconsistent *and* opposite to each other; either failure
   * alone would leave every single-eye assertion above passing.
   */
  it('moves both eyes the same way, on both axes', () => {
    const shift = (
      eye: (typeof EYES)[number],
      dx: number,
      dy: number,
    ): { x: number; y: number } => {
      const before = eye.view(eye.rest.yaw, eye.rest.pitch);
      const dragged = dragTo(eye.rest.yaw, eye.rest.pitch, dx, dy);
      const after = eye.view(dragged.yaw, dragged.pitch);
      return { x: after.x - before.x, y: after.y - before.y };
    };

    const [deck, chase] = EYES;
    for (const [dx, dy] of [
      [60, 0],
      [-60, 0],
      [0, 50],
      [0, -50],
    ]) {
      const a = shift(deck, dx, dy);
      const b = shift(chase, dx, dy);
      expect(Math.sign(a.x)).toBe(Math.sign(b.x));
      expect(Math.sign(a.y)).toBe(Math.sign(b.y));
    }
  });
});
