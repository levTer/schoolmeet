"use client";

/**
 * Общий хук установки PWA EduFlow.
 *
 * Отвечает за перехват события `beforeinstallprompt` (браузеры Chromium/Edge/Samsung),
 * определение iOS Safari для показа инструкции и статуса standalone-приложения.
 *
 * APK раздаётся из public/eduflow.apk по фиксированному пути `/eduflow.apk`:
 * компоненты используют этот же origin, чтобы атрибут download работал.
 *
 * Используется и в шапке (Navbar/SiteHeader), и в Hero-блоке лендинга,
 * поэтому состояние хранится в модуле (singleton), а события раздаются
 * подписчикам — не нужно ловить `beforeinstallprompt` в нескольких местах.
 */

import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/**
 * Канонический локальный путь к APK. Раньше он переопределялся переменной
 * окружения на релиз GitHub, но cross-origin ссылка игнорирует download —
 * поэтому путь зафиксирован. Константа оставлена для совместимости состояния
 * хука и проверяется тестами на совпадение с href в обеих кнопках.
 */
const APK_DOWNLOAD_URL = "/eduflow.apk";

type Subscriber = () => void;

// Синглтон-состояние на уровне модуля.
let _deferredPrompt: BeforeInstallPromptEvent | null = null;
let _isInstalled = false;
let _isIOS = false;
let _isPrompting = false;
let _listenersReady = false;
const _subscribers = new Set<Subscriber>();

function notify() {
  _subscribers.forEach((sub) => sub());
}

function setupListeners() {
  if (_listenersReady || typeof window === "undefined") return;
  _listenersReady = true;

  const iosNavigator = window.navigator as Navigator & { standalone?: boolean };
  _isInstalled =
    window.matchMedia("(display-mode: standalone)").matches ||
    iosNavigator.standalone === true ||
    document.referrer.startsWith("android-app://");

  const { userAgent, platform, maxTouchPoints } = window.navigator;
  const iosDevice =
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1);
  const otherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|Mercury/i.test(userAgent);
  _isIOS = iosDevice && /Safari/i.test(userAgent) && !otherIosBrowser;

  const onBeforeInstallPrompt = (event: Event) => {
    event.preventDefault();
    _deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  };

  const onAppInstalled = () => {
    _deferredPrompt = null;
    _isInstalled = true;
    notify();
  };

  const displayMode = window.matchMedia("(display-mode: standalone)");
  const onDisplayModeChange = (event: MediaQueryListEvent) => {
    if (event.matches) {
      _isInstalled = true;
      notify();
    }
  };

  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);
  displayMode.addEventListener("change", onDisplayModeChange);
}

function subscribe(fn: Subscriber) {
  _subscribers.add(fn);
  return () => {
    _subscribers.delete(fn);
  };
}

export interface PwaInstallState {
  /** Системный prompt готов к вызову (Chromium-браузеры). */
  canPrompt: boolean;
  /** Приложение уже установлено в standalone-режиме — кнопку лучше скрыть. */
  isInstalled: boolean;
  /** Это iOS Safari — показываем ручную инструкцию «Поделиться → На экран Домой». */
  isIOS: boolean;
  /** Идёт вызов системного prompt — не давать нажимать ещё раз. */
  isPrompting: boolean;
  /** Прямая ссылка на локальный APK-файл (всегда `/eduflow.apk`). */
  apkUrl: string;
}

export function usePwaInstall(): PwaInstallState & {
  /** Вызвать системный prompt, если он готов; иначе подсказывает мануал через открытие модалки на уровне компонента. */
  triggerPrompt: () => Promise<"accepted" | "dismissed" | "manual">;
} {
  // Подписываемся на изменения синглтона, чтобы компоненты перерисовывались.
  const [, setTick] = useState(0);

  useEffect(() => {
    setupListeners();
    return subscribe(() => setTick((t) => t + 1));
  }, []);

  const triggerPrompt = useCallback(async () => {
    if (_isInstalled || _isPrompting) return "dismissed";

    if (_deferredPrompt) {
      const promptEvent = _deferredPrompt;
      _deferredPrompt = null;
      _isPrompting = true;
      notify();
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice.outcome === "accepted") {
          _isInstalled = true;
          return "accepted";
        }
        return "dismissed";
      } catch {
        return "manual";
      } finally {
        _isPrompting = false;
        notify();
      }
    }

    return "manual";
  }, []);

  return {
    canPrompt: _deferredPrompt !== null,
    isInstalled: _isInstalled,
    isIOS: _isIOS,
    isPrompting: _isPrompting,
    apkUrl: APK_DOWNLOAD_URL,
    triggerPrompt,
  };
}
