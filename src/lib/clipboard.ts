/**
 * Копирование и внешние ссылки в веб, Electron и Android WebView.
 *
 * Зачем отдельный модуль: одинаковый код выполняется в трёх средах с разными
 * возможностями.
 *  - Браузер: `navigator.clipboard` работает только в защищённом контексте
 *    (https или localhost) и только по жесту пользователя.
 *  - Electron (Mac/Windows): контекст защищённый, но WebView старых сборок
 *    может не иметь Clipboard API.
 *  - Android WebView: Clipboard API доступен не во всех прошивках, а
 *    `navigator.clipboard` иногда возвращает отказ без объяснения.
 *
 * Поэтому сначала пробуем современный API, затем — старый путь через
 * `document.execCommand("copy")`, который в WebView работает всегда. Если не
 * сработало и это, вызывающий код обязан показать текст для ручного переноса:
 * «не удалось скопировать» не должно означать «потеряли резервные коды».
 */

/** Копирует текст. `true` — точно скопировано, `false` — нужен ручной перенос. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Отказ в правах/небезопасный контекст — идём по старому пути.
    }
  }

  if (typeof document === "undefined") return false;

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    // За пределами экрана: поле не должно дёргать прокрутку и вёрстку.
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.left = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);

    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);

    const copied = typeof document.execCommand === "function" && document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

/** Открыт ли сайт внутри Android-оболочки (`AndroidApp` из WebView). */
export function isAndroidShell(): boolean {
  if (typeof window === "undefined") return false;
  return typeof window.AndroidApp !== "undefined";
}

/**
 * Передаёт внешнюю ссылку нативной оболочке.
 *
 * В Electron обычный `<a href="otpauth://…">` уходил в навигацию и блокировался
 * политикой окна — кнопка «открыть в приложении» молча ничего не делала. Мост
 * `eduflowDesktop.openExternal` передаёт ссылку main-процессу, который сверяет
 * схему. Возвращает `true`, если ссылку взяла оболочка; `false` — значит,
 * работаем как обычный браузер (переход по ссылке).
 */
export function openInNativeShell(url: string): boolean {
  if (typeof window === "undefined") return false;

  const bridge = window.eduflowDesktop;
  if (bridge?.openExternal) {
    try {
      void bridge.openExternal(url);
      return true;
    } catch {
      // Мост есть, но вызов сорвался — пробуем следующий путь.
    }
  }

  const android = window.AndroidApp;
  if (typeof android?.openExternal === "function") {
    try {
      return android.openExternal(url) !== false;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Может ли эта оболочка открыть внешнюю ссылку.
 *
 * Нужно, чтобы не показывать «мёртвую» кнопку: в APK без моста
 * `AndroidApp.openExternal` WebView не умеет открывать неизвестные схемы, и
 * ссылка `otpauth://` просто ничего не сделает. В браузере переход по ссылке
 * обрабатывает система, поэтому там кнопка уместна всегда.
 */
export function canOpenExternalLink(): boolean {
  if (typeof window === "undefined") return false;
  if (window.eduflowDesktop?.openExternal) return true;
  if (typeof window.AndroidApp?.openExternal === "function") return true;
  return !isAndroidShell();
}

/** Открыт ли сайт внутри приложения (Electron или Android-оболочка). */
export function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.eduflowDesktop?.isDesktop) || isAndroidShell();
}
