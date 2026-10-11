"use client";

import type { ButtonHTMLAttributes } from "react";
import { Loader2, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface GradientButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Показывает спиннер и блокирует повторную отправку. */
  loading?: boolean;
  loadingText?: string;
  icon?: LucideIcon;
  fullWidth?: boolean;
}

/** Основная кнопка действия: фирменный градиент, блик при наведении. */
export function GradientButton({
  children,
  className,
  loading = false,
  loadingText,
  icon: Icon,
  fullWidth = true,
  disabled,
  ...props
}: GradientButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading}
      className={cn(
        "group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white shadow-glow transition",
        "hover:scale-[1.01] hover:shadow-glow-accent focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30",
        "disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100",
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full"
      />

      <span className="relative inline-flex items-center gap-2">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          Icon && <Icon className="h-4 w-4" />
        )}
        {loading && loadingText ? loadingText : children}
      </span>
    </button>
  );
}
