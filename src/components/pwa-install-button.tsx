"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import { ArrowLeft, Check, Download, Plus, Share, X } from "lucide-react";

import { Modal } from "@/components/ui/modal";
import { WINDOWS_SMARTSCREEN_NOTE } from "@/lib/install-copy";
import { cn } from "@/lib/utils";
import { usePwaInstall } from "@/hooks/usePwaInstall";

/*
 * Установка EduFlow — БЕЗ авто-детекции ОС и фильтрации устройств:
 *   - перехватываем beforeinstallprompt (Chromium/Edge/Samsung Internet)
 *   - тип состояния: useState<BeforeInstallPromptEvent | null>
 *   - при клике — await promptEvent.prompt(), затем обрабатываем userChoice
 *   - слушаем appinstalled и (display-mode: standalone) для скрытия кнопки
 *   - модальное окно ВСЕГДА показывает все 3 варианта списком (дизайн №9):
 *       1) 🤖 Скачать APK для Android    → <a href="/eduflow.apk" download="EduFlow.apk">
 *       2) 💻 Скачать для Windows (.exe / portable)
 *          → <a href="/eduflow-windows.zip" download="EduFlow-windows.zip">
 *       3) 🍏 Скачать для Mac (.dmg) → /eduflow.dmg
 *     Одинаковый набор кнопок виден каждому — и на ПК, и на телефоне.
 *   - прямая ссылка на APK строго локальная: `/eduflow.apk` (тот же origin),
 *     иначе атрибут download не работает.
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
 * Стиль: тёмно-сланцевый фон (#0F172A), скругление rounded-[18px],
 * белая окантовка border-white/20 и золотисто-янтарные иконки (#F59E0B) — дизайн №9.
 *
 * Фильтрации по типу устройства НЕТ: в модалке одновременно показаны все три
 * варианта — Android (APK), Windows (портативный .exe) и Mac (DMG).
 */
export function PwaInstallButton({ className }: { className?: string }) {
  const { isInstalled, isPrompting, triggerPrompt } = usePwaInstall();
  const [isModalOpen, setIsModalOpen] = useState(false);
  // false — список из всех 3 вариантов, true — пошаговая подсказка 🍏.
  const [showAppleHelp, setShowAppleHelp] = useState(false);

  const openModal = useCallback(() => {
    setShowAppleHelp(false);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setShowAppleHelp(false);
  }, []);

  const handleInstall = async () => {
    if (isInstalled || isPrompting) return;
    const outcome = await triggerPrompt();
    if (outcome === "manual" || outcome === "dismissed") {
      // Если нативный prompt не доступен / отклонён — показываем все 3 варианта.
      openModal();
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
              <p className="text-xs text-amber-300">Все 3 варианта — для любой платформы</p>
            </div>
          </div>

          <div id="pwa-install-description" className="mt-6">
            {showAppleHelp ? (
              /* 🍏 Пошаговая подсказка для Safari / Chrome. */
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => setShowAppleHelp(false)}
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
                    🍏
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">Установить для Mac / iPhone</p>
                    <p className="text-xs text-amber-300">
                      Safari и Chrome — «Поделиться» или «Установить»
                    </p>
                  </div>
                </div>

                <ol className="space-y-3">
                  <InstallStep number={1} icon={<Share className="h-4 w-4" />}>
                    Нажмите <strong className="font-semibold text-white">«Поделиться»</strong> в
                    Safari или <strong className="font-semibold text-white">«Установить»</strong> в
                    Chrome
                  </InstallStep>
                  <InstallStep number={2} icon={<Plus className="h-4 w-4" />}>
                    Выберите{" "}
                    <strong className="font-semibold text-white">«На экран &quot;Домой&quot;»</strong>{" "}
                    на iPhone / iPad — или{" "}
                    <strong className="font-semibold text-white">«Добавить на главный экран»</strong>
                  </InstallStep>
                  <InstallStep number={3} icon={<Check className="h-4 w-4" />}>
                    Нажмите <strong className="font-semibold text-white">«Добавить»</strong> —
                    иконка EduFlow появится на экране или в Dock
                  </InstallStep>
                </ol>

                <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-xs leading-5 text-slate-400">
                  <strong className="font-semibold text-slate-200">Safari на Mac:</strong> «Файл» →{" "}
                  <strong className="font-semibold text-slate-200">«Добавить в Dock»</strong>.{" "}
                  <strong className="font-semibold text-slate-200">Chrome на Android:</strong> меню
                  «⋮» → «Установить».
                </p>
              </div>
            ) : (
              /* Все 3 варианта списком — одинаково для ПК, Android, Mac и iPhone. */
              <div className="flex flex-col gap-3">
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
                  href="/eduflow-windows.zip"
                  download="EduFlow-windows.zip"
                  className={installerTile}
                  aria-label="Скачать портативную версию для Windows (.exe в ZIP-архиве)"
                >
                  <span aria-hidden className={tileShine} />
                  <span className="relative text-sm font-semibold leading-snug text-white">
                    💻 Скачать для Windows (.exe / portable)
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
                <button type="button" onClick={() => setShowAppleHelp(true)} className="text-xs text-slate-400 underline hover:text-white">
                  Установка через браузер на Mac / iPhone
                </button>

                {/* Windows: неподписанный .exe → предупреждение SmartScreen. */}
                <p
                  id="windows-smartscreen-note"
                  className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3.5 py-3 text-xs leading-5 text-amber-100/90"
                >
                  {WINDOWS_SMARTSCREEN_NOTE}
                </p>
              </div>
            )}
          </div>

          {!showAppleHelp && (
            <p className="mt-4 text-center text-xs leading-5 text-slate-500">
              APK для Android · Portable (.exe) для Windows 10/11 · DMG для Mac (неподписанный веб-лаунчер, открывает EduFlow в браузере)
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
