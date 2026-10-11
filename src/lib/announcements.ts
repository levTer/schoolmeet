import { prisma } from "@/lib/prisma";
import { GRADE_LABELS, isGradeCode, type GradeCode } from "@/lib/schedule-rules";
import type { Role } from "@/types";

/**
 * Общешкольные объявления (модель `Announcement`).
 *
 * Создавать и снимать их может только ADMIN (см. `admin-permissions.ts`), а
 * видят активные объявления все: ученик — объявления своей школы и своего
 * класса, учитель и администратор — все.
 */

export const ANNOUNCEMENT_TITLE_MIN = 3;
export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_CONTENT_MIN = 3;
export const ANNOUNCEMENT_CONTENT_MAX = 2000;

/** Сколько объявлений показываем в баннере кабинета. */
export const ANNOUNCEMENT_BANNER_LIMIT = 3;

export interface AnnouncementAuthor {
  id: string;
  name: string;
  role: Role;
}

export interface AnnouncementDto {
  id: string;
  title: string;
  content: string;
  /** null — объявление для всей школы. */
  targetGrade: GradeCode | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  author: AnnouncementAuthor;
}

export interface AnnouncementInput {
  title: string;
  content: string;
  targetGrade: GradeCode | null;
  isActive: boolean;
}

export interface AnnouncementValidationError {
  ok: false;
  error: string;
  fields: Record<string, string>;
}

export type AnnouncementValidation = { ok: true; data: AnnouncementInput } | AnnouncementValidationError;

export function targetGradeLabel(target: GradeCode | null): string {
  return target ? GRADE_LABELS[target] : "Вся школа";
}

/**
 * Валидация объявления. Общая для сервера и формы —
 * правила и тексты ошибок живут в одном месте.
 *
 * `partial` используется при частичном обновлении (PATCH): проверяются только
 * переданные поля.
 */
export function validateAnnouncementInput(
  input: unknown,
  options: { partial?: boolean } = {},
): AnnouncementValidation {
  const fields: Record<string, string> = {};

  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Ожидается JSON-объект объявления", fields: {} };
  }

  const raw = input as Record<string, unknown>;
  const result: Partial<AnnouncementInput> = {};

  /* Заголовок ------------------------------------------------------------- */
  if (raw.title !== undefined || !options.partial) {
    const title = typeof raw.title === "string" ? raw.title.trim().replace(/\s+/g, " ") : "";
    if (!title) fields.title = "Укажите заголовок";
    else if (title.length < ANNOUNCEMENT_TITLE_MIN) fields.title = `Минимум ${ANNOUNCEMENT_TITLE_MIN} символа`;
    else if (title.length > ANNOUNCEMENT_TITLE_MAX) fields.title = `Максимум ${ANNOUNCEMENT_TITLE_MAX} символов`;
    else result.title = title;
  }

  /* Текст ----------------------------------------------------------------- */
  if (raw.content !== undefined || !options.partial) {
    const content = typeof raw.content === "string" ? raw.content.trim() : "";
    if (!content) fields.content = "Напишите текст объявления";
    else if (content.length < ANNOUNCEMENT_CONTENT_MIN) fields.content = "Слишком короткий текст";
    else if (content.length > ANNOUNCEMENT_CONTENT_MAX) fields.content = `Максимум ${ANNOUNCEMENT_CONTENT_MAX} символов`;
    else result.content = content;
  }

  /* Класс ----------------------------------------------------------------- */
  if (raw.targetGrade !== undefined || !options.partial) {
    const target = raw.targetGrade;
    if (target === null || target === undefined || target === "" || target === "ALL") {
      result.targetGrade = null;
    } else if (isGradeCode(target)) {
      result.targetGrade = target;
    } else {
      fields.targetGrade = "Класс может быть с 5 по 11 или «Вся школа»";
    }
  }

  /* Флаг активности ------------------------------------------------------- */
  if (raw.isActive !== undefined) {
    if (typeof raw.isActive !== "boolean") fields.isActive = "Некорректное значение";
    else result.isActive = raw.isActive;
  } else if (!options.partial) {
    result.isActive = true;
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, error: "Проверьте поля объявления", fields };
  }

  return {
    ok: true,
    data: {
      title: result.title ?? "",
      content: result.content ?? "",
      targetGrade: result.targetGrade ?? null,
      isActive: result.isActive ?? true,
    },
  };
}

type AnnouncementRow = {
  id: string;
  title: string;
  content: string;
  targetGrade: GradeCode | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; name: string; role: Role };
};

function toDto(row: AnnouncementRow): AnnouncementDto {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    targetGrade: (row.targetGrade as GradeCode | null) ?? null,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    author: { id: row.author.id, name: row.author.name, role: row.author.role as Role },
  };
}

const announcementInclude = {
  author: { select: { id: true, name: true, role: true } },
} as const;

/** Список объявлений для админ-панели (свежие сверху). */
export async function listAnnouncements(options: { take?: number; includeInactive?: boolean } = {}): Promise<
  AnnouncementDto[]
> {
  const take = Math.min(Math.max(options.take ?? 50, 1), 200);

  const rows = await prisma.announcement.findMany({
    where: options.includeInactive === false ? { isActive: true } : {},
    orderBy: { createdAt: "desc" },
    take,
    include: announcementInclude,
  });

  return rows.map((row) => toDto(row as AnnouncementRow));
}

export interface AnnouncementViewer {
  id: string;
  role: Role;
  /** Класс ученика (для учителей и администраторов — null). */
  grade: GradeCode | null;
}

/**
 * Активные объявления для конкретного человека:
 *  - ученик видит объявления всей школы и своего класса;
 *  - учитель и администратор видят все объявления.
 */
export async function listActiveAnnouncementsForViewer(
  viewer: AnnouncementViewer,
  limit = ANNOUNCEMENT_BANNER_LIMIT,
): Promise<AnnouncementDto[]> {
  const isStudent = viewer.role === "STUDENT";

  const rows = await prisma.announcement.findMany({
    where: {
      isActive: true,
      ...(isStudent ? { OR: [{ targetGrade: null }, { targetGrade: viewer.grade ?? undefined }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 10),
    include: announcementInclude,
  });

  return rows.map((row) => toDto(row as AnnouncementRow));
}

export async function getAnnouncement(id: string): Promise<AnnouncementDto | null> {
  const row = await prisma.announcement.findUnique({ where: { id }, include: announcementInclude });
  return row ? toDto(row as AnnouncementRow) : null;
}

export async function createAnnouncement(
  authorId: string,
  input: AnnouncementInput,
): Promise<AnnouncementDto> {
  const row = await prisma.announcement.create({
    data: {
      title: input.title,
      content: input.content,
      targetGrade: input.targetGrade,
      isActive: input.isActive,
      authorId,
    },
    include: announcementInclude,
  });

  return toDto(row as AnnouncementRow);
}

export interface AnnouncementPatch {
  title?: string;
  content?: string;
  targetGrade?: GradeCode | null;
  isActive?: boolean;
}

export async function updateAnnouncement(id: string, patch: AnnouncementPatch): Promise<AnnouncementDto> {
  const row = await prisma.announcement.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.targetGrade !== undefined ? { targetGrade: patch.targetGrade } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    },
    include: announcementInclude,
  });

  return toDto(row as AnnouncementRow);
}

export async function deleteAnnouncement(id: string): Promise<void> {
  await prisma.announcement.delete({ where: { id } });
}
