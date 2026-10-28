"use client";

import { Settings2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { getThemeOption, TEXT_SIZE_OPTIONS, type TextSize } from "@/lib/theme";
import { cn } from "@/lib/utils";

import { ThemeSwitcher } from "./ThemeSwitcher";
import { useTheme } from "./theme-provider";

const TEXT_SIZE_SAMPLE_CLASS: Record<TextSize, string> = {
  small: "text-sm",
  normal: "text-base",
  large: "text-lg",
};

interface AppearanceSettingsMenuProps {
  className?: string;
}

/**
 * Меню «Внешний вид»: пять тем дизайн-системы и размер текста.
 *
 * Каждая тема меняет акцент и цвет системной полосы (Android status bar,
 * Electron title bar). Выбор сохраняется в localStorage и применяется до
 * первой отрисовки bootstrap-скриптом из layout.tsx.
 */
export function AppearanceSettingsMenu({ className }: AppearanceSettingsMenuProps) {
  const { theme, textSize, setTextSize } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const activeTheme = getThemeOption(theme);

  return (
    <div ref={rootRef} className={cn("relative shrink-0", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Открыть настройки внешнего вида"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => setIsOpen((open) => !open)}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors",
          isOpen
            ? "border-white/20 bg-white/[0.08] text-white"
            : "border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.06] hover:text-white",
        )}
      >
        <Settings2 aria-hidden="true" className="h-4 w-4" />
      </button>

      {isOpen ? (
        <div
          id={menuId}
          role="dialog"
          aria-label="Настройки внешнего вида"
          className="animate-fade-up absolute right-0 top-full z-[70] mt-2 w-[19rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-white/10 bg-surface text-left shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5">
            <div>
              <p className="text-sm font-semibold text-white">Внешний вид</p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {activeTheme.label} · сохраняется на устройстве
              </p>
            </div>
            <button
              type="button"
              aria-label="Закрыть настройки"
              onClick={() => setIsOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/[0.06] hover:text-white"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>

          <section aria-labelledby={`${menuId}-theme`} className="px-3.5 py-3">
            <p id={`${menuId}-theme`} className="mb-2 text-xs font-medium text-slate-400">
              Тема
            </p>
            <ThemeSwitcher />
          </section>

          <section
            aria-labelledby={`${menuId}-text-size`}
            className="border-t border-white/10 px-3.5 py-3"
          >
            <p id={`${menuId}-text-size`} className="mb-2 text-xs font-medium text-slate-400">
              Размер текста
            </p>
            <div role="group" aria-label="Размер текста" className="grid grid-cols-3 gap-1.5">
              {TEXT_SIZE_OPTIONS.map((option) => {
                const isSelected = textSize === option.id;

                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-label={`Аа (${option.label})`}
                    aria-pressed={isSelected}
                    onClick={() => setTextSize(option.id)}
                    className={cn(
                      "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-2 transition-colors",
                      isSelected
                        ? "border-brand-400/40 bg-brand-500/15 text-white"
                        : "border-white/10 bg-white/[0.02] text-slate-300 hover:border-white/20 hover:bg-white/[0.05] hover:text-white",
                    )}
                  >
                    <span className={cn("font-semibold leading-none", TEXT_SIZE_SAMPLE_CLASS[option.id])}>
                      Аа
                    </span>
                    <span className="text-[10px] leading-none text-slate-400">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
