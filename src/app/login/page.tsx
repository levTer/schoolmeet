import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { CalendarDays, ShieldCheck, Sparkles, Video } from "lucide-react";

import { AuthShell, type AuthHighlight } from "@/components/auth/auth-shell";
import { LoginForm, LoginFormSkeleton } from "@/components/auth/login-form";
import { authOptions } from "@/lib/auth";
import { sanitizeRedirectPath } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Вход",
  description: "Вход в личный кабинет Лицея Сингулярити: администратор, учитель, ученик.",
};

export const dynamic = "force-dynamic";

const HIGHLIGHTS: readonly AuthHighlight[] = [
  {
    icon: Video,
    title: "HD-видеоуроки",
    text: "WebRTC-комнаты со своим кодом для каждого класса.",
  },
  {
    icon: Sparkles,
    title: "ИИ-доска",
    text: "GPT-4o Vision разбирает формулы и задачи прямо на доске.",
  },
  {
    icon: CalendarDays,
    title: "Расписание",
    text: "Учитель планирует слоты, ученик видит своё расписание.",
  },
  {
    icon: ShieldCheck,
    title: "Роли и доступы",
    text: "ADMIN, TEACHER, STUDENT — права проверяются на каждом маршруте.",
  },
];

/** Query-параметры страницы входа: `callbackUrl` (middleware) + данные из формы регистрации. */
interface LoginPageProps {
  searchParams: {
    callbackUrl?: string | string[];
    /** `true` — аккаунт только что создан (показываем подтверждение). */
    registered?: string | string[];
    /** Email нового аккаунта: подставляется в поле ввода (`LoginForm`). */
    email?: string | string[];
  };
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const callbackUrl = sanitizeRedirectPath(searchParams.callbackUrl);
  const session = await getServerSession(authOptions);

  // Уже авторизованных не держим на странице входа.
  if (session?.user) redirect(callbackUrl);

  return (
    <AuthShell
      eyebrow="Вход в аккаунт"
      title="С возвращением!"
      subtitle="Введите школьный email и пароль — сессия создаётся по JWT и хранится 30 дней."
      highlights={HIGHLIGHTS}
    >
      <Suspense fallback={<LoginFormSkeleton />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
