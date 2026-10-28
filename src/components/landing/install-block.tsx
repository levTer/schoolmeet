"use client";

import { useState } from "react";
import Image from "next/image";
import { Check, Download, Plus, Share, X } from "lucide-react";

import { Modal } from "@/components/ui/modal";
import { useIsApp } from "@/hooks/useIsApp";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import { WINDOWS_SMARTSCREEN_NOTE } from "@/lib/install-copy";
import { cn } from "@/lib/utils";

/**
 * Плитка варианта установки в дизайн-системе: карточка `#111827`,
 * окантовка `border-white/10`, скругление `rounded-lg`, без золота и свечения.
 */
const installerTile =
  "group flex min-h-[44px] w-full items-center justify-between gap-2.5 " +
  "rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2 text-left " +
  "transition-colors duration-150 hover:border-white/20 hover:bg-white/[0.05] " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70";

const goldIcon = "h-4 w-4 shrink-0 text-brand-400 transition-transform group-hover:translate-y-0.5";

/**
 * Блок установки EduFlow (дизайн №9).
 *
 * Отдельные варианты без авто-детекции ОС: прямое скачивание APK для Android,
 * установка PWA через браузер и установщики Windows / Mac. Системный PWA prompt
 * вызывается только кнопкой PWA; ссылка на APK не содержит обработчика клика.
 *
 * Все три файла лежат в `public/`, поэтому ссылки относительные: атрибут `download`
 * работает только для того же origin. Service Worker (`public/sw.js`) не
 * перехватывает `.apk`, `.exe`, `.zip` и `.dmg` — файлы скачиваются как бинарные
 * данные и не подменяются закэшированным HTML (иначе вместо установщика на 90 МБ
 * пользователь получил бы страницу сайта с расширением .exe).
 */
export function InstallBlock() {
  const isApp = useIsApp();
  const { isInstalled, isPrompting, triggerPrompt } = usePwaInstall();
  const [isPwaHelpOpen, setIsPwaHelpOpen] = useState(false);
  const [isInstallerHelpOpen, setIsInstallerHelpOpen] = useState(false);

  const handlePwaInstall = async () => {
    if (isInstalled || isPrompting) return;
    const outcome = await triggerPrompt();
    if (outcome === "manual") setIsPwaHelpOpen(true);
  };

  if (isApp) return null;

  return (
    <div className="animate-fade-up mx-auto mt-6 w-full max-w-2xl text-left">
      <div className="card px-3 py-3 sm:px-4">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
            Установить EduFlow
          </p>
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            APK · PWA · EXE · DMG
          </span>
        </div>

        <p className="mt-1 text-[11px] text-slate-500">
          Скачайте установочный файл или добавьте веб-приложение через браузер.
        </p>

        <div className="mt-2 grid w-full grid-cols-1 gap-1.5 sm:grid-cols-2">
          <a
            href="/eduflow.apk"
            download="EduFlow.apk"
            target="_blank"
            rel="noopener noreferrer"
            className={installerTile}
          >
            <span className="truncate text-xs font-medium leading-snug text-white">
              🤖 Скачать файл APK напрямую
            </span>
            <Download aria-hidden className={goldIcon} strokeWidth={2} />
          </a>

          <button
            type="button"
            onClick={() => void handlePwaInstall()}
            disabled={isPrompting || isInstalled}
            className={cn(
              installerTile,
              "border-brand-400/30 bg-brand-500/[0.08] hover:border-brand-400/50 hover:bg-brand-500/[0.14] disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            <span className="truncate text-xs font-medium leading-snug text-white">
              📲 Добавить иконку на экран (PWA)
              {isInstalled && <span className="mt-1 block text-xs text-brand-200">PWA уже установлено</span>}
            </span>
            <Plus aria-hidden className={goldIcon} strokeWidth={2} />
          </button>

          <a
            href="/eduflow-setup.exe"
            download="EduFlow-Setup.exe"
            className={installerTile}
            aria-label="Скачать установщик для Windows (.exe)"
          >
            <span className="truncate text-xs font-medium leading-snug text-white">
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
            <span className="truncate text-xs font-medium leading-snug text-white">
              🍏 Скачать для Mac (.dmg)
            </span>
            <Download aria-hidden className={goldIcon} strokeWidth={2} />
          </a>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          Windows: скачайте установщик .exe (~90 МБ) и запустите его — приложение появится на
          рабочем столе. Неподписанный .exe → SmartScreen «Подробнее → Выполнить в любом случае».
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
          DMG для Mac: неподписанный веб-лаунчер, открывает EduFlow в браузере.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <button
            type="button"
            onClick={() => setIsPwaHelpOpen(true)}
            className="text-xs text-slate-400 underline hover:text-white"
          >
            Как добавить PWA через браузер
          </button>
          <button
            type="button"
            onClick={() => setIsInstallerHelpOpen(true)}
            className="text-xs text-brand-300 underline decoration-brand-400/40 underline-offset-2 hover:text-brand-200"
          >
            Инструкция для Windows (.exe)
          </button>
        </div>

        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] leading-relaxed text-slate-500">
          <Image
            src="/icon.svg"
            alt=""
            width={16}
            height={16}
            unoptimized
            className="inline-block h-4 w-4 align-[-2px]"
          />
          <span>APK для Android · PWA через браузер · .exe для Windows · DMG для Mac</span>
        </p>
      </div>

      {/* Анимированный блок создаёт stacking context — оверлеям нужен портал в body. */}
      <Modal
        portal
        open={isPwaHelpOpen}
        onClose={() => setIsPwaHelpOpen(false)}
        labelledBy="install-help-title"
        describedBy="install-help-description"
        className="border-white/10 bg-surface shadow-xl sm:max-w-md"
      >
        <div className="relative p-6 sm:p-7">
          <button
            type="button"
            onClick={() => setIsPwaHelpOpen(false)}
            className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60"
            aria-label="Закрыть инструкцию"
          >
            <X aria-hidden className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-3 pr-10">
            <Image
              src="/icon.svg"
              alt=""
              width={48}
              height={48}
              unoptimized
              className="h-12 w-12 shrink-0 rounded-[14px] ring-1 ring-inset ring-white/10"
            />
            <div>
              <h2 id="install-help-title" className="text-lg font-semibold text-white">
                Как добавить EduFlow на экран
              </h2>
              <p className="text-xs text-brand-300">PWA через браузер · Android, iPhone и Mac</p>
            </div>
          </div>

          <p id="install-help-description" className="mt-5 text-sm leading-relaxed text-slate-300">
            Если браузер не предлагает установку автоматически, добавьте веб-приложение через его меню.
          </p>

          <ol className="mt-4 space-y-3">
            <InstallStep icon={<Share className="h-4 w-4" />}>
              На iPhone / iPad нажмите <strong className="font-semibold text-white">«Поделиться»</strong>{" "}
              в Safari; на Android откройте меню <strong className="font-semibold text-white">«⋮»</strong>{" "}
              в Chrome
            </InstallStep>
            <InstallStep icon={<Plus className="h-4 w-4" />}>
              Выберите{" "}
              <strong className="font-semibold text-white">«На экран &quot;Домой&quot;»</strong> на
              iPhone / iPad — или <strong className="font-semibold text-white">«Установить приложение»</strong>{" "}
              / <strong className="font-semibold text-white">«Добавить на главный экран»</strong> на Android
            </InstallStep>
            <InstallStep icon={<Check className="h-4 w-4" />}>
              Нажмите <strong className="font-semibold text-white">«Добавить»</strong> или{" "}
              <strong className="font-semibold text-white">«Установить»</strong> — иконка EduFlow
              появится на домашнем экране
            </InstallStep>
          </ol>

          <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-xs leading-5 text-slate-400">
            <strong className="font-semibold text-slate-200">Safari на Mac:</strong> вместо этого →{" "}
            <strong className="font-semibold text-slate-200">Файл</strong> →{" "}
            <strong className="font-semibold text-slate-200">Добавить в Dock</strong>.
          </p>

          <button
            type="button"
            onClick={() => setIsPwaHelpOpen(false)}
            className="mt-6 w-full rounded-xl bg-brand-500 px-4 py-3 text-sm font-medium text-canvas transition hover:bg-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60"
          >
            Понятно
          </button>
        </div>
      </Modal>

      <Modal
        portal
        open={isInstallerHelpOpen}
        onClose={() => setIsInstallerHelpOpen(false)}
        labelledBy="windows-install-title"
        describedBy="windows-install-description"
        className="border-white/10 bg-surface shadow-xl sm:max-w-md"
      >
        <div className="relative p-6 sm:p-7">
          <button
            type="button"
            onClick={() => setIsInstallerHelpOpen(false)}
            className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60"
            aria-label="Закрыть инструкцию"
          >
            <X aria-hidden className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-3 pr-10">
            <Image
              src="/icon.svg"
              alt=""
              width={48}
              height={48}
              unoptimized
              className="h-12 w-12 shrink-0 rounded-[14px] ring-1 ring-inset ring-white/10"
            />
            <div>
              <h2 id="windows-install-title" className="text-lg font-semibold text-white">
                Установка EduFlow для Windows
              </h2>
              <p className="text-xs text-brand-300">Установщик .exe · Windows 10 / 11</p>
            </div>
          </div>

          <p id="windows-install-description" className="mt-4 text-sm leading-relaxed text-slate-300">
            Скачайте файл <strong className="font-semibold text-white">EduFlow-Setup.exe</strong>{" "}
            (~90 МБ) и запустите его двойным щелчком — установка занимает меньше минуты.
          </p>

          <p className="mt-3 rounded-xl border border-brand-400/25 bg-brand-500/10 p-3 text-xs leading-5 text-brand-100">
            {WINDOWS_SMARTSCREEN_NOTE}
          </p>

          <ol className="mt-4 space-y-3">
            <WindowsStep number={1} icon={<Download className="h-4 w-4" />}>
              Нажмите{" "}
              <strong className="font-semibold text-white">
                «💻 Скачать для Windows (.exe Установщик)»
              </strong>{" "}
              — браузер сохранит файл EduFlow-Setup.exe
            </WindowsStep>
            <WindowsStep number={2} icon={<Share className="h-4 w-4" />}>
              Откройте скачанный файл: если появится синее окно SmartScreen, нажмите{" "}
              <strong className="font-semibold text-white">«Подробнее»</strong> →{" "}
              <strong className="font-semibold text-white">«Выполнить в любом случае»</strong>
            </WindowsStep>
            <WindowsStep number={3} icon={<Plus className="h-4 w-4" />}>
              В окне установщика выберите папку (или оставьте предложенную) и нажмите{" "}
              <strong className="font-semibold text-white">«Установить»</strong>
            </WindowsStep>
            <WindowsStep number={4} icon={<Check className="h-4 w-4" />}>
              Готово: ярлык <strong className="font-semibold text-white">EduFlow</strong> появится на
              рабочем столе и в меню «Пуск». Приложение откроется в отдельном окне и сразу покажет
              платформу
            </WindowsStep>
          </ol>

          <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-xs leading-5 text-slate-400">
            Обновление — просто запустите новый EduFlow-Setup.exe: вход и настройки сохранятся.
          </p>

          <a
            href="/eduflow-setup.exe"
            download="EduFlow-Setup.exe"
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-3 text-sm font-medium text-canvas transition hover:bg-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60"
          >
            <Download aria-hidden className="h-4 w-4" strokeWidth={2.4} />
            Скачать EduFlow-Setup.exe
          </a>

          <button
            type="button"
            onClick={() => setIsInstallerHelpOpen(false)}
            className="mt-3 w-full rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:border-white/30 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60"
          >
            Понятно
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** Шаг инструкции Windows: иконка в золотом круге с номером шага. */
function WindowsStep({
  number,
  icon,
  children,
}: {
  number: number;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3.5 text-sm leading-5 text-slate-300">
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-brand-300 ring-1 ring-white/10">
        {icon}
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand-400 text-[10px] font-bold text-canvas">
          {number}
        </span>
      </span>
      <span>{children}</span>
    </li>
  );
}

/** Шаг инструкции: золотой круг с иконкой и текст. */
function InstallStep({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3.5 text-sm leading-5 text-slate-300">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-brand-300 ring-1 ring-white/10">
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}
