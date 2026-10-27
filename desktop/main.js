/**
 * EduFlow Desktop — главный процесс Electron.
 *
 * Полноценное десктопное приложение на Chromium, как Discord / VS Code / Spotify:
 *  • собственное окно 1280×832 с иконкой №9 и тёмно-сланцевым фоном `#0F172A`;
 *  • сразу открывает https://schoolmeet-vb96.onrender.com в изолированном окне;
 *  • нативное меню (Файл / Правка / Вид / Переходы / Справка), горячие клавиши;
 *  • внешние ссылки уходят в системный браузер, чужие origin — блокируются;
 *  • камера и микрофон для онлайн-уроков разрешены только для домена EduFlow;
 *  • при отсутствии сети показывается локальная страница «Нет подключения»;
 *  • один экземпляр приложения (повторный запуск фокусирует открытое окно).
 */
const path = require("node:path");
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, shell, session } = require("electron");

const APP_URL = (process.env.EDUFLOW_URL || "https://schoolmeet-vb96.onrender.com").replace(/\/+$/, "");
const APP_ORIGIN = new URL(APP_URL).origin;
const APP_NAME = "EduFlow";
/** Тёмно-сланцевый фон окна до загрузки страницы (дизайн №9). */
const BACKGROUND_COLOR = "#0F172A";
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

function buildMenu() {
  const template = [
    {
      label: "Файл",
      submenu: [
        {
          label: "Обновить страницу",
          accelerator: "CmdOrCtrl+R",
          click: () => mainWindow && mainWindow.webContents.reload(),
        },
        {
          label: "Открыть в браузере",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => openExternal(mainWindow ? mainWindow.webContents.getURL() || APP_URL : APP_URL),
        },
        { type: "separator" },
        { label: "Печать…", accelerator: "CmdOrCtrl+P", click: () => mainWindow && mainWindow.webContents.print() },
        { type: "separator" },
        { role: "quit", label: "Выход" },
      ],
    },
    {
      label: "Правка",
      submenu: [
        { role: "undo", label: "Отменить" },
        { role: "redo", label: "Повторить" },
        { type: "separator" },
        { role: "cut", label: "Вырезать" },
        { role: "copy", label: "Копировать" },
        { role: "paste", label: "Вставить" },
        { role: "selectAll", label: "Выделить всё" },
      ],
    },
    {
      label: "Вид",
      submenu: [
        { role: "resetZoom", label: "Обычный масштаб" },
        { role: "zoomIn", label: "Увеличить" },
        { role: "zoomOut", label: "Уменьшить" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Полный экран" },
        { role: "toggleDevTools", label: "Инструменты разработчика" },
      ],
    },
    {
      label: "Переходы",
      submenu: [
        {
          label: "Назад",
          accelerator: "Alt+Left",
          click: () => mainWindow && mainWindow.webContents.canGoBack() && mainWindow.webContents.goBack(),
        },
        {
          label: "Вперёд",
          accelerator: "Alt+Right",
          click: () => mainWindow && mainWindow.webContents.canGoForward() && mainWindow.webContents.goForward(),
        },
        { label: "На главную", click: () => mainWindow && mainWindow.loadURL(APP_URL) },
      ],
    },
    {
      label: "Справка",
      submenu: [
        {
          label: "О программе EduFlow",
          click: () =>
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: `О программе ${APP_NAME}`,
              message: `${APP_NAME} ${app.getVersion()}`,
              detail:
                `Десктопное приложение для онлайн-уроков, домашних заданий и обучения с ИИ.\n\n` +
                `Версия Electron: ${process.versions.electron}\n` +
                `Версия Chromium: ${process.versions.chrome}\n` +
                `Версия Node.js: ${process.versions.node}\n\n` +
                `Адрес: ${APP_URL}`,
              buttons: ["Закрыть"],
              noLink: true,
              icon: iconPath(),
            }),
        },
        {
          label: "Сайт EduFlow",
          click: () => openExternal(APP_URL),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    backgroundColor: BACKGROUND_COLOR,
    icon: iconPath(),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });

  window.setMenuBarVisibility(true);
  window.once("ready-to-show", () => window.show());

  // Всплывающие окна: свои страницы — в отдельном окне, чужие — в системном браузере.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      return { action: "allow", overrideBrowserWindowOptions: { backgroundColor: BACKGROUND_COLOR } };
    }
    void openExternal(url);
    return { action: "deny" };
  });

  // Уходим из приложения только по ссылкам самого EduFlow.
  window.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    void openExternal(url);
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame) return;
    // -3 = ERR_ABORTED (обычная отмена навигации), её не показываем.
    if (errorCode === -3) return;
    console.warn(`[EduFlow] Не удалось загрузить ${validatedUrl}: ${errorDescription} (${errorCode})`);
    showOfflinePage(errorDescription);
  });

  window.webContents.on("did-finish-load", () => {
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
    app.setAppUserModelId("com.eduflow.desktop");
    configurePermissions();
    configureDownloads();
    buildMenu();
    registerIpc();

    const window = createMainWindow();
    window.webContents.setUserAgent(BROWSER_USER_AGENT);
    void window.loadURL(APP_URL);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const created = createMainWindow();
        created.webContents.setUserAgent(BROWSER_USER_AGENT);
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
