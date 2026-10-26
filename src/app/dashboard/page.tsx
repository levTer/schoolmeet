import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession, type Session } from "next-auth";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CloudOff,
  Mail,
  ShieldCheck,
  Sparkles,
  UserRound,
  Video,
} from "lucide-react";

import { AdminDeniedNotice } from "@/components/dashboard/admin-denied-notice";
import { AnnouncementBanner } from "@/components/dashboard/announcement-banner";
import {
  NextLessonWidgetLive,
  QuickLessonButton,
  ReviewQueueWidget,
  UrgentHomeworkWidget,
} from "@/components/dashboard/widgets";
import { AppShell } from "@/components/layout/app-shell";
import { authOptions, canAccessAdminArea } from "@/lib/auth";
import { loadDashboardData, resolveLessonSnapshot } from "@/lib/dashboard-data";
import { buildDashboardFallback, viewerFromClaims, withDeadline, type DashboardData } from "@/lib/dashboard-fallback";
import { getGreeting } from "@/lib/dashboard-greeting";
import { recalculateDashboardMetrics, syncOverdueHomeworkStatuses } from "@/lib/dashboard-maintenance";
import { ROLE_LABELS, getPermissionLabels, type Role } from "@/types";

export const metadata: Metadata = {
  title: "Кабинет",
  description: "Личный кабинет Лицея Сингулярити: роль, расписание и вход в урок.",
};

export const dynamic = "force-dynamic";

/** Общий дедлайн загрузки данных, чтобы последовательные Neon-задержки не превысили лимит RSC. */
const DASHBOARD_PAGE_DATA_TIMEOUT_MS = 24_000;

const ROLE_BADGES: Record<Role, string> = {
  ADMIN: "border-rose-400/30 bg-rose-500/15 text-rose-200",
  TEACHER: "border-brand-400/30 bg-brand-500/15 text-brand-100",
  STUDENT: "border-accent-400/30 bg-accent-500/15 text-accent-300",
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
  const urgent = data.urgent;
  const review = data.review;
  const announcements = data.announcements;

  /* Динамическое приветствие по времени суток. */
  const { greeting, emoji } = getGreeting(now);

  const quickLinks = [
    {
      href: "/schedule",
      title: "Расписание",
      text: "Недельная сетка уроков: слоты, предметы и учителя.",
      icon: CalendarDays,
    },
    {
      href: "/meeting",
      title: "Урок",
      text: "Видеокомната по коду: доска, участники и чат класса.",
      icon: Video,
    },
    ...(canOpenAdmin
      ? [
          {
            href: "/admin",
            title: "Админ-панель",
            text: "Пользователи платформы, роли и статистика школы.",
            icon: ShieldCheck,
          },
        ]
      : []),
  ];

  const firstName = (name ?? "друг").split(" ")[0];

  return (
    <AppShell>
      <AnnouncementBanner announcements={announcements} />

      {/* Приветствие */}
      <header className="animate-fade-up flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">
            Личный кабинет
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl lg:text-4xl">
            {emoji} {greeting},{" "}
            <span className="text-gradient">{firstName}</span>!
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
            Добро пожаловать в {displayName}. Ниже — ваш следующий урок, задания и быстрые
            переходы.
          </p>
        </div>

        <span
          className={`inline-flex w-fit items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium ${ROLE_BADGES[role]}`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {ROLE_LABELS[role]} · {role}
        </span>
      </header>

      {searchParams.denied && (
        <div className="mt-6">
          {/* toast «Доступ открыт только Администратору школы» + баннер-«след». */}
          <AdminDeniedNotice denied={searchParams.denied} />
        </div>
      )}

      {/* Честная деградация: часть данных не пришла, но кабинет работает. */}
      {data.degraded && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <p className="text-sm leading-relaxed text-amber-100">
            Школа отвечает медленнее обычного: часть данных (расписание или задания) не загрузилась.
            Кабинет доступен — обновите страницу через минуту.
          </p>
        </div>
      )}

      {/* Виджеты: следующий урок, срочные ДЗ и очередь проверки */}
      <div className="mt-6 grid gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
        <NextLessonWidgetLive next={next} live={live} />
        <UrgentHomeworkWidget items={urgent} role={role} />
        <ReviewQueueWidget queue={review} role={role} />
      </div>

      {/* Быстрое действие: внеплановый урок (только для учителей) */}
      {role !== "STUDENT" && (
        <div className="mt-5">
          <QuickLessonButton role={role} />
        </div>
      )}

      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,20rem)_1fr]">
        {/* Профиль */}
        <section
          id="profile"
          className="ring-gradient glass-card animate-fade-up h-fit scroll-mt-20 p-5 sm:p-6 md:scroll-mt-24"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
            <UserRound className="h-4 w-4" />
            Профиль
          </h2>

          <dl className="mt-5 space-y-4 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wider text-slate-500">Имя</dt>
              <dd className="mt-1 text-white">{name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-slate-500">Email</dt>
              <dd className="mt-1 flex items-center gap-2 text-white">
                <Mail className="h-3.5 w-3.5 text-slate-500" />
                {email ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-slate-500">Роль</dt>
              <dd className="mt-1 text-white">
                {ROLE_LABELS[role]}{" "}
                <span className="font-mono text-xs text-slate-500">({role})</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-slate-500">ID пользователя</dt>
              <dd className="mt-1 truncate font-mono text-xs text-slate-400">{id}</dd>
            </div>
          </dl>

          <div className="mt-6 border-t border-white/5 pt-5">
            <p className="text-xs uppercase tracking-wider text-slate-500">Права роли</p>
            <ul className="mt-3 space-y-2">
              {permissions.map((permission) => (
                <li key={permission} className="flex items-center gap-2 text-sm text-slate-300">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  {permission}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Быстрые переходы */}
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {quickLinks.map(({ href, title, text, icon: Icon }, index) => (
              <Link
                key={href}
                href={href}
                style={{ animationDelay: `${100 + index * 80}ms` }}
                className="ring-gradient glass-card animate-fade-up group p-5 sm:p-6 hover:bg-white/[0.05]"
              >
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow">
                  <Icon className="h-5 w-5 text-white" />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{text}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-200 transition group-hover:gap-3">
                  Перейти
                  <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            ))}
          </div>

          <section className="glass-card p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-white">Что нового в Этапе 7</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Главный дашборд с живым обратным отсчётом до урока, полная мобильная адаптация
              (нижняя навигация, адаптивные видео и доска), PWA-поддержка для установки на экран
              телефона, а также красивые страницы ошибок в стиле glass-morphism.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs">
              {[
                "PWA",
                "Mobile-first",
                "Bottom Nav",
                "Обратный отсчёт",
                "Glass-morphism",
                "Touch UI",
                "JWT",
                "WebRTC",
              ].map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-slate-300"
                >
                  {chip}
                </span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
