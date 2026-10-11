import { Prisma } from "@prisma/client";

import { buildLessonCodeCandidate } from "@/lib/lesson-code";
import { generateRoomEncryptionKey } from "@/lib/meetings";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { GRADE_LABELS, slotsOverlap, type CreateLessonInput, type GradeCode, type ScheduleConflictInfo } from "@/lib/schedule-rules";
import type { SchoolViewer } from "@/lib/school-viewer";
import { DEFAULT_SUBJECTS } from "@/lib/subjects";
import type { DayOfWeek, Schedule, Subject } from "@/types";

/**
 * Серверная логика расписания: кто что видит, создание урока с проверкой
 * пересечений и удаление. HTTP-слой — в `src/app/api/schedule`.
 */

const MAX_CODE_ATTEMPTS = 5;

const lessonInclude = {
  subject: { select: { id: true, name: true, color: true, emoji: true } },
  teacher: { select: { id: true, name: true } },
} as const;

type LessonRow = Prisma.ScheduleGetPayload<{ include: typeof lessonInclude }>;

type ScheduleConflict = ScheduleConflictInfo;

function toLessonDto(row: LessonRow): Schedule {
  return {
    id: row.id,
    subjectId: row.subjectId,
    teacherId: row.teacherId,
    grade: row.grade as GradeCode,
    dayOfWeek: row.dayOfWeek as DayOfWeek,
    startTime: row.startTime,
    endTime: row.endTime,
    room: row.room,
    meetingCode: row.meetingCode,
    subject: row.subject,
    teacher: row.teacher,
  };
}

/**
 * Уроки, которые видит пользователь:
 *  - ученик — только расписание своего класса (без класса — пусто);
 *  - учитель — только свои уроки;
 *  - администратор — всё расписание школы.
 */
export async function listLessonsForViewer(viewer: SchoolViewer): Promise<Schedule[]> {
  if (viewer.role === "STUDENT") {
    if (!viewer.grade) return [];
    return loadLessons({ grade: viewer.grade });
  }
  if (viewer.role === "TEACHER") {
    return loadLessons({ teacherId: viewer.id });
  }
  return loadLessons({});
}

async function loadLessons(where: Prisma.ScheduleWhereInput): Promise<Schedule[]> {
  const rows = await prisma.schedule.findMany({
    where,
    include: lessonInclude,
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });
  return rows.map(toLessonDto);
}

/**
 * Список предметов для выбора в расписании и ДЗ.
 *
 * Если таблица `subjects` пуста (чистая база без `npm run db:seed`), каталог
 * наполняется эталонным набором из `DEFAULT_SUBJECTS` — учитель в любом случае
 * увидит предметы в модалке «Новый урок». Существующий (в т.ч. отредактированный
 * администратором) каталог не трогаем.
 */
export async function listSubjects(): Promise<Subject[]> {
  const select = { id: true, name: true, color: true, emoji: true } as const;

  const existing = await prisma.subject.findMany({ select, orderBy: { name: "asc" } });
  if (existing.length > 0) return existing;

  await ensureDefaultSubjects();
  return prisma.subject.findMany({ select, orderBy: { name: "asc" } });
}

/** Создаёт отсутствующие предметы эталонного каталога (идемпотентно, по имени). */
export async function ensureDefaultSubjects(): Promise<void> {
  await prisma.$transaction(
    DEFAULT_SUBJECTS.map((subject) =>
      prisma.subject.upsert({
        where: { name: subject.name },
        update: { color: subject.color, emoji: subject.emoji },
        create: { name: subject.name, color: subject.color, emoji: subject.emoji },
      }),
    ),
  );
}

/** Ищет свободный код комнаты для урока (как в createMeeting, но внутри транзакции). */
async function pickMeetingCode(tx: Prisma.TransactionClient, title: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const candidate = buildLessonCodeCandidate(title, attempt);
    const taken = await tx.meeting.findUnique({ where: { meetingCode: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw new Error("Не удалось подобрать свободный код комнаты");
}

/**
 * Создаёт урок вместе с комнатой. Проверка пересечений и вставка идут в одной
 * сериализуемой транзакции, поэтому два параллельных запроса не создадут
 * накладку в расписании класса или учителя.
 */
export async function createLesson(input: CreateLessonInput, teacher: SchoolViewer): Promise<Schedule> {
  if (teacher.role === "STUDENT") throw forbidden();

  const row = await prisma.$transaction(
    async (tx) => {
      const subject = await tx.subject.findUnique({ where: { id: input.subjectId } });
      if (!subject) throw badRequest("Предмет не найден", { subjectId: "Выберите предмет из списка" });

      const sameDay = await tx.schedule.findMany({
        where: {
          dayOfWeek: input.dayOfWeek,
          OR: [
            { grade: input.grade },
            { teacherId: teacher.id },
            ...(input.room ? [{ room: input.room }] : []),
          ],
        },
        include: lessonInclude,
      });

      const conflicts = sameDay
        .filter((lesson) => slotsOverlap(lesson, input))
        .flatMap((lesson): ScheduleConflict[] => {
          const base = {
            lessonId: lesson.id,
            subjectName: lesson.subject.name,
            grade: lesson.grade as GradeCode,
            startTime: lesson.startTime,
            endTime: lesson.endTime,
            teacherName: lesson.teacher.name,
          };
          const kinds: ScheduleConflict["kind"][] = [];
          if (lesson.grade === input.grade) kinds.push("grade");
          if (lesson.teacherId === teacher.id) kinds.push("teacher");
          if (input.room && lesson.room === input.room) kinds.push("room");
          return kinds.map((kind) => ({ ...base, kind }));
        });

      if (conflicts.length > 0) {
        throw conflict("Время пересекается с другим уроком", { conflicts });
      }

      const title = `${subject.name} · ${GRADE_LABELS[input.grade]}`;
      const meetingCode = await pickMeetingCode(tx, title);

      await tx.meeting.create({
        data: {
          title,
          meetingCode,
          hostId: teacher.id,
          encryptionKey: generateRoomEncryptionKey(),
        },
      });

      return tx.schedule.create({
        data: {
          subjectId: subject.id,
          teacherId: teacher.id,
          grade: input.grade,
          dayOfWeek: input.dayOfWeek,
          startTime: input.startTime,
          endTime: input.endTime,
          room: input.room,
          meetingCode,
        },
        include: lessonInclude,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  return toLessonDto(row);
}

/** Удаляет слот расписания. Комнату и историю чата сохраняем. */
export async function deleteLesson(lessonId: string, viewer: SchoolViewer): Promise<void> {
  const lesson = await prisma.schedule.findUnique({ where: { id: lessonId }, select: { id: true, teacherId: true } });
  if (!lesson) throw notFound("Урок не найден");

  const isOwner = lesson.teacherId === viewer.id;
  if (!isOwner && viewer.role !== "ADMIN") throw forbidden("Удалять можно только свои уроки");

  await prisma.schedule.delete({ where: { id: lesson.id } });
}
