import { DEG, clamp, lerp } from './math';

/**
 * Time of day.
 *
 * The sun is not modelled astronomically. What matters for sailing is only how
 * high it is and roughly where, because that drives the two things the player
 * actually reacts to: how much light there is, and where the glare sits on the
 * water. A real ephemeris would add nothing a helmsman would notice.
 *
 * Everything here is a pure function of the hour, so the renderer, the water
 * shader and the HUD can all ask independently and never disagree.
 */

export type Rgb = readonly [number, number, number];

export interface SkyState {
  /** Hour of day, 0..24. */
  hour: number;
  /** Sun elevation above the horizon, rad. Negative at night. */
  sunElevation: number;
  /** Sun bearing, compass rad. */
  sunAzimuth: number;
  /** 0 at night, 1 in full daylight. Everything visual scales off this. */
  daylight: number;
  /** 1 while the sun is near the horizon: the warm, low, long-shadow look. */
  goldenness: number;
  /** Sun direction in render coordinates (x east, y up, z south). */
  sunDir: readonly [number, number, number];

  skyTop: Rgb;
  skyHorizon: Rgb;
  sunColor: Rgb;
  ambientColor: Rgb;
  waterDeep: Rgb;
  waterShallow: Rgb;
  fogColor: Rgb;

  sunIntensity: number;
  ambientIntensity: number;
}

const SUNRISE = 6;
const SUNSET = 19;
/** Peak elevation at local noon. Mid-latitude summer-ish. */
const MAX_ELEVATION = 62 * DEG;

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

/** Palette keyframes, keyed on sun elevation. */
const NIGHT = {
  skyTop: [0.016, 0.026, 0.05] as Rgb,
  skyHorizon: [0.05, 0.075, 0.115] as Rgb,
  sun: [0.34, 0.42, 0.62] as Rgb, // moonlight
  ambient: [0.07, 0.1, 0.17] as Rgb,
  deep: [0.012, 0.022, 0.04] as Rgb,
  shallow: [0.05, 0.09, 0.14] as Rgb,
  fog: [0.03, 0.045, 0.075] as Rgb,
};

const TWILIGHT = {
  skyTop: [0.09, 0.11, 0.22] as Rgb,
  skyHorizon: [0.62, 0.31, 0.22] as Rgb,
  sun: [1.0, 0.55, 0.3] as Rgb,
  ambient: [0.2, 0.19, 0.27] as Rgb,
  // Water stays cool at twilight; the warmth belongs to the sky and reaches the
  // sea through the Fresnel reflection, not through the water's own colour.
  // Tinting the water itself turns the whole surface to mud.
  deep: [0.035, 0.05, 0.08] as Rgb,
  shallow: [0.14, 0.16, 0.22] as Rgb,
  fog: [0.3, 0.22, 0.23] as Rgb,
};

const GOLDEN = {
  skyTop: [0.24, 0.38, 0.6] as Rgb,
  skyHorizon: [0.85, 0.66, 0.44] as Rgb,
  sun: [1.0, 0.85, 0.66] as Rgb,
  ambient: [0.42, 0.44, 0.5] as Rgb,
  deep: [0.05, 0.1, 0.16] as Rgb,
  shallow: [0.27, 0.37, 0.46] as Rgb,
  fog: [0.5, 0.49, 0.5] as Rgb,
};

const DAY = {
  skyTop: [0.24, 0.44, 0.72] as Rgb,
  skyHorizon: [0.62, 0.73, 0.85] as Rgb,
  sun: [1.0, 0.98, 0.94] as Rgb,
  ambient: [0.55, 0.63, 0.74] as Rgb,
  deep: [0.05, 0.11, 0.19] as Rgb,
  shallow: [0.24, 0.45, 0.58] as Rgb,
  fog: [0.53, 0.63, 0.73] as Rgb,
};

/** Wrap an hour into 0..24. */
export const wrapHour = (h: number): number => ((h % 24) + 24) % 24;

export function skyState(hourRaw: number): SkyState {
  const hour = wrapHour(hourRaw);

  // Elevation follows a sine between sunrise and sunset, and dips below the
  // horizon at night. Not accurate, but monotonic and smooth, which is all the
  // lighting needs.
  const dayLength = SUNSET - SUNRISE;
  const t = (hour - SUNRISE) / dayLength; // 0 at sunrise, 1 at sunset
  const sunElevation =
    t >= 0 && t <= 1
      ? Math.sin(t * Math.PI) * MAX_ELEVATION
      : // Night: sink to a floor and come back, so twilight fades smoothly.
        -Math.sin((wrapHour(hour - SUNSET) / (24 - dayLength)) * Math.PI) * 30 * DEG;

  // Sweeps east -> south -> west across the day.
  const sunAzimuth = (90 + clamp(t, -0.4, 1.4) * 180) * DEG;

  const e = sunElevation;
  let p: typeof DAY;
  if (e < -6 * DEG) {
    p = NIGHT;
  } else if (e < 2 * DEG) {
    // Civil twilight: the sky is on fire near the horizon.
    const k = (e + 6 * DEG) / (8 * DEG);
    p = blend(NIGHT, TWILIGHT, k);
  } else if (e < 18 * DEG) {
    const k = (e - 2 * DEG) / (16 * DEG);
    p = blend(TWILIGHT, GOLDEN, k);
  } else {
    const k = clamp((e - 18 * DEG) / (26 * DEG), 0, 1);
    p = blend(GOLDEN, DAY, k);
  }

  const daylight = clamp((e + 8 * DEG) / (24 * DEG), 0, 1);
  const goldenness = e > 0 ? clamp(1 - e / (22 * DEG), 0, 1) : clamp(1 + e / (8 * DEG), 0, 1);

  // Render coordinates: x east, y up, z south. Azimuth is a compass bearing.
  const ce = Math.cos(Math.max(e, -0.25));
  const se = Math.sin(Math.max(e, -0.25));
  const sunDir: readonly [number, number, number] = [
    Math.sin(sunAzimuth) * ce,
    se,
    -Math.cos(sunAzimuth) * ce,
  ];

  return {
    hour,
    sunElevation,
    sunAzimuth,
    daylight,
    goldenness,
    sunDir,
    skyTop: p.skyTop,
    skyHorizon: p.skyHorizon,
    sunColor: p.sun,
    ambientColor: p.ambient,
    waterDeep: p.deep,
    waterShallow: p.shallow,
    fogColor: p.fog,
    // Moonlight is never zero: pitch black is unplayable, and a real night at
    // sea under a moon is genuinely navigable.
    sunIntensity: lerp(0.22, 2.1, daylight),
    ambientIntensity: lerp(0.5, 2.2, daylight),
  };
}

function blend(a: typeof DAY, b: typeof DAY, k: number): typeof DAY {
  const t = clamp(k, 0, 1);
  return {
    skyTop: mix(a.skyTop, b.skyTop, t),
    skyHorizon: mix(a.skyHorizon, b.skyHorizon, t),
    sun: mix(a.sun, b.sun, t),
    ambient: mix(a.ambient, b.ambient, t),
    deep: mix(a.deep, b.deep, t),
    shallow: mix(a.shallow, b.shallow, t),
    fog: mix(a.fog, b.fog, t),
  };
}

/** Label for the HUD. */
export function phaseName(sky: SkyState): string {
  const e = sky.sunElevation;
  if (e < -6 * DEG) return 'Night';
  if (e < 0) return sky.hour < 12 ? 'Dawn' : 'Dusk';
  if (e < 12 * DEG) return sky.hour < 12 ? 'Sunrise' : 'Sunset';
  if (e < 30 * DEG) return sky.hour < 12 ? 'Morning' : 'Afternoon';
  return 'Midday';
}

export function formatClock(hour: number): string {
  const h = wrapHour(hour);
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
