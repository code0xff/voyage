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
  /** True while the eye is being dragged, so the scene can stop smoothing it. */
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
const MIN_MAGNIFY = 3;
const MAX_MAGNIFY = 12;

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

  let dragging = -1; // pointerId, or -1
  let lastX = 0;
  let lastY = 0;

  const onDown = (e: PointerEvent) => {
    if (dragging !== -1 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    dragging = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    // Stops the drag turning into a text selection over the UI panels.
    e.preventDefault();
  };

  const onMove = (e: PointerEvent) => {
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
    if (e.pointerId !== dragging) return;
    dragging = -1;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    canvas.style.cursor = 'grab';
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
  canvas.addEventListener('pointercancel', endDrag);
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
    get dragging() {
      return dragging !== -1;
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
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDouble);
      canvas.style.cursor = '';
      canvas.style.touchAction = '';
    },
  };
}
