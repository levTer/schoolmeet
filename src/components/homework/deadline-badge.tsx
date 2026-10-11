"use client";

import { useNow } from "@/hooks/useNow";
import { formatDeadline, formatTimeLeft, getDeadlineIndicator, type DeadlineTone } from "@/lib/homework-rules";
import { cn } from "@/lib/utils";

const TONE_STYLES: Record<DeadlineTone, string> = {
  ok: "border-emerald-400/25 bg-emerald-500/10 text-emerald-200",
  soon: "border-amber-400/30 bg-amber-500/10 text-amber-200",
  urgent: "border-rose-400/40 bg-rose-500/15 text-rose-100 animate-pulse",
  overdue: "border-slate-500/40 bg-slate-700/40 text-slate-300",
};

/**
 * Индикатор дедлайна: 🟢 >24ч · 🟡 <24ч · 🔴 ГОРИТ <1ч · ⚫ просрочено.
 * До монтирования показываем только дату, чтобы не расходиться с сервером.
 */
export function DeadlineBadge({ deadline, className }: { deadline: string; className?: string }) {
  const now = useNow(30_000);
  const dateText = formatDeadline(deadline);
  const base = "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium";

  if (!now) {
    return <span className={cn(base, "border-white/10 bg-white/[0.04] text-slate-300", className)}>до {dateText}</span>;
  }

  const indicator = getDeadlineIndicator(deadline, now);
  const detail = indicator.tone === "overdue" ? `дедлайн был ${dateText}` : `${formatTimeLeft(indicator.minutesLeft)} · до ${dateText}`;

  return (
    <span className={cn(base, TONE_STYLES[indicator.tone], className)} title={`Дедлайн: ${dateText}`}>
      <span aria-hidden>{indicator.emoji}</span>
      <span>{indicator.label}</span>
      <span className="font-normal opacity-80">· {detail}</span>
    </span>
  );
}
