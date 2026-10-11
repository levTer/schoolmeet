import { Eye, PencilRuler, ShieldCheck, Users } from "lucide-react";

import { DAY_SHORT_LABELS, type DayOfWeek } from "@/types";

interface Lesson {
  day: DayOfWeek;
  time: string;
  subject: string;
  room: string;
  teacher: string;
}

const LESSONS: readonly Lesson[] = [
  { day: 1, time: "09:00", subject: "Алгебра", room: "8 «Б»", teacher: "А. Соколова" },
  { day: 1, time: "10:00", subject: "Геометрия", room: "9 «А»", teacher: "А. Соколова" },
  { day: 2, time: "11:30", subject: "Физика", room: "8 «Б»", teacher: "И. Петров" },
  { day: 3, time: "09:00", subject: "Алгебра", room: "8 «Б»", teacher: "А. Соколова" },
  { day: 4, time: "11:30", subject: "Геометрия", room: "8 «Б»", teacher: "А. Соколова" },
  { day: 5, time: "13:00", subject: "Подготовка к ОГЭ", room: "9 «А»", teacher: "И. Петров" },
] as const;

const DAYS: readonly DayOfWeek[] = [1, 2, 3, 4, 5];

const ROLES = [
  {
    icon: PencilRuler,
    title: "Учитель",
    accent: "from-brand-500/25 to-brand-500/0 text-brand-200 ring-brand-400/20",
    permissions: [
      "Создаёт и редактирует слоты",
      "Привязывает комнату к уроку",
      "Видит расписание всех классов",
    ],
  },
  {
    icon: Eye,
    title: "Ученик",
    accent: "from-accent-500/25 to-accent-500/0 text-accent-300 ring-accent-400/20",
    permissions: [
      "Только просмотр своего класса",
      "Вход в урок одним кликом",
      "Напоминание за 10 минут",
    ],
  },
] as const;

/** Секция «Расписание» — показывает неделю и разграничение ролей. */
export function ScheduleSection() {
  return (
    <section id="schedule" className="relative scroll-mt-28 py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1 text-xs font-medium uppercase tracking-widest text-slate-400">
            <Users className="h-3.5 w-3.5 text-emerald-300" />
            Расписание
          </span>
          <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
            Расписание, где у каждой роли{" "}
            <span className="text-gradient-brand">свои права</span>
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-400">
            Правила доступа задаются ролью из модели <code className="text-slate-300">User</code>:
            ADMIN управляет школой, TEACHER ведёт сетку, STUDENT только читает её.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          {/* Недельная сетка */}
          <div className="ring-gradient overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025] p-5 backdrop-blur sm:p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Учебная неделя</h3>
              <span className="text-xs text-slate-500">8 «Б» · 2026/27</span>
            </div>

            <div className="mt-5 grid grid-cols-5 gap-2 sm:gap-3">
              {DAYS.map((day) => (
                <div key={day} className="flex flex-col gap-2">
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] py-2 text-center">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                      {DAY_SHORT_LABELS[day]}
                    </p>
                  </div>

                  {LESSONS.filter((lesson) => lesson.day === day).map((lesson) => (
                    <div
                      key={`${lesson.day}-${lesson.time}`}
                      className="group rounded-xl border border-white/10 bg-gradient-to-br from-brand-500/15 to-accent-500/5 p-2.5 transition hover:-translate-y-0.5 hover:border-brand-400/40"
                    >
                      <p className="text-[10px] font-medium text-brand-200">{lesson.time}</p>
                      <p className="mt-1 text-xs font-semibold leading-tight text-white">
                        {lesson.subject}
                      </p>
                      <p className="mt-1 truncate text-[10px] text-slate-400">{lesson.teacher}</p>
                    </div>
                  ))}

                  {LESSONS.filter((lesson) => lesson.day === day).length === 0 && (
                    <div className="rounded-xl border border-dashed border-white/10 p-3 text-center text-[10px] text-slate-600">
                      Окно
                    </div>
                  )}
                </div>
              ))}
            </div>

            <p className="mt-5 flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              К каждому слоту автоматически создаётся комната с уникальным кодом и ключом шифрования.
            </p>
          </div>

          {/* Роли */}
          <div className="flex flex-col gap-5">
            {ROLES.map((role) => (
              <div
                key={role.title}
                className="rounded-3xl border border-white/10 bg-white/[0.025] p-6 backdrop-blur"
              >
                <span
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ring-1 ${role.accent}`}
                >
                  <role.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-white">{role.title}</h3>
                <ul className="mt-3 space-y-2">
                  {role.permissions.map((permission) => (
                    <li key={permission} className="flex items-start gap-2.5 text-sm text-slate-400">
                      <span className="mt-1.5 inline-flex h-1.5 w-1.5 flex-none rounded-full bg-brand-400" />
                      {permission}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
