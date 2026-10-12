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
          "inline-flex h-10 w-10 items-center justify-center rounded-xl border transition",
          isOpen
            ? "border-brand-400/50 bg-brand-500/15 text-white"
            : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-brand-400/40 hover:bg-brand-500/10 hover:text-white",
        )}
      >
        <Settings2 aria-hidden="true" className="h-5 w-5" />
      </button>

      {isOpen ? (
        <div
          id={menuId}
          role="dialog"
          aria-label="Настройки внешнего вида"
          className="absolute right-0 top-full z-[70] mt-2 w-80 max-w-[calc(100vw_-_2rem)] overflow-hidden rounded-2xl border border-white/10 bg-ink-950/95 text-left shadow-glow backdrop-blur-2xl"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-white">Настройки</p>
              <p className="mt-0.5 text-xs text-slate-400">Внешний вид приложения</p>
            </div>
            <button
              type="button"
              aria-label="Закрыть настройки"
              onClick={() => setIsOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>

          <section aria-labelledby={`${menuId}-theme`} className="px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <p id={`${menuId}-theme`} className="text-sm font-medium text-white">
                Цветовая тема
              </p>
              <span className="truncate text-xs text-slate-400">{activeTheme.label}</span>
            </div>
            <ThemeSwitcher compact className="mt-3 justify-start" />
          </section>

          <section
            aria-labelledby={`${menuId}-text-size`}
            className="border-t border-white/10 px-4 py-4"
          >
            <div className="mb-3">
              <p id={`${menuId}-text-size`} className="text-sm font-medium text-white">
                Размер текста
              </p>
              <p className="mt-0.5 text-xs text-slate-400">Изменится во всём интерфейсе</p>
            </div>
            <div role="group" aria-label="Размер текста" className="grid grid-cols-3 gap-2">
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
                      "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 transition",
                      isSelected
                        ? "border-brand-400/50 bg-brand-500/15 text-white shadow-glow"
                        : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25 hover:bg-white/[0.07] hover:text-white",
                    )}
                  >
                    <span className={cn("font-semibold leading-none", TEXT_SIZE_SAMPLE_CLASS[option.id])}>
                      Аа
                    </span>
                    <span className="text-[10px] leading-none">({option.label})</span>
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
