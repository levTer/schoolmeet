import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: number | string;
  hint?: string;
  icon: LucideIcon;
  /** Тон акцента иконки. */
  tone?: "brand" | "accent" | "danger" | "success";
  /** Задержка анимации появления (каскад). */
  index?: number;
}

const TONES = {
  brand: "text-brand-300 bg-brand-500/10 border-brand-400/25",
  accent: "text-accent-300 bg-accent-500/10 border-accent-400/25",
  danger: "text-rose-300 bg-rose-500/10 border-rose-400/25",
  success: "text-emerald-300 bg-emerald-500/10 border-emerald-400/25",
} as const;

/** Карточка метрики на странице обзора админ-панели. */
export function StatCard({ label, value, hint, icon: Icon, tone = "brand", index = 0 }: StatCardProps) {
  return (
    <div
      style={{ animationDelay: `${80 + index * 70}ms` }}
      className="ring-gradient animate-fade-up glass-card p-5"
    >
      <span className={cn("inline-flex h-9 w-9 items-center justify-center rounded-xl border", TONES[tone])}>
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-4 text-3xl font-semibold tabular-nums text-white">{value}</p>
      <p className="mt-1 text-xs uppercase tracking-wider text-slate-500">{label}</p>
      {hint && <p className="mt-2 text-xs leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}
