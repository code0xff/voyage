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

export interface OrbitControl {
  /** Azimuth away from dead astern, radians. Positive swings the eye to port. */
  readonly yaw: number;
  /** Elevation of the eye above the boat's horizontal, radians. */
  readonly pitch: number;
  /** Distance multiplier applied to the default chase range. */
  readonly zoom: number;
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

// Roughly a full turn per screen width, which is what every other orbit control
// does and therefore what the hand expects.
const YAW_PER_PX = 0.006;
const PITCH_PER_PX = 0.004;
const ZOOM_PER_LINE = 0.0012;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createOrbit(canvas: HTMLCanvasElement): OrbitControl {
  let yaw = 0;
  let pitch = DEFAULT_PITCH;
  let minPitch = MIN_PITCH;
  let maxPitch = MAX_PITCH;
  /** Where a reset puts the pitch. Level on deck, over the boat from astern. */
  let restPitch = DEFAULT_PITCH;
  let zoom = 1;

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

    /*
     * One rule, both axes: **the scene follows the hand.**
     *
     * Drag right and the sea slides right; drag down and it slides down, as
     * though the view were being pulled about by a corner. That is what the
     * `grab` cursor on this canvas promises, it is what every map and 3D
     * viewer does, and it is what a first-person panorama does too -- Street
     * View pans this way, and nobody reads it as inverted.
     *
     * Both signs are negative because both eyes are *cameras*: to slide the
     * scene one way the camera has to go the other. Getting one of these two
     * signs right and the other wrong is what this used to do, and it is why
     * the two axes disagreed. The consumers in scene.ts have to hold up their
     * end -- see the note there on the deck eye.
     */
    yaw -= dx * YAW_PER_PX;
    pitch = clamp(pitch - dy * PITCH_PER_PX, minPitch, maxPitch);
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
    zoom = clamp(zoom * Math.exp(e.deltaY * scale * ZOOM_PER_LINE), MIN_ZOOM, MAX_ZOOM);
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
