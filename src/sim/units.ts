/** Unit conversions. The core computes in SI (m, s, kg, rad); convert only for display. */

export const KNOT = 0.514444; // m/s

export const msToKnots = (v: number): number => v / KNOT;
export const knotsToMs = (v: number): number => v * KNOT;

/**
 * Theoretical hull speed: the speed at which wave-making resistance starts to
 * climb steeply. It is the phase speed of a deep-water wave whose length
 * equals the waterline: sqrt(g*L / 2pi) ~= 1.25 * sqrt(L).
 */
export const hullSpeed = (lwl: number): number => Math.sqrt((9.81 * lwl) / (2 * Math.PI));
