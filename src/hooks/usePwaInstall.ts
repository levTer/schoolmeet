"use client";

/**
 * Общий хук установки PWA EduFlow.
 *
 * Отвечает за перехват события `beforeinstallprompt` (браузеры Chromium/Edge/Samsung)
 * и статус standalone-приложения. Никакой авто-детекции ОС здесь НЕТ:
 * все 3 варианта установки (Android APK, Windows MSIX, Mac / iPhone)
 * компоненты показывают каждому пользователю без фильтрации устройств.
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
let _isPrompting = false;
let _listenersReady = false;
const _subscribers = new Set<Subscriber>();

function notify() {
  _subscribers.forEach((sub) => sub());
}

function setupListeners() {
  if (_listenersReady || typeof window === "undefined") return;
  _listenersReady = true;

  // Только статус установленного приложения — без авто-детекции ОС и
  // фильтрации устройств: варианты установки рисуются все всегда.
  const iosNavigator = window.navigator as Navigator & { standalone?: boolean };
  _isInstalled =
    window.matchMedia("(display-mode: standalone)").matches ||
    iosNavigator.standalone === true ||
    document.referrer.startsWith("android-app://");

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
    const unsubscribe = subscribe(() => setTick((t) => t + 1));
    setupListeners();
    notify();
    return unsubscribe;
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
    isPrompting: _isPrompting,
    apkUrl: APK_DOWNLOAD_URL,
    triggerPrompt,
  };
}
