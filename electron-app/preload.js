'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eduflowDesktop', {
  isDesktop: true,
  platform: process.platform,
  /**
   * Открыть ссылку системным обработчиком: https — в браузере,
   * `otpauth://totp/…` — в приложении-аутентификаторе (второй фактор).
   * Разрешённые схемы проверяет main-процесс (`isExternalSchemeAllowed`).
   */
  openExternal: (url) => ipcRenderer.invoke('eduflow:open-external', String(url)),
  setTheme: (themeColors) => ipcRenderer.send('update-titlebar-theme', themeColors),
});
