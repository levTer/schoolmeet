"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Check, Download, Plus, Share, Smartphone, X } from "lucide-react";

import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const APK_DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_APK_DOWNLOAD_URL ||
  "https://github.com/levTer/schoolmeet/releases/latest/download/eduflow.apk";

function isStandaloneWindow(): boolean {
  const iosNavigator = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches ||
    iosNavigator.standalone === true ||
    document.referrer.startsWith("android-app://");
}

function isIosSafari(): boolean {
  const { userAgent, platform, maxTouchPoints } = window.navigator;
  const iosDevice = /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1);
  const otherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|Mercury/i.test(userAgent);
  return iosDevice && /Safari/i.test(userAgent) && !otherIosBrowser;
}

/**
 * Кнопка установки EduFlow для гостей и авторизованных пользователей.
 * Android/Chromium использует native beforeinstallprompt, iOS Safari — модальную
 * инструкцию «Поделиться → На экран "Домой"». В standalone кнопка скрывается.
 */
export function PwaInstallButton({ className }: { className?: string }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPrompting, setIsPrompting] = useState(false);

  useEffect(() => {
    setIsIOS(isIosSafari());
    setIsInstalled(isStandaloneWindow());

    const displayMode = window.matchMedia("(display-mode: standalone)");
    const onDisplayModeChange = (event: MediaQueryListEvent) => {
      if (event.matches) setIsInstalled(true);
    };
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
      setIsModalOpen(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    displayMode.addEventListener("change", onDisplayModeChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      displayMode.removeEventListener("change", onDisplayModeChange);
    };
  }, []);

  const closeModal = useCallback(() => setIsModalOpen(false), []);

  const handleInstall = async () => {
    if (isInstalled || isPrompting) return;

    if (deferredPrompt) {
      const promptEvent = deferredPrompt;
      // Системный prompt можно вызвать у перехваченного события только один раз.
      setDeferredPrompt(null);
      setIsPrompting(true);
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice.outcome === "accepted") setIsInstalled(true);
      } catch {
        // Если браузер отклонил нативный сценарий, остаётся ручная инструкция.
        setIsModalOpen(true);
      } finally {
        setIsPrompting(false);
      }
      return;
    }

    setIsModalOpen(true);
  };

  if (isInstalled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => void handleInstall()}
        disabled={isPrompting}
        aria-label="Установить EduFlow"
        title="Установить EduFlow"
        className={cn(
          "relative inline-flex min-h-10 shrink-0 items-center justify-center gap-2 overflow-hidden rounded-full px-3 py-2 text-sm font-semibold text-white",
          "bg-gradient-to-r from-slate-800 via-indigo-700 to-indigo-600 shadow-[0_0_24px_rgba(79,70,229,0.35)] ring-1 ring-indigo-300/25",
          "transition duration-200 hover:-translate-y-0.5 hover:from-slate-700 hover:via-indigo-600 hover:to-indigo-500 hover:shadow-[0_0_30px_rgba(79,70,229,0.5)]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-wait disabled:opacity-70 xl:px-4",
          className,
        )}
      >
        <span aria-hidden className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-60" />
        <Download aria-hidden className="relative h-4 w-4" strokeWidth={2.2} />
        <span className="relative hidden xl:inline">{isPrompting ? "Установка…" : "Установить EduFlow"}</span>
      </button>

      <Modal
        open={isModalOpen}
        onClose={closeModal}
        labelledBy="pwa-install-title"
        describedBy="pwa-install-description"
        className="border-white/10 bg-[#0F172A] shadow-[0_24px_90px_rgba(2,6,23,0.75)] sm:max-w-md"
      >
        <div className="relative p-6 sm:p-7">
          <button
            type="button"
            onClick={closeModal}
            aria-label="Закрыть окно установки"
            className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-3 pr-10">
            <Image src="/icon.svg" alt="" width={48} height={48} unoptimized className="h-12 w-12" />
            <div>
              <h2 id="pwa-install-title" className="text-lg font-semibold text-white">Установить EduFlow</h2>
              <p className="text-xs text-indigo-300">Быстрый доступ с главного экрана</p>
            </div>
          </div>

          <div id="pwa-install-description" className="mt-6">
            {isIOS ? (
              <ol className="space-y-3">
                <InstallStep number={1} icon={<Share className="h-4 w-4" />}>
                  Нажмите <strong className="font-semibold text-white">«Поделиться»</strong> в Safari
                </InstallStep>
                <InstallStep number={2} icon={<Plus className="h-4 w-4" />}>
                  Выберите <strong className="font-semibold text-white">«На экран &quot;Домой&quot;»</strong>
                </InstallStep>
                <InstallStep number={3} icon={<Check className="h-4 w-4" />}>
                  Нажмите <strong className="font-semibold text-white">«Добавить»</strong>
                </InstallStep>
              </ol>
            ) : (
              <div className="rounded-2xl border border-indigo-400/15 bg-indigo-500/[0.07] p-4">
                <div className="flex gap-3">
                  <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-indigo-300" />
                  <p className="text-sm leading-6 text-slate-300">
                    Откройте меню браузера и выберите <strong className="font-semibold text-white">«Установить приложение»</strong> или <strong className="font-semibold text-white">«Добавить на главный экран»</strong>.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 border-t border-white/10 pt-5">
            <a
              href={APK_DOWNLOAD_URL}
              target="_blank"
              rel="noreferrer"
              download="eduflow.apk"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-indigo-300/25 bg-gradient-to-r from-blue-700 to-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_0_24px_rgba(79,70,229,0.25)] transition hover:from-blue-600 hover:to-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              <Download className="h-4 w-4" />
              Скачать APK для Android
            </a>
            <p className="mt-2.5 text-center text-xs leading-5 text-slate-500">
              После скачивания откройте APK и разрешите установку из этого источника.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
}

function InstallStep({ number, icon, children }: { number: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3.5 text-sm leading-5 text-slate-300">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-400/20">
        {icon}
      </span>
      <span className="sr-only">Шаг {number}</span>
      <span>{children}</span>
    </li>
  );
}
