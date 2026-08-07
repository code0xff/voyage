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

/**
 * Seconds as a clock: minutes, seconds and a tenth.
 *
 * Here with the other conversions between what the physics holds and what a
 * person reads, rather than in whichever feature happened to need it first --
 * a duration is a duration whether it is a race, a passage or an ETA.
 */
export function formatTime(seconds: number): string {
  const neg = seconds < 0;
  const s = Math.abs(seconds);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${neg ? '-' : ''}${m}:${r.toFixed(1).padStart(4, '0')}`;
}

/**
 * Metres as a person reads them: metres below a kilometre, kilometres above.
 *
 * Here with formatTime and for the same reason. The chart's distance run and
 * the logbook's distance sailed are the same quantity written the same way, and
 * they had a copy of this line each to write it with.
 */
export function formatDistance(metres: number): string {
  return metres < 1000 ? `${metres.toFixed(0)} m` : `${(metres / 1000).toFixed(2)} km`;
}
