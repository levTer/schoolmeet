import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { GraduationCap, KeyRound, ShieldCheck, UserCheck } from "lucide-react";

import { AuthShell, type AuthHighlight } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";
import { authOptions } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Регистрация",
  description: "Регистрация в SchoolMeet: аккаунт учителя или ученика.",
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
    icon: KeyRound,
    title: "bcrypt вместо паролей",
    text: "В базе лежит только хеш — восстановить пароль нельзя.",
  },
  {
    icon: ShieldCheck,
    title: "Защищённые разделы",
    text: "Кабинет, урок и админ-панель закрыты middleware.",
  },
];

export default async function RegisterPage() {
  const session = await getServerSession(authOptions);

  if (session?.user) redirect("/dashboard");

  return (
    <AuthShell
      eyebrow="Создание аккаунта"
      title="Присоединиться к SchoolMeet"
      subtitle="Заполните форму и выберите роль — доступ к разделам платформы настроится автоматически."
      highlights={HIGHLIGHTS}
    >
      <RegisterForm />
    </AuthShell>
  );
}
