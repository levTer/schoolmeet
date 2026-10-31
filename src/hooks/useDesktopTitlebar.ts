"use client";

import { useEffect, useState, type CSSProperties } from "react";

/*
 * В Windows Electron titlebar-area-width — ширина ДОСТУПНОЙ области, а не
 * ширина системных кнопок. Используем её как ширину шапки, чтобы профиль был
 * справа, но не попадал под кнопки окна. X учитывает кнопки и слева, если их
 * положение изменится. Запасной вариант подходит и старым EXE без WCO API.
 */
const WINDOWS_TITLEBAR_STYLE: CSSProperties = {
  width: "env(titlebar-area-width, calc(100% - 140px))",
  marginLeft: "env(titlebar-area-x, 0px)",
  marginRight: 0,
};

/* Другие Electron-оболочки сохраняют прежнюю раскладку. */
const OTHER_DESKTOP_TITLEBAR_STYLE: CSSProperties = {
  paddingRight: "env(titlebar-area-width, 140px)",
};

type DesktopPlatform = "windows" | "other" | null;

/** Размер шапки меняется только для Windows EXE, не для сайта, PWA или Mac. */
export function useDesktopTitlebar() {
  const [platform, setPlatform] = useState<DesktopPlatform>(null);

  useEffect(() => {
    const desktop = window.eduflowDesktop;
    if (desktop?.isDesktop) {
      setPlatform(desktop.platform === "win32" ? "windows" : "other");
    }
  }, []);

  return {
    isWindowsDesktop: platform === "windows",
    titlebarStyle:
      platform === "windows"
        ? WINDOWS_TITLEBAR_STYLE
        : platform === "other"
          ? OTHER_DESKTOP_TITLEBAR_STYLE
          : undefined,
  };
}
