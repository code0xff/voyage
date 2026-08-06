/** Day/night theme, persisted in localStorage and applied as the `dark` class on <html>
 *  (Tailwind `darkMode: "class"`). Falls back to the OS preference on first visit.
 *
 *  Pre-paint wiring (in src/main.tsx, before createRoot) avoids a flash of the wrong theme:
 *    import { initialTheme } from "@/lib/theme";
 *    document.documentElement.classList.toggle("dark", initialTheme() === "dark");
 */
import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "app_theme";

function readStored(): Theme | null {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" ? v : null;
}

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Resolve the initial theme without flashing: stored value, else OS preference. */
export function initialTheme(): Theme {
  return readStored() ?? systemTheme();
}

function apply(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/** Theme state + a toggle. Persists every change and keeps <html> in sync. */
export function useTheme(): { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    apply(theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return { theme, toggle, setTheme };
}
