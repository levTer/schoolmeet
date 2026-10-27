"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import { ArrowLeft, Check, Download, Plus, Share, X } from "lucide-react";

import { Modal } from "@/components/ui/modal";
import { WINDOWS_SMARTSCREEN_NOTE } from "@/lib/install-copy";
import { cn } from "@/lib/utils";
import { useIsApp } from "@/hooks/useIsApp";
import { usePwaInstall } from "@/hooks/usePwaInstall";

/**
 * Кнопка в шапке сначала показывает способы установки, не запуская PWA prompt.
 * APK, Windows и Mac остаются прямыми ссылками; только отдельная кнопка PWA
 * вызывает сохранённый beforeinstallprompt через общий хук usePwaInstall.
 * Варианты доступны на всех устройствах без авто-детекции ОС.
 */
export function PwaInstallButton({ className }: { className?: string }) {
  const isApp = useIsApp();
  const { isInstalled, isPrompting, triggerPrompt } = usePwaInstall();
  const [isModalOpen, setIsModalOpen] = useState(false);
  // false — способы установки, true — ручная установка PWA через браузер.
  const [showPwaHelp, setShowPwaHelp] = useState(false);

  const openModal = useCallback(() => {
    setShowPwaHelp(false);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setShowPwaHelp(false);
  }, []);

  const handlePwaInstall = async () => {
    if (isInstalled || isPrompting) return;
    const outcome = await triggerPrompt();
    if (outcome === "manual") setShowPwaHelp(true);
    if (outcome === "accepted") closeModal();
  };

  if (isApp || isInstalled) return null;

  return (
    <>
      <button
        type="button"
        onClick={openModal}
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

      {/* Шапка может иметь backdrop-filter: портал не даёт ей обрезать fixed-оверлей. */}
      <Modal
        portal
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
              <p id="pwa-install-description" className="text-xs text-amber-300">
                Скачайте файл или установите PWA через браузер
              </p>
            </div>
          </div>

          <div className="mt-6">
            {showPwaHelp ? (
              /* Ручная установка PWA, если нативный prompt недоступен. */
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => setShowPwaHelp(false)}
                  className="-ml-1.5 inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-slate-400 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
                  Ко всем вариантам установки
                </button>

                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] border border-white/10 bg-amber-500/10 text-xl ring-1 ring-inset ring-amber-400/20"
                  >
                    📲
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">Добавить PWA через браузер</p>
                    <p className="text-xs text-amber-300">
                      Если браузер не предлагает установку автоматически
                    </p>
                  </div>
                </div>

                <ol className="space-y-3">
                  <InstallStep number={1} icon={<Share className="h-4 w-4" />}>
                    На iPhone / iPad нажмите <strong className="font-semibold text-white">«Поделиться»</strong>{" "}
                    в Safari; на Android откройте меню <strong className="font-semibold text-white">«⋮»</strong>{" "}
                    в Chrome
                  </InstallStep>
                  <InstallStep number={2} icon={<Plus className="h-4 w-4" />}>
                    Выберите{" "}
                    <strong className="font-semibold text-white">«На экран &quot;Домой&quot;»</strong>{" "}
                    на iPhone / iPad — или <strong className="font-semibold text-white">«Установить приложение»</strong>{" "}
                    / <strong className="font-semibold text-white">«Добавить на главный экран»</strong> на Android
                  </InstallStep>
                  <InstallStep number={3} icon={<Check className="h-4 w-4" />}>
                    Нажмите <strong className="font-semibold text-white">«Добавить»</strong> или{" "}
                    <strong className="font-semibold text-white">«Установить»</strong> — иконка EduFlow
                    появится на домашнем экране
                  </InstallStep>
                </ol>

                <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-xs leading-5 text-slate-400">
                  <strong className="font-semibold text-slate-200">Safari на Mac:</strong> «Файл» →{" "}
                  <strong className="font-semibold text-slate-200">«Добавить в Dock»</strong>.
                </p>
              </div>
            ) : (
              /* APK и PWA разделены; установщики Windows / Mac также доступны всем. */
              <div className="flex flex-col gap-3">
                <a
                  href="/eduflow.apk"
                  download="EduFlow.apk"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={installerTile}
                >
                  <span aria-hidden className={tileShine} />
                  <span className="relative text-sm font-semibold leading-snug text-white">
                    🤖 Скачать файл APK напрямую
                  </span>
                  <Download aria-hidden className={goldIcon} strokeWidth={2} />
                </a>

                <button
                  type="button"
                  onClick={() => void handlePwaInstall()}
                  disabled={isPrompting}
                  className={cn(
                    installerTile,
                    "border-amber-400/40 bg-amber-500/10 hover:border-amber-300/70 hover:bg-amber-500/20 disabled:cursor-wait disabled:opacity-60",
                  )}
                >
                  <span aria-hidden className={tileShine} />
                  <span className="relative text-sm font-semibold leading-snug text-white">
                    📲 Добавить иконку на экран (PWA)
                  </span>
                  <Plus aria-hidden className={goldIcon} strokeWidth={2} />
                </button>

                <a
                  href="/eduflow-setup.exe"
                  download="EduFlow-Setup.exe"
                  className={installerTile}
                  aria-label="Скачать установщик для Windows (.exe)"
                >
                  <span aria-hidden className={tileShine} />
                  <span className="relative text-sm font-semibold leading-snug text-white">
                    💻 Скачать для Windows (.exe Установщик)
                  </span>
                  <Download aria-hidden className={goldIcon} strokeWidth={2} />
                </a>

                <a
                  href="/eduflow.dmg"
                  download="EduFlow.dmg"
                  className={installerTile}
                  aria-label="Скачать для Mac (.dmg)"
                >
                  <span aria-hidden className={tileShine} />
                  <span className="relative text-sm font-semibold leading-snug text-white">
                    🍏 Скачать для Mac (.dmg)
                  </span>
                  <Download aria-hidden className={goldIcon} strokeWidth={2} />
                </a>
                <button type="button" onClick={() => setShowPwaHelp(true)} className="text-xs text-slate-400 underline hover:text-white">
                  Как добавить PWA через браузер
                </button>

                {/* Windows: неподписанный .exe → предупреждение SmartScreen. */}
                <div
                  id="windows-smartscreen-note"
                  className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3.5 py-3 text-xs leading-5 text-amber-100/90"
                >
                  <p className="font-semibold uppercase tracking-widest text-amber-300">
                    💻 Windows — установщик .exe
                  </p>
                  <p className="mt-1.5">{WINDOWS_SMARTSCREEN_NOTE}</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-4 text-amber-100/90">
                    <li>Скачайте EduFlow-Setup.exe (~90 МБ) кнопкой выше.</li>
                    <li>Откройте файл двойным щелчком и подтвердите запуск.</li>
                    <li>Нажмите «Установить» — ярлык EduFlow появится на рабочем столе.</li>
                    <li>Запустите EduFlow: приложение откроется в отдельном окне.</li>
                  </ol>
                </div>
              </div>
            )}
          </div>

          {!showPwaHelp && (
            <p className="mt-4 text-center text-xs leading-5 text-slate-500">
              APK для Android · PWA через браузер · .exe для Windows · DMG для Mac (неподписанный веб-лаунчер)
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

/**
 * Плитка варианта установки в модалке — дизайн №9:
 * фон `#0F172A`, скругление `rounded-[18px]`, окантовка `border-white/20`,
 * золотисто-янтарная иконка `#F59E0B` (amber-500).
 */
const installerTile =
  "group relative flex min-h-[76px] w-full items-center justify-between gap-2.5 overflow-hidden " +
  "rounded-[18px] border border-white/20 bg-[#0F172A] px-4 py-3.5 text-left " +
  "shadow-[0_10px_30px_-10px_rgba(0,0,0,0.65)] ring-1 ring-white/5 " +
  "transition duration-200 hover:-translate-y-0.5 hover:border-white/40 hover:bg-[#111a2f] " +
  "hover:shadow-[0_14px_36px_-10px_rgba(0,0,0,0.8),0_0_28px_-6px_rgba(245,158,11,0.4)] " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70";

const goldIcon =
  "relative h-5 w-5 shrink-0 text-amber-500 drop-shadow-[0_0_8px_rgba(245,158,11,0.55)] " +
  "transition-transform group-hover:scale-110";

const tileShine =
  "pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent";

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
