"use client";

import { useState } from "react";
import Image from "next/image";
import { Download, Monitor, Smartphone, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { usePwaInstall } from "@/hooks/usePwaInstall";

type InstallHelp = "windows" | "ios";

/** Блок установки EduFlow: APK для Android, PWA для Windows и инструкция для iOS. */
export function InstallBlock() {
  const { isInstalled, isPrompting, isWindows, isIOS, triggerPrompt } = usePwaInstall();
  const [installHelp, setInstallHelp] = useState<InstallHelp | null>(null);

  if (isInstalled) return null;

  const handleWindowsInstall = async () => {
    if (!isWindows) {
      setInstallHelp("windows");
      return;
    }
    const outcome = await triggerPrompt();
    if (outcome === "manual") setInstallHelp("windows");
  };

  const squircleButton =
    "group relative inline-flex min-h-12 items-center justify-center gap-2.5 overflow-hidden " +
    "rounded-[18px] border border-white/25 bg-[#0F172A] px-5 py-3 text-sm sm:text-base font-semibold text-white " +
    "shadow-[0_10px_30px_-10px_rgba(0,0,0,0.65)] ring-1 ring-white/5 " +
    "transition duration-200 hover:-translate-y-0.5 hover:border-white/40 hover:bg-[#111a2f] " +
    "hover:shadow-[0_14px_36px_-10px_rgba(0,0,0,0.8),0_0_28px_-6px_rgba(245,158,11,0.4)] " +
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70";

  const goldIcon =
    "h-5 w-5 shrink-0 text-amber-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.55)] transition-transform group-hover:scale-110";

  return (
    <div className="animate-fade-up mx-auto mt-9 flex w-full max-w-2xl flex-col items-center gap-3 [animation-delay:200ms]">
      <div className="relative w-full rounded-[26px] border border-white/10 bg-[#0F172A]/70 px-4 py-6 shadow-[0_24px_70px_-40px_rgba(0,0,0,0.95),0_0_50px_-24px_rgba(245,158,11,0.35)] ring-1 ring-inset ring-white/[0.04] backdrop-blur sm:px-7">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/40 to-transparent"
        />

        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-slate-400 backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.8)]" />
          Установить EduFlow
        </div>

        <div className="mt-4 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
          <a
            href="/eduflow.apk"
            download="EduFlow.apk"
            className={cn(squircleButton, "w-full")}
            aria-label="Скачать APK (Android)"
          >
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
            <Download aria-hidden className={goldIcon} strokeWidth={2} />
            <span className="relative">🤖 Скачать APK (Android)</span>
          </a>

          <button
            type="button"
            onClick={() => void handleWindowsInstall()}
            disabled={isPrompting}
            className={cn(squircleButton, "w-full", isPrompting && "cursor-wait opacity-70")}
            aria-label="Установить на ПК (Windows)"
          >
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
            <Monitor aria-hidden className={goldIcon} strokeWidth={2} />
            <span className="relative">
              {isPrompting ? "Установка…" : "💻 Установить на ПК (Windows)"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setInstallHelp("ios")}
            className={cn(squircleButton, "w-full")}
            aria-label="Установить на iPhone / iPad"
          >
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
            <Smartphone aria-hidden className={goldIcon} strokeWidth={2} />
            <span className="relative">📱 Установить на iPhone / iPad</span>
          </button>
        </div>

        <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
          <Image
            src="/icon.svg"
            alt=""
            width={16}
            height={16}
            unoptimized
            className="mr-1.5 inline-block h-4 w-4 align-[-2px]"
          />
          APK для Android · установка PWA для Windows · Safari на iPhone и iPad
        </p>
      </div>

      {installHelp && (
        <div
          className="fixed inset-0 z-[999] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setInstallHelp(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-help-title"
            className="relative w-full max-w-md rounded-2xl border border-amber-400/20 bg-[#0F172A] p-6 text-left text-white shadow-2xl shadow-black/50"
          >
            <button
              type="button"
              onClick={() => setInstallHelp(null)}
              className="absolute right-4 top-4 rounded-lg p-2 text-slate-400 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              aria-label="Закрыть инструкцию"
            >
              <X aria-hidden className="h-5 w-5" />
            </button>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-amber-400">
              Установка EduFlow
            </p>
            <h2 id="install-help-title" className="pr-8 text-xl font-bold">
              {installHelp === "windows" ? "Установить на Windows" : "Установить на iPhone или iPad"}
            </h2>
            {installHelp === "windows" ? (
              <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-300">
                <p>Откройте EduFlow в Google Chrome или Microsoft Edge, затем выберите один из способов:</p>
                <ol className="list-decimal space-y-2 pl-5 marker:text-amber-400">
                  <li>Нажмите значок установки в адресной строке.</li>
                  <li>Или откройте меню <strong className="text-white">⋮</strong> → <strong className="text-white">Приложения</strong> → <strong className="text-white">Установить EduFlow</strong>.</li>
                </ol>
                <p>Подтвердите установку — EduFlow появится на Рабочем столе и в меню «Пуск».</p>
              </div>
            ) : (
              <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-300">
                <p>Откройте эту страницу в Safari на iPhone или iPad.</p>
                <ol className="list-decimal space-y-2 pl-5 marker:text-amber-400">
                  <li>Нажмите кнопку «Поделиться» внизу экрана.</li>
                  <li>Выберите «На экран Домой», затем нажмите «Добавить».</li>
                </ol>
                {!isIOS && <p className="text-amber-200/80">Для установки на iPhone и iPad используйте именно Safari.</p>}
              </div>
            )}
            <button
              type="button"
              onClick={() => setInstallHelp(null)}
              className="mt-6 w-full rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
            >
              Понятно
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
