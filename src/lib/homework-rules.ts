/**
 * Правила домашних заданий (чистый TypeScript).
 *
 * Индикатор дедлайна, ограничения на ответы и файлы, проверка оценки учителя.
 * Модуль не зависит ни от Prisma, ни от Node API, поэтому его можно импортировать
 * и в клиентских компонентах (индикаторы), и на сервере (валидация).
 */

import { isGradeCode, SCHOOL_TIMEZONE, type GradeCode, type ValidationResult } from "@/lib/schedule-rules";

/* -------------------------------------------------------------------------- */
/* Дедлайны                                                                    */
/* -------------------------------------------------------------------------- */

export type DeadlineTone = "ok" | "soon" | "urgent" | "overdue";

export interface DeadlineIndicator {
  tone: DeadlineTone;
  /** Цветной маркер из ТЗ: 🟢 / 🟡 / 🔴 / ⚫. */
  emoji: string;
  label: string;
  /** Оставшееся время в минутах (отрицательное — просрочено). */
  minutesLeft: number;
}

const MINUTE_MS = 60 * 1000;

/**
 *  🟢 больше 24 ч до дедлайна
 *  🟡 меньше 24 ч
 *  🔴 ГОРИТ — меньше 1 ч
 *  ⚫ дедлайн прошёл
 */
export function getDeadlineIndicator(deadline: Date | string, now: Date): DeadlineIndicator {
  const deadlineMs = typeof deadline === "string" ? Date.parse(deadline) : deadline.getTime();
  const minutesLeft = Math.floor((deadlineMs - now.getTime()) / MINUTE_MS);

  if (minutesLeft < 0) {
    return { tone: "overdue", emoji: "⚫", label: "Просрочено", minutesLeft };
  }
  if (minutesLeft < 60) {
    return { tone: "urgent", emoji: "🔴", label: "ГОРИТ — меньше часа", minutesLeft };
  }
  if (minutesLeft <= 24 * 60) {
    return { tone: "soon", emoji: "🟡", label: "Меньше суток", minutesLeft };
  }
  return { tone: "ok", emoji: "🟢", label: "Больше суток", minutesLeft };
}

/** Короткая подпись оставшегося времени: «2 ч 15 мин», «45 мин», «1 д 3 ч». */
export function formatTimeLeft(minutesLeft: number): string {
  const abs = Math.abs(minutesLeft);
  const days = Math.floor(abs / (24 * 60));
  const hours = Math.floor((abs % (24 * 60)) / 60);
  const minutes = abs % 60;

  let text: string;
  if (days > 0) text = `${days} д ${hours} ч`;
  else if (hours > 0) text = `${hours} ч ${minutes} мин`;
  else text = `${minutes} мин`;

  return minutesLeft < 0 ? `просрочено на ${text}` : `осталось ${text}`;
}

/* -------------------------------------------------------------------------- */
/* Ограничения                                                                 */
/* -------------------------------------------------------------------------- */

export const HOMEWORK_LIMITS = {
  titleMin: 3,
  titleMax: 120,
  descriptionMin: 10,
  descriptionMax: 10_000,
  answerMax: 20_000,
  maxScoreMin: 2,
  maxScoreMax: 10,
  defaultMaxScore: 5,
  maxFilesPerSubmission: 5,
  maxFileBytes: 10 * 1024 * 1024,
} as const;

export interface AllowedFileType {
  extension: string;
  mimeType: string;
  /** Байтовая подпись для бинарных форматов; `null` — текстовый файл. */
  signature: readonly number[] | null;
}

/**
 * Разрешённые типы файлов. Проверяется и расширение, и MIME, и первые байты
 * содержимого — иначе переименованный исполняемый файл прошёл бы как PDF.
 */
export const ALLOWED_FILE_TYPES: readonly AllowedFileType[] = [
  { extension: "pdf", mimeType: "application/pdf", signature: [0x25, 0x50, 0x44, 0x46] },
  { extension: "png", mimeType: "image/png", signature: [0x89, 0x50, 0x4e, 0x47] },
  { extension: "jpg", mimeType: "image/jpeg", signature: [0xff, 0xd8, 0xff] },
  { extension: "jpeg", mimeType: "image/jpeg", signature: [0xff, 0xd8, 0xff] },
  {
    extension: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    signature: [0x50, 0x4b, 0x03, 0x04],
  },
  { extension: "txt", mimeType: "text/plain", signature: null },
];

export function findAllowedFileType(fileName: string): AllowedFileType | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  const extension = fileName.slice(dot + 1).toLowerCase();
  return ALLOWED_FILE_TYPES.find((type) => type.extension === extension) ?? null;
}

/** Проверяет содержимое файла по сигнатуре (для текстовых типов — что это UTF-8 без NUL-байтов). */
export function matchesFileSignature(type: AllowedFileType, bytes: Uint8Array): boolean {
  if (type.signature === null) {
    return !bytes.subarray(0, 4096).includes(0);
  }
  return type.signature.every((byte, index) => bytes[index] === byte);
}

/** Безопасное имя для заголовка Content-Disposition и отображения. */
export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f"<>|*?:]/g, "_").trim();
  return cleaned.slice(0, 120) || "file";
}

/* -------------------------------------------------------------------------- */
/* Проверка оценки                                                             */
/* -------------------------------------------------------------------------- */

/** Оценка — целое число от 1 до maxScore. Возвращает `null`, если значение некорректно. */
export function parseGrade(value: unknown, maxScore: number): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > maxScore) return null;
  return numeric;
}

/* -------------------------------------------------------------------------- */
/* Валидация входящих данных                                                   */
/* -------------------------------------------------------------------------- */

export interface CreateHomeworkInput {
  title: string;
  description: string;
  subjectId: string;
  grade: GradeCode;
  deadline: Date;
  maxScore: number;
}

/** Проверка тела POST /api/homework. Существование предмета и класс проверяет сервер. */
export function validateCreateHomework(payload: unknown, now: Date): ValidationResult<CreateHomeworkInput> {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const L = HOMEWORK_LIMITS;

  const title = typeof raw.title === "string" ? raw.title.trim().replace(/\s+/g, " ") : "";
  if (title.length < L.titleMin || title.length > L.titleMax) {
    fields.title = `Название от ${L.titleMin} до ${L.titleMax} символов`;
  }

  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (description.length < L.descriptionMin || description.length > L.descriptionMax) {
    fields.description = `Условие от ${L.descriptionMin} до ${L.descriptionMax} символов`;
  }

  const subjectId = typeof raw.subjectId === "string" ? raw.subjectId.trim() : "";
  if (!subjectId) fields.subjectId = "Выберите предмет";

  const grade = isGradeCode(raw.grade) ? raw.grade : null;
  if (!grade) fields.grade = "Выберите класс";

  const deadline = typeof raw.deadline === "string" ? new Date(raw.deadline) : null;
  if (!deadline || Number.isNaN(deadline.getTime())) {
    fields.deadline = "Укажите дату и время сдачи";
  } else if (deadline.getTime() <= now.getTime()) {
    fields.deadline = "Дедлайн должен быть в будущем";
  }

  const maxScore = raw.maxScore === undefined ? L.defaultMaxScore : parseGrade(raw.maxScore, L.maxScoreMax);
  if (maxScore === null || maxScore < L.maxScoreMin) {
    fields.maxScore = `Максимальный балл от ${L.maxScoreMin} до ${L.maxScoreMax}`;
  }

  if (Object.keys(fields).length > 0 || !deadline || maxScore === null || !grade) {
    return { ok: false, error: "Проверьте правильность заполнения полей", fields };
  }

  return {
    ok: true,
    data: { title, description, subjectId, grade, deadline, maxScore },
  };
}

/** Проверка текста ответа: длина и тип. */
export function validateAnswer(value: unknown): ValidationResult<string> {
  if (typeof value !== "string") {
    return { ok: false, error: "Ответ должен быть текстом", fields: { answer: "Ответ должен быть текстом" } };
  }
  if (value.length > HOMEWORK_LIMITS.answerMax) {
    return {
      ok: false,
      error: `Ответ не длиннее ${HOMEWORK_LIMITS.answerMax} символов`,
      fields: { answer: `Не длиннее ${HOMEWORK_LIMITS.answerMax} символов` },
    };
  }
  return { ok: true, data: value };
}

/** Дата дедлайна во времени школы: «13 октября, 18:00». */
export function formatDeadline(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("ru-RU", {
    timeZone: SCHOOL_TIMEZONE,
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}
