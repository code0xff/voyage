/**
 * Mouse and touch orbit around the boat.
 *
 * This only ever produces three numbers -- azimuth, elevation and a distance
 * multiplier -- which the scene applies to the chase camera. Nothing here
 * touches the boat, so the helm keeps working while the view is being dragged.
 *
 * The offsets are relative to the boat's heading, not to the world. A view set
 * off the port quarter stays off the port quarter through a tack; an absolute
 * azimuth would swing the camera across the boat every time she turns, which is
 * exactly the moment you want the view to hold still.
 */

import { clamp } from '../sim/math';

export interface OrbitControl {
  /** Azimuth away from dead astern, radians. Positive swings the eye to port. */
  readonly yaw: number;
  /** Elevation of the eye above the boat's horizontal, radians. */
  readonly pitch: number;
  /** Distance multiplier applied to the default chase range. */
  readonly zoom: number;
  /** Binocular power, when the wheel is pointed at it. */
  readonly magnify: number;
  /**
   * What the wheel turns.
   *
   * There is only one wheel and two things worth turning with it, and they are
   * never both live: the eye's distance means nothing on deck, where the eye is
   * fixed to the boat, and the glasses only exist there. So the wheel follows
   * the view rather than needing a second gesture, and it keeps the meaning it
   * already had -- away from you for more of the scene, towards you for less.
   */
  setWheelTarget(target: 'distance' | 'magnify'): void;
  /** Restore a stored power, so the glasses open where they were last left. */
  setMagnify(power: number): void;
  /** True while the eye is dragged or pinched, so the scene can stop smoothing it. */
  readonly dragging: boolean;
  /**
   * Change what `pitch` is allowed to be, and pull the current value into it.
   *
   * What pitch *means* is the camera mode's business, and the modes disagree.
   * Orbiting the boat it is the elevation of the eye above her, which is only
   * ever positive -- looking up from underneath is not a view of anything.
   * Standing on deck it is where the head is looking, which has to reach the
   * masthead as well as the water alongside, so it runs either side of zero.
   */
  setPitchLimits(min: number, max: number, rest: number): void;
  /**
   * Level the view to a mode's resting pitch, leaving the bearing alone.
   *
   * Distinct from reset() on purpose. Cycling the camera is starting a new
   * view and should face forward; raising binoculars is not -- you looked at
   * something first, and that is the whole reason the glasses came up.
   */
  levelPitch(rest: number): void;
  reset(): void;
  dispose(): void;
}

/** Matches the framing the fixed chase camera used before orbiting existed. */
const DEFAULT_PITCH = 0.3;
/** Low enough to sight along the wave tops, high enough not to swim. */
const MIN_PITCH = 0.02;
/** Short of straight down, where azimuth stops meaning anything. */
const MAX_PITCH = 1.45;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3.5;

/**
 * Binocular power: where it starts, and how far it goes either way.
 *
 * Five is what this arrived at by being looked through, and it is a compromise
 * rather than an answer -- seven is what a real cruising pair gives you and
 * leaves under eight degrees to find anything in from a pitching deck. Which
 * side of that trade a given player wants is not something the code can know,
 * so the wheel decides it. Three is a wide sweep for finding the blow; twelve
 * is a bird on the water, for anyone willing to hold it steady.
 */
const DEFAULT_MAGNIFY = 5;
export const MIN_MAGNIFY = 3;
export const MAX_MAGNIFY = 12;

// Roughly a full turn per screen width, which is what every other orbit control
// does and therefore what the hand expects.
const YAW_PER_PX = 0.006;
const PITCH_PER_PX = 0.004;
const ZOOM_PER_LINE = 0.0012;

/**
 * What a drag does to the look-around, before any limits are applied.
 *
 * Separated from the pointer handling so the one rule below can be asserted
 * without a DOM -- and, more to the point, asserted *through the code that
 * implements it* rather than against a second copy of the rule written in a
 * test. See `eye.test.ts`, which drives this and then the camera poses it
 * feeds, and fails on either sign.
 *
 * One rule, both axes: **the eye follows the hand.**
 *
 * Drag right and you look right; drag down and you look down. The sea goes the
 * other way, because turning your head is what moves it.
 *
 * Both conventions are in wide use and the choice was not obvious. A drag with
 * a `grab` cursor usually means the other one -- push the world about like a
 * map, which is what the chart in MinimapCard does and should keep doing,
 * because a chart *is* a map. This is not a map. It is where a helmsman is
 * looking, and the thing being dragged is a head: you turn it towards what you
 * want to see, which is the same gesture as pointing binoculars at a blow.
 *
 * Written down because it was got wrong once in each direction. The four
 * combinations of two eyes and two axes had drifted into four different
 * conventions; unifying them picked map-style, which fixed the disagreement
 * and left the horizontal opposite to what the one person using it had already
 * said felt right. Both signs are positive here, and both consumers in eye.ts
 * subtract -- that pairing is what makes the two eyes agree.
 */
export function dragTo(
  yaw: number,
  pitch: number,
  dx: number,
  dy: number,
): { yaw: number; pitch: number } {
  return { yaw: yaw + dx * YAW_PER_PX, pitch: pitch + dy * PITCH_PER_PX };
}

/**
 * What a pinch does to the wheel's target, before any limits are applied.
 *
 * `ratio` is the gap between the two fingers now over what it was at the last
 * move. One rule: **the scene follows the fingers.** Spread them and it grows,
 * which is a shorter eye distance or more binocular power -- the same hand
 * meaning that the wheel encodes, and encoded oppositely by the two numbers
 * for the same reason the wheel inverts them (see onWheel).
 *
 * A ratio rather than a difference, so the gesture composes: two small
 * spreads land where one big one does, and doubling the gap means the same
 * fraction of the range at any zoom. It also makes the mapping literal for
 * the distance target -- fingers twice as far apart, scene twice as large --
 * which is what every photo viewer has taught the hand to expect.
 *
 * Separated from the pointer handling for the same reason as `dragTo`: it is
 * two signs, and signs are what this project gets wrong. See eye.test.ts.
 */
export function pinchTo(
  zoom: number,
  magnify: number,
  ratio: number,
  target: 'distance' | 'magnify',
): { zoom: number; magnify: number } {
  return target === 'magnify'
    ? { zoom, magnify: magnify * ratio }
    : { zoom: zoom / ratio, magnify };
}

export function createOrbit(canvas: HTMLCanvasElement): OrbitControl {
  let yaw = 0;
  let pitch = DEFAULT_PITCH;
  let minPitch = MIN_PITCH;
  let maxPitch = MAX_PITCH;
  /** Where a reset puts the pitch. Level on deck, over the boat from astern. */
  let restPitch = DEFAULT_PITCH;
  let zoom = 1;
  let magnify = DEFAULT_MAGNIFY;
  let wheelTarget: 'distance' | 'magnify' = 'distance';

  /** Every pointer currently down on the canvas, by id. Two of them is a pinch. */
  const pointers = new Map<number, { x: number; y: number }>();
  let dragging = -1; // pointerId of the one-finger look-around, or -1
  let lastX = 0;
  let lastY = 0;
  /** Gap between the two fingers at the last pinch move, px. */
  let pinchSpan = 0;

  const span = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // A third finger has no meaning here, and folding it into the pair would
    // jolt the span. Ignored entirely rather than tracked and unused.
    if (pointers.size >= 2) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 1) {
      dragging = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.style.cursor = 'grabbing';
    } else {
      // A second finger turns the drag into a pinch. The look-around stops:
      // two fingers move for the gap between them, not to steer the eye, and
      // letting the first finger keep steering would swing the view with
      // every pinch.
      dragging = -1;
      pinchSpan = span();
    }
    // Stops the drag turning into a text selection over the UI panels.
    e.preventDefault();
  };

  const onMove = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2) {
      const d = span();
      // Both guards are the degenerate pinch: fingers landing or crossing on
      // the same point, where a ratio is 0/0 and means nothing.
      if (pinchSpan > 0 && d > 0) {
        const next = pinchTo(zoom, magnify, d / pinchSpan, wheelTarget);
        zoom = clamp(next.zoom, MIN_ZOOM, MAX_ZOOM);
        magnify = clamp(next.magnify, MIN_MAGNIFY, MAX_MAGNIFY);
      }
      pinchSpan = d;
      return;
    }
    if (e.pointerId !== dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    // The rule itself is in dragTo, so that it can be tested.
    const next = dragTo(yaw, pitch, dx, dy);
    yaw = next.yaw;
    pitch = clamp(next.pitch, minPitch, maxPitch);
  };

  const endDrag = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    const rest = [...pointers.entries()];
    if (rest.length === 1) {
      // The pinch is over but a finger is still down: it goes back to
      // steering, re-anchored where it now is so the view does not jump by
      // the distance it travelled while it was half of the pinch.
      const [id, p] = rest[0];
      dragging = id;
      lastX = p.x;
      lastY = p.y;
    } else {
      dragging = -1;
      canvas.style.cursor = 'grab';
    }
  };

  const onCancel = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    // Unlike endDrag, nothing is promoted to steering here. A cancel is the
    // browser taking the gesture -- a system edge swipe, the page losing the
    // pointers -- not a finger choosing to lift, and a camera that starts
    // turning under a finger the user thinks the browser owns is worse than
    // one that waits for a fresh touch. A survivor of a half-cancelled pinch
    // stays tracked but strands until it goes down again.
    dragging = -1;
    if (pointers.size === 0) canvas.style.cursor = 'grab';
  };

  const onWheel = (e: WheelEvent) => {
    // deltaMode 1 is lines and 2 is pages; both come in far smaller numbers
    // than pixels, and untreated a line-mode mouse would barely zoom at all.
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const step = Math.exp(e.deltaY * scale * ZOOM_PER_LINE);
    if (wheelTarget === 'magnify') {
      // Inverted against the distance, because the two mean the same thing to
      // the hand and opposite things to the number: pushing the wheel away
      // brings the scene closer, which is a smaller eye distance and a larger
      // power. Multiplied rather than added, so a notch is the same fraction
      // at three power as at twelve.
      magnify = clamp(magnify / step, MIN_MAGNIFY, MAX_MAGNIFY);
    } else {
      zoom = clamp(zoom * step, MIN_ZOOM, MAX_ZOOM);
    }
    e.preventDefault(); // otherwise the page scrolls behind the canvas
  };

  const onDouble = () => {
    yaw = 0;
    // The mode's resting pitch, not the orbit's: on deck that is zero, which is
    // level with the horizon, and the orbit default would open the view
    // staring into the sky.
    pitch = clamp(restPitch, minPitch, maxPitch);
    zoom = 1;
  };

  canvas.style.cursor = 'grab';
  // Without this a touch drag scrolls the page instead of moving the camera,
  // and the pointermove stream stops the moment the browser starts panning.
  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDouble);

  return {
    get yaw() {
      return yaw;
    },
    get pitch() {
      return pitch;
    },
    get zoom() {
      return zoom;
    },
    get magnify() {
      return magnify;
    },
    setWheelTarget(target) {
      wheelTarget = target;
    },
    setMagnify(power) {
      // Clamped here as well as on load, because this is the only door: a
      // stored value, a hand-edited file and the wheel all end up at the same
      // number through it.
      magnify = clamp(power, MIN_MAGNIFY, MAX_MAGNIFY);
    },
    get dragging() {
      // A pinch counts: the fingers are placing the eye's distance, and the
      // smoothing that steadies an idle camera would read as lag under them.
      return dragging !== -1 || pointers.size === 2;
    },
    setPitchLimits(min, max, rest) {
      minPitch = min;
      maxPitch = max;
      restPitch = rest;
      pitch = clamp(pitch, min, max);
    },
    levelPitch(rest) {
      pitch = clamp(rest, minPitch, maxPitch);
    },
    reset: onDouble,
    dispose() {
      // Captures outlive listeners: a finger still down when the scene is
      // torn down would hold the canvas captured with nobody left listening,
      // and a canvas that is reused would start its next life deaf to that
      // pointer until the browser got around to an implicit release.
      for (const id of pointers.keys()) {
        if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
      }
      pointers.clear();
      dragging = -1;
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDouble);
      canvas.style.cursor = '';
      canvas.style.touchAction = '';
    },
  };
}
