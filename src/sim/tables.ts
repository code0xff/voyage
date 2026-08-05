/**
 * Foil coefficient tables.
 *
 * These are tables with linear interpolation rather than closed-form curves,
 * because:
 *  - tuning becomes "edit a few numbers" instead of re-deriving a formula
 *  - measured polar or wind-tunnel data can be dropped straight in
 *  - post-stall behaviour does not have to be forced into an analytic shape
 *
 * x is angle of attack in degrees, ascending. Values outside the range clamp
 * to the end points.
 */

export interface Table {
  x: number[];
  y: number[];
}

export function sample(t: Table, x: number): number {
  const { x: xs, y: ys } = t;
  if (x <= xs[0]) return ys[0];
  const n = xs.length;
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = 1;
  while (i < n - 1 && xs[i] < x) i++;
  const t0 = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + (ys[i] - ys[i - 1]) * t0;
}

/**
 * Soft sail (deeply cambered cloth). Higher peak lift than a thin aerofoil and
 * a much gentler stall. At 90 degrees -- running dead downwind -- it is a flat
 * plate: no lift, drag around 1.4.
 */
export const SAIL_CL: Table = {
  x: [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90],
  y: [0, 0.65, 1.15, 1.55, 1.75, 1.72, 1.6, 1.32, 1.1, 0.88, 0.62, 0.33, 0],
};

export const SAIL_CD: Table = {
  x: [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90],
  y: [0.05, 0.06, 0.09, 0.13, 0.17, 0.23, 0.3, 0.5, 0.72, 0.95, 1.15, 1.3, 1.4],
};

/**
 * Keel and rudder: high-aspect rigid foils, so they stall far earlier than a
 * sail (around 15 degrees). That stall is what makes "too much rudder actually
 * turns you less" fall out of the model for free.
 */
export const FOIL_CL: Table = {
  x: [0, 4, 8, 12, 15, 18, 25, 35, 50, 70, 90],
  y: [0, 0.36, 0.72, 1.0, 1.08, 0.85, 0.72, 0.75, 0.72, 0.5, 0],
};

export const FOIL_CD: Table = {
  x: [0, 4, 8, 12, 15, 18, 25, 35, 50, 70, 90],
  y: [0.01, 0.014, 0.028, 0.05, 0.07, 0.14, 0.3, 0.55, 0.9, 1.2, 1.32],
};
