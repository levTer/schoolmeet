"use client";

import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Иконка слева внутри поля. */
  icon?: LucideIcon;
  /** Текст ошибки: подсвечивает рамку и выводится под полем. */
  error?: string;
  /** Подсказка под полем, если ошибки нет. */
  hint?: ReactNode;
  /** Кнопка/иконка справа внутри поля (например, «показать пароль»). */
  trailing?: ReactNode;
}

/** Текстовое поле в стилистике SchoolMeet: стекло, свечение при фокусе. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, icon: Icon, error, hint, trailing, className, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedById = `${inputId}-description`;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={inputId}
        className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-slate-400"
      >
        {label}
      </label>

      <div className="relative">
        {Icon && (
          <Icon
            aria-hidden
            className={cn(
              "pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 transition",
              error ? "text-rose-400/80" : "text-slate-500",
            )}
          />
        )}

        <input
          id={inputId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? describedById : undefined}
          className={cn(
            "w-full rounded-xl border bg-white/[0.035] py-3 pr-3.5 text-sm text-white shadow-inner-top outline-none backdrop-blur-xl transition duration-200",
            "placeholder:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60",
            Icon && "pl-10",
            error
              ? "border-rose-500/60 focus:border-rose-400 focus:ring-4 focus:ring-rose-500/15"
              : "border-white/10 hover:border-white/20 focus:border-accent-400/70 focus:bg-white/[0.06] focus:ring-4 focus:ring-accent-500/15",
            trailing && "pr-11",
            className,
          )}
          {...props}
        />

        {trailing && <div className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</div>}
      </div>

      {error ? (
        <p id={describedById} role="alert" className="animate-fade-in text-xs text-rose-300">
          {error}
        </p>
      ) : hint ? (
        <p id={describedById} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

/** Поле пароля с кнопкой «показать/скрыть». */
export const PasswordField = forwardRef<HTMLInputElement, Omit<TextFieldProps, "trailing">>(
  function PasswordField({ type = "password", ...props }, ref) {
    const [isVisible, setIsVisible] = useState(false);

    return (
      <TextField
        ref={ref}
        type={isVisible ? "text" : type}
        trailing={
          <button
            type="button"
            onClick={() => setIsVisible((value) => !value)}
            aria-label={isVisible ? "Скрыть пароль" : "Показать пароль"}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
          >
            {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        }
        {...props}
      />
    );
  },
);
