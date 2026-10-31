"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { THEME_OPTIONS, THEME_SECTIONS, type ThemeOption } from "@/lib/theme";

import { useTheme } from "./theme-provider";

interface ThemeSwitcherProps {
  /** Компактная версия для шапки: только кружки-образцы. */
  compact?: boolean;
  className?: string;
}

/** Краски палитры одной темой-образцом: точные hex с референса. */
function PaletteStrip({ option, className }: { option: ThemeOption; className?: string }) {
  return (
    <span aria-hidden className={cn("flex h-8 overflow-hidden rounded-lg", className)}>
      {option.palette.map((swatch) => (
        <span
          key={`${option.id}-${swatch.hex}`}
          className="h-full flex-1"
          style={{ backgroundColor: swatch.hex }}
        />
      ))}
    </span>
  );
}

export function ThemeSwitcher({ compact = false, className }: ThemeSwitcherProps) {
  const { theme, setTheme } = useTheme();

  if (compact) {
    return (
      <div
        role="group"
        aria-label="Выбор цветовой темы"
        className={cn("flex flex-wrap items-center gap-1.5", className)}
      >
        {THEME_OPTIONS.map((option) => {
          const isSelected = theme === option.id;

          return (
            <button
              key={option.id}
              type="button"
              aria-label={`Выбрать тему «${option.label}»`}
              aria-pressed={isSelected}
              title={`${option.label} · ${option.palette.map((swatch) => swatch.hex).join(" ")}`}
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
    <div className={cn("space-y-3", className)}>
      {THEME_SECTIONS.map((section) => {
        const options = THEME_OPTIONS.filter((option) => option.group === section.id);

        return (
          <section key={section.id} aria-label={section.title} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                {section.title}
              </p>
              <span className="text-[10px] text-slate-500">{options.length}</span>
            </div>

            <div role="group" aria-label={section.title} className="grid gap-1.5">
              {options.map((option) => {
                const isSelected = theme === option.id;
                const hexLine = option.palette.map((swatch) => swatch.hex).join(" · ");

                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-label={`Выбрать тему «${option.label}» — ${hexLine}`}
                    title={option.palette.map((swatch) => `${swatch.name} ${swatch.hex}`).join(" · ")}
                    aria-pressed={isSelected}
                    onClick={() => setTheme(option.id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl border px-2 py-1.5 text-left transition",
                      isSelected
                        ? "border-white/25 bg-white/[0.07]"
                        : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]",
                    )}
                  >
                    <PaletteStrip option={option} className="w-14 shrink-0 border border-white/10" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium text-white">
                          {option.label}
                        </span>
                        {isSelected ? (
                          <Check className="h-3 w-3 shrink-0 text-white" aria-hidden="true" />
                        ) : null}
                      </span>
                      <span className="mt-0.5 block break-words font-mono text-[10px] leading-snug text-slate-400">
                        {hexLine}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
