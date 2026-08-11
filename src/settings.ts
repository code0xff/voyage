import type { WeatherKind } from './sim/weather';
import { WEATHER_KINDS } from './sim/weather';
import { knotsToMs, msToKnots } from './sim/units';
import type { Vec2 } from './sim/math';
import { setDriftVec } from './sim/current';
import { TIDE_PERIOD } from './sim/current';
import { venueById, type Venue } from './sim/venues';
import { detectLang, type Lang } from './i18n';
import { regionById, type Region } from './sim/regions';

/**
 * Player settings, persisted to localStorage.
 *
 * Kept separate from the physics constants in config.ts on purpose: those
 * describe *what the boat is*, these describe *what conditions you are sailing
 * in today*. Mixing them would mean the boat's performance changed every time
 * a setting moved, and the polar diagram would stop meaning anything.
 */
export interface Settings {
  /** Mean true wind speed, knots. */
  windKnots: number;
  /** 0 = steady wind, 1 = very gusty and shifty. */
  gustiness: number;
  /** Wave height multiplier. Zero is flat water. */
  seaScale: number;
  /**
   * Tidal drift, knots: how fast the water itself is moving. Zero is slack.
   */
  driftKnots: number;
  /**
   * The set, degrees: the compass direction the water is going *to*.
   *
   * Deliberately the opposite convention to the wind, which is quoted by where
   * it comes from. Both are how they are given at sea, and picking one for
   * consistency would only mean the player had to translate.
   */
  setDeg: number;
  /**
   * Hours in the tidal cycle, or 0 for a stream that never turns.
   *
   * `driftKnots` is then the rate at its full run rather than a constant: it
   * dies to slack about three hours in, runs the other way, and comes back.
   * Zero keeps the steady set this had before, which is what every passage
   * sailed until now was sailed in.
   */
  tideHours: number;
  sound: boolean;

  /** Hour of day the session starts at, 0..24. */
  startHour: number;
  /** How many simulated minutes pass per real minute. 1 = real time. */
  timeScale: number;
  /** 'auto' lets the weather evolve on its own; anything else pins it. */
  weatherMode: 'auto' | WeatherKind;
  /** How thickly islands are scattered through the ocean, 0..10. Zero is open water. */
  islandCount: number;
  /**
   * A named place to sail, or '' for the procedural ocean.
   *
   * Picking one writes its conditions into the settings above rather than
   * overriding them, so the sliders keep showing what is actually being sailed
   * and stay adjustable. Only the things that have no slider -- the land, the
   * wind's direction, how far offshore the slack water reaches -- are read from
   * the venue by the engine.
   */
  venue: string;
  /**
   * A surveyed region to sail, or '' for none.
   *
   * Kept apart from `venue` rather than folded into it. A venue is a sketch in
   * circles that reproduces the decisions a place asks of you; a region is the
   * place, surveyed. They are different claims about how true the land is, and
   * collapsing them into one field would make the honest label impossible.
   */
  region: string;
  /** Seed for islands and weather, so a session can be reproduced. */
  seed: number;
  /** Roll a new seed every time you put to sea. Off pins the world to `seed`. */
  randomWorld: boolean;
  /**
   * Which language the interface is in.
   *
   * A setting rather than a fixed read of the browser's language, because the
   * two are different questions: what your machine is configured as, and what
   * you want to read this in. The browser only supplies the first guess, and
   * only when nothing has been stored yet.
   */
  lang: Lang;
  /**
   * Binocular power, 3 to 12.
   *
   * Kept because it is a preference and not a condition: how far you like to
   * see is about your eyes, not about the sea, so it belongs beside `lang` and
   * `sound` rather than beside the wind. It is set on the wheel while the
   * glasses are up and saved when they come down -- persisting it on every
   * notch would push a settings write through React at wheel speed.
   */
  binocularPower: number;
}

export const DEFAULT_SETTINGS: Settings = {
  windKnots: 12,
  gustiness: 0.45,
  seaScale: 1,
  driftKnots: 0,
  setDeg: 90,
  tideHours: TIDE_PERIOD,
  sound: true,
  startHour: 9,
  timeScale: 60,
  weatherMode: 'auto',
  islandCount: 4,
  venue: '',
  region: '',
  seed: 20260806,
  randomWorld: true,
  // Overwritten by `loadSettings` on a first run, which asks the browser.
  lang: 'en',
  binocularPower: 5,
};

const KEY = 'voyage.settings.v2';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, lang: detectLang() };
    const o = JSON.parse(raw) as Partial<Settings>;
    // Stored values are not trusted. A version bump or a hand-edited entry must
    // never be able to break the game.
    const num = (v: unknown, d: number, lo: number, hi: number): number =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : d;
    const mode =
      o.weatherMode === 'auto' || (o.weatherMode && WEATHER_KINDS.includes(o.weatherMode))
        ? o.weatherMode
        : DEFAULT_SETTINGS.weatherMode;
    return {
      windKnots: num(o.windKnots, DEFAULT_SETTINGS.windKnots, 3, 40),
      gustiness: num(o.gustiness, DEFAULT_SETTINGS.gustiness, 0, 1),
      seaScale: num(o.seaScale, DEFAULT_SETTINGS.seaScale, 0, 2),
      driftKnots: num(o.driftKnots, DEFAULT_SETTINGS.driftKnots, 0, 4),
      setDeg: num(o.setDeg, DEFAULT_SETTINGS.setDeg, 0, 359),
      tideHours: num(o.tideHours, DEFAULT_SETTINGS.tideHours, 0, 24),
      sound: typeof o.sound === 'boolean' ? o.sound : DEFAULT_SETTINGS.sound,
      startHour: num(o.startHour, DEFAULT_SETTINGS.startHour, 0, 24),
      timeScale: num(o.timeScale, DEFAULT_SETTINGS.timeScale, 0, 600),
      weatherMode: mode,
      islandCount: Math.round(num(o.islandCount, DEFAULT_SETTINGS.islandCount, 0, 10)),
      // Checked against the list rather than trusted: a venue removed or
      // renamed between versions must fall back to open water, not strand the
      // player in a world the engine cannot build.
      venue: typeof o.venue === 'string' && venueById(o.venue) ? o.venue : DEFAULT_SETTINGS.venue,
      // Checked against the list for the same reason as the venue: a stored id
      // for a region that no longer ships must not strand the player in a world
      // with no land the engine can load.
      region:
        typeof o.region === 'string' && regionById(o.region)
          ? o.region
          : DEFAULT_SETTINGS.region,
      seed: Math.round(num(o.seed, DEFAULT_SETTINGS.seed, 1, 2 ** 31)),
      randomWorld:
        typeof o.randomWorld === 'boolean' ? o.randomWorld : DEFAULT_SETTINGS.randomWorld,
      // Falls back to the browser rather than to English: a stored file written
      // before this setting existed should still open in the reader's language.
      lang: o.lang === 'en' || o.lang === 'ko' ? o.lang : detectLang(),
      // Clamped to the same range the wheel allows, so a hand-edited file
      // cannot open the game at a power the control could never reach.
      binocularPower: num(o.binocularPower, DEFAULT_SETTINGS.binocularPower, 3, 12),
    };
  } catch {
    return { ...DEFAULT_SETTINGS, lang: detectLang() };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private browsing and similar. Settings simply do not persist.
  }
}

export const windMs = (s: Settings): number => knotsToMs(s.windKnots);
export const windKn = (ms: number): number => msToKnots(ms);

/**
 * The player's set and drift as the velocity vector the physics wants.
 *
 * The conversion itself lives in `src/sim/current.ts`, with the model that uses
 * it, because venues need it too and a second copy would be a compass-to-vector
 * sign only one caller exercised.
 */
export const currentVec = (s: Settings): Vec2 => setDriftVec(s.setDeg, s.driftKnots);

/**
 * Settings for sailing a venue: its conditions written into the player's own,
 * rather than held apart and overriding them.
 *
 * One source of truth is the point. Kept separate, the wind slider would read
 * 12 knots while the boat sailed in 20, and the player would be adjusting a
 * number nothing was listening to.
 */
export const withVenue = (s: Settings, v: Venue): Settings => ({
  ...s,
  venue: v.id,
  windKnots: Math.round(v.windKnots),
  gustiness: v.gustiness,
  seaScale: v.seaScale,
  driftKnots: v.driftKnots,
  setDeg: v.setDeg,
  startHour: v.startHour,
  // A venue brings its own land, so the procedural ocean has to stand down.
  islandCount: 0,
});

/** Back to the open ocean, with a plausible sea rather than whatever the venue had. */
export const withoutVenue = (s: Settings): Settings => ({
  ...s,
  venue: '',
  driftKnots: 0,
  islandCount: DEFAULT_SETTINGS.islandCount,
});

/**
 * Settings for sailing a region: its conditions written into the player's own.
 *
 * Written in rather than overridden, exactly as `withVenue` does and for the
 * same reason -- every slider then keeps showing what is actually being sailed
 * and stays live, instead of displaying one thing while the world does another.
 *
 * The land is not among them. A region brings a surveyed coast and no islands,
 * and the two cannot coexist: the island slider stands down.
 */
export function withRegion(s: Settings, r: Region): Settings {
  return {
    ...s,
    region: r.id,
    venue: '',
    islandCount: 0,
    windKnots: r.conditions.windKnots,
    gustiness: r.conditions.gustiness,
    seaScale: r.conditions.seaScale,
    setDeg: r.conditions.setDeg,
    driftKnots: r.conditions.driftKnots,
    startHour: r.conditions.startHour,
  };
}

/** Leaving a region for the open ocean. Conditions stay as they were left. */
export const withoutRegion = (s: Settings): Settings => ({ ...s, region: '' });
