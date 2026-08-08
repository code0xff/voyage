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
 * Seconds as a span of time a passage is measured in.
 *
 * This used to be `m:ss.t`, which was a race clock -- the right thing to read
 * when the whole event was four minutes long and a tenth of a second decided
 * it. The race is gone and every caller now measures a passage, where that
 * format is wrong twice over: it never carries hours, so two and a quarter
 * hours read as `135:00.0`, and it offers a tenth of a second of precision on
 * a number whose real uncertainty is minutes.
 *
 * So the unit steps with the span, as a chartplotter's does. Under a minute is
 * counted in seconds, because the last of an approach is the one time seconds
 * are what you want; above that the seconds are dropped, because a passage that
 * took `41m` did not take `41m 12s` in any sense the reader cares about.
 *
 * Rounds down rather than to nearest: an ETA that has not got there yet must
 * not read as arrived, and a passage must not claim a minute it did not sail.
 *
 * Which is why the last second is `<1s` and not `0s`. Rounding down alone broke
 * the promise at the one boundary where it is a statement about the world and
 * not about tidiness: half a second still to run is not an arrival, and `0s`
 * says it is. Only a span of exactly zero gets to read as zero.
 */
export function formatDuration(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(seconds);
  const s = Math.floor(abs);
  // `abs > 0` rather than `seconds !== 0`, so that a negative zero -- which is
  // less than nothing to every reader but `<` -- reads as plain `0s`.
  if (s === 0) return abs > 0 ? `${sign}<1s` : '0s';
  if (s < 60) return `${sign}${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${sign}${m}m`;
  return `${sign}${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * Metres as a person reads them: metres below a kilometre, kilometres above.
 *
 * Here with formatDuration and for the same reason. The chart's distance run,
 * the logbook's distance sailed and the passage bar's distance to run are the
 * same quantity written the same way, and they had a copy of this line each to
 * write it with.
 */
export function formatDistance(metres: number): string {
  return metres < 1000 ? `${metres.toFixed(0)} m` : `${(metres / 1000).toFixed(2)} km`;
}

/**
 * When something happened, in the reader's own locale and time zone.
 *
 * For `PassageRecord.startedAt`, which is real time rather than world time --
 * the one date in this project a person reads. No year: a logbook is read as
 * "when did I last go out", and every entry in it carrying 2026 is noise until
 * the day one of them does not, which is a problem to have.
 *
 * Here rather than in whichever panel needed it first because two of them do,
 * and a date the front page and the logbook wrote differently would read as two
 * different facts. `toLocaleString` is ECMA-402 and not a browser API, so this
 * does not breach the rule about what `src/sim` may touch -- it resolves the
 * same way under `tsx` as it does in the browser.
 *
 * The locale is passed in rather than left to the browser, because the two can
 * disagree: someone reading the interface in Korean on an English machine was
 * getting an English month in an otherwise Korean panel. This still does not
 * know what languages exist -- it forwards a tag it is handed.
 */
export function formatWhen(msSinceEpoch: number, locale?: string): string {
  return new Date(msSinceEpoch).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
