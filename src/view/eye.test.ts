import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { chaseEyePosition, chaseTarget, deckOrientation } from './eye';
import { dragTo, pinchTo } from './orbit';

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
 * matters: **when the hand goes one way, does the eye go the same way?** The
 * mark on the water therefore moves the other way, because turning your head
 * is what moves it. See `dragTo` for why that convention and not the map one.
 *
 * It is deliberately not a restatement of the rule against itself; flip either
 * sign in `dragTo`, or either sign in `deckOrientation`, and it fails.
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
  it.each(EYES)('$name: dragging right looks right, so the mark goes left', (eye) => {
    const before = eye.view(eye.rest.yaw, eye.rest.pitch);
    const dragged = dragTo(eye.rest.yaw, eye.rest.pitch, 60, 0);
    const after = eye.view(dragged.yaw, dragged.pitch);

    expect(after.x).toBeLessThan(before.x);
  });

  it.each(EYES)('$name: dragging left looks left, so the mark goes right', (eye) => {
    const before = eye.view(eye.rest.yaw, eye.rest.pitch);
    const dragged = dragTo(eye.rest.yaw, eye.rest.pitch, -60, 0);
    const after = eye.view(dragged.yaw, dragged.pitch);

    expect(after.x).toBeGreaterThan(before.x);
  });

  it.each(EYES)('$name: dragging down looks down, so the mark goes up', (eye) => {
    const before = eye.view(eye.rest.yaw, eye.rest.pitch);
    const dragged = dragTo(eye.rest.yaw, eye.rest.pitch, 0, 50);
    const after = eye.view(dragged.yaw, dragged.pitch);

    expect(after.y).toBeGreaterThan(before.y);
  });

  it.each(EYES)('$name: dragging up looks up, so the mark goes down', (eye) => {
    const before = eye.view(eye.rest.yaw, eye.rest.pitch);
    const dragged = dragTo(eye.rest.yaw, eye.rest.pitch, 0, -50);
    const after = eye.view(dragged.yaw, dragged.pitch);

    expect(after.y).toBeLessThan(before.y);
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

/**
 * The same kind of claim for the other gesture: two signs, one per wheel
 * target, and the pair must disagree -- the hand means "more of what I am
 * looking at" both times, and the two numbers encode that oppositely (a
 * shorter eye distance, a higher power). A pinch that moved them the same
 * way would zoom one view and un-zoom the other.
 */
describe('the scene follows the fingers', () => {
  it('spreading them brings the boat closer -- a shorter eye distance', () => {
    const next = pinchTo(1, 5, 1.5, 'distance');
    expect(next.zoom).toBeLessThan(1);
    expect(next.magnify).toBe(5);
  });

  it('closing them pushes it away', () => {
    const next = pinchTo(1, 5, 0.6, 'distance');
    expect(next.zoom).toBeGreaterThan(1);
  });

  it('spreading them raises the binocular power', () => {
    const next = pinchTo(1, 5, 1.5, 'magnify');
    expect(next.magnify).toBeGreaterThan(5);
    expect(next.zoom).toBe(1);
  });

  it('composes: many small spreads land where one big one does', () => {
    // The pointer stream delivers a pinch as dozens of tiny ratios; if they
    // did not compose, the zoom would depend on the event rate. Both targets,
    // because an additive magnify would pass every sign test above and still
    // give a different power for the same gesture at different event rates.
    let zoom = 1;
    let power = 5;
    for (let i = 0; i < 10; i++) {
      const k = Math.pow(2, 1 / 10);
      zoom = pinchTo(zoom, 5, k, 'distance').zoom;
      power = pinchTo(1, power, k, 'magnify').magnify;
    }
    expect(zoom).toBeCloseTo(pinchTo(1, 5, 2, 'distance').zoom, 10);
    expect(power).toBeCloseTo(pinchTo(1, 5, 2, 'magnify').magnify, 10);
  });
});
