'use strict';

/**
 * EduFlow Desktop — тонкая Electron-обёртка для macOS.
 *
 * Открывает живую веб-версию платформы в нативном окне: контент, авторизация
 * и обновления всегда приходят с сервера, DMG не нужно пересобирать при
 * изменениях сайта. Окно — без лишних рамок и полос меню: системный заголовок
 * скрыт (`titleBarStyle: 'hidden'`), вместо белой полосы — бесшовный тёмный
 * верх в цвет темы, а нативные кнопки окна рисует Window Controls Overlay.
 *
 * Безопасность: удалённый контент работает без Node.js и preload-скриптов
 * (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`),
 * навигация ограничена origin'ом платформы, внешние ссылки уходят
 * в системный браузер, разрешения камеры/микрофона/экрана выдаются
 * только нашему сайту.
 *
 * Адрес платформы можно переопределить переменной окружения EDUFLOW_URL
 * (удобно для локальной проверки: EDUFLOW_URL=http://localhost:3000 npm start).
 */

const path = require('node:path');
const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
} = require('electron');

app.setName('EduFlow');

const APP_URL = process.env.EDUFLOW_URL || 'https://schoolmeet-vb96.onrender.com';
const APP_ORIGIN = new URL(APP_URL).origin;
// Runtime-иконка лежит в assets/: каталог build/ — ресурсы упаковки,
// electron-builder не включает его содержимое внутрь приложения.
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const LOADING_PAGE = path.join(__dirname, 'loading.html');

/** Тема бесшовного заголовка окна: тёмный сланец (дизайн №9) и серебристо-белые значки кнопок. */
const TITLE_BAR_COLOR = '#0F172A';
const TITLE_BAR_SYMBOL_COLOR = '#F8FAFC';
const TITLE_BAR_HEIGHT = 38;

/**
 * Бесплатный инстанс на Render засыпает без трафика и просыпается
 * до минуты. Столько ждём на экране загрузки, прежде чем показать ошибку.
 */
const SERVER_WAIT_TIMEOUT_MS = 120_000;
const SERVER_POLL_INTERVAL_MS = 1_500;
const SERVER_REQUEST_TIMEOUT_MS = 15_000;

/** Разрешения, которые платформа вправе запрашивать (видеоуроки, показ экрана). */
const ALLOWED_PERMISSIONS = new Set([
  'media', // камера + микрофон
  'display-capture', // демонстрация экрана
  'notifications',
  'fullscreen',
  'pointerLock',
  'clipboard-sanitized-write',
]);

let mainWindow = null;
/** Номер текущей попытки подключения: устаревшие циклы опроса завершаются сами. */
let loadAttempt = 0;

function isAppUrl(rawUrl) {
  try {
    return new URL(rawUrl).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function isLoadingPage(rawUrl) {
  return typeof rawUrl === 'string' && rawUrl.startsWith('file://');
}

/** Внутри приложения разрешены только платформа и локальный экран загрузки. */
function isTrustedUrl(rawUrl) {
  return rawUrl === 'about:blank' || isLoadingPage(rawUrl) || isAppUrl(rawUrl);
}

function openExternal(rawUrl) {
  if (/^(https?|mailto|tel):/i.test(rawUrl)) {
    shell.openExternal(rawUrl).catch(() => {});
  }
}

/**
 * Ждёт, пока сервер начнёт отвечать. На холодном старте Render отвечает 5xx
 * (или соединение висит) — это « ещё просыпается», любой другой ответ — жив.
 */
async function waitForServer(attempt) {
  const deadline = Date.now() + SERVER_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (attempt !== loadAttempt || !mainWindow || mainWindow.isDestroyed()) return false;
    try {
      const response = await fetch(APP_URL, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(SERVER_REQUEST_TIMEOUT_MS),
      });
      if (response.status < 500) return true;
    } catch {
      // Сеть недоступна или таймаут — ждём и повторяем до дедлайна.
    }
    await new Promise((resolve) => setTimeout(resolve, SERVER_POLL_INTERVAL_MS));
  }
  return false;
}

/** Экран загрузки уже показан: дожидаемся сервера и открываем платформу. */
async function connectToApp() {
  const attempt = ++loadAttempt;
  const serverAwake = await waitForServer(attempt);
  if (attempt !== loadAttempt || !mainWindow || mainWindow.isDestroyed()) return;

  if (serverAwake) {
    // Ошибку загрузки, если она случится, покажет обработчик did-fail-load.
    await mainWindow.loadURL(APP_URL).catch(() => {});
  } else {
    await mainWindow.webContents
      .executeJavaScript('window.__eduflowShowError && window.__eduflowShowError()')
      .catch(() => {});
  }
}

/** Минимальное контекстное меню: буфер обмена и копирование ссылок. */
function showContextMenu(win, params) {
  const items = [];

  if (params.linkURL) {
    items.push({
      label: 'Копировать ссылку',
      click: () => clipboard.writeText(params.linkURL),
    });
  }
  if (params.isEditable) {
    items.push(
      { role: 'cut', label: 'Вырезать' },
      { role: 'copy', label: 'Копировать' },
      { role: 'paste', label: 'Вставить' },
      { role: 'selectAll', label: 'Выбрать всё' },
    );
  } else if (params.selectionText) {
    items.push({ role: 'copy', label: 'Копировать' });
  }

  if (items.length > 0) {
    Menu.buildFromTemplate(items).popup({ window: win });
  }
}

/**
 * Бесшовный тёмный заголовок окна, как у Discord / Spotify / VS Code.
 *
 * `titleBarStyle: 'hidden'` полностью убирает системную полосу сверху —
 * содержимое занимает всё окно. На Windows и Linux нативные кнопки
 * «свернуть / развернуть / закрыть» рисует Window Controls Overlay в цвет
 * темы (тёмно-сланцевый фон, серебристо-белые значки, высота 38 px);
 * на macOS система сама сохраняет «светофор», поэтому оверлей там не нужен.
 */
function titleBarOptions() {
  if (process.platform === 'darwin') return { titleBarStyle: 'hidden' };
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: TITLE_BAR_COLOR,
      symbolColor: TITLE_BAR_SYMBOL_COLOR,
      height: TITLE_BAR_HEIGHT,
    },
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 380,
    minHeight: 560,
    title: 'EduFlow',
    icon: ICON_PATH,
    // Тёмный фон в фирменном цвете — без белой вспышки при загрузке.
    backgroundColor: '#0F172A',
    // Бесшовный тёмный заголовок: системная полоса убрана, кнопки окна — в оверлее.
    ...titleBarOptions(),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
    },
  });
  mainWindow = win;

  win.once('ready-to-show', () => win.show());
  // Страховочный показ, если первый кадр по какой-то причине не отрисовался.
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 3000);

  const { webContents } = win;

  // Новые окна (target="_blank"): свои страницы — внутри, чужие — в браузер.
  webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: '#0F172A',
          ...titleBarOptions(),
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
          },
        },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });

  // Навигация главного окна не должна уводить с платформы.
  const guardNavigation = (event, url) => {
    if (!isTrustedUrl(url)) {
      event.preventDefault();
      openExternal(url);
    }
  };
  webContents.on('will-navigate', guardNavigation);
  webContents.on('will-redirect', guardNavigation);

  webContents.on('context-menu', (_event, params) => showContextMenu(win, params));

  // Как только показан экран загрузки — начинаем подключение к серверу.
  webContents.on('did-finish-load', () => {
    if (isLoadingPage(webContents.getURL())) connectToApp();
  });

  // Сбой загрузки платформы (оффлайн, сервер лёг) — обратно на экран загрузки:
  // он сам продолжит попытки и покажет кнопку «Повторить», если не выйдет.
  webContents.on('did-fail-load', (_event, errorCode, _description, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // -3 = ERR_ABORTED, прервана новой навигацией
    if (isLoadingPage(validatedURL)) return;
    win.loadFile(LOADING_PAGE).catch(() => {});
  });

  webContents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') webContents.reload();
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    loadAttempt += 1; // останавливаем цикл ожидания сервера
  });

  win.loadFile(LOADING_PAGE).catch(() => {});
}

/**
 * Меню: окно EduFlow не несёт полос меню. На macOS меню приложения живёт
 * в системной строке сверху экрана — оставляем минимальное стандартное,
 * иначе macOS не отдаёт Cmd+C/Cmd+V/Cmd+Q веб-контенту.
 */
function buildAppMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'Вид',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
    ]),
  );
}

/** Разрешения, демонстрация экрана и загрузки — только для origin'а платформы. */
function setupSession() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = (details && details.requestingUrl) || webContents.getURL();
    callback(isAppUrl(requestingUrl) && ALLOWED_PERMISSIONS.has(permission));
  });

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return requestingOrigin === APP_ORIGIN && ALLOWED_PERMISSIONS.has(permission);
  });

  // getDisplayMedia(): на macOS 15+ выбор окна/экрана рисует сама система
  // (useSystemPicker); на остальных системах отдаём главный экран.
  ses.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (request.securityOrigin && request.securityOrigin !== APP_ORIGIN) {
        callback({});
        return;
      }
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        const primaryDisplayId = String(screen.getPrimaryDisplay().id);
        const primary =
          sources.find((source) => source.display_id === primaryDisplayId) || sources[0];
        if (!primary) {
          callback({});
          return;
        }
        callback(
          request.audioRequested ? { video: primary, audio: 'loopback' } : { video: primary },
        );
      } catch {
        callback({});
      }
    },
    process.platform === 'darwin' ? { useSystemPicker: true } : undefined,
  );

  // Загрузки: путь не задаём — Electron показывает системный диалог сохранения,
  // а мы только отражаем прогресс на иконке окна/Dock.
  ses.on('will-download', (_event, item) => {
    item.on('updated', (_updatedEvent, state) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (state === 'progressing' && item.getTotalBytes() > 0) {
        mainWindow.setProgressBar(item.getReceivedBytes() / item.getTotalBytes());
      }
    });
    item.once('done', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(-1);
    });
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Веб-контенту запрещено создавать <webview> — вся навигация под контролем окна.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  app
    .whenReady()
    .then(() => {
      // В dev-режиме (electron .) иконку Dock не подхватывает бандл — ставим вручную.
      if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
        const icon = nativeImage.createFromPath(ICON_PATH);
        if (!icon.isEmpty()) app.dock.setIcon(icon);
      }

      buildAppMenu();
      setupSession();
      createWindow();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    })
    .catch((error) => {
      console.error('EduFlow: не удалось запустить приложение', error);
      app.quit();
    });

  app.on('window-all-closed', () => {
    // macOS: приложение живёт в Dock до явного Cmd+Q.
    if (process.platform !== 'darwin') app.quit();
  });
}
