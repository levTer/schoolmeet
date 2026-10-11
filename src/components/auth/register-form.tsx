"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  GraduationCap,
  KeyRound,
  Loader2,
  Mail,
  User,
} from "lucide-react";

import { FormAlert } from "@/components/ui/form-alert";
import { PasswordField, TextField } from "@/components/ui/field";
import { GradientButton } from "@/components/ui/gradient-button";
import {
  getPasswordStrength,
  normalizeEmail,
  validateRegisterInput,
  type FieldErrors,
  type RegisterResponse,
} from "@/lib/validation";

type PublicRole = "STUDENT" | "TEACHER";

const ROLE_OPTIONS: readonly {
  value: PublicRole;
  label: string;
  hint: string;
  icon: typeof GraduationCap;
}[] = [
  {
    value: "STUDENT",
    label: "Я Ученик",
    hint: "Смотрю расписание, подключаюсь к урокам и пишу в чат класса.",
    icon: GraduationCap,
  },
  {
    value: "TEACHER",
    label: "Я Учитель",
    hint: "Создаю уроки, планирую расписание, веду доску и модерю чат.",
    icon: User,
  },
];

const STRENGTH_STYLES = [
  "w-0 bg-transparent",
  "w-1/3 bg-rose-500",
  "w-2/3 bg-amber-400",
  "w-full bg-emerald-400",
] as const;

/** Форма регистрации: создаёт аккаунт через `POST /api/auth/register`. */
export function RegisterForm() {
  const router = useRouter();

  const [role, setRole] = useState<PublicRole>("STUDENT");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreated, setIsCreated] = useState(false);

  const strength = useMemo(() => getPasswordStrength(password), [password]);
  const activeRole = ROLE_OPTIONS.find((option) => option.value === role) ?? ROLE_OPTIONS[0];

  function clearFieldError(field: keyof FieldErrors) {
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedEmail = normalizeEmail(email);
    const validation = validateRegisterInput({ name, email: normalizedEmail, password, role });

    const nextErrors: FieldErrors = validation.ok ? {} : { ...validation.fields };

    /* Подтверждение пароля проверяем здесь: в БД оно не нужно. */
    if (!confirmPassword) {
      nextErrors.confirmPassword = "Повторите пароль";
    } else if (confirmPassword !== password) {
      nextErrors.confirmPassword = "Пароли не совпадают";
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFormError("Проверьте правильность заполнения полей");
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email: normalizedEmail,
          password,
          confirmPassword,
          role,
        }),
      });

      const payload = (await response.json()) as RegisterResponse;

      if (!payload.ok) {
        setFieldErrors(payload.fields ?? {});
        setFormError(payload.error);
        return;
      }

      if (!response.ok) {
        setFormError("Сервер отклонил запрос. Попробуйте ещё раз.");
        return;
      }

      // Аккаунт создан — показываем подтверждение и уводим на вход.
      setIsCreated(true);
      setTimeout(() => {
        router.push(`/login?registered=1&email=${encodeURIComponent(normalizedEmail)}`);
      }, 1400);
    } catch {
      setFormError("Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isCreated) {
    return (
      <div className="animate-fade-up space-y-4 py-6 text-center">
        <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow">
          <CheckCircle2 className="h-7 w-7 text-white" />
        </span>
        <h3 className="text-lg font-semibold text-white">Аккаунт создан</h3>
        <p className="text-sm leading-relaxed text-slate-400">
          Роль «{role === "TEACHER" ? "Учитель" : "Ученик"}» сохранена. Перенаправляем на страницу
          входа…
        </p>
        <p className="inline-flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <Link href="/login" className="underline-offset-4 hover:text-white hover:underline">
            Перейти ко входу вручную
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {formError && (
        <FormAlert variant="error" onDismiss={() => setFormError(null)}>
          {formError}
        </FormAlert>
      )}

      <TextField
        label="Имя и фамилия"
        name="name"
        autoComplete="name"
        placeholder="Анна Иванова"
        icon={User}
        value={name}
        error={fieldErrors.name}
        onChange={(event) => {
          setName(event.target.value);
          clearFieldError("name");
        }}
      />

      <TextField
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        placeholder="anna@school.ru"
        icon={Mail}
        value={email}
        error={fieldErrors.email}
        onChange={(event) => {
          setEmail(event.target.value);
          clearFieldError("email");
        }}
      />

      {/* Роль: переключатель «Я Ученик» / «Я Учитель» */}
      <div className="space-y-2">
        <span className="block text-xs font-medium uppercase tracking-wider text-slate-400">
          Я регистрируюсь как
        </span>

        <div className="grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-ink-900/60 p-1">
          {ROLE_OPTIONS.map((option) => {
            const isActive = option.value === role;
            const Icon = option.icon;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setRole(option.value);
                  clearFieldError("role");
                }}
                aria-pressed={isActive}
                className={
                  isActive
                    ? "relative inline-flex items-center justify-center gap-2 rounded-xl bg-brand-gradient px-3 py-2.5 text-sm font-semibold text-white shadow-glow transition"
                    : "relative inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-white"
                }
              >
                <Icon className="h-4 w-4" />
                {option.label}
              </button>
            );
          })}
        </div>

        <p className="text-xs leading-relaxed text-slate-500">{activeRole.hint}</p>
        {fieldErrors.role && <p className="text-xs text-rose-300">{fieldErrors.role}</p>}
      </div>

      <div className="space-y-2">
        <PasswordField
          label="Пароль"
          name="new-password"
          autoComplete="new-password"
          placeholder="Минимум 8 символов"
          icon={KeyRound}
          value={password}
          error={fieldErrors.password}
          onChange={(event) => {
            setPassword(event.target.value);
            clearFieldError("password");
          }}
        />

        {password && (
          <div className="animate-fade-in space-y-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all duration-500 ${STRENGTH_STYLES[strength.score]}`}
              />
            </div>
            <p className="text-[11px] text-slate-500">
              {strength.label} · буквы и цифры, минимум 8 символов
            </p>
          </div>
        )}
      </div>

      <PasswordField
        label="Подтверждение пароля"
        name="confirm-password"
        autoComplete="new-password"
        placeholder="Повторите пароль"
        icon={KeyRound}
        value={confirmPassword}
        error={fieldErrors.confirmPassword}
        onChange={(event) => {
          setConfirmPassword(event.target.value);
          clearFieldError("confirmPassword");
        }}
      />

      <GradientButton
        type="submit"
        loading={isSubmitting}
        loadingText="Создаём аккаунт…"
        icon={ArrowRight}
      >
        Создать аккаунт
      </GradientButton>

      <p className="text-center text-xs leading-relaxed text-slate-500">
        Пароль хешируется алгоритмом bcrypt и не хранится в открытом виде.
      </p>

      <p className="text-center text-sm text-slate-400">
        Уже есть аккаунт?{" "}
        <Link
          href="/login"
          className="font-medium text-brand-200 underline-offset-4 transition hover:text-white hover:underline"
        >
          Войти
        </Link>
      </p>
    </form>
  );
}
