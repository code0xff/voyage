import { knotsToMs, msToKnots } from './sim/units';

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
  /** Distance to the windward mark, m. */
  legLength: number;
  laps: number;
  countdown: number;
  sound: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  windKnots: 12,
  gustiness: 0.45,
  seaScale: 1,
  legLength: 380,
  laps: 2,
  countdown: 45,
  sound: true,
};

const KEY = 'voyage.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const o = JSON.parse(raw) as Partial<Settings>;
    // Stored values are not trusted. A version bump or a hand-edited entry must
    // never be able to break the game.
    const num = (v: unknown, d: number, lo: number, hi: number): number =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : d;
    return {
      windKnots: num(o.windKnots, DEFAULT_SETTINGS.windKnots, 3, 40),
      gustiness: num(o.gustiness, DEFAULT_SETTINGS.gustiness, 0, 1),
      seaScale: num(o.seaScale, DEFAULT_SETTINGS.seaScale, 0, 2),
      legLength: num(o.legLength, DEFAULT_SETTINGS.legLength, 150, 1200),
      laps: Math.round(num(o.laps, DEFAULT_SETTINGS.laps, 1, 5)),
      countdown: Math.round(num(o.countdown, DEFAULT_SETTINGS.countdown, 5, 300)),
      sound: typeof o.sound === 'boolean' ? o.sound : DEFAULT_SETTINGS.sound,
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
