"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Crown, Loader2, ShieldCheck, XCircle } from "lucide-react";

import { FormAlert } from "@/components/ui/form-alert";
import { GradientButton } from "@/components/ui/gradient-button";
import { apiRequest } from "@/lib/client-api";

interface AdminPromotePromptProps {
  /** Код школы, которой принадлежит admin-ссылка. */
  schoolCode: string;
  /** Секретный токен из ссылки (`?invite=…`). */
  invite: string;
  /** Пользователь уже администратор — показываем подтверждение без вопроса. */
  alreadyAdmin?: boolean;
}

/**
 * Обновляет JWT-сессию из БД (POST /api/auth/session с `trigger: "update"`),
 * чтобы новая роль ADMIN была видна middleware до перехода в админ-панель.
 */
async function refreshSessionRole(): Promise<void> {
  try {
    const csrfPayload = (await fetch("/api/auth/csrf", { cache: "no-store" }).then((response) =>
      response.json(),
    )) as { csrfToken?: string };
    await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csrfToken: csrfPayload?.csrfToken, data: {} }),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    // Сессия обновится и фоном (раз в минуту) — переход не блокируем.
  }
}

/**
 * Окно подтверждения для вошедшего пользователя, перешедшего по секретной
 * ссылке Администратора: «Повысить ваш аккаунт до ADMIN?».
 */
export function AdminPromotePrompt({ schoolCode, invite, alreadyAdmin = false }: AdminPromotePromptProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setIsSubmitting(true);
    setError(null);

    const result = await apiRequest<{ alreadyAdmin: boolean }>("/api/auth/promote", {
      json: { schoolCode, invite },
    });
    setIsSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setIsDone(true);
    await refreshSessionRole();
    router.push("/admin");
    router.refresh();
  }

  if (alreadyAdmin || isDone) {
    return (
      <div className="animate-fade-up space-y-4 py-6 text-center">
        <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow">
          <Crown className="h-7 w-7 text-white" />
        </span>
        <h3 className="text-lg font-semibold text-white">
          {alreadyAdmin ? "У вас уже есть права Администратора" : "Права Администратора выданы"}
        </h3>
        <p className="text-sm leading-relaxed text-slate-400">
          {alreadyAdmin
            ? "Повышение не требуется — ваш аккаунт уже имеет роль ADMIN."
            : "Роль вашего аккаунта обновлена до ADMIN. Открываем админ-панель…"}
        </p>
        <Link
          href="/admin"
          className="inline-flex items-center gap-2 rounded-xl border border-brand-400/25 bg-brand-500/10 px-4 py-2.5 text-sm font-medium text-brand-100 transition hover:bg-brand-500/20"
        >
          <ShieldCheck className="h-4 w-4" />
          Перейти в админ-панель
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-fade-up space-y-5">
      {error && (
        <FormAlert variant="error" onDismiss={() => setError(null)}>
          {error}
        </FormAlert>
      )}

      <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4">
        <p className="flex items-start gap-3 text-sm leading-relaxed text-amber-100">
          <Crown className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <span>
            <strong className="font-semibold">Вы перешли по ссылке Администратора.</strong>{" "}
            Повысить ваш аккаунт до ADMIN?
          </span>
        </p>
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        Аккаунт получит права администратора школы: управление пользователями, ролями, объявлениями
        и активными уроками. Повышение записывается в журнал действий.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <GradientButton
          type="button"
          loading={isSubmitting}
          loadingText="Повышаем…"
          icon={isSubmitting ? Loader2 : CheckCircle2}
          onClick={() => void handleConfirm()}
        >
          Да, повысить до ADMIN
        </GradientButton>

        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10"
        >
          <XCircle className="h-4 w-4" />
          Нет, отмена
        </Link>
      </div>
    </div>
  );
}
