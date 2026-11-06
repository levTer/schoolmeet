"use client";

import { useState, useEffect } from "react";

/**
 * Определяет, открыт ли EduFlow внутри установленного приложения, а не на сайте:
 *
 *  • Android APK — WebView-контейнер регистрирует JavaScript-мост
 *    `window.AndroidApp` до загрузки сайта (MainActivity.attachJavascriptBridge),
 *    поэтому мост есть во всех выпущенных сборках APK и обновление приложения
 *    не требуется;
 *  • Windows .exe / macOS — оболочка Electron с меткой `EduFlowDesktop`
 *    в User-Agent или preload-мостом `window.eduflowDesktop.isDesktop`;
 *  • установленная PWA — режим `display-mode: standalone`
 *    (iOS Safari — `navigator.standalone`).
 *
 * Внутри приложения все кнопки скачивания установщиков (APK / EXE / DMG) и
 * установки PWA скрываются: Navbar, SiteHeader, InstallBlock и PwaInstallButton
 * проверяют этот хук. В обычном браузере, включая мобильный, возвращается
 * `false`, и кнопки остаются видимыми.
 *
 * До монтирования возвращает `false`, чтобы серверная и клиентская разметка
 * не расходились при гидрации.
 */
export function useIsApp() {
  const [isApp, setIsApp] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Android APK: JS-мост AndroidApp есть в каждой сборке WebView-контейнера.
    const isAndroidApp = Boolean(window.AndroidApp);

    // Electron (Windows .exe / macOS): метка в UA или preload-мост.
    const isElectron =
      navigator.userAgent.includes("EduFlowDesktop") ||
      Boolean(window.eduflowDesktop?.isDesktop);

    // Установленная PWA: standalone-режим, на iOS — navigator.standalone.
    const isPwa =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    if (isAndroidApp || isElectron || isPwa) setIsApp(true);
  }, []);

  return isApp;
}
