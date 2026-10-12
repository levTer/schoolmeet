import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Crown, GraduationCap, Link2, ShieldCheck, UserCheck } from "lucide-react";

import { AdminPromotePrompt } from "@/components/auth/admin-promote-prompt";
import { AuthShell, type AuthHighlight } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";
import { authOptions } from "@/lib/auth";
import { normalizeInviteToken, type InviteRole } from "@/lib/invite-rules";
import { findSchoolForInvite } from "@/lib/schools";

export const metadata: Metadata = {
  title: "Регистрация",
  description: "Регистрация в SchoolMeet: аккаунт ученика, учителя или администратора по приглашению.",
};

export const dynamic = "force-dynamic";

const HIGHLIGHTS: readonly AuthHighlight[] = [
  {
    icon: GraduationCap,
    title: "Роль ученика",
    text: "Расписание, вход в урок по коду, чат класса.",
  },
  {
    icon: UserCheck,
    title: "Роль учителя",
    text: "Создание уроков, доска, управление расписанием.",
  },
  {
    icon: Link2,
    title: "Ссылки-приглашения",
    text: "Учитель и админ — только по секретной ссылке школы.",
  },
  {
    icon: ShieldCheck,
    title: "Защищённые разделы",
    text: "Кабинет, урок и админ-панель закрыты middleware.",
  },
];

interface RegisterPageProps {
  searchParams?: { code?: string; invite?: string };
}

/**
 * Страница регистрации (`/auth/register`).
 *
 * Поддерживает секретные ссылки-приглашения `?code=…&invite=…`:
 *  - без `invite` — публичная регистрация, роль всегда STUDENT;
 *  - `invite=teacherInviteToken` — доступна роль TEACHER;
 *  - `invite=adminInviteToken` — регистрация сразу с ролью ADMIN, а для уже
 *    вошедшего пользователя — окно «Повысить ваш аккаунт до ADMIN?».
 */
export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const session = await getServerSession(authOptions);

  const code = typeof searchParams?.code === "string" ? searchParams.code : "";
  const invite = normalizeInviteToken(searchParams?.invite);

  let inviteRole: InviteRole | null = null;
  let schoolCode = code.trim();
  let schoolName: string | null = null;
  try {
    const found = await findSchoolForInvite(code, invite);
    if (found) {
      inviteRole = found.inviteRole;
      schoolCode = found.school.code;
      schoolName = found.school.name;
    }
  } catch (error) {
    // БД недоступна — открываем публичную форму, регистрация сама сообщит ошибку.
    console.error("[auth/register] Не удалось разобрать ссылку-приглашение:", error);
  }

  if (session?.user) {
    // Ссылка Администратора + вошедший аккаунт → повышение вместо регистрации.
    if (inviteRole === "ADMIN") {
      return (
        <AuthShell
          eyebrow="Ссылка Администратора"
          title="Назначение администратора"
          subtitle="Вы перешли по секретной ссылке школы для получения прав ADMIN."
          highlights={HIGHLIGHTS}
        >
          <AdminPromotePrompt
            schoolCode={schoolCode}
            invite={invite}
            alreadyAdmin={session.user.role === "ADMIN"}
          />
        </AuthShell>
      );
    }
    redirect("/dashboard");
  }

  return (
    <AuthShell
      eyebrow="Создание аккаунта"
      title="Присоединиться к SchoolMeet"
      subtitle={
        inviteRole === "ADMIN"
          ? "Ссылка Администратора: аккаунт будет создан сразу с ролью ADMIN."
          : inviteRole === "TEACHER"
            ? "Ссылка учителя: доступна регистрация с ролью Учитель."
            : "Заполните форму — по умолчанию создаётся аккаунт ученика."
      }
      highlights={HIGHLIGHTS}
    >
      {inviteRole === "ADMIN" && schoolName ? (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3.5 py-3 text-xs text-amber-100">
          <Crown className="h-4 w-4 shrink-0 text-amber-300" />
          Школа: {schoolName} · роль Администратора по секретной ссылке
        </p>
      ) : null}
      <RegisterForm
        initialSchoolCode={schoolCode}
        initialInvite={invite}
        initialInviteRole={inviteRole}
      />
    </AuthShell>
  );
}
