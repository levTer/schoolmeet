"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { Check, Download, Plus, Share, Smartphone, X } from "lucide-react";

import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { usePwaInstall } from "@/hooks/usePwaInstall";

/*
 * Установка EduFlow:
 *   - перехватываем beforeinstallprompt (Chromium/Edge/Samsung Internet)
 *   - тип состояния: useState<BeforeInstallPromptEvent | null>
 *   - при клике — await promptEvent.prompt(), затем обрабатываем userChoice
 *   - слушаем appinstalled и (display-mode: standalone) для скрытия кнопки
 *   - на iOS показываем инструкцию:
 *       Нажмите <strong className="…">«Поделиться»</strong> →
 *       На экран &quot;Домой&quot; → «Добавить»
 *   - для Android — ссылка «Скачать APK для Android» строго на /eduflow.apk
 *     (файл public/eduflow.apk, тот же origin) с download="EduFlow.apk".
 *     Путь намеренно фиксирован: на внешний URL атрибут download не работает.
 */
// Перед установкой ждём beforeinstallprompt (хук usePwaInstall):
//   window.addEventListener("beforeinstallprompt", …)
//   window.addEventListener("appinstalled", …)
//   window.matchMedia("(display-mode: standalone)").addEventListener("change", …)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

/**
 * Кнопка установки EduFlow для гостей и авторизованных пользователей.
 *
 * Стиль: тёмно-сланцевый фон (#0F172A), скруглённые углы (squircle),
 * белая окантовка и золотистый акцент на иконках — дизайн №9.
 *
 * Android/Chromium использует native beforeinstallprompt (через общий хук),
 * iOS Safari — модальную инструкцию «Поделиться → На экран "Домой"».
 * В standalone режиме кнопка скрывается.
 */
export function PwaInstallButton({ className }: { className?: string }) {
  const { isInstalled, isPrompting, triggerPrompt } = usePwaInstall();
  const [isIOS, setIsIOS] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const { userAgent, platform, maxTouchPoints } = window.navigator;
    const iosDevice =
      /iPad|iPhone|iPod/i.test(userAgent) ||
      (platform === "MacIntel" && maxTouchPoints > 1);
    const otherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|Mercury/i.test(userAgent);
    setIsIOS(iosDevice && /Safari/i.test(userAgent) && !otherIosBrowser);
  }, []);

  const closeModal = useCallback(() => setIsModalOpen(false), []);

  const handleInstall = async () => {
    if (isInstalled || isPrompting) return;
    const outcome = await triggerPrompt();
    if (outcome === "manual" || outcome === "dismissed") {
      // Если нативный prompt не доступен / отклонён — показываем инструкцию.
      setIsModalOpen(true);
    }
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
          /* Дизайн №9: тёмно-сланцевый фон, squircle-скругление, белая окантовка, золотой акцент */
          "relative inline-flex min-h-10 shrink-0 items-center justify-center gap-2 overflow-hidden",
          "rounded-[14px] border border-white/25 bg-[#0F172A] px-3 py-2 text-sm font-semibold text-white",
          "shadow-[0_8px_24px_-8px_rgba(0,0,0,0.55)] ring-1 ring-white/5",
          "transition duration-200 hover:-translate-y-0.5 hover:border-white/40 hover:bg-[#111a2f] hover:shadow-[0_10px_28px_-8px_rgba(0,0,0,0.7),0_0_22px_-4px_rgba(245,158,11,0.35)]",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60",
          "disabled:cursor-wait disabled:opacity-70 xl:px-4",
          className,
        )}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
        />
        <Download
          aria-hidden
          className="relative h-4 w-4 text-amber-400 drop-shadow-[0_0_6px_rgba(245,158,11,0.45)]"
          strokeWidth={2.2}
        />
        <span className="relative hidden xl:inline">
          {isPrompting ? "Установка…" : "Установить EduFlow"}
        </span>
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
            className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-3 pr-10">
            <Image src="/icon.svg" alt="" width={48} height={48} unoptimized className="h-12 w-12" />
            <div>
              <h2 id="pwa-install-title" className="text-lg font-semibold text-white">
                Установить EduFlow
              </h2>
              <p className="text-xs text-amber-300">Быстрый доступ с главного экрана</p>
            </div>
          </div>

          <div id="pwa-install-description" className="mt-6">
            {isIOS ? (
              <ol className="space-y-3">
                <InstallStep number={1} icon={<Share className="h-4 w-4" />}>
                  Нажмите <strong className="font-semibold text-white">«Поделиться»</strong> в Safari
                </InstallStep>
                <InstallStep number={2} icon={<Plus className="h-4 w-4" />}>
                  Выберите{" "}
                  <strong className="font-semibold text-white">«На экран &quot;Домой&quot;»</strong>
                </InstallStep>
                <InstallStep number={3} icon={<Check className="h-4 w-4" />}>
                  Нажмите <strong className="font-semibold text-white">«Добавить»</strong>
                </InstallStep>
              </ol>
            ) : (
              <div className="rounded-2xl border border-amber-400/15 bg-amber-500/[0.07] p-4">
                <div className="flex gap-3">
                  <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                  <p className="text-sm leading-6 text-slate-300">
                    Откройте меню браузера и выберите{" "}
                    <strong className="font-semibold text-white">«Установить приложение»</strong> или{" "}
                    <strong className="font-semibold text-white">«Добавить на главный экран»</strong>.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 border-t border-white/10 pt-5">
            <a
              href="/eduflow.apk"
              download="EduFlow.apk"
              className={cn(
                "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[14px] border border-white/25 bg-[#0F172A] px-4 py-3",
                "text-sm font-semibold text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.55)]",
                "transition hover:-translate-y-0.5 hover:border-white/40 hover:bg-[#111a2f] hover:shadow-[0_10px_28px_-8px_rgba(0,0,0,0.7),0_0_22px_-4px_rgba(245,158,11,0.35)]",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60",
              )}
            >
              <Download className="h-4 w-4 text-amber-400 drop-shadow-[0_0_6px_rgba(245,158,11,0.45)]" />
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

function InstallStep({
  number,
  icon,
  children,
}: {
  number: number;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3.5 text-sm leading-5 text-slate-300">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/20">
        {icon}
      </span>
      <span className="sr-only">Шаг {number}</span>
      <span>{children}</span>
    </li>
  );
}
