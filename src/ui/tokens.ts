/**
 * Bridge between the design tokens and the canvas drawings.
 *
 * The polar plot and the telemetry graph are canvases, so they cannot use
 * Tailwind classes. Reading the same CSS custom properties keeps them in step
 * with the rest of the UI instead of drifting into a second, hard-coded palette
 * that has to be updated by hand whenever the theme changes.
 */

const cache = new Map<string, string>();
let cachedTheme = '';

function currentTheme(): string {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** `token('--muted-foreground')` -> a canvas-ready colour string. */
export function token(name: string, alpha = 1): string {
  const theme = currentTheme();
  if (theme !== cachedTheme) {
    cache.clear();
    cachedTheme = theme;
  }
  const key = `${name}|${alpha}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // Tokens are stored as bare oklch components so Tailwind can inject alpha.
  const value = raw ? (alpha === 1 ? `oklch(${raw})` : `oklch(${raw} / ${alpha})`) : '#888';
  cache.set(key, value);
  return value;
}

export const CHART = {
  bsp: '--info',
  vmg: '--warning',
  heel: '--destructive',
  tws: '--muted-foreground',
} as const;
