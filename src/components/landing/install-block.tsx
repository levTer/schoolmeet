"use client";

import { useState } from "react";
import Image from "next/image";
import { Download, Smartphone } from "lucide-react";

import { cn } from "@/lib/utils";
import { usePwaInstall } from "@/hooks/usePwaInstall";

/**
 * Блок «Установить EduFlow» на главной странице (Hero-секция).
 *
 * Две чёткие, лаконичные кнопки в стиле дизайна №9:
 *   А) «📲 Установить как приложение» — PWA-установка в 1 клик через браузер
 *      (вызывает beforeinstallprompt; если prompt не готов — откроется
 *      инструкция в шапочной кнопке через всплывающее меню).
 *   Б) «🤖 Скачать APK для Android» — ссылка строго на /eduflow.apk
 *      (файл public/eduflow.apk, тот же origin), скачивается через download.
 *
 * Стиль: тёмно-сланцевый фон (#0F172A), скруглённые углы (squircle),
 * белая окантовка и золотистый акцент на иконках.
 */
export function InstallBlock() {
  const { isInstalled, isPrompting, triggerPrompt } = usePwaInstall();
  const [hint, setHint] = useState<string | null>(null);

  if (isInstalled) return null;

  const handlePwaClick = async () => {
    const outcome = await triggerPrompt();
    if (outcome === "manual") {
      setHint("Откройте меню браузера → «Установить приложение» или «Добавить на главный экран».");
    }
  };

  const squircleButton =
    "group relative inline-flex min-h-12 items-center justify-center gap-2.5 overflow-hidden " +
    "rounded-[18px] border border-white/25 bg-[#0F172A] px-6 py-3 text-sm sm:text-base font-semibold text-white " +
    "shadow-[0_10px_30px_-10px_rgba(0,0,0,0.65)] ring-1 ring-white/5 " +
    "transition duration-200 hover:-translate-y-0.5 hover:border-white/40 hover:bg-[#111a2f] " +
    "hover:shadow-[0_14px_36px_-10px_rgba(0,0,0,0.8),0_0_28px_-6px_rgba(245,158,11,0.4)] " +
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70";

  const goldIcon =
    "h-5 w-5 text-amber-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.55)] transition-transform group-hover:scale-110";

  return (
    <div className="animate-fade-up mt-8 flex w-full flex-col items-center gap-4 [animation-delay:380ms]">
      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-slate-400 backdrop-blur">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.8)]" />
        Установить EduFlow
      </div>

      <div className="flex w-full max-w-xl flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
        {/* Кнопка A: PWA-установка */}
        <button
          type="button"
          onClick={() => void handlePwaClick()}
          disabled={isPrompting}
          className={cn(squircleButton, "flex-1", isPrompting && "cursor-wait opacity-70")}
          aria-label="Установить EduFlow как приложение"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
          />
          <Smartphone aria-hidden className={goldIcon} strokeWidth={2} />
          <span className="relative">
            {isPrompting ? "Установка…" : "📲 Установить как приложение"}
          </span>
        </button>

        {/* Кнопка Б: APK из public/eduflow.apk — путь фиксирован, без env-переопределений. */}
        <a
          href="/eduflow.apk"
          download="EduFlow.apk"
          className={cn(squircleButton, "flex-1")}
          aria-label="Скачать APK для Android"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
          />
          <Download aria-hidden className={goldIcon} strokeWidth={2} />
          <span className="relative">🤖 Скачать APK для Android</span>
        </a>
      </div>

      <p className="text-center text-xs leading-relaxed text-slate-500">
        <Image
          src="/icon.svg"
          alt=""
          width={16}
          height={16}
          unoptimized
          className="mr-1.5 inline-block h-4 w-4 align-[-2px]"
        />
        PWA работает в любом современном браузере · APK для Android 8+ · без ZIP-архивов
      </p>

      {hint && (
        <button
          type="button"
          onClick={() => setHint(null)}
          className="max-w-xl rounded-xl border border-amber-400/20 bg-amber-500/[0.08] px-4 py-2.5 text-left text-xs leading-relaxed text-amber-100/90 transition hover:bg-amber-500/[0.12]"
        >
          {hint}
          <span className="ml-2 text-amber-300/80 underline-offset-2 hover:underline">(закрыть)</span>
        </button>
      )}
    </div>
  );
}
