"use client";

import { useState, useEffect } from "react";

/**
 * Определяет, открыт ли EduFlow внутри установленного приложения
 * (десктопная оболочка Electron с меткой `EduFlowDesktop` / preload-мостом
 * или установленная PWA в режиме `display-mode: standalone`).
 *
 * До монтирования возвращает `false`, чтобы серверная и клиентская разметка
 * не расходились при гидрации.
 */
export function useIsApp() {
  const [isApp, setIsApp] = useState(false);

  useEffect(() => {
    const isElectron =
      typeof navigator !== "undefined" &&
      (navigator.userAgent.includes("EduFlowDesktop") ||
        Boolean(
          typeof window !== "undefined" &&
            (window as Window & { eduflowDesktop?: { isDesktop?: boolean } }).eduflowDesktop
              ?.isDesktop,
        ));
    const isPwa =
      typeof window !== "undefined" &&
      (window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true);
    if (isElectron || isPwa) setIsApp(true);
  }, []);

  return isApp;
}
