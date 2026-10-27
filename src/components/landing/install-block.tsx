"use client";

import { useState } from "react";
import Image from "next/image";
import { Check, Download, Plus, Share, X } from "lucide-react";

import { Modal } from "@/components/ui/modal";
import { useIsApp } from "@/hooks/useIsApp";
import { WINDOWS_SMARTSCREEN_NOTE } from "@/lib/install-copy";

/**
 * Кнопка-плитка установщика в дизайне №9: тёмно-сланцевый фон `#0F172A`,
 * squircle-скругление, белая окантовка, золотой акцент на иконке и свечении.
 */
const installerTile =
  "group relative flex min-h-[76px] w-full items-center justify-between gap-2.5 overflow-hidden " +
  "rounded-[18px] border border-white/25 bg-[#0F172A] px-4 py-3.5 text-left " +
  "shadow-[0_10px_30px_-10px_rgba(0,0,0,0.65)] ring-1 ring-white/5 " +
  "transition duration-200 hover:-translate-y-0.5 hover:border-white/40 hover:bg-[#111a2f] " +
  "hover:shadow-[0_14px_36px_-10px_rgba(0,0,0,0.8),0_0_28px_-6px_rgba(245,158,11,0.4)] " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70";

const goldIcon =
  "relative h-5 w-5 shrink-0 text-amber-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.55)] " +
  "transition-transform group-hover:scale-110";

const tileShine =
  "pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent";

/**
 * Блок установки EduFlow (дизайн №9).
 *
 * Три нативных пути установки (все три кнопки видны всегда, без авто-детекции ОС):
 *  1. Android — прямая ссылка на `public/eduflow.apk` с атрибутом `download`;
 *  2. Windows 10/11 — полноценный Electron-установщик `public/eduflow-setup.exe`
 *     (~80–100 МБ, движок Chromium, иконка №9) с атрибутом `download`;
 *  3. Mac — прямая ссылка на `public/eduflow.dmg`; отдельная инструкция для браузера:
 *     «Поделиться» / «Установить» → «На экран "Домой"» или «Добавить в Dock».
 *
 * Все три файла лежат в `public/`, поэтому ссылки относительные: атрибут `download`
 * работает только для того же origin. Service Worker (`public/sw.js`) не
 * перехватывает `.apk`, `.exe`, `.zip` и `.dmg` — файлы скачиваются как бинарные
 * данные и не подменяются закэшированным HTML (иначе вместо установщика на 90 МБ
 * пользователь получил бы страницу сайта с расширением .exe).
 */
export function InstallBlock() {
  const isApp = useIsApp();
  const [isAppleHelpOpen, setIsAppleHelpOpen] = useState(false);
  const [isInstallerHelpOpen, setIsInstallerHelpOpen] = useState(false);

  if (isApp) return null;

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

        <p className="mt-3 text-left text-sm leading-relaxed text-slate-400">
          Скачайте приложение для своей платформы — установщик загрузится сразу.
        </p>

        <div className="mt-4 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
          <a
            href="/eduflow.apk"
            download="EduFlow.apk"
            className={installerTile}
            aria-label="Скачать установщик для Android (APK)"
          >
            <span aria-hidden className={tileShine} />
            <span className="relative text-sm font-semibold leading-snug text-white">
              🤖 Скачать APK для Android
            </span>
            <Download aria-hidden className={goldIcon} strokeWidth={2} />
          </a>

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
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-400">
          Windows: скачайте установщик .exe (~90 МБ) и запустите его — приложение появится на
          рабочем столе. Неподписанный .exe → SmartScreen «Подробнее → Выполнить в любом случае».
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          DMG для Mac: неподписанный веб-лаунчер, открывает EduFlow в браузере.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={() => setIsAppleHelpOpen(true)}
            className="text-xs text-slate-400 underline hover:text-white"
          >
            Установка через браузер на Mac / iPhone
          </button>
          <button
            type="button"
            onClick={() => setIsInstallerHelpOpen(true)}
            className="text-xs text-amber-300/90 underline decoration-amber-400/40 underline-offset-2 hover:text-amber-200"
          >
            Инструкция для Windows (.exe)
          </button>
        </div>

        <p className="mt-4 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-xs leading-relaxed text-slate-500">
          <Image
            src="/icon.svg"
            alt=""
            width={16}
            height={16}
            unoptimized
            className="inline-block h-4 w-4 align-[-2px]"
          />
          <span>APK для Android · Установщик .exe для Windows 10/11 · DMG для Mac</span>
        </p>
      </div>

      <Modal
        open={isAppleHelpOpen}
        onClose={() => setIsAppleHelpOpen(false)}
        labelledBy="install-help-title"
        describedBy="install-help-description"
        className="border-white/10 bg-[#0F172A] shadow-[0_24px_90px_rgba(2,6,23,0.75)] sm:max-w-md"
      >
        <div className="relative p-6 sm:p-7">
          <button
            type="button"
            onClick={() => setIsAppleHelpOpen(false)}
            className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
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
              className="h-12 w-12 shrink-0 rounded-[14px] ring-1 ring-inset ring-amber-400/20"
            />
            <div>
              <h2 id="install-help-title" className="text-lg font-semibold text-white">
                Как установить EduFlow
              </h2>
              <p className="text-xs text-amber-300">Windows (.exe), Mac и iPhone</p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-300">
              💻 Windows — установщик .exe
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-200">
              {WINDOWS_SMARTSCREEN_NOTE}
            </p>
            <a
              href="/eduflow-setup.exe"
              download="EduFlow-Setup.exe"
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
            >
              Скачать EduFlow-Setup.exe
            </a>
          </div>

          <p id="install-help-description" className="mt-5 text-sm leading-relaxed text-slate-300">
            Mac / iPhone: откройте EduFlow в Safari (iPhone, iPad, Mac) или Chrome — установка
            веб-приложения выполняется через меню «Поделиться» или «Установить».
          </p>

          <ol className="mt-4 space-y-3">
            <InstallStep icon={<Share className="h-4 w-4" />}>
              Нажмите <strong className="font-semibold text-white">«Поделиться»</strong> в панели
              Safari — или <strong className="font-semibold text-white">«Установить»</strong> в меню
              Chrome
            </InstallStep>
            <InstallStep icon={<Plus className="h-4 w-4" />}>
              Выберите{" "}
              <strong className="font-semibold text-white">«На экран &quot;Домой&quot;»</strong> на
              iPhone / iPad — или{" "}
              <strong className="font-semibold text-white">«Добавить на главный экран»</strong>
            </InstallStep>
            <InstallStep icon={<Check className="h-4 w-4" />}>
              Нажмите <strong className="font-semibold text-white">«Добавить»</strong> — иконка
              EduFlow появится на домашнем экране или в Dock
            </InstallStep>
          </ol>

          <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-xs leading-5 text-slate-400">
            <strong className="font-semibold text-slate-200">Safari на Mac:</strong> вместо этого →{" "}
            <strong className="font-semibold text-slate-200">Файл</strong> →{" "}
            <strong className="font-semibold text-slate-200">Добавить в Dock</strong>.{" "}
            <strong className="font-semibold text-slate-200">Chrome на Android:</strong> меню «⋮» →{" "}
            <strong className="font-semibold text-slate-200">Установить</strong>.
          </p>

          <button
            type="button"
            onClick={() => setIsAppleHelpOpen(false)}
            className="mt-6 w-full rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
          >
            Понятно
          </button>
        </div>
      </Modal>

      <Modal
        open={isInstallerHelpOpen}
        onClose={() => setIsInstallerHelpOpen(false)}
        labelledBy="windows-install-title"
        describedBy="windows-install-description"
        className="border-white/10 bg-[#0F172A] shadow-[0_24px_90px_rgba(2,6,23,0.75)] sm:max-w-md"
      >
        <div className="relative p-6 sm:p-7">
          <button
            type="button"
            onClick={() => setIsInstallerHelpOpen(false)}
            className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
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
              className="h-12 w-12 shrink-0 rounded-[14px] ring-1 ring-inset ring-amber-400/20"
            />
            <div>
              <h2 id="windows-install-title" className="text-lg font-semibold text-white">
                Установка EduFlow для Windows
              </h2>
              <p className="text-xs text-amber-300">Установщик .exe · Windows 10 / 11</p>
            </div>
          </div>

          <p id="windows-install-description" className="mt-4 text-sm leading-relaxed text-slate-300">
            Скачайте файл <strong className="font-semibold text-white">EduFlow-Setup.exe</strong>{" "}
            (~90 МБ) и запустите его двойным щелчком — установка занимает меньше минуты.
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
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
          >
            <Download aria-hidden className="h-4 w-4" strokeWidth={2.4} />
            Скачать EduFlow-Setup.exe
          </a>

          <button
            type="button"
            onClick={() => setIsInstallerHelpOpen(false)}
            className="mt-3 w-full rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:border-white/30 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
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
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/20">
        {icon}
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-slate-950">
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
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/20">
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}
