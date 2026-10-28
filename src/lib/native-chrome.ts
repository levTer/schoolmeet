import { type ThemeOption } from "@/lib/theme";

/**
 * Синхронизация нативного хрома всех платформ с активной темой.
 *
 *  • Web / PWA — обновляет `<meta name="theme-color">`;
 *  • Android APK — JavaScript-мост `AndroidApp.setStatusBarColor(hex)`
 *    (см. android/app/src/main/java/ru/eduflow/app/MainActivity.java);
 *  • Windows .exe / macOS .dmg — `window.eduflowDesktop.setTheme(...)`
 *    (contextBridge → ipcRenderer «update-titlebar-theme» → titleBarOverlay).
 *
 * Все вызовы опциональны: в обычном браузере мостов нет, и функция молча
 * возвращается, поэтому её можно звать из любого клиентского компонента.
 */
export function syncNativeChrome(theme: ThemeOption) {
  if (typeof window === "undefined") return;

  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", theme.background);

  /* Android: статус-бар и панель навигации перекрашиваются мостом. */
  if (window.AndroidApp?.setStatusBarColor) {
    try {
      window.AndroidApp.setStatusBarColor(theme.bgColor);
    } catch {
      // Мост может быть недоступен в WebView без JS-интерфейса — не критично.
    }
  }

  /* Electron (Windows / macOS): нативная полоса заголовка окна. */
  window.eduflowDesktop?.setTheme?.({
    backgroundColor: theme.titlebar,
    symbolColor: theme.symbol,
  });
}
