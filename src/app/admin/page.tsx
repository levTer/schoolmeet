import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import {
  ArrowRight,
  Ban,
  BarChart3,
  CalendarClock,
  ClipboardCheck,
  GraduationCap,
  History,
  ScrollText,
  ShieldCheck,
  UserRound,
  Users,
  Video,
} from "lucide-react";

import { AnnouncementModalButton } from "@/components/admin/announcement-modal";
import { AdminBarChart } from "@/components/admin/charts";
import { StatCard } from "@/components/admin/stat-card";
import { FormAlert } from "@/components/ui/form-alert";
import { auditActionLabel, auditActionTone, formatAuditDetails } from "@/lib/audit";
import { getAdminOverview, getAdminSecondaryMetrics, type AdminOverview } from "@/lib/admin-stats";
import { authOptions, canAccessAdminArea } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Обзор школы",
  description: "Метрики SchoolMeet: ученики, учителя, активные уроки и успеваемость по классам.",
};

export const dynamic = "force-dynamic";

const METRIC_ICONS = {
  students: UserRound,
  teachers: GraduationCap,
  live: Video,
  homework: ClipboardCheck,
} as const;

const METRIC_TONES = {
  students: "accent",
  teachers: "brand",
  live: "danger",
  homework: "success",
} as const;

const TONE_BADGES = {
  danger: "border-rose-400/25 bg-rose-500/10 text-rose-200",
  success: "border-emerald-400/25 bg-emerald-500/10 text-emerald-200",
  brand: "border-brand-400/25 bg-brand-500/10 text-brand-100",
  neutral: "border-white/10 bg-white/[0.04] text-slate-300",
} as const;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Обзор (`/admin`): метрики школы, графики активности и успеваемости,
 * быстрая кнопка «Создать объявление» и последние действия администрации.
 */
export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/admin");
  if (!canAccessAdminArea(session.user.role)) redirect("/dashboard?denied=admin");

  let overview: AdminOverview | null = null;
  let secondary: { pendingReview: number; banned: number; todayJoins: number } | null = null;
  let databaseError = false;

  try {
    [overview, secondary] = await Promise.all([getAdminOverview(), getAdminSecondaryMetrics()]);
  } catch (error) {
    // База недоступна (или миграции не применены) — показываем понятный экран.
    console.error("[admin] Не удалось загрузить метрики:", error);
    databaseError = true;
  }

  if (databaseError || !overview || !secondary) {
    return (
      <div className="space-y-6">
        <FormAlert variant="error">
          Не удалось загрузить статистику. Проверьте, что база данных доступна и миграции применены
          (<span className="font-mono text-xs">npm run db:push</span>).
        </FormAlert>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Метрики */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {overview.metrics.map((metric, index) => {
          const key = metric.key as keyof typeof METRIC_ICONS;
          return (
            <StatCard
              key={metric.key}
              label={metric.label}
              value={metric.value}
              hint={metric.hint}
              icon={METRIC_ICONS[key] ?? BarChart3}
              tone={METRIC_TONES[key] ?? "brand"}
              index={index}
            />
          );
        })}
      </section>

      {/* Вторичные метрики + быстрые действия */}
      <section className="animate-fade-up grid gap-4 lg:grid-cols-3">
        <div className="glass-card flex flex-col justify-between gap-4 p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs text-slate-300">
              <Ban className="h-3.5 w-3.5 text-rose-300" />
              Заблокировано: {secondary.banned}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs text-slate-300">
              <ClipboardCheck className="h-3.5 w-3.5 text-amber-300" />
              Ждут проверки: {secondary.pendingReview}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs text-slate-300">
              <Users className="h-3.5 w-3.5 text-accent-300" />
              Входов в уроки сегодня: {secondary.todayJoins}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-medium text-emerald-200">
              <ShieldCheck className="h-3.5 w-3.5" />
              Всего аккаунтов: {overview.totals.users}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <AnnouncementModalButton />
            <Link
              href="/admin/users"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10"
            >
              <Users className="h-4 w-4" />
              Пользователи
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/admin/meetings"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10"
            >
              <CalendarClock className="h-4 w-4" />
              Активные уроки
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <div className="ring-gradient glass-card p-5">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-brand-300" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Последние действия</h2>
          </div>

          {overview.recentAudit.length === 0 ? (
            <p className="mt-4 text-xs text-slate-500">
              Журнал пуст. Здесь появятся смена ролей, блокировки и завершения уроков.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {overview.recentAudit.slice(0, 4).map((entry) => (
                <li key={entry.id} className="text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium",
                        TONE_BADGES[auditActionTone(entry.action)],
                      )}
                    >
                      {auditActionLabel(entry.action)}
                    </span>
                    <span className="shrink-0 text-slate-500">{formatDateTime(entry.createdAt)}</span>
                  </div>
                  <p className="mt-1 truncate text-slate-400">
                    {entry.actor?.name ?? "Система"}
                    {formatAuditDetails(entry.details) && ` · ${formatAuditDetails(entry.details)}`}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <Link
            href="/admin/audit"
            className="mt-4 inline-flex items-center gap-1.5 text-xs text-accent-300 transition hover:text-accent-200"
          >
            <ScrollText className="h-3.5 w-3.5" />
            Весь журнал
          </Link>
        </div>
      </section>

      {/* Графики */}
      <section className="grid gap-4 xl:grid-cols-2">
        <div className="animate-fade-up glass-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                Активность звонков
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Входы в видеоуроки по дням недели за последние 28 дней
              </p>
            </div>
            <BarChart3 className="h-4 w-4 text-brand-300" />
          </div>

          <div className="mt-4">
            <AdminBarChart
              points={overview.callActivity}
              ariaLabel="Входы в видеоуроки по дням недели"
              emptyText="Пока никто не заходил в уроки — запустите занятие, и график оживёт."
            />
          </div>
        </div>

        <div className="animate-fade-up glass-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                Успеваемость по классам
              </h2>
              <p className="mt-1 text-xs text-slate-500">Средний балл за проверенные домашние задания</p>
            </div>
            <GraduationCap className="h-4 w-4 text-accent-300" />
          </div>

          <div className="mt-4">
            <AdminBarChart
              points={overview.grades}
              max={5}
              tone="accent"
              formatValue={(value) => value.toFixed(1)}
              ariaLabel="Средняя оценка по классам с 5 по 11"
              emptyText="Оценок пока нет — проверьте домашние задания, и график заполнится."
            />
          </div>
        </div>
      </section>

      <p className="text-center text-[11px] text-slate-600">
        Данные обновляются автоматически · собрано{" "}
        {new Date(overview.generatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
      </p>
    </div>
  );
}
