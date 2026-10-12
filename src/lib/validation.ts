import { normalizeSchoolCode } from "@/lib/school-rules";
import type { Role } from "@/types";

/* -------------------------------------------------------------------------- */
/* Константы валидации                                                         */
/* -------------------------------------------------------------------------- */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72; // bcrypt обрезает всё после 72 байт
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 60;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

/**
 * Роли, которые пользователь может выбрать при самостоятельной регистрации.
 * `ADMIN` выдаётся только вручную (сид/панель администратора) — иначе любой
 * желающий получил бы полный доступ к платформе.
 */
export const PUBLIC_ROLES = ["STUDENT", "TEACHER"] as const satisfies readonly Role[];

export type PublicRole = (typeof PUBLIC_ROLES)[number];

/* -------------------------------------------------------------------------- */
/* Типы                                                                        */
/* -------------------------------------------------------------------------- */

/** Ошибки конкретных полей формы — ключи совпадают с именами полей UI. */
export interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  role?: string;
  schoolCode?: string;
  classId?: string;
}

/** Проверенные данные регистрации, готовые к записи в БД. */
export interface RegisterFields {
  name: string;
  email: string;
  password: string;
  role: PublicRole;
  schoolCode: string;
  classId: string | null;
}

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fields: FieldErrors };

/* -------------------------------------------------------------------------- */
/* Хелперы                                                                     */
/* -------------------------------------------------------------------------- */

/** Email всегда храним и сравниваем в нижнем регистре без пробелов. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isPublicRole(value: unknown): value is PublicRole {
  return (
    typeof value === "string" &&
    (PUBLIC_ROLES as readonly string[]).includes(value.trim().toUpperCase())
  );
}

/** Список требований к паролю, которые ещё не выполнены. */
export function getPasswordIssues(password: string): string[] {
  const issues: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    issues.push(`минимум ${PASSWORD_MIN_LENGTH} символов`);
  }
  if (!/[a-zA-Zа-яА-ЯёЁ]/.test(password)) {
    issues.push("хотя бы одна буква");
  }
  if (!/\d/.test(password)) {
    issues.push("хотя бы одна цифра");
  }

  return issues;
}

/** Оценка надёжности пароля для индикатора в форме (0–3). */
export function getPasswordStrength(password: string): {
  score: 0 | 1 | 2 | 3;
  label: string;
} {
  if (!password) return { score: 0, label: "Пусто" };

  let score = 0;
  if (password.length >= PASSWORD_MIN_LENGTH) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-ZА-ЯЁ]/.test(password) && /[a-zа-яё]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^\w\s]/.test(password)) score += 1;

  if (score <= 1) return { score: 1, label: "Слабый пароль" };
  if (score === 2) return { score: 2, label: "Средний пароль" };
  return { score: 3, label: "Надёжный пароль" };
}

/* -------------------------------------------------------------------------- */
/* Валидация                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Проверяет тело запроса на регистрацию.
 * Используется и на сервере (API-роут), и на клиенте (мгновенная подсказка
 * в форме) — правила валидации живут в одном месте.
 */
export function validateRegisterInput(input: unknown): ValidationResult<RegisterFields> {
  const fields: FieldErrors = {};

  if (typeof input !== "object" || input === null) {
    return {
      ok: false,
      error: "Ожидается JSON-объект с данными регистрации",
      fields: {},
    };
  }

  const raw = input as Record<string, unknown>;

  /* Имя ------------------------------------------------------------------ */
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) {
    fields.name = "Укажите имя";
  } else if (name.length < NAME_MIN_LENGTH) {
    fields.name = `Имя должно быть не короче ${NAME_MIN_LENGTH} символов`;
  } else if (name.length > NAME_MAX_LENGTH) {
    fields.name = `Имя должно быть не длиннее ${NAME_MAX_LENGTH} символов`;
  }

  /* Email ---------------------------------------------------------------- */
  const email = typeof raw.email === "string" ? normalizeEmail(raw.email) : "";
  if (!email) {
    fields.email = "Укажите email";
  } else if (!EMAIL_REGEX.test(email)) {
    fields.email = "Некорректный email";
  }

  /* Пароль --------------------------------------------------------------- */
  const password = typeof raw.password === "string" ? raw.password : "";
  if (!password) {
    fields.password = "Придумайте пароль";
  } else if (password.length < PASSWORD_MIN_LENGTH) {
    fields.password = `Пароль должен содержать минимум ${PASSWORD_MIN_LENGTH} символов`;
  } else if (password.length > PASSWORD_MAX_LENGTH) {
    fields.password = `Пароль должен быть не длиннее ${PASSWORD_MAX_LENGTH} символов`;
  } else if (getPasswordIssues(password).length > 0) {
    fields.password = `Пароль должен содержать ${getPasswordIssues(password).join(" и ")}`;
  }

  /* Подтверждение пароля (необязательное поле протокола) ----------------- */
  if (typeof raw.confirmPassword === "string" && raw.confirmPassword !== password) {
    fields.confirmPassword = "Пароли не совпадают";
  }

  /* Роль ----------------------------------------------------------------- */
  let role: PublicRole = "STUDENT";
  if (typeof raw.role === "string" && raw.role.trim() !== "") {
    if (isPublicRole(raw.role)) {
      role = raw.role.trim().toUpperCase() as PublicRole;
    } else {
      fields.role = "Роль может быть только TEACHER или STUDENT";
    }
  }

  /* Школа и класс -------------------------------------------------------- */
  const schoolCode = normalizeSchoolCode(raw.schoolCode);
  if (!schoolCode) fields.schoolCode = "Введите корректный код школы";

  const rawClassId = typeof raw.classId === "string" ? raw.classId.trim() : "";
  let classId: string | null = null;
  if (role === "STUDENT") {
    if (!rawClassId) fields.classId = "Выберите свой класс";
    else classId = rawClassId;
  } else if (rawClassId) {
    fields.classId = "Учителю не нужно выбирать класс";
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, error: "Проверьте правильность заполнения полей", fields };
  }

  return { ok: true, data: { name, email, password, role, schoolCode: schoolCode!, classId } };
}

/* -------------------------------------------------------------------------- */
/* Контракты API регистрации                                                   */
/* -------------------------------------------------------------------------- */

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  schoolCode: string;
  classId?: string | null;
  confirmPassword?: string;
  role?: PublicRole;
}

export interface RegisterResponseUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  schoolId: string;
  classId: string | null;
  createdAt: string;
}

export type RegisterResponse =
  | { ok: true; data: { user: RegisterResponseUser } }
  | { ok: false; error: string; code?: string; fields?: FieldErrors };
