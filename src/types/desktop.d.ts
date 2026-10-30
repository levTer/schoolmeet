/**
 * Мосты нативной оболочки, которые веб-интерфейс видит в `window`.
 *
 * `eduflowDesktop` пробрасывает preload Electron (desktop/ и electron-app/),
 * `AndroidApp` — JavaScript-интерфейс Android-контейнера
 * (`webView.addJavascriptInterface(new AndroidBridge(), "AndroidApp")`).
 */
interface NativeThemeColors {
  backgroundColor: string;
  symbolColor: string;
}

interface AndroidAppBridge {
  /** Перекрашивает Status Bar и Navigation Bar (hex, например «#0B0F17»). */
  setStatusBarColor?: (colorHex: string) => void;
  /** Возвращает текущий цвет статус-бара (hex). */
  getStatusBarColor?: () => string;
  /** true — активна edge-to-edge разметка (контент под системными панелями). */
  isEdgeToEdge?: () => boolean;
}

interface Window {
  eduflowDesktop?: {
    isDesktop?: boolean;
    platform?: string;
    setTheme?: (themeColors: NativeThemeColors) => void;
    /**
     * Открыть ссылку системным обработчиком. Используется для
     * `otpauth://totp/…` при включении второго фактора; разрешённые схемы
     * проверяет main-процесс Electron. В старых сборках метода нет — веб
     * обязан работать и без него.
     */
    openExternal?: (url: string) => Promise<void> | void;
  };
  AndroidApp?: AndroidAppBridge;
}
