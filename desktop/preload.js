/**
 * Preload-скрипт EduFlow Desktop.
 *
 * Изолирован от страницы (`contextIsolation: true`), поэтому пробрасывает в
 * window.eduflowDesktop только безопасный, «замороженный» набор данных и
 * функций. Никакого доступа к Node.js у веб-страницы нет.
 */
const { contextBridge, ipcRenderer } = require("electron");

const APP_URL = process.env.EDUFLOW_URL || "https://schoolmeet-vb96.onrender.com";

contextBridge.exposeInMainWorld("eduflowDesktop", {
  isDesktop: true,
  platform: process.platform,
  appUrl: APP_URL,
  versions: {
    app: process.env.EDUFLOW_VERSION || "1.0.0",
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  /** Открыть ссылку в системном браузере. */
  openExternal: (url) => ipcRenderer.invoke("eduflow:open-external", String(url)),
  /** Перезагрузить приложение (кнопка «Повторить» на офлайн-странице). */
  reload: () => ipcRenderer.invoke("eduflow:reload"),
  /** Информация о приложении для окна «О программе». */
  getAppInfo: () => ipcRenderer.invoke("eduflow:app-info"),
});
