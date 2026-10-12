"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  DEFAULT_THEME,
  getThemeOption,
  isThemeId,
  THEME_STORAGE_KEY,
  type ThemeId,
} from "@/lib/theme";

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
    "content",
    getThemeOption(theme).background,
  );
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Keep the server and the first hydration render on the same default theme.
  // A small head script sets the saved theme on <html> before the page is painted.
  const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME);

  useEffect(() => {
    let initialTheme = isThemeId(document.documentElement.dataset.theme)
      ? document.documentElement.dataset.theme
      : DEFAULT_THEME;

    try {
      const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemeId(savedTheme)) initialTheme = savedTheme;
    } catch {
      // Storage can be disabled; the pre-hydration HTML attribute remains usable.
    }

    applyTheme(initialTheme);
    setThemeState(initialTheme);
  }, []);

  const setTheme = useCallback((nextTheme: ThemeId) => {
    setThemeState(nextTheme);
    applyTheme(nextTheme);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Keep the current theme for this session if persistent storage is blocked.
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
