"use client";

import { cn } from "@/lib/utils";
import { THEME_OPTIONS } from "@/lib/theme";

import { useTheme } from "./theme-provider";

interface ThemeSwitcherProps {
  /** Small version for a compact header row; the full version includes a caption. */
  compact?: boolean;
  className?: string;
}

export function ThemeSwitcher({ compact = false, className }: ThemeSwitcherProps) {
  const { theme, setTheme } = useTheme();

  return (
    <div className={cn("flex items-center gap-3", compact ? "justify-center" : "justify-between", className)}>
      {!compact ? (
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white">Цветовая тема</p>
          <p className="mt-0.5 text-[11px] text-slate-400">Сохранится на этом устройстве</p>
        </div>
      ) : null}

      <div
        role="group"
        aria-label="Выбор цветовой темы"
        className={cn("flex shrink-0 items-center", compact ? "gap-1" : "gap-2")}
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
                "rounded-full border transition duration-200 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900",
                compact ? "h-5 w-5" : "h-7 w-7",
                isSelected
                  ? "border-white ring-2 ring-white/90 ring-offset-2 ring-offset-ink-900"
                  : "border-white/35 hover:border-white/80",
              )}
              style={{
                backgroundImage: `linear-gradient(145deg, ${option.background} 8%, ${option.accent} 100%)`,
              }}
            >
              <span className="sr-only">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
