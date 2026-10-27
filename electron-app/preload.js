'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eduflowDesktop', {
  isDesktop: true,
  platform: process.platform,
  setTheme: (themeColors) => ipcRenderer.send('update-titlebar-theme', themeColors),
});
