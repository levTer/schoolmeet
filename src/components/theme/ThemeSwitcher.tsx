"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { THEME_OPTIONS } from "@/lib/theme";

import { useTheme } from "./theme-provider";

interface ThemeSwitcherProps {
  /** Компактная версия для шапки: только кружки-образцы. */
  compact?: boolean;
  className?: string;
}

/**
 * Переключатель пяти тем дизайн-системы.
 *
 * Каждая тема задаёт свой `--accent-primary` и `--titlebar-color`; образец
 * показывает акцент на фоне страницы темы. В компактном режиме — кружки,
 * в полном — список с названием и галочкой на активной теме.
 */
export function ThemeSwitcher({ compact = false, className }: ThemeSwitcherProps) {
  const { theme, setTheme } = useTheme();

  if (compact) {
    return (
      <div
        role="group"
        aria-label="Выбор цветовой темы"
        className={cn("flex items-center gap-1.5", className)}
      >
        {THEME_OPTIONS.map((option) => {
          const isSelected = theme === option.id;

          return (
            <button
              key={option.id}
              type="button"
              aria-label={`Выбрать тему «${option.label}»`}
              aria-pressed={isSelected}
              title={option.label}
              onClick={() => setTheme(option.id)}
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-full border transition",
                isSelected
                  ? "border-white/80 ring-2 ring-white/70 ring-offset-2 ring-offset-surface"
                  : "border-white/10 hover:border-white/40",
              )}
              style={{
                backgroundImage: `linear-gradient(145deg, ${option.background} 10%, ${option.accent} 100%)`,
              }}
            >
              <span className="sr-only">{option.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Выбор цветовой темы"
      className={cn("grid gap-2 sm:grid-cols-2", className)}
    >
      {THEME_OPTIONS.map((option) => {
        const isSelected = theme === option.id;

        return (
          <button
            key={option.id}
            type="button"
            aria-label={`Выбрать тему «${option.label}»`}
            aria-pressed={isSelected}
            onClick={() => setTheme(option.id)}
            className={cn(
              "flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition",
              isSelected
                ? "border-white/25 bg-white/[0.06]"
                : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]",
            )}
          >
            <span
              aria-hidden
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15"
              style={{
                backgroundImage: `linear-gradient(145deg, ${option.background} 10%, ${option.accent} 100%)`,
              }}
            >
              {isSelected ? <Check className="h-3.5 w-3.5 text-white drop-shadow" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-white">{option.label}</span>
              <span className="block truncate text-[11px] text-slate-400">{option.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
