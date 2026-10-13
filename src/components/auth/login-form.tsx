"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { ArrowRight, KeyRound, Mail, Sparkles } from "lucide-react";

import { FormAlert } from "@/components/ui/form-alert";
import { PasswordField, TextField } from "@/components/ui/field";
import { GradientButton } from "@/components/ui/gradient-button";
import { resolveLoginErrorMessage } from "@/lib/auth-errors";
import { QUICK_LOGIN_ACCOUNTS, type QuickLoginAccount } from "@/lib/demo-accounts";
import { normalizeEmail } from "@/lib/validation";
import { sanitizeRedirectPath } from "@/lib/utils";

/**
 * Форма входа (NextAuth CredentialsProvider).
 *
 * После успешной проверки NextAuth ставит JWT-cookie сессии, форма уводит
 * пользователя на `/dashboard` (или на `callbackUrl`, который middleware
 * добавил при редиректе с защищённого маршрута).
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const redirectTo = sanitizeRedirectPath(searchParams.get("callbackUrl"));
  // Форма регистрации возвращает сюда `?registered=true&email=…`; значение «1»
  // поддерживаем для совместимости со старыми ссылками.
  const registeredParam = searchParams.get("registered");
  const justRegistered = registeredParam === "true" || registeredParam === "1";
  // Email из query-параметра подставляем сразу в инпут (и сразу нормализуем:
  // вход ищет пользователя по email без пробелов и в нижнем регистре).
  const prefilledEmail = normalizeEmail(searchParams.get("email") ?? "");
  const authError = searchParams.get("error");

  const [email, setEmail] = useState(prefilledEmail);
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(
    authError ? resolveLoginErrorMessage(authError) : null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedEmail = normalizeEmail(email);
    const nextErrors: { email?: string; password?: string } = {};

    if (!normalizedEmail) nextErrors.email = "Укажите email";
    if (!password) nextErrors.password = "Введите пароль";

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSubmitting(true);
    setFormError(null);

    try {
      const result = await signIn("credentials", {
        redirect: false,
        email: normalizedEmail,
        password,
        callbackUrl: redirectTo,
      });

      if (!result || result.error) {
        setFormError(resolveLoginErrorMessage(result?.error));
        return;
      }

      // Успех: cookie сессии уже установлена — обновляем роутер и уходим в кабинет.
      router.replace(sanitizeRedirectPath(result.url ?? redirectTo));
      router.refresh();
    } catch {
      setFormError("Сервер авторизации недоступен. Проверьте соединение и попробуйте снова.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function fillDemo(account: QuickLoginAccount) {
    setEmail(account.email);
    setPassword(account.password);
    setFieldErrors({});
    setFormError(null);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {justRegistered && (
        <FormAlert variant="success">
          Аккаунт создан! Войдите, чтобы попасть в личный кабинет.
        </FormAlert>
      )}

      {formError && (
        <FormAlert variant="error" onDismiss={() => setFormError(null)}>
          {formError}
        </FormAlert>
      )}

      <TextField
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        placeholder="ivan@school.ru"
        icon={Mail}
        value={email}
        error={fieldErrors.email}
        onChange={(event) => {
          setEmail(event.target.value);
          if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
        }}
      />

      <PasswordField
        label="Пароль"
        name="password"
        autoComplete="current-password"
        placeholder="••••••••"
        icon={KeyRound}
        value={password}
        error={fieldErrors.password}
        onChange={(event) => {
          setPassword(event.target.value);
          if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
        }}
      />

      <GradientButton type="submit" loading={isSubmitting} loadingText="Входим…" icon={ArrowRight}>
        Войти
      </GradientButton>

      <p className="text-center text-xs text-slate-500">
        Забыли пароль? Восстановление доступа появится в следующем релизе.
      </p>

      <div className="space-y-3 rounded-2xl border border-brand-400/20 bg-brand-500/[0.06] p-4">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-100">
          <Sparkles className="h-3.5 w-3.5 text-brand-300" />
          Быстрый демо-вход
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {QUICK_LOGIN_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => fillDemo(account)}
              className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-left text-xs text-slate-200 transition hover:border-brand-400/50 hover:bg-brand-500/15 hover:text-white"
            >
              {account.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Нажмите кнопку — Email и пароль заполнятся автоматически. Затем нажмите «Войти».
        </p>
      </div>

      <p className="text-center text-sm text-slate-400">
        Ещё нет аккаунта?{" "}
        <Link
          href="/auth/register"
          className="font-medium text-brand-200 underline-offset-4 transition hover:text-white hover:underline"
        >
          Зарегистрироваться
        </Link>
      </p>
    </form>
  );
}

/** Скелет формы на время подгрузки клиентских параметров (`Suspense`). */
export function LoginFormSkeleton() {
  return (
    <div className="space-y-5">
      {[0, 1].map((key) => (
        <div key={key} className="space-y-2">
          <div className="h-3 w-20 animate-pulse rounded-full bg-white/10" />
          <div className="h-11 animate-pulse rounded-xl bg-white/5" />
        </div>
      ))}
      <div className="h-11 animate-pulse rounded-xl bg-white/10" />
    </div>
  );
}
