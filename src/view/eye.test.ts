import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BRACED, chaseEyePosition, chaseTarget, deckOrientation } from './eye';
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

/**
 * The braced view, behind the glasses.
 *
 * Not a look but a claim with a truth value, which is why it is here: with
 * the glasses up the horizon must hold while she rolls and pitches, or the
 * one job binoculars have -- finding a blow at five power, where every
 * residual degree is five degrees of field -- is impossible. Asserted
 * against the world rather than against the other factor: a mark sitting on
 * the water dead ahead is projected through the real pose function, and the
 * question is how far it moves across the screen when she heels.
 */
describe('the glasses hold the horizon', () => {
  /** Where the mark lands with the deck eye at this pose. */
  const deckAt = (heel: number, boatPitch: number, follow: number) => {
    const cam = camera();
    cam.position.set(0, 2.5, 0);
    cam.quaternion.copy(deckOrientation(boatPitch, 0, heel, 0, 0, follow));
    return onScreen(cam);
  };

  /**
   * The same mark, off to one side, where roll actually shows.
   *
   * A review pointed out that the dead-ahead mark sits on the roll axis, so
   * a mutation dropping `follow` from the roll term alone passed everything
   * here. Twenty degrees off the bow is where a horizon tilt reads.
   */
  const OFF_BOW = new THREE.Vector3(-Math.sin(0.35) * 500, 0, -Math.cos(0.35) * 500);

  const offBowAt = (heel: number, follow: number) => {
    const cam = camera();
    cam.position.set(0, 2.5, 0);
    cam.quaternion.copy(deckOrientation(0, 0, heel, 0, 0, follow));
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const p = OFF_BOW.clone().project(cam);
    return { x: p.x, y: p.y };
  };

  it('steadies her roll, seen where roll shows', () => {
    const heel = 18 * (Math.PI / 180);
    const level = offBowAt(0, 1);
    const naked = offBowAt(heel, 1);
    const braced = offBowAt(heel, BRACED);
    const swingNaked = Math.abs(naked.y - level.y);
    const swingBraced = Math.abs(braced.y - offBowAt(0, BRACED).y);
    expect(swingNaked).toBeGreaterThan(0.05);
    expect(swingBraced).toBeLessThan(swingNaked * 0.2);
  });

  it('takes far less of her roll and pitch than the naked eye', () => {
    const heel = 18 * (Math.PI / 180);
    const pitch = 6 * (Math.PI / 180);
    const level = deckAt(0, 0, 1);
    const naked = deckAt(heel, pitch, 1);
    const braced = deckAt(heel, pitch, BRACED);

    const swingNaked = Math.hypot(naked.x - level.x, naked.y - level.y);
    const swingBraced = Math.hypot(braced.x - level.x, braced.y - level.y);
    expect(swingNaked).toBeGreaterThan(0.1);
    // Written out rather than derived from BRACED: the claim is that the
    // view is steady enough to search with, not that one number equals
    // another. A fifth of the naked swing is that claim.
    expect(swingBraced).toBeLessThan(swingNaked * 0.2);
  });

  it('still moves a little -- a braced body, not a tripod', () => {
    // Through her pitch, not her roll: roll turns the view about its own
    // axis, so a mark dead ahead sits on the pivot and hardly moves however
    // hard she rolls. The first draft of this test asked the roll question
    // and measured 1e-4 of screen -- a number that says nothing about the
    // stabilisation and everything about where the mark was put.
    const level = deckAt(0, 0, BRACED);
    const braced = deckAt(0, 6 * (Math.PI / 180), BRACED);
    expect(Math.hypot(braced.x - level.x, braced.y - level.y)).toBeGreaterThan(0.005);
  });

  it('never steadies the heading -- where she points is where you look', () => {
    // The trap this guards: "hold the view" read as "hold the compass" would
    // leave the glasses pointing at a fixed bearing while the boat turned
    // under them, which is not bracing, it is a gyro.
    const cam = camera();
    cam.position.set(0, 2.5, 0);
    cam.quaternion.copy(deckOrientation(0, 0.4, 0, 0, 0, BRACED));
    const turned = onScreen(cam);
    const ahead = deckAt(0, 0, BRACED);
    expect(Math.abs(turned.x - ahead.x)).toBeGreaterThan(0.3);
  });
});
