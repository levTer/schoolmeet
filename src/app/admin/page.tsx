import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { CalendarDays, ShieldCheck, UserRound, Users } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { prisma } from "@/lib/prisma";
import { authOptions, canAccessAdminArea } from "@/lib/auth";
import { ROLE_LABELS, type Role } from "@/types";

export const metadata: Metadata = {
  title: "Админ-панель",
  description: "Управление пользователями SchoolMeet: роли ADMIN, TEACHER, STUDENT.",
};

export const dynamic = "force-dynamic";

const ROLE_BADGES: Record<Role, string> = {
  ADMIN: "border-rose-400/30 bg-rose-500/15 text-rose-200",
  TEACHER: "border-brand-400/30 bg-brand-500/15 text-brand-100",
  STUDENT: "border-accent-400/30 bg-accent-500/15 text-accent-300",
};

/**
 * Раздел `/admin`: доступен только ADMIN и TEACHER.
 *
 * Первый барьер — middleware (редирект до рендера), второй — эта проверка
 * внутри страницы: даже если matcher изменят, данные не утекут.
 */
export default async function AdminPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login?callbackUrl=/admin");
  }
  if (!canAccessAdminArea(session.user.role)) {
    redirect("/dashboard?denied=/admin");
  }

  let users: {
    id: string;
    name: string;
    email: string;
    role: string;
    createdAt: Date;
  }[] = [];
  let databaseError = false;

  try {
    users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
  } catch (error) {
    // База недоступна — показываем понятное сообщение вместо 500-й ошибки.
    console.error("[admin] Не удалось загрузить пользователей:", error);
    databaseError = true;
  }

  const counters = {
    total: users.length,
    admins: users.filter((user) => user.role === "ADMIN").length,
    teachers: users.filter((user) => user.role === "TEACHER").length,
    students: users.filter((user) => user.role === "STUDENT").length,
  };

  return (
    <AppShell>
      <header className="animate-fade-up flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">
            Управление школой
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Админ-панель</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            Раздел открыт для ролей ADMIN и TEACHER. Ниже — последние зарегистрированные
            пользователи платформы (до 50 записей).
          </p>
        </div>

        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-medium text-emerald-200">
          <ShieldCheck className="h-3.5 w-3.5" />
          Доступ подтверждён: {ROLE_LABELS[session.user.role]}
        </span>
      </header>

      {/* Счётчики */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Всего пользователей", value: counters.total, icon: Users },
          { label: "Администраторы", value: counters.admins, icon: ShieldCheck },
          { label: "Учителя", value: counters.teachers, icon: CalendarDays },
          { label: "Ученики", value: counters.students, icon: UserRound },
        ].map(({ label, value, icon: Icon }, index) => (
          <div
            key={label}
            style={{ animationDelay: `${80 + index * 70}ms` }}
            className="ring-gradient animate-fade-up rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl"
          >
            <Icon className="h-5 w-5 text-brand-300" />
            <p className="mt-4 text-3xl font-semibold text-white">{value}</p>
            <p className="mt-1 text-xs uppercase tracking-wider text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      {/* Таблица пользователей */}
      <section className="animate-fade-up glass-card mt-8 overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            Пользователи
          </h2>
          <span className="text-xs text-slate-500">до 50 записей</span>
        </div>

        {databaseError ? (
          <p className="px-6 py-10 text-center text-sm text-rose-200">
            Не удалось подключиться к базе данных. Проверьте переменную окружения{" "}
            <span className="font-mono text-xs">DATABASE_URL</span> и запустите{" "}
            <span className="font-mono text-xs">npx prisma migrate dev</span>.
          </p>
        ) : users.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            Пользователей пока нет — зарегистрируйте первый аккаунт на странице «Регистрация».
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-500">
                <tr className="border-b border-white/5">
                  <th className="px-6 py-3 font-medium">Имя</th>
                  <th className="px-6 py-3 font-medium">Email</th>
                  <th className="px-6 py-3 font-medium">Роль</th>
                  <th className="px-6 py-3 font-medium">Создан</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-white/5 transition last:border-0 hover:bg-white/[0.03]"
                  >
                    <td className="px-6 py-3.5 text-white">{user.name}</td>
                    <td className="px-6 py-3.5 text-slate-400">{user.email}</td>
                    <td className="px-6 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${ROLE_BADGES[user.role as Role]}`}
                      >
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-slate-500">
                      {user.createdAt.toLocaleDateString("ru-RU", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
