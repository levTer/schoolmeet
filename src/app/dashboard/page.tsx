import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession, type Session } from "next-auth";
import {
  BellRing,
  CalendarDays,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  CloudOff,
  ShieldCheck,
  Video,
} from "lucide-react";

import { AdminDeniedNotice } from "@/components/dashboard/admin-denied-notice";
import { AnnouncementBanner } from "@/components/dashboard/announcement-banner";
import { LiveLessonCard } from "@/components/dashboard/live-lesson-card";
import { NextLessonCompact } from "@/components/dashboard/next-lesson-compact";
import {
  NextLessonWidgetLive,
  QuickLessonButton,
  ReviewQueueWidget,
  UrgentHomeworkWidget,
} from "@/components/dashboard/widgets";
import { AppShell } from "@/components/layout/app-shell";
import { authOptions, canAccessAdminArea } from "@/lib/auth";
import { loadDashboardData, resolveLessonSnapshot } from "@/lib/dashboard-data";
import {
  buildDashboardFallback,
  viewerFromClaims,
  withDeadline,
  type DashboardData,
} from "@/lib/dashboard-fallback";
import { getGreeting } from "@/lib/dashboard-greeting";
import { recalculateDashboardMetrics, syncOverdueHomeworkStatuses } from "@/lib/dashboard-maintenance";
import { formatDeadline } from "@/lib/homework-rules";
import { ROLE_LABELS, getPermissionLabels, type Role } from "@/types";

export const metadata: Metadata = {
  title: "Кабинет",
  description: "Личный кабинет EduFlow: следующий урок, задания и быстрые действия.",
};

export const dynamic = "force-dynamic";

/** Общий дедлайн загрузки данных, чтобы последовательные Neon-задержки не превысили лимит RSC. */
const DASHBOARD_PAGE_DATA_TIMEOUT_MS = 24_000;

/** Компактные бейджи роли — акцент темы, без «светофорных» полос. */
const ROLE_BADGES: Record<Role, string> = {
  ADMIN: "border-rose-400/25 bg-rose-500/10 text-rose-200",
  TEACHER: "border-brand-400/25 bg-brand-500/10 text-brand-200",
  STUDENT: "border-white/10 bg-white/[0.04] text-slate-300",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { denied?: string };
}) {
  /* Сессию читаем в изолированном блоке: callback `jwt` тоже ходит в БД и при
     задержке Neon может бросить исключение. Кабинет из-за этого падать не должен. */
  let session: Session | null = null;
  try {
    session = await withDeadline(getServerSession(authOptions), "dashboard session");
  } catch (err) {
    console.error("[DASHBOARD_SESSION_WARN]", err);
  }

  /* `redirect()` бросает служебное исключение NEXT_REDIRECT, поэтому вызывается
     строго вне try/catch — иначе мы бы перехватили управляющий сигнал Next.js. */
  if (!session?.user) {
    redirect("/login?callbackUrl=/dashboard");
  }

  const { id, name, email, role, schoolId, classId, schoolName } = session.user;
  const displayName = schoolName || "EduFlow";
  const canOpenAdmin = canAccessAdminArea(role);
  const permissions = getPermissionLabels(role);

  const now = new Date();

  /* ГЛАВНЫЙ try-catch страницы: загрузка данных пользователя, расписания и
     виджетов. При задержке базы (таймаут, P2028) исключение НЕ уходит наверх —
     рендерим кабинет с валидным fallback-объектом, чтобы `/dashboard` открывался
     всегда, а не показывал экран ошибки Next.js. */
  let data: DashboardData;
  try {
    const loaded = await withDeadline(
      loadDashboardData({ userId: id, role, schoolId, classId, now }),
      "dashboard page data",
      DASHBOARD_PAGE_DATA_TIMEOUT_MS,
    );
    data =
      loaded ??
      buildDashboardFallback({
        viewer: viewerFromClaims({ id, role, schoolId, classId, isBanned: session.user.banned }),
      });
  } catch (err) {
    console.error("[DASHBOARD_DATA_WARN]", err);
    data = buildDashboardFallback({
      viewer: viewerFromClaims({ id, role, schoolId, classId, isBanned: session.user.banned }),
    });
  }

  /* Фоновая сервисная операция №1: обновление просроченных статусов ДЗ.
     Сбой фоновой досыпки (именно она бросала P2028 на `homework.updateMany`)
     логируем и продолжаем рендер — страница от этого не «убивается».
     Операции пропускаем, когда данные уже пришли неполными: база и так не
     успевает, лишние запросы только удлинят рендер. */
  const maintenanceViewer =
    data.viewer ?? viewerFromClaims({ id, role, schoolId, classId, isBanned: session.user.banned });

  try {
    if (!data.degraded) {
      void syncOverdueHomeworkStatuses(maintenanceViewer, now).catch((err) => {
        console.error("[DASHBOARD_HW_UPDATE_WARN]", err);
      });
    }
  } catch (err) {
    console.error("[DASHBOARD_HW_UPDATE_WARN]", err);
  }

  /* Фоновая сервисная операция №2: метрики вспомогательные и не должны
     удерживать RSC-рендер. Оба уровня ошибок изолированы (вызов и промис). */
  try {
    if (!data.degraded) {
      void recalculateDashboardMetrics(maintenanceViewer, now).catch((err) => {
        console.error("[DASHBOARD_METRICS_WARN]", err);
      });
    }
  } catch (err) {
    console.error("[DASHBOARD_METRICS_WARN]", err);
  }

  const { live, next } = resolveLessonSnapshot(data.lessons, now);
  const liveLesson = data.liveLesson ?? null;
  const urgent = data.urgent;
  const review = data.review;
  const announcements = data.announcements;

  /* Динамическое приветствие по времени суток. */
  const { greeting, emoji } = getGreeting(now);

  const firstName = (name ?? "друг").split(" ")[0];

  const quickLinks = [
    { href: "/schedule", title: "Расписание", text: "Недельная сетка уроков", icon: CalendarDays },
    { href: "/homework", title: "Домашние задания", text: "Сроки и проверка работ", icon: ClipboardList },
    { href: "/meeting", title: "Урок", text: "Видеокомната по коду", icon: Video },
    ...(canOpenAdmin
      ? [{ href: "/admin", title: "Админ-панель", text: "Люди, роли и статистика", icon: ShieldCheck }]
      : []),
  ];

  const mobileShortcuts = [
    { href: "/schedule", label: "Расписание", icon: CalendarDays },
    { href: "/homework", label: "ДЗ", icon: ClipboardList },
    { href: "/meeting", label: "Урок", icon: Video },
    ...(canOpenAdmin ? [{ href: "/admin", label: "Админ", icon: ShieldCheck }] : []),
  ];

  return (
    <AppShell flush>
      {/* ───────────────────────── Мобильный экран ─────────────────────────
          Один экран 100dvh без прокрутки страницы: приветствие, следующий
          урок, статистика, дедлайны (внутренняя прокрутка) и быстрые ссылки.
          Нижняя навигация прижата к низу и учитывает safe-area.           */}
      <div className="no-scrollbar flex h-full min-h-0 flex-col gap-2.5 overflow-y-auto px-3 pb-1 pt-2.5 md:hidden">
        {/* Самый верх кабинета: урок идёт прямо сейчас → вход в 1 клик. */}
        {liveLesson ? <LiveLessonCard lesson={liveLesson} /> : null}

        <header
          id="profile"
          className="flex scroll-mt-16 items-center justify-between gap-2 py-1 mb-2"
        >
          <div className="min-w-0">
            <h1 className="truncate text-base font-medium text-white">
              {emoji} {greeting}, {firstName}
            </h1>
            <p className="mt-0.5 truncate text-xs text-slate-400">
              {displayName} · {ROLE_LABELS[role]}
            </p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center rounded-md border px-2 py-1 text-[11px] font-medium ${ROLE_BADGES[role]}`}
          >
            {role}
          </span>
        </header>

        {searchParams.denied ? <AdminDeniedNotice denied={searchParams.denied} /> : null}

        {data.degraded ? (
          <p className="flex items-center gap-1.5 rounded-lg border border-amber-400/20 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-100">
            <CloudOff className="h-3.5 w-3.5 shrink-0 text-amber-300" />
            Часть данных не загрузилась — обновите страницу
          </p>
        ) : null}

        {announcements.length > 0 ? (
          <p className="flex items-center gap-1.5 truncate rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-slate-300">
            <BellRing className="h-3.5 w-3.5 shrink-0 text-brand-300" />
            <span className="truncate">{announcements[0].title}</span>
          </p>
        ) : null}

        <NextLessonCompact next={next} live={live} />

        {/* Статистика: плотная сетка без «воздуха» */}
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Срочные ДЗ" value={urgent.length} />
          <StatTile label="На проверке" value={review.count} />
          <StatTile label="В неделе" value={data.lessons.length} suffix="ур." />
        </div>

        {/* Дедлайны: карточка растягивается, список прокручивается внутри */}
        <section
          className="card flex min-h-[92px] flex-1 flex-col p-3"
          aria-labelledby="mobile-deadlines"
        >
          <div className="flex items-center justify-between">
            <h2 id="mobile-deadlines" className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <CalendarClock className="h-3.5 w-3.5" />
              Ближайшие дедлайны
            </h2>
            <Link href="/homework" className="text-[11px] font-medium text-brand-300 hover:text-brand-200">
              Все
            </Link>
          </div>

          {urgent.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">Активных заданий нет</p>
          ) : (
            <ul className="no-scrollbar mt-1.5 min-h-0 flex-1 space-y-1 overflow-y-auto">
              {urgent.slice(0, 4).map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/homework/${item.id}`}
                    className="flex items-center gap-2 rounded-lg px-1 py-1.5 transition hover:bg-white/[0.04]"
                  >
                    <span aria-hidden className="text-sm">
                      {item.subjectEmoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-white">{item.title}</span>
                      <span className="block truncate text-[10px] text-slate-500">
                        до {formatDeadline(item.deadline)}
                      </span>
                    </span>
                    <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Быстрые переходы: скрыты на мобильных — дублируют Bottom Navigation Bar */}
      </div>

      {/* ───────────────────────── Десктопный экран ───────────────────────── */}
      <div className="mx-auto hidden w-full max-w-7xl min-h-0 flex-1 flex-col gap-3 px-5 pt-4 md:flex">
        {/* Самый верх кабинета: урок идёт прямо сейчас → вход в 1 клик. */}
        {liveLesson ? <LiveLessonCard lesson={liveLesson} /> : null}

        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-slate-400">Личный кабинет</p>
            <h1 className="mt-0.5 truncate text-lg font-semibold text-white">
              {emoji} {greeting}, {firstName}
            </h1>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${ROLE_BADGES[role]}`}
          >
            {ROLE_LABELS[role]} · {role}
          </span>
        </header>

        <div className="hidden md:block">
          <AnnouncementBanner announcements={announcements} />
        </div>

        {searchParams.denied ? <AdminDeniedNotice denied={searchParams.denied} /> : null}

        {data.degraded ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2">
            <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <p className="text-xs leading-relaxed text-amber-100">
              Школа отвечает медленнее обычного: часть данных не загрузилась. Кабинет доступен —
              обновите страницу через минуту.
            </p>
          </div>
        ) : null}

        <div className="grid min-h-0 gap-3 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-3 lg:col-span-2">
            <NextLessonWidgetLive next={next} live={live} />

            <div className="grid gap-3 sm:grid-cols-2">
              <UrgentHomeworkWidget items={urgent} role={role} />
              <ReviewQueueWidget queue={review} role={role} />
            </div>

            {role !== "STUDENT" ? <QuickLessonButton role={role} /> : null}
          </div>

          <aside className="flex min-w-0 flex-col gap-3">
            {/* Профиль: компактная карточка, без огромных заголовков */}
            <section id="profile-desktop" className="card scroll-mt-20 p-4">
              <h2 className="text-xs font-medium text-slate-400">Профиль</h2>
              <p className="mt-2 truncate text-sm font-semibold text-white">{name ?? "—"}</p>
              <p className="truncate text-xs text-slate-400">{email ?? "—"}</p>

              <dl className="mt-3 space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-500">Роль</dt>
                  <dd className="text-slate-200">{ROLE_LABELS[role]}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-500">Школа</dt>
                  <dd className="truncate text-slate-200">{displayName}</dd>
                </div>
              </dl>

              <ul className="mt-3 space-y-1 border-t border-white/10 pt-2.5">
                {permissions.slice(0, 4).map((permission) => (
                  <li key={permission} className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <span className="h-1 w-1 rounded-full bg-brand-400" />
                    {permission}
                  </li>
                ))}
              </ul>
            </section>

            {/* Быстрые переходы */}
            <nav aria-label="Быстрые переходы" className="card p-2">
              {quickLinks.map(({ href, title, text, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition hover:bg-white/[0.05]"
                >
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03]">
                    <Icon className="h-4 w-4 text-brand-300" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-white">{title}</span>
                    <span className="block truncate text-[11px] text-slate-500">{text}</span>
                  </span>
                </Link>
              ))}
            </nav>

            {/* Быстрые переходы: только на ПК, на мобильных дублируют BottomNav */}
            <nav
              aria-label="Быстрые действия"
              className={`hidden md:grid gap-2 mt-3 ${mobileShortcuts.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}
            >
              {mobileShortcuts.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="tile flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium text-slate-300 transition active:opacity-70"
                >
                  <Icon className="h-4 w-4 text-brand-300" />
                  <span className="truncate">{label}</span>
                </Link>
              ))}
            </nav>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

/** Плотная плитка статистики мобильного кабинета. */
function StatTile({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="card px-2.5 py-2">
      <p className="truncate text-[10px] text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-semibold leading-none tabular-nums text-white">
        {value}
        {suffix ? <span className="ml-1 text-[10px] font-normal text-slate-500">{suffix}</span> : null}
      </p>
    </div>
  );
}
