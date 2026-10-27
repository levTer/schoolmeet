/**
 * EduFlow Desktop — главный процесс Electron.
 *
 * Полноценное десктопное приложение на Chromium, как Discord / VS Code / Spotify:
 *  • собственное окно 1280×832 с иконкой №9 и тёмно-сланцевым фоном `#0F172A`;
 *  • бесшовный тёмный заголовок окна вместо системной белой полосы Windows
 *    (`titleBarStyle: "hidden"` + Window Controls Overlay в цвет темы);
 *  • чистый интерфейс без нативного верхнего меню Electron (`Menu.setApplicationMenu(null)`,
 *    `autoHideMenuBar: true`, `menuBarVisible: false`);
 *  • метка `EduFlowDesktop/1.0.0` в User-Agent — веб-интерфейс скрывает кнопки установки;
 *  • сразу открывает https://schoolmeet-vb96.onrender.com в изолированном окне;
 *  • внешние ссылки уходят в системный браузер, чужие origin — блокируются;
 *  • камера и микрофон для онлайн-уроков разрешены только для домена EduFlow;
 *  • при отсутствии сети показывается локальная страница «Нет подключения»;
 *  • один экземпляр приложения (повторный запуск фокусирует открытое окно).
 */
const path = require("node:path");
const { app, BrowserWindow, Menu, ipcMain, nativeImage, shell, session } = require("electron");

const APP_URL = (process.env.EDUFLOW_URL || "https://schoolmeet-vb96.onrender.com").replace(/\/+$/, "");
const APP_ORIGIN = new URL(APP_URL).origin;
const APP_NAME = "EduFlow";
/** Тёмно-сланцевый фон окна до загрузки страницы (дизайн №9). */
const BACKGROUND_COLOR = "#0F172A";
/** Серебристо-белые значки «закрыть / свернуть / развернуть» в оверлее заголовка. */
const TITLE_BAR_SYMBOL_COLOR = "#F8FAFC";
/** Высота оверлея кнопок окна — компактная тёмная полоса, как у Discord / VS Code. */
const TITLE_BAR_HEIGHT = 38;
const IS_DEV = !app.isPackaged;

let mainWindow = null;
let isOfflinePageShown = false;

/** Chromium-строка браузера без упоминаний Electron — иначе OAuth-провайдеры ругаются. */
const BROWSER_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${
  process.versions.chrome
} Safari/537.36 EduFlow/${app.getVersion()}`;

function iconPath() {
  const candidates = [
    path.join(__dirname, "assets", "icon.png"),
    path.join(__dirname, "build", "icon.png"),
    path.join(process.resourcesPath || __dirname, "icon.png"),
  ];
  for (const candidate of candidates) {
    const image = nativeImage.createFromPath(candidate);
    if (!image.isEmpty()) return candidate;
  }
  return undefined;
}

function isAppUrl(target) {
  try {
    return new URL(target).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
  return Promise.resolve();
}

/** Разрешения выдаём только для домена EduFlow — уроки требуют камеру и микрофон. */
function configurePermissions() {
  const allowed = new Set([
    "media",
    "mediaKeySystem",
    "notifications",
    "clipboard-read",
    "clipboard-sanitized-write",
    "fullscreen",
    "display-capture",
    "speaker-selection",
  ]);

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details?.requestingUrl || webContents.getURL();
    if (!isAppUrl(requestingUrl)) return callback(false);
    callback(allowed.has(permission));
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => allowed.has(permission));
}

/** Скачивания: файлы из уроков и ДЗ сохраняются в «Загрузки» с обычным диалогом. */
function configureDownloads() {
  session.defaultSession.on("will-download", (event, item) => {
    item.setSaveDialogOptions({
      title: "Сохранить файл",
      defaultPath: path.join(app.getPath("downloads"), item.getFilename()),
    });
  });
}

/**
 * Бесшовный тёмный заголовок окна, как у Discord / Spotify / VS Code.
 *
 * `titleBarStyle: "hidden"` полностью убирает системную белую полосу сверху —
 * содержимое страницы занимает всё окно. На Windows и Linux нативные кнопки
 * «свернуть / развернуть / закрыть» рисует Window Controls Overlay в цвет темы:
 * тёмно-сланцевый фон `#0F172A`, серебристо-белые значки, высота 38 px.
 * На macOS система сама сохраняет «светофор», поэтому оверлей там не нужен.
 */
function titleBarOptions() {
  if (process.platform === "darwin") return { titleBarStyle: "hidden" };
  return {
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: BACKGROUND_COLOR,
      symbolColor: TITLE_BAR_SYMBOL_COLOR,
      height: TITLE_BAR_HEIGHT,
    },
  };
}

function createMainWindow() {
  Menu.setApplicationMenu(null);

  const window = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    // Предотвращает белые вспышки при загрузке.
    backgroundColor: BACKGROUND_COLOR,
    // Бесшовный тёмный заголовок: без системной белой полосы Windows,
    // нативные кнопки окна — в тёмном оверлее цвета темы.
    ...titleBarOptions(),
    icon: iconPath(),
    autoHideMenuBar: true,
    menuBarVisible: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });

  window.setMenuBarVisibility(false);
  window.removeMenu();

  const { webContents } = window;
  webContents.setUserAgent(BROWSER_USER_AGENT);
  webContents.setUserAgent(webContents.getUserAgent() + " EduFlowDesktop/1.0.0");

  window.once("ready-to-show", () => window.show());

  // Всплывающие окна: свои страницы — в отдельном окне без меню, чужие — в системном браузере.
  webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          backgroundColor: BACKGROUND_COLOR,
          ...titleBarOptions(),
          autoHideMenuBar: true,
          menuBarVisible: false,
        },
      };
    }
    void openExternal(url);
    return { action: "deny" };
  });

  // Уходим из приложения только по ссылкам самого EduFlow.
  webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    void openExternal(url);
  });

  webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame) return;
    // -3 = ERR_ABORTED (обычная отмена навигации), её не показываем.
    if (errorCode === -3) return;
    console.warn(`[EduFlow] Не удалось загрузить ${validatedUrl}: ${errorDescription} (${errorCode})`);
    showOfflinePage(errorDescription);
  });

  webContents.on("did-finish-load", () => {
    isOfflinePageShown = false;
  });

  window.on("closed", () => {
    mainWindow = null;
  });

  mainWindow = window;
  return window;
}

function showOfflinePage(reason) {
  if (isOfflinePageShown) return;
  isOfflinePageShown = true;
  const url = `file://${path.join(__dirname, "offline.html").replace(/\\/g, "/")}?reason=${encodeURIComponent(
    reason || "Нет подключения",
  )}`;
  if (mainWindow) void mainWindow.loadURL(url);
}

function registerIpc() {
  ipcMain.handle("eduflow:open-external", (_event, url) => openExternal(String(url)));
  ipcMain.handle("eduflow:reload", () => {
    isOfflinePageShown = false;
    if (mainWindow) return mainWindow.loadURL(APP_URL);
    return Promise.resolve();
  });
  ipcMain.handle("eduflow:app-info", () => ({
    name: APP_NAME,
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    url: APP_URL,
  }));
}

/** Один экземпляр: второй запуск просто фокусирует уже открытое окно. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    app.setAppUserModelId("com.eduflow.desktop");
    session.defaultSession.setUserAgent(`${BROWSER_USER_AGENT} EduFlowDesktop/1.0.0`);
    configurePermissions();
    configureDownloads();
    registerIpc();

    const window = createMainWindow();
    void window.loadURL(APP_URL);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const created = createMainWindow();
        void created.loadURL(APP_URL);
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // Безопасность: запрещаем подключать неизвестные preload/webview.
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });

  if (IS_DEV) {
    console.log(`[EduFlow] Режим разработки, адрес: ${APP_URL}`);
  }
}
