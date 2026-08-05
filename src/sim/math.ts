/**
 * Coordinate conventions, used consistently across the whole physics core.
 *
 *   World:   x = East, y = North  (a 2D plane)
 *   Bearing: compass convention. 0 = North, clockwise positive.
 *            The unit vector for angle a is (sin a, cos a)
 *   Hull:    x_b = forward (surge, u), y_b = starboard (sway, v)
 *   Yaw rate r: positive = bow swinging to starboard (clockwise)
 *
 * One-line summary of the sign rules: **positive means starboard**.
 * So an apparent wind angle above zero means the wind comes over the
 * starboard side.
 */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);

export function norm(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Compass bearing to unit vector. */
export const compassVec = (a: number): Vec2 => ({ x: Math.sin(a), y: Math.cos(a) });

/** Vector to compass bearing. */
export const compassAngle = (v: Vec2): number => Math.atan2(v.x, v.y);

/** Rotate 90 degrees clockwise (i.e. +90 in compass terms). */
export const rotCW90 = (v: Vec2): Vec2 => ({ x: v.y, y: -v.x });

/** Rotate 90 degrees counter-clockwise. */
export const rotCCW90 = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x });

/** Wrap an angle into (-PI, PI]. */
export function wrapPi(a: number): number {
  let r = (a + Math.PI) % (2 * Math.PI);
  if (r < 0) r += 2 * Math.PI;
  return r - Math.PI;
}

/** Wrap an angle into [0, 2PI). */
export function wrap2Pi(a: number): number {
  const r = a % (2 * Math.PI);
  return r < 0 ? r + 2 * Math.PI : r;
}

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Sign function that treats zero as positive, for picking a tack or a side. */
export const side = (v: number): number => (v < 0 ? -1 : 1);

/** First-order lag with time constant tau. Frame-rate independent. */
export const approach = (current: number, target: number, tau: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-dt / Math.max(tau, 1e-6)));
