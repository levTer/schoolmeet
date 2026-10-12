"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  DEFAULT_TEXT_SIZE,
  DEFAULT_THEME,
  getThemeOption,
  isTextSize,
  isThemeId,
  LEGACY_THEME_STORAGE_KEY,
  TEXT_SIZE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  type TextSize,
  type ThemeId,
} from "@/lib/theme";

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  textSize: TextSize;
  setTextSize: (textSize: TextSize) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
    "content",
    getThemeOption(theme).background,
  );
}

function applyTextSize(textSize: TextSize) {
  document.documentElement.dataset.textSize = textSize;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Match the server's defaults on the first render. The head bootstrap script
  // applies saved values before paint; these effects hydrate the control state.
  const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME);
  const [textSize, setTextSizeState] = useState<TextSize>(DEFAULT_TEXT_SIZE);

  useEffect(() => {
    let initialTheme = isThemeId(document.documentElement.dataset.theme)
      ? document.documentElement.dataset.theme
      : DEFAULT_THEME;
    let initialTextSize = isTextSize(document.documentElement.dataset.textSize)
      ? document.documentElement.dataset.textSize
      : DEFAULT_TEXT_SIZE;

    try {
      const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemeId(savedTheme)) {
        initialTheme = savedTheme;
      } else {
        const legacyTheme = window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
        if (isThemeId(legacyTheme)) {
          initialTheme = legacyTheme;
          window.localStorage.setItem(THEME_STORAGE_KEY, legacyTheme);
        }
      }

      const savedTextSize = window.localStorage.getItem(TEXT_SIZE_STORAGE_KEY);
      if (isTextSize(savedTextSize)) initialTextSize = savedTextSize;
    } catch {
      // Storage can be disabled; the pre-hydration HTML attributes remain usable.
    }

    applyTheme(initialTheme);
    applyTextSize(initialTextSize);
    setThemeState(initialTheme);
    setTextSizeState(initialTextSize);
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

  const setTextSize = useCallback((nextTextSize: TextSize) => {
    setTextSizeState(nextTextSize);
    applyTextSize(nextTextSize);

    try {
      window.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, nextTextSize);
    } catch {
      // Keep the current text size for this session if storage is blocked.
    }
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, textSize, setTextSize }),
    [theme, setTheme, textSize, setTextSize],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
