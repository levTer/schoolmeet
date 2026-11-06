/**
 * Видимость кнопок скачивания: сайт против установленного приложения.
 *
 * Реальный рендер InstallBlock (лендинг) и PwaInstallButton (шапка) в jsdom:
 *  • обычный браузер — ссылки APK/EXE/DMG и кнопка установки видны;
 *  • Android APK — мост window.AndroidApp (есть во всех выпущенных сборках,
 *    обновление APK не требуется) → всё скрыто;
 *  • Windows .exe / macOS — preload-мост eduflowDesktop.isDesktop или метка
 *    EduFlowDesktop в User-Agent → всё скрыто;
 *  • установленная PWA (display-mode: standalone) → всё скрыто.
 *
 * Сценарий «браузер» идёт первым: синглтон usePwaInstall фиксирует
 * _isInstalled = false, поэтому в остальных сценариях кнопки скрывает
 * именно useIsApp, а не флаг установленной PWA.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { InstallBlock } from "../src/components/landing/install-block";
import { PwaInstallButton } from "../src/components/pwa-install-button";

type Environment = "browser" | "apk-bridge" | "exe-bridge" | "exe-ua" | "pwa-standalone";

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Рендерит оба блока установки в окружении env и проверяет итоговый DOM. */
async function renderIn(env: Environment, check: (container: HTMLElement) => void) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "https://eduflow.test/",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // matchMedia: standalone-режим включён только для установленной PWA.
  window.matchMedia = (query: string) => ({
    matches: env === "pwa-standalone" && query === "(display-mode: standalone)",
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  });

  const userAgent =
    env === "exe-ua"
      ? `${DESKTOP_UA} EduFlowDesktop/1.0.0`
      : env === "exe-bridge"
        ? DESKTOP_UA
        : MOBILE_UA;
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: userAgent });

  // Мосты нативных оболочек — ровно то, что пробрасывают WebView и preload.
  if (env === "apk-bridge") {
    (window as unknown as { AndroidApp?: object }).AndroidApp = {
      setStatusBarColor() {},
      getStatusBarColor: () => "#0B0F17",
      isEdgeToEdge: () => true,
    };
  }
  if (env === "exe-bridge") {
    (window as unknown as { eduflowDesktop?: object }).eduflowDesktop = {
      isDesktop: true,
      platform: "win32",
      setTheme() {},
    };
  }

  const globals: Record<string, unknown> = {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    // tsx использует классический JSX runtime; Next.js подключает его автоматически.
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  const container = window.document.getElementById("root")!;
  const root = createRoot(container);
  try {
    await act(async () => root.render(<><InstallBlock /><PwaInstallButton /></>));
    check(container);
  } finally {
    await act(async () => root.unmount());
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
    window.close();
  }
}

/** Внутри приложения оба компонента возвращают null — контейнер пуст. */
function assertHidden(container: HTMLElement, env: Environment) {
  assert.equal(
    container.querySelector('a[href="/eduflow.apk"]'),
    null,
    `${env}: ссылка на APK осталась внутри приложения`,
  );
  assert.equal(
    container.querySelector('a[href="/eduflow-setup.exe"]'),
    null,
    `${env}: ссылка на EXE осталась внутри приложения`,
  );
  assert.equal(
    container.querySelector('a[href="/eduflow.dmg"]'),
    null,
    `${env}: ссылка на DMG осталась внутри приложения`,
  );
  assert.equal(
    container.querySelector('button[aria-label="Установить EduFlow"]'),
    null,
    `${env}: кнопка установки в шапке осталась внутри приложения`,
  );
  assert.equal(container.innerHTML, "", `${env}: блок установки не полностью скрыт`);
}

test("обычный браузер: кнопки скачивания APK/EXE/DMG и установки видны", async () => {
  await renderIn("browser", (container) => {
    assert.ok(container.querySelector('a[href="/eduflow.apk"]'), "лендинг: нет ссылки на APK");
    assert.ok(container.querySelector('a[href="/eduflow-setup.exe"]'), "лендинг: нет ссылки на EXE");
    assert.ok(container.querySelector('a[href="/eduflow.dmg"]'), "лендинг: нет ссылки на DMG");
    assert.ok(
      container.querySelector('button[aria-label="Установить EduFlow"]'),
      "шапка: нет кнопки установки",
    );
  });
});

test("Android APK (мост window.AndroidApp): кнопки скачивания скрыты", async () => {
  await renderIn("apk-bridge", (container) => assertHidden(container, "apk-bridge"));
});

test("Windows EXE (preload-мост eduflowDesktop.isDesktop): кнопки скачивания скрыты", async () => {
  await renderIn("exe-bridge", (container) => assertHidden(container, "exe-bridge"));
});

test("Windows EXE (метка EduFlowDesktop в User-Agent): кнопки скачивания скрыты", async () => {
  await renderIn("exe-ua", (container) => assertHidden(container, "exe-ua"));
});

test("установленная PWA (display-mode: standalone): кнопки скачивания скрыты", async () => {
  await renderIn("pwa-standalone", (container) => assertHidden(container, "pwa-standalone"));
});
