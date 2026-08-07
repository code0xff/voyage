import type { WeatherKind } from './sim/weather';
import { WEATHER_KINDS } from './sim/weather';
import { knotsToMs, msToKnots } from './sim/units';
import { DEG, compassVec, scale, type Vec2 } from './sim/math';

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
  /** Distance to the windward mark, m. */
  legLength: number;
  laps: number;
  countdown: number;
  sound: boolean;

  /** Hour of day the session starts at, 0..24. */
  startHour: number;
  /** How many simulated minutes pass per real minute. 1 = real time. */
  timeScale: number;
  /** 'auto' lets the weather evolve on its own; anything else pins it. */
  weatherMode: 'auto' | WeatherKind;
  /** How thickly islands are scattered through the ocean, 0..10. Zero is open water. */
  islandCount: number;
  /** Seed for islands and weather, so a session can be reproduced. */
  seed: number;
  /** Roll a new seed at the start of every race. Off pins the world to `seed`. */
  randomWorld: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  windKnots: 12,
  gustiness: 0.45,
  seaScale: 1,
  driftKnots: 0,
  setDeg: 90,
  legLength: 380,
  laps: 2,
  countdown: 45,
  sound: true,
  startHour: 9,
  timeScale: 60,
  weatherMode: 'auto',
  islandCount: 4,
  seed: 20260806,
  randomWorld: true,
};

const KEY = 'voyage.settings.v2';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
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
      legLength: num(o.legLength, DEFAULT_SETTINGS.legLength, 150, 1200),
      laps: Math.round(num(o.laps, DEFAULT_SETTINGS.laps, 1, 5)),
      countdown: Math.round(num(o.countdown, DEFAULT_SETTINGS.countdown, 5, 300)),
      sound: typeof o.sound === 'boolean' ? o.sound : DEFAULT_SETTINGS.sound,
      startHour: num(o.startHour, DEFAULT_SETTINGS.startHour, 0, 24),
      timeScale: num(o.timeScale, DEFAULT_SETTINGS.timeScale, 0, 600),
      weatherMode: mode,
      islandCount: Math.round(num(o.islandCount, DEFAULT_SETTINGS.islandCount, 0, 10)),
      seed: Math.round(num(o.seed, DEFAULT_SETTINGS.seed, 1, 2 ** 31)),
      randomWorld:
        typeof o.randomWorld === 'boolean' ? o.randomWorld : DEFAULT_SETTINGS.randomWorld,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
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
 * The set and drift as the velocity vector the physics wants, world frame.
 *
 * The conversion lives here rather than in `src/sim/` because it is the point
 * where a player-facing pair of numbers becomes a physical quantity, and the
 * compass-to-vector part of it is the one thing about a set that is easy to get
 * backwards: the set is where the water goes, so it is `compassVec(set)` and
 * not its negation.
 */
export const currentVec = (s: Settings): Vec2 =>
  scale(compassVec(s.setDeg * DEG), knotsToMs(s.driftKnots));
