"use client";

import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface FormAlertProps {
  variant: "error" | "success" | "info";
  children: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}

const STYLES = {
  error: "border-rose-500/25 bg-rose-500/10 text-rose-200",
  success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
  info: "border-brand-400/25 bg-brand-500/10 text-brand-100",
} as const;

/** Сообщение над формой: ошибка входа, успешная регистрация, подсказка. */
export function FormAlert({ variant, children, onDismiss, className }: FormAlertProps) {
  const Icon = variant === "success" ? CheckCircle2 : AlertCircle;

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "animate-fade-up flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm backdrop-blur-xl",
        STYLES[variant],
        className,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1 leading-relaxed">{children}</div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Закрыть сообщение"
          className="rounded-lg p-0.5 opacity-60 transition hover:bg-white/10 hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
