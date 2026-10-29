"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  Crown,
  GraduationCap,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  User,
  UserCheck,
} from "lucide-react";

import { FormAlert } from "@/components/ui/form-alert";
import { PasswordField, TextField } from "@/components/ui/field";
import { canonicalSchoolCode, normalizeSchoolCode } from "@/lib/school-rules";
import { GradientButton } from "@/components/ui/gradient-button";
import { normalizeInviteToken, rolesForInvite, type InviteRole } from "@/lib/invite-rules";
import {
  getPasswordStrength,
  normalizeEmail,
  validateRegisterInput,
  type FieldErrors,
  type RegisterResponse,
} from "@/lib/validation";
import { ROLE_LABELS, type Role } from "@/types";

type SelectableRole = "STUDENT" | "TEACHER";

const ROLE_OPTIONS: readonly {
  value: SelectableRole;
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
    icon: UserCheck,
  },
];

interface SchoolCheckData {
  school: {
    name: string;
    code: string;
    /**
     * Политика изоляции классов школы. `false` — гибкая школа (например,
     * «Школа Душа» или «Fullhouse»): класс при регистрации необязателен.
     * Отсутствует/`true` — строгая, класс обязателен (fail closed).
     */
    strictClassIsolation?: boolean;
  };
  classes: Array<{ id: string; name: string; grade: string | null }>;
  inviteRole?: InviteRole | null;
  /**
   * У школы ровно один класс («Общий»): сетку выбора класса не показываем,
   * а `defaultClassId` подставляем в форму автоматически.
   */
  isSingleClass?: boolean;
  /** id единственного класса школы (заполнен, когда `isSingleClass === true`). */
  defaultClassId?: string | null;
}

interface SchoolCheckResponse {
  ok?: boolean;
  valid?: boolean;
  data?: SchoolCheckData;
  school?: SchoolCheckData["school"];
  classes?: SchoolCheckData["classes"];
  inviteRole?: InviteRole | null;
  isSingleClass?: boolean;
  defaultClassId?: string | null;
  error?: string;
  fields?: FieldErrors;
}

function schoolCheckDataFrom(payload: SchoolCheckResponse): SchoolCheckData | null {
  const isSingleClass = payload.isSingleClass ?? payload.data?.isSingleClass;
  const defaultClassId = payload.defaultClassId ?? payload.data?.defaultClassId ?? null;

  if (payload.data?.school && Array.isArray(payload.data.classes)) {
    return { ...payload.data, isSingleClass, defaultClassId };
  }
  if (payload.valid && payload.school && Array.isArray(payload.classes)) {
    return {
      school: payload.school,
      classes: payload.classes,
      inviteRole: payload.inviteRole ?? null,
      isSingleClass,
      defaultClassId,
    };
  }
  return null;
}

const STRENGTH_STYLES = [
  "w-0 bg-transparent",
  "w-1/3 bg-rose-500",
  "w-2/3 bg-amber-400",
  "w-full bg-emerald-400",
] as const;

interface RegisterFormProps {
  /** Код школы из ссылки-приглашения (`?code=…`) — подставляется сразу. */
  initialSchoolCode?: string;
  /** Секретный токен приглашения (`?invite=…`). */
  initialInvite?: string;
  /** Уровень ссылки, проверенный сервером: TEACHER / ADMIN / null (публично). */
  initialInviteRole?: InviteRole | null;
}

/**
 * Форма регистрации: создаёт аккаунт через `POST /api/auth/register`.
 *
 * Трёхуровневая система доступа: без секретной ссылки роль всегда STUDENT
 * (выбор скрыт); `teacherInviteToken` открывает роль TEACHER; `adminInviteToken`
 * регистрирует сразу с ролью ADMIN. Уровень ссылки проверяет сервер — и при
 * отправке формы, и в `/api/schools/check`.
 */
export function RegisterForm({
  initialSchoolCode = "",
  initialInvite = "",
  initialInviteRole = null,
}: RegisterFormProps) {
  const router = useRouter();

  const invite = useMemo(() => normalizeInviteToken(initialInvite), [initialInvite]);
  const [inviteRole, setInviteRole] = useState<InviteRole | null>(initialInviteRole);
  const [role, setRole] = useState<SelectableRole>(initialInviteRole === "TEACHER" ? "TEACHER" : "STUDENT");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [schoolCode, setSchoolCode] = useState(initialSchoolCode);
  const [schoolCheck, setSchoolCheck] = useState<SchoolCheckData | null>(null);
  const [classId, setClassId] = useState("");
  const [isCheckingSchool, setIsCheckingSchool] = useState(false);
  const schoolLookupRequestRef = useRef(0);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreated, setIsCreated] = useState(false);

  const strength = useMemo(() => getPasswordStrength(password), [password]);

  /**
   * Обязателен ли класс. В гибкой школе (`strictClassIsolation === false`)
   * ученик регистрируется БЕЗ класса и посещает любые уроки своей школы;
   * API принимает `classId = null` (в схеме БД колонка опциональна).
   */
  const classIsRequired = schoolCheck?.school.strictClassIsolation !== false;

  /**
   * У школы ровно один класс («Общий», «Школа Душа»): сетку выбора класса
   * СТРОГО не показываем, а `defaultClassId` подставляем в форму. Ученик
   * регистрируется в один клик: код школы → ФИО → email → пароль.
   */
  const singleClassId =
    schoolCheck?.isSingleClass === true
      ? schoolCheck.defaultClassId ?? schoolCheck.classes[0]?.id ?? ""
      : "";
  const isSingleClass = singleClassId !== "";

  /** Автопроверка кода школы из ссылки-приглашения при открытии страницы. */
  const didAutoCheckRef = useRef(false);
  useEffect(() => {
    if (didAutoCheckRef.current || !initialSchoolCode.trim()) return;
    didAutoCheckRef.current = true;
    void handleCheckSchool();
    // Проверяем только при монтировании: дальше пользователь жмёт «Проверить код» сам.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Итоговая роль: ADMIN выдаёт только admin-ссылка, TEACHER — teacher-ссылка. */
  const effectiveRole: Role = inviteRole === "ADMIN" ? "ADMIN" : inviteRole === "TEACHER" ? role : "STUDENT";

  function clearFieldError(field: keyof FieldErrors) {
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  /**
   * Проверяет код школы и возвращает подтверждённые данные (или `null`).
   *
   * Возвращаемое значение нужно отправке формы: если человек ввёл код и сразу
   * нажал «Зарегистрироваться», проверка выполняется в том же нажатии —
   * регистрация ученика одноклассной школы остаётся в один клик.
   */
  async function handleCheckSchool(): Promise<SchoolCheckData | null> {
    const normalizedCode = normalizeSchoolCode(schoolCode);
    if (!normalizedCode) {
      setSchoolCheck(null);
      setFieldErrors((previous) => ({
        ...previous,
        schoolCode: "Введите корректный код школы, выданный администратором",
      }));
      return null;
    }

    const requestId = ++schoolLookupRequestRef.current;
    setIsCheckingSchool(true);
    setSchoolCheck(null);
    setClassId("");
    clearFieldError("schoolCode");
    setFormError(null);

    try {
      // Пробелы по краям снимает сервер (`code.trim()`), поэтому отправляем ввод как есть.
      const inviteParam = invite ? `&invite=${encodeURIComponent(invite)}` : "";
      const response = await fetch(`/api/schools/check?code=${encodeURIComponent(schoolCode)}${inviteParam}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as SchoolCheckResponse;
      if (schoolLookupRequestRef.current !== requestId) return null;

      const data = schoolCheckDataFrom(payload);
      if (!response.ok || payload.ok === false || payload.valid === false || !data) {
        setInviteRole(null);
        setRole("STUDENT");
        setFieldErrors((previous) => ({
          ...previous,
          schoolCode: payload.fields?.schoolCode ?? payload.error ?? "Школа с таким кодом не найдена",
        }));
        return null;
      }

      // Уровень ссылки перепроверяем для каждого кода школы: токен действует
      // только для своей школы, поэтому после смены кода роль возвращается к STUDENT.
      const nextInviteRole = data.inviteRole ?? null;
      setInviteRole(nextInviteRole);
      setRole(nextInviteRole === "TEACHER" ? "TEACHER" : "STUDENT");
      setSchoolCheck(data);
      // Одноклассная школа: класс подставляем сразу — пользователь его не
      // выбирает и вообще не видит сетку классов.
      const autoClassId =
        data.isSingleClass === true ? data.defaultClassId ?? data.classes[0]?.id ?? "" : "";
      if (autoClassId) setClassId(autoClassId);
      setFieldErrors((previous) => ({ ...previous, schoolCode: undefined, classId: undefined, role: undefined }));
      return data;
    } catch {
      if (schoolLookupRequestRef.current === requestId) {
        setFieldErrors((previous) => ({
          ...previous,
          schoolCode: "Не удалось проверить код школы. Попробуйте ещё раз.",
        }));
      }
      return null;
    } finally {
      if (schoolLookupRequestRef.current === requestId) setIsCheckingSchool(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    /*
      Код школы проверяем прямо здесь, если он ещё не подтверждён: человек мог
      ввести код и сразу нажать «Зарегистрироваться». Для одноклассной школы
      это и есть регистрация в один клик — лишних нажатий не требуется.
    */
    const activeSchoolCheck =
      schoolCheck ?? (normalizeSchoolCode(schoolCode) ? await handleCheckSchool() : null);
    // Класс одноклассной школы (может появиться только что, вместе с проверкой).
    const activeSingleClassId =
      activeSchoolCheck?.isSingleClass === true
        ? activeSchoolCheck.defaultClassId ?? activeSchoolCheck.classes[0]?.id ?? ""
        : singleClassId;
    const classIdForSubmit = classId || activeSingleClassId;

    const normalizedEmail = normalizeEmail(email);
    const normalizedSchoolCode = normalizeSchoolCode(schoolCode);
    const allowedRoles = rolesForInvite(inviteRole);
    const validation = validateRegisterInput(
      {
        name,
        email: normalizedEmail,
        password,
        role: effectiveRole,
        schoolCode,
        classId: effectiveRole === "STUDENT" ? classIdForSubmit : null,
      },
      { allowedRoles, classIdOptional: !classIsRequired },
    );

    const nextErrors: FieldErrors = validation.ok ? {} : { ...validation.fields };
    // Сравниваем канонические коды: `DUSHA`/`SOUL` — псевдонимы «Школы Душа»,
    // поэтому регистрация принимает и короткий код, и полный.
    if (
      !activeSchoolCheck ||
      canonicalSchoolCode(activeSchoolCheck.school.code) !== canonicalSchoolCode(normalizedSchoolCode)
    ) {
      nextErrors.schoolCode = "Сначала проверьте код школы";
    }
    // Для одноклассной школы класс уже подставлен автоматически: проверяем
    // именно то значение, которое уйдёт на сервер (`classId || singleClassId`).
    if (
      effectiveRole === "STUDENT" &&
      activeSchoolCheck &&
      classIsRequired &&
      !activeSchoolCheck.classes.some((item) => item.id === classIdForSubmit)
    ) {
      nextErrors.classId = "Выберите класс из списка школы";
    }
    // Класс подставлен, но в состояние ещё не попал — синхронизируем, чтобы
    // тело запроса взяло именно его.
    if (effectiveRole === "STUDENT" && activeSingleClassId && classId !== activeSingleClassId) {
      setClassId(activeSingleClassId);
    }

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
          role: effectiveRole,
          schoolCode,
          classId: effectiveRole === "STUDENT" ? classId || null : null,
          invite,
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
      // Email передаём в query, чтобы форма входа подставила его сама
      // (логин уже нормализован: без пробелов и в нижнем регистре).
      setIsCreated(true);
      setTimeout(() => {
        router.push(`/login?registered=true&email=${encodeURIComponent(normalizedEmail)}`);
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
          Роль «{ROLE_LABELS[effectiveRole]}» сохранена. Перенаправляем на страницу входа…
        </p>
        <p className="inline-flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <Link
            href={`/login?registered=true&email=${encodeURIComponent(normalizeEmail(email))}`}
            className="underline-offset-4 hover:text-white hover:underline"
          >
            Перейти ко входу вручную
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-2.5 md:gap-3.5">
      {formError && (
        <FormAlert variant="error" onDismiss={() => setFormError(null)}>
          {formError}
        </FormAlert>
      )}

      <div className="flex flex-col gap-2">
        <TextField
          label="Код школы"
          className="h-10 text-sm px-3 py-1.5 md:h-11"
          name="schoolCode"
          autoComplete="off"
          placeholder="Код, выданный администратором"
          value={schoolCode}
          error={fieldErrors.schoolCode}
          onChange={(event) => {
            const value = event.target.value;
            schoolLookupRequestRef.current += 1;
            setSchoolCode(value);
            setSchoolCheck(null);
            setClassId("");
            setIsCheckingSchool(false);
            // Смена кода обнуляет действие секретной ссылки до новой проверки.
            setInviteRole(null);
            setRole("STUDENT");
            clearFieldError("schoolCode");
            clearFieldError("classId");
            clearFieldError("role");
          }}
          onBlur={() => {
            // Автопроверка кода: ученик «одноклассной» школы проходит
            // регистрацию в один клик — код подтверждается, как только поле
            // покинуто, и единственный класс подставляется сам.
            if (!schoolCheck && schoolCode.trim() && !isCheckingSchool) void handleCheckSchool();
          }}
        />
        <button
          type="button"
          onClick={() => void handleCheckSchool()}
          disabled={isCheckingSchool || !schoolCode.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-400/25 bg-brand-500/10 px-4 py-2.5 text-sm font-medium text-brand-100 transition hover:bg-brand-500/20 disabled:cursor-not-allowed disabled:opacity-50 max-md:h-9 max-md:px-3 max-md:py-0 max-md:text-xs"
        >
          {isCheckingSchool ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {isCheckingSchool ? "Проверяем…" : "Проверить код"}
        </button>
        {schoolCheck ? (
          <p role="status" className="text-xs text-emerald-300">
            Школа подтверждена: {schoolCheck.school.name}
          </p>
        ) : null}
      </div>

      <TextField
        label="Имя и фамилия"
        className="h-10 text-sm py-1.5 pr-3 md:h-11"
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
        className="h-10 text-sm py-1.5 pr-3 md:h-11"
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

      {/* Роль: публично — всегда Ученик; по teacher-ссылке — выбор Ученик/Учитель; по admin-ссылке — Администратор */}
      <div className="space-y-1.5">
        <span className="block text-xs font-medium uppercase tracking-wider text-slate-400">
          Я регистрируюсь как
        </span>

        {inviteRole === "ADMIN" ? (
          <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-1">
            <div className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-brand-gradient px-3 text-xs font-medium text-white shadow-glow">
              <Crown className="h-4 w-4" />
              {ROLE_LABELS.ADMIN}
            </div>
          </div>
        ) : inviteRole === "TEACHER" ? (
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
                      ? "relative inline-flex items-center justify-center gap-2 rounded-xl bg-brand-gradient px-3 py-2.5 text-sm font-semibold text-white shadow-glow transition max-md:h-9 max-md:px-2 max-md:py-0 max-md:text-xs max-md:font-medium"
                      : "relative inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 transition hover:bg-white/5 hover:text-white max-md:h-9 max-md:px-2 max-md:py-0 max-md:text-xs max-md:font-medium"
                  }
                >
                  <Icon className="h-4 w-4" />
                  {option.label}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-1">
            <div className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-white/[0.06] px-3 text-xs font-medium text-slate-200">
              <GraduationCap className="h-4 w-4" />
              {ROLE_LABELS.STUDENT}
              <Lock className="h-3.5 w-3.5 text-slate-500" />
            </div>
          </div>
        )}

        <p className="text-[11px] leading-snug text-slate-500 md:text-xs md:leading-relaxed">
          {inviteRole === "ADMIN"
            ? "Роль Администратора выдана по секретной ссылке приглашения."
            : inviteRole === "TEACHER"
              ? "Ссылка учителя открыла роль «Учитель». Без ссылки доступна только роль ученика."
              : "Роль по умолчанию — Ученик. Роли Учитель и Администратор выдаются только по специальным ссылкам-приглашениям от администрации школы."}
        </p>
        {fieldErrors.role && <p className="text-xs text-rose-300">{fieldErrors.role}</p>}
      </div>

      {/* Одноклассная школа: сетку выбора класса СТРОГО скрываем — класс
          («Общий») уже подставлен автоматически из `defaultClassId`. */}
      {effectiveRole === "STUDENT" && schoolCheck && isSingleClass ? (
        <p
          role="status"
          className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200"
        >
          Класс: <span className="font-medium">{schoolCheck.classes[0]?.name ?? "Общий"}</span> —
          назначается автоматически, выбирать не нужно.
        </p>
      ) : effectiveRole === "STUDENT" && schoolCheck ? (
        <div className="space-y-1.5">
          <span className="block text-xs font-medium uppercase tracking-wider text-slate-400">Класс</span>
          <div role="group" aria-label="Выбор класса" className="grid grid-cols-4 gap-1.5">
            {!classIsRequired && (
              <button
                type="button"
                aria-pressed={!classId}
                onClick={() => {
                  setClassId("");
                  clearFieldError("classId");
                }}
                className={`inline-flex h-8 min-w-0 items-center justify-center truncate rounded-lg border px-1 text-xs transition md:h-9 md:text-sm ${
                  !classId
                    ? "border-brand-400/50 bg-brand-500/15 text-white"
                    : "border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.07]"
                }`}
              >
                Без класса
              </button>
            )}
            {schoolCheck.classes.map((schoolClass) => {
              const isSelected = classId === schoolClass.id;
              return (
                <button
                  key={schoolClass.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    setClassId(schoolClass.id);
                    clearFieldError("classId");
                  }}
                  className={`inline-flex h-8 min-w-0 items-center justify-center truncate rounded-lg border px-1 text-xs transition md:h-9 md:text-sm ${
                    isSelected
                      ? "border-brand-400/50 bg-brand-500/15 text-white"
                      : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]"
                  }`}
                >
                  {schoolClass.name}
                </button>
              );
            })}
          </div>
          {fieldErrors.classId && <p role="alert" className="text-xs text-rose-300">{fieldErrors.classId}</p>}
          {classIsRequired && schoolCheck.classes.length === 0 ? (
            <p className="text-xs text-slate-500">В школе пока не созданы классы. Обратитесь к администратору.</p>
          ) : !classIsRequired ? (
            <p className="text-xs text-slate-500">
              Класс необязателен: школа без классной изоляции — вы сможете посещать любые уроки школы, а класс выбрать позже в меню.
            </p>
          ) : null}
        </div>
      ) : effectiveRole === "STUDENT" ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-500">
          Сначала подтвердите код школы — затем появится список классов.
        </p>
      ) : null}

      <div className="space-y-1.5">
        <PasswordField
          label="Пароль"
          className="h-10 text-sm py-1.5 pr-3 md:h-11"
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
        className="h-10 text-sm py-1.5 pr-3 md:h-11"
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
        className="h-10 py-1.5 text-sm md:h-11"
      >
        Зарегистрироваться
      </GradientButton>

      <p className="text-center text-[11px] leading-snug text-slate-500 md:text-xs md:leading-relaxed">
        Пароль хешируется алгоритмом bcrypt и не хранится в открытом виде.
      </p>

      <p className="pb-1 text-center text-sm text-slate-400">
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
