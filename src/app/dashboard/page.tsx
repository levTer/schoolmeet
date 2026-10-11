import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Mail,
  ShieldCheck,
  Sparkles,
  UserRound,
  Video,
} from "lucide-react";

import { AnnouncementBanner } from "@/components/dashboard/announcement-banner";
import { NextLessonWidget, ReviewQueueWidget, UrgentHomeworkWidget } from "@/components/dashboard/widgets";
import { AppShell } from "@/components/layout/app-shell";
import { FormAlert } from "@/components/ui/form-alert";
import { listActiveAnnouncementsForViewer, type AnnouncementDto } from "@/lib/announcements";
import { authOptions, canAccessAdminArea } from "@/lib/auth";
import { getReviewQueue, getUrgentHomework } from "@/lib/homework";
import { findLiveLesson, findNextLesson, getSchoolClock } from "@/lib/schedule-rules";
import { listLessonsForViewer } from "@/lib/schedule";
import { getSchoolViewer } from "@/lib/school-viewer";
import { ROLE_LABELS, getPermissionLabels, type Role, type Schedule } from "@/types";

export const metadata: Metadata = {
  title: "Кабинет",
  description: "Личный кабинет SchoolMeet: роль, расписание и вход в урок.",
};

export const dynamic = "force-dynamic";

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
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login?callbackUrl=/dashboard");
  }

  const { id, name, email, role } = session.user;
  const canOpenAdmin = canAccessAdminArea(role);
  const permissions = getPermissionLabels(role);

  const now = new Date();
  const viewer = await getSchoolViewer(id);
  const [lessons, urgent, review] = viewer
    ? await Promise.all([
        listLessonsForViewer(viewer),
        getUrgentHomework(viewer, now),
        getReviewQueue(viewer),
      ])
    : [[] as Schedule[], [], { count: 0, items: [] }];
  const clock = getSchoolClock(now);
  const live = findLiveLesson(lessons, clock);
  const next = findNextLesson(lessons, clock);

  /* Объявления школы: ученик видит свою школу и свой класс, персонал — все. */
  let announcements: AnnouncementDto[] = [];
  try {
    announcements = await listActiveAnnouncementsForViewer({
      id,
      role,
      grade: viewer?.grade ?? null,
    });
  } catch (error) {
    console.error("[dashboard] Не удалось загрузить объявления:", error);
  }

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

  return (
    <AppShell>
      <AnnouncementBanner announcements={announcements} />

      {/* Приветствие */}
      <header className="animate-fade-up flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">
            Личный кабинет
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Здравствуйте,{" "}
            <span className="text-gradient">{(name ?? "друг").split(" ")[0]}</span>!
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
            Сессия защищена JWT-cookie, а доступ к разделам определяется ролью. Ниже — ваш профиль и
            быстрые переходы.
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
          <FormAlert variant="info">
            Раздел <span className="font-mono text-xs">{searchParams.denied}</span> доступен только
            ролям ADMIN и TEACHER. Ваша роль — {ROLE_LABELS[role]}.
          </FormAlert>
        </div>
      )}

      {/* Виджеты: следующий урок, срочные ДЗ и очередь проверки */}
      <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <NextLessonWidget next={next} live={live} />
        <UrgentHomeworkWidget items={urgent} role={role} />
        <ReviewQueueWidget queue={review} role={role} />
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,20rem)_1fr]">
        {/* Профиль */}
        <section className="ring-gradient glass-card animate-fade-up h-fit p-6">
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

        {/* Быстрые переходы и статус этапа */}
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {quickLinks.map(({ href, title, text, icon: Icon }, index) => (
              <Link
                key={href}
                href={href}
                style={{ animationDelay: `${100 + index * 80}ms` }}
                className="ring-gradient glass-card animate-fade-up group p-6 hover:bg-white/[0.05]"
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

          <section className="glass-card p-6">
            <h2 className="text-lg font-semibold text-white">Что дальше</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Этап 5 добавил расписание 5–11 классов и домашние задания: дедлайны, загрузку файлов и
              проверку учителем. ИИ формирует только черновик проверки — оценку видит ученик после
              утверждения учителем.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs">
              {["JWT-сессия", "WebRTC", "Socket.IO", "AES-256", "Prisma", "Файлы", "ДЗ"].map((chip) => (
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
