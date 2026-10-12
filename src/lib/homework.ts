import { Prisma } from "@prisma/client";

import { getAIProvider } from "@/lib/ai-provider";
import { badRequest, conflict, forbidden, DomainError, notFound } from "@/lib/api";
import { findAllowedFileType, getDeadlineIndicator, HOMEWORK_LIMITS, matchesFileSignature, parseGrade, sanitizeFileName, type DeadlineIndicator } from "@/lib/homework-rules";
import { deleteUpload, readUpload, saveUpload } from "@/lib/file-storage";
import { prisma } from "@/lib/prisma";
import { gradeFromClassName } from "@/lib/school-rules";
import type { SchoolViewer } from "@/lib/school-viewer";
import { hasPermission, type HomeworkAttachmentInfo, type HomeworkDetailInfo, type HomeworkDetailView, type HomeworkListItem, type HomeworkSubmissionStatus, type StudentSubmissionInfo, type TeacherReviewInfo, type TeacherSubmissionInfo } from "@/types";
import type { GradeCode } from "@/lib/schedule-rules";

/**
 * Домашние задания: выборка по ролям, сдача, файлы, черновик ИИ и утверждение оценки.
 *
 * Ключевое правило: черновик ИИ (`aiSuggestedGrade`, `aiDraftComment`) уходит
 * только учителю-владельцу задания или администратору. Ученику отдаём оценку
 * и комментарий лишь после `approvedAt`.
 */

const SUBJECT_SELECT = { id: true, name: true, color: true, emoji: true } as const;
const ATTACHMENT_SELECT = { id: true, fileName: true, mimeType: true, size: true } as const;

type Db = Prisma.TransactionClient;

/* -------------------------------------------------------------------------- */
/* Проверки доступа                                                            */
/* -------------------------------------------------------------------------- */

/** Ученик может работать только с заданиями своего класса. */
async function requireStudentHomework(db: Db, homeworkId: string, viewer: SchoolViewer) {
  if (viewer.role !== "STUDENT") throw forbidden("Сдавать задания могут только ученики");
  const homework = await db.homework.findUnique({
    where: { id: homeworkId },
    select: {
      id: true,
      schoolId: true,
      classId: true,
      grade: true,
      deadline: true,
      description: true,
      maxScore: true,
      teacherId: true,
    },
  });
  // Чужая школа или класс для ученика «не существует» — не раскрываем наличие задания.
  if (
    !homework ||
    !viewer.schoolId ||
    !viewer.classId ||
    homework.schoolId !== viewer.schoolId ||
    homework.classId !== viewer.classId
  ) {
    throw notFound("Задание не найдено");
  }
  return homework;
}

/** Проверять и оценивать может учитель-владелец задания или администратор. */
async function requireReviewableHomework(db: Db, homeworkId: string, viewer: SchoolViewer) {
  if (!hasPermission(viewer.role, "homework:review")) throw forbidden("Проверять задания могут только учителя");
  const homework = await db.homework.findUnique({
    where: { id: homeworkId },
    select: {
      id: true,
      teacherId: true,
      schoolId: true,
      classId: true,
      grade: true,
      deadline: true,
      description: true,
      maxScore: true,
    },
  });
  if (!homework || !viewer.schoolId || homework.schoolId !== viewer.schoolId) throw notFound("Задание не найдено");
  if (viewer.role !== "ADMIN" && homework.teacherId !== viewer.id) {
    throw forbidden("Это задание выдал другой учитель");
  }
  return homework;
}

/* -------------------------------------------------------------------------- */
/* DTO                                                                         */
/* -------------------------------------------------------------------------- */

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function toAttachmentDto(attachment: { id: string; fileName: string; mimeType: string; size: number }): HomeworkAttachmentInfo {
  return { id: attachment.id, fileName: attachment.fileName, mimeType: attachment.mimeType, size: attachment.size };
}

function toHomeworkInfo(homework: {
  id: string;
  title: string;
  description: string;
  grade: string;
  classId: string | null;
  schoolClass: { id: string; name: string } | null;
  deadline: Date;
  maxScore: number;
  subject: { id: string; name: string; color: string; emoji: string };
  teacher: { id: string; name: string };
}): HomeworkDetailInfo {
  return {
    id: homework.id,
    title: homework.title,
    description: homework.description,
    subject: homework.subject,
    grade: homework.grade as GradeCode,
    classId: homework.classId,
    className: homework.schoolClass?.name ?? null,
    deadline: homework.deadline.toISOString(),
    maxScore: homework.maxScore,
    teacher: homework.teacher,
  };
}

/**
 * Ответ ученика. Черновик ИИ и неутверждённая оценка сюда не попадают:
 * `grade` и `comment` заполняются только при `approvedAt`.
 */
function toStudentSubmission(submission: {
  id: string;
  status: string;
  answer: string;
  draftSavedAt: Date | null;
  submittedAt: Date | null;
  attachments: { id: string; fileName: string; mimeType: string; size: number }[];
  review: { grade: number | null; comment: string | null; approvedAt: Date | null } | null;
}): StudentSubmissionInfo {
  const approved = submission.review?.approvedAt ? submission.review : null;
  return {
    id: submission.id,
    status: submission.status as HomeworkSubmissionStatus,
    answer: submission.answer,
    draftSavedAt: toIso(submission.draftSavedAt),
    submittedAt: toIso(submission.submittedAt),
    attachments: submission.attachments.map(toAttachmentDto),
    grade: approved?.grade ?? null,
    comment: approved?.comment ?? null,
    approvedAt: toIso(approved?.approvedAt),
  };
}

function toTeacherReview(review: {
  aiSuggestedGrade: number | null;
  aiDraftComment: string | null;
  aiDraftedAt: Date | null;
  grade: number | null;
  comment: string | null;
  approvedAt: Date | null;
}): TeacherReviewInfo {
  return {
    aiSuggestedGrade: review.aiSuggestedGrade,
    aiDraftComment: review.aiDraftComment,
    aiDraftedAt: toIso(review.aiDraftedAt),
    grade: review.grade,
    comment: review.comment,
    approvedAt: toIso(review.approvedAt),
  };
}

/* -------------------------------------------------------------------------- */
/* Чтение                                                                      */
/* -------------------------------------------------------------------------- */

/** Список заданий для роли: ученику — свой класс, учителю — свои задания, админу — все. */
export async function listHomeworkForViewer(viewer: SchoolViewer): Promise<HomeworkListItem[]> {
  if (viewer.role === "STUDENT") {
    if (!viewer.schoolId || !viewer.classId) return [];
    const rows = await prisma.homework.findMany({
      where: { schoolId: viewer.schoolId, classId: viewer.classId },
      orderBy: { deadline: "asc" },
      include: {
        subject: { select: SUBJECT_SELECT },
        teacher: { select: { id: true, name: true } },
        schoolClass: { select: { name: true } },
        submissions: {
          where: { studentId: viewer.id },
          select: { status: true, submittedAt: true, review: { select: { grade: true, approvedAt: true } } },
        },
      },
    });

    return rows.map((row) => {
      const submission = row.submissions[0];
      return {
        id: row.id,
        title: row.title,
        subject: row.subject,
        grade: row.grade as GradeCode,
        classId: row.classId,
        className: row.schoolClass?.name ?? null,
        deadline: row.deadline.toISOString(),
        maxScore: row.maxScore,
        teacher: row.teacher,
        mySubmission: submission
          ? {
              status: submission.status as HomeworkSubmissionStatus,
              submittedAt: toIso(submission.submittedAt),
              grade: submission.review?.approvedAt ? submission.review.grade : null,
            }
          : null,
      };
    });
  }

  if (!viewer.schoolId) return [];
  const rows = await prisma.homework.findMany({
    where: { schoolId: viewer.schoolId, ...(viewer.role === "ADMIN" ? {} : { teacherId: viewer.id }) },
    orderBy: { deadline: "asc" },
    include: {
      subject: { select: SUBJECT_SELECT },
      teacher: { select: { id: true, name: true } },
      schoolClass: { select: { name: true } },
      submissions: { select: { status: true } },
    },
  });

  // Знаменатель сдачи — число учеников конкретной группы в этой школе.
  const studentCounts = await prisma.user.groupBy({
    by: ["classId"],
    where: { role: "STUDENT", schoolId: viewer.schoolId, classId: { not: null } },
    _count: { _all: true },
  });
  const totalByClass = new Map(studentCounts.map((item) => [item.classId, item._count._all]));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    subject: row.subject,
    grade: row.grade as GradeCode,
    classId: row.classId,
    className: row.schoolClass?.name ?? null,
    deadline: row.deadline.toISOString(),
    maxScore: row.maxScore,
    teacher: row.teacher,
    stats: {
      total: row.classId ? totalByClass.get(row.classId) ?? 0 : 0,
      submitted: row.submissions.filter((s) => s.status !== "DRAFT").length,
      graded: row.submissions.filter((s) => s.status === "GRADED").length,
    },
  }));
}

/** Карточка задания с ответом, в зависимости от роли. Чужой класс/чужой учитель — 404/403. */
export async function getHomeworkDetailForViewer(homeworkId: string, viewer: SchoolViewer): Promise<HomeworkDetailView | null> {
  const homework = await prisma.homework.findUnique({
    where: { id: homeworkId },
    include: {
      subject: { select: SUBJECT_SELECT },
      teacher: { select: { id: true, name: true } },
      schoolClass: { select: { id: true, name: true } },
    },
  });
  if (!homework || !viewer.schoolId || homework.schoolId !== viewer.schoolId) return null;

  if (viewer.role === "STUDENT") {
    if (!viewer.classId || homework.classId !== viewer.classId) return null;

    const submission = await prisma.homeworkSubmission.findUnique({
      where: { homeworkId_studentId: { homeworkId, studentId: viewer.id } },
      include: { attachments: { select: ATTACHMENT_SELECT }, review: true },
    });

    return {
      view: "student",
      homework: toHomeworkInfo(homework),
      submission: submission ? toStudentSubmission(submission) : null,
    };
  }

  if (viewer.role === "TEACHER" && homework.teacherId !== viewer.id) return null;

  const submissions = await prisma.homeworkSubmission.findMany({
    where: { homeworkId, status: { not: "DRAFT" } },
    orderBy: { submittedAt: "asc" },
    include: {
      student: { select: { id: true, name: true } },
      attachments: { select: ATTACHMENT_SELECT },
      review: true,
    },
  });

  const teacherSubmissions: TeacherSubmissionInfo[] = submissions.map((submission) => ({
    id: submission.id,
    student: submission.student,
    status: submission.status as HomeworkSubmissionStatus,
    answer: submission.answer,
    draftSavedAt: toIso(submission.draftSavedAt),
    submittedAt: toIso(submission.submittedAt),
    attachments: submission.attachments.map(toAttachmentDto),
    review: submission.review ? toTeacherReview(submission.review) : null,
  }));

  const classStudents = await prisma.user.findMany({
    where: { role: "STUDENT", schoolId: homework.schoolId, classId: homework.classId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const submittedIds = new Set(submissions.map((submission) => submission.studentId));
  const missingStudents = classStudents.filter((student) => !submittedIds.has(student.id));

  return {
    view: "teacher",
    homework: toHomeworkInfo(homework),
    submissions: teacherSubmissions,
    missingStudents,
  };
}

/* -------------------------------------------------------------------------- */
/* Создание задания (учитель)                                                  */
/* -------------------------------------------------------------------------- */

export interface CreateHomeworkData {
  title: string;
  description: string;
  subjectId: string;
  classId: string;
  grade: GradeCode;
  deadline: Date;
  maxScore: number;
}

export async function createHomework(data: CreateHomeworkData, teacher: SchoolViewer): Promise<{ id: string }> {
  if (!hasPermission(teacher.role, "homework:write")) throw forbidden("Выдавать задания могут только учителя");
  if (!teacher.schoolId) throw forbidden("Аккаунт не привязан к школе");

  const schoolClass = await prisma.class.findFirst({
    where: { id: data.classId, schoolId: teacher.schoolId },
    select: { id: true, name: true },
  });
  if (!schoolClass) throw badRequest("Класс не найден в вашей школе", { classId: "Выберите класс своей школы" });
  const grade = gradeFromClassName(schoolClass.name);
  if (!grade || grade !== data.grade) {
    throw badRequest("Параллель не совпадает с выбранным классом", { classId: "Обновите список классов" });
  }

  const subject = await prisma.subject.findUnique({ where: { id: data.subjectId }, select: { id: true } });
  if (!subject) throw badRequest("Предмет не найден", { subjectId: "Выберите предмет из списка" });

  const homework = await prisma.homework.create({
    data: { ...data, grade, schoolId: teacher.schoolId, teacherId: teacher.id },
    select: { id: true },
  });
  return homework;
}

/* -------------------------------------------------------------------------- */
/* Ответ ученика: черновик, файлы, сдача                                       */
/* -------------------------------------------------------------------------- */

/** Находит черновик ученика или создаёт его. Уже сданную работу не меняем. */
async function getOrCreateDraft(db: Db, homeworkId: string, studentId: string) {
  const existing = await db.homeworkSubmission.findUnique({
    where: { homeworkId_studentId: { homeworkId, studentId } },
    select: { id: true, status: true },
  });
  if (existing) {
    if (existing.status !== "DRAFT") throw conflict("Работа уже сдана и не может быть изменена");
    return existing;
  }
  return db.homeworkSubmission.create({
    data: { homeworkId, studentId, status: "DRAFT" },
    select: { id: true, status: true },
  });
}

/** Автосохранение черновика ответа (каждые 10 секунд с клиента). */
export async function saveDraftAnswer(homeworkId: string, answer: string, viewer: SchoolViewer): Promise<{ savedAt: string }> {
  return prisma.$transaction(async (tx) => {
    await requireStudentHomework(tx, homeworkId, viewer);
    const savedAt = new Date();

    const updated = await tx.homeworkSubmission.updateMany({
      where: { homeworkId, studentId: viewer.id, status: "DRAFT" },
      data: { answer, draftSavedAt: savedAt },
    });
    if (updated.count === 0) {
      const draft = await getOrCreateDraft(tx, homeworkId, viewer.id);
      await tx.homeworkSubmission.update({ where: { id: draft.id }, data: { answer, draftSavedAt: savedAt } });
    }
    return { savedAt: savedAt.toISOString() };
  });
}

export interface UploadedFileInput {
  fileName: string;
  bytes: Uint8Array;
}

/** Прикрепляет файл к черновику. Проверяем тип, сигнатуру, размер и количество. */
export async function attachFileToDraft(
  homeworkId: string,
  file: UploadedFileInput,
  viewer: SchoolViewer,
): Promise<HomeworkAttachmentInfo> {
  await requireStudentHomework(prisma, homeworkId, viewer);

  const type = findAllowedFileType(file.fileName);
  if (!type) {
    throw badRequest("Такой формат не поддерживается: PDF, PNG, JPG, DOCX или TXT", { file: "Неподдерживаемый формат" });
  }
  if (file.bytes.length === 0) throw badRequest("Файл пустой", { file: "Файл пустой" });
  if (file.bytes.length > HOMEWORK_LIMITS.maxFileBytes) {
    throw new DomainError(413, "FILE_TOO_LARGE", "Файл больше 10 МБ", { file: "Не больше 10 МБ" });
  }
  if (!matchesFileSignature(type, file.bytes)) {
    throw badRequest("Содержимое файла не соответствует его формату", { file: "Файл повреждён или переименован" });
  }

  const storageKey = await saveUpload(file.bytes, type.extension);
  try {
    const attachment = await prisma.$transaction(async (tx) => {
      await requireStudentHomework(tx, homeworkId, viewer);
      const draft = await getOrCreateDraft(tx, homeworkId, viewer.id);

      const count = await tx.homeworkAttachment.count({ where: { submissionId: draft.id } });
      if (count >= HOMEWORK_LIMITS.maxFilesPerSubmission) {
        throw badRequest(`Можно прикрепить не больше ${HOMEWORK_LIMITS.maxFilesPerSubmission} файлов`, {
          file: "Лимит файлов достигнут",
        });
      }

      return tx.homeworkAttachment.create({
        data: {
          submissionId: draft.id,
          fileName: sanitizeFileName(file.fileName),
          mimeType: type.mimeType,
          size: file.bytes.length,
          storageKey,
        },
        select: ATTACHMENT_SELECT,
      });
    });
    return toAttachmentDto(attachment);
  } catch (error) {
    // Если запись не создалась, файл на диске не нужен.
    await deleteUpload(storageKey).catch(() => undefined);
    throw error;
  }
}

/** Удаляет свой файл из черновика. */
export async function removeAttachmentFromDraft(homeworkId: string, attachmentId: string, viewer: SchoolViewer): Promise<void> {
  const storageKey = await prisma.$transaction(async (tx) => {
    await requireStudentHomework(tx, homeworkId, viewer);

    const attachment = await tx.homeworkAttachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        storageKey: true,
        submission: { select: { homeworkId: true, studentId: true, status: true } },
      },
    });
    const owned = attachment?.submission.homeworkId === homeworkId && attachment.submission.studentId === viewer.id;
    if (!attachment || !owned) throw notFound("Файл не найден");
    if (attachment.submission.status !== "DRAFT") throw conflict("Работа уже сдана, файлы менять нельзя");

    await tx.homeworkAttachment.delete({ where: { id: attachment.id } });
    return attachment.storageKey;
  });

  await deleteUpload(storageKey).catch(() => undefined);
}

/** Сдача работы. После неё черновик блокируется, статус — «На проверке». */
export async function submitHomework(homeworkId: string, viewer: SchoolViewer) {
  return prisma.$transaction(async (tx) => {
    const homework = await requireStudentHomework(tx, homeworkId, viewer);

    const submission = await tx.homeworkSubmission.findUnique({
      where: { homeworkId_studentId: { homeworkId, studentId: viewer.id } },
      select: { id: true, status: true, answer: true, _count: { select: { attachments: true } } },
    });
    if (submission && submission.status !== "DRAFT") throw conflict("Работа уже сдана");

    const hasContent = Boolean(submission?.answer.trim()) || (submission?._count.attachments ?? 0) > 0;
    if (!submission || !hasContent) {
      throw badRequest("Нечего сдавать: напишите ответ или прикрепите файл", { answer: "Ответ пуст" });
    }

    const submittedAt = new Date();
    const updated = await tx.homeworkSubmission.updateMany({
      where: { id: submission.id, status: "DRAFT" },
      data: { status: "SUBMITTED", submittedAt },
    });
    if (updated.count === 0) throw conflict("Работа уже сдана");

    return {
      status: "SUBMITTED" as const,
      submittedAt: submittedAt.toISOString(),
      isLate: submittedAt.getTime() > homework.deadline.getTime(),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Файлы для скачивания                                                        */
/* -------------------------------------------------------------------------- */

export async function getAttachmentForDownload(
  homeworkId: string,
  attachmentId: string,
  viewer: SchoolViewer,
): Promise<{ fileName: string; mimeType: string; bytes: Buffer }> {
  const attachment = await prisma.homeworkAttachment.findUnique({
    where: { id: attachmentId },
    select: {
      fileName: true,
      mimeType: true,
      storageKey: true,
      submission: {
        select: {
          homeworkId: true,
          studentId: true,
          homework: { select: { teacherId: true, schoolId: true, classId: true } },
        },
      },
    },
  });
  if (!attachment || attachment.submission.homeworkId !== homeworkId) throw notFound("Файл не найден");

  const { submission } = attachment;
  if (!viewer.schoolId || submission.homework.schoolId !== viewer.schoolId) throw notFound("Файл не найден");
  if (
    viewer.role === "STUDENT" &&
    (submission.studentId !== viewer.id || submission.homework.classId !== viewer.classId)
  ) {
    throw notFound("Файл не найден");
  }
  if (viewer.role === "TEACHER" && submission.homework.teacherId !== viewer.id) {
    throw forbidden("Файлы чужих заданий недоступны");
  }

  return { fileName: attachment.fileName, mimeType: attachment.mimeType, bytes: await readUpload(attachment.storageKey) };
}

/* -------------------------------------------------------------------------- */
/* Проверка учителем: черновик ИИ и утверждение                                */
/* -------------------------------------------------------------------------- */

/**
 * Генерирует черновик проверки через AI-провайдер и сохраняет его в
 * `HomeworkReview.ai*`. Оценка ученику не уходит — только учителю.
 */
export async function generateAiReviewDraft(
  homeworkId: string,
  submissionId: string,
  viewer: SchoolViewer,
): Promise<TeacherReviewInfo> {
  const homework = await requireReviewableHomework(prisma, homeworkId, viewer);

  const submission = await prisma.homeworkSubmission.findUnique({
    where: { id: submissionId },
    select: {
      homeworkId: true,
      status: true,
      answer: true,
      submittedAt: true,
      _count: { select: { attachments: true } },
    },
  });
  if (!submission || submission.homeworkId !== homeworkId) throw notFound("Работа не найдена");
  if (submission.status !== "SUBMITTED") {
    throw conflict("ИИ-черновик создаётся только для работ на проверке");
  }

  const draft = await getAIProvider().reviewHomework({
    description: homework.description,
    answer: submission.answer,
    maxScore: homework.maxScore,
    attachmentCount: submission._count.attachments,
    isLate: Boolean(submission.submittedAt && submission.submittedAt > homework.deadline),
  });

  const suggestedGrade = parseGrade(draft.suggestedGrade, homework.maxScore) ?? 1;
  const draftedAt = new Date();

  return prisma.$transaction(async (tx) => {
    // Перепроверяем статус внутри транзакции: работу могли оценить во время запроса к ИИ.
    const current = await tx.homeworkSubmission.findUnique({ where: { id: submissionId }, select: { status: true } });
    if (current?.status !== "SUBMITTED") throw conflict("Работа уже оценена");

    const review = await tx.homeworkReview.upsert({
      where: { submissionId },
      create: {
        submissionId,
        reviewerId: viewer.id,
        aiSuggestedGrade: suggestedGrade,
        aiDraftComment: draft.draftComment,
        aiDraftedAt: draftedAt,
      },
      update: {
        aiSuggestedGrade: suggestedGrade,
        aiDraftComment: draft.draftComment,
        aiDraftedAt: draftedAt,
      },
    });
    return toTeacherReview(review);
  });
}

export interface ApproveReviewInput {
  grade: unknown;
  comment: unknown;
}

/**
 * Утверждение учителем: оценка и комментарий становятся видны ученику,
 * статус работы — «Оценено». Текст ИИ-черновика учитель может править до отправки.
 */
export async function approveReview(
  homeworkId: string,
  submissionId: string,
  input: ApproveReviewInput,
  viewer: SchoolViewer,
): Promise<TeacherReviewInfo> {
  const parsed = parseApproval(input);
  if (!parsed.ok) throw badRequest(parsed.error, parsed.fields);

  return prisma.$transaction(
    async (tx) => {
      const homework = await requireReviewableHomework(tx, homeworkId, viewer);
      const parsedGrade = parseGrade(parsed.data.grade, homework.maxScore);
      if (parsedGrade === null) {
        throw badRequest(`Оценка от 1 до ${homework.maxScore}`, { grade: `От 1 до ${homework.maxScore}` });
      }

      const submission = await tx.homeworkSubmission.findUnique({
        where: { id: submissionId },
        select: { homeworkId: true, status: true },
      });
      if (!submission || submission.homeworkId !== homeworkId) throw notFound("Работа не найдена");
      if (submission.status !== "SUBMITTED") throw conflict("Работа уже оценена или ещё не сдана");

      const approvedAt = new Date();
      const review = await tx.homeworkReview.upsert({
        where: { submissionId },
        create: {
          submissionId,
          reviewerId: viewer.id,
          grade: parsedGrade,
          comment: parsed.data.comment,
          approvedAt,
        },
        update: {
          reviewerId: viewer.id,
          grade: parsedGrade,
          comment: parsed.data.comment,
          approvedAt,
        },
      });
      await tx.homeworkSubmission.update({ where: { id: submissionId }, data: { status: "GRADED" } });

      return toTeacherReview(review);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

function parseApproval(input: ApproveReviewInput):
  | { ok: true; data: { grade: unknown; comment: string | null } }
  | { ok: false; error: string; fields: Record<string, string> } {
  const comment = typeof input.comment === "string" ? input.comment.trim() : "";
  if (comment.length > 2000) {
    return { ok: false, error: "Комментарий не длиннее 2000 символов", fields: { comment: "Слишком длинный комментарий" } };
  }
  return { ok: true, data: { grade: input.grade, comment: comment || null } };
}

/* -------------------------------------------------------------------------- */
/* Виджеты дашборда                                                            */
/* -------------------------------------------------------------------------- */

export interface UrgentHomeworkItem {
  id: string;
  title: string;
  subjectName: string;
  subjectEmoji: string;
  deadline: string;
  indicator: DeadlineIndicator;
  /** Для ученика: статус его работы; для учителя: сколько сдано. */
  note: string;
}

/**
 * «Срочные ДЗ»: ученику — ближайшие несданные задания, учителю — ближайшие дедлайны его заданий.
 */
export async function getUrgentHomework(viewer: SchoolViewer, now: Date): Promise<UrgentHomeworkItem[]> {
  if (viewer.role === "STUDENT") {
    if (!viewer.schoolId || !viewer.classId) return [];
    const rows = await prisma.homework.findMany({
      where: {
        schoolId: viewer.schoolId,
        classId: viewer.classId,
        OR: [
          { submissions: { none: { studentId: viewer.id } } },
          { submissions: { some: { studentId: viewer.id, status: "DRAFT" } } },
        ],
      },
      orderBy: { deadline: "asc" },
      take: 3,
      include: { subject: { select: SUBJECT_SELECT } },
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      subjectName: row.subject.name,
      subjectEmoji: row.subject.emoji,
      deadline: row.deadline.toISOString(),
      indicator: getDeadlineIndicator(row.deadline, now),
      note: "Не сдано",
    }));
  }

  if (!viewer.schoolId) return [];
  const rows = await prisma.homework.findMany({
    where: {
      schoolId: viewer.schoolId,
      ...(viewer.role === "ADMIN" ? {} : { teacherId: viewer.id }),
      deadline: { gte: now },
    },
    orderBy: { deadline: "asc" },
    take: 3,
    include: {
      subject: { select: SUBJECT_SELECT },
      submissions: { where: { status: { not: "DRAFT" } }, select: { id: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    subjectName: row.subject.name,
    subjectEmoji: row.subject.emoji,
    deadline: row.deadline.toISOString(),
    indicator: getDeadlineIndicator(row.deadline, now),
    note: `Сдано: ${row.submissions.length}`,
  }));
}

export interface ReviewQueueItem {
  submissionId: string;
  homeworkId: string;
  homeworkTitle: string;
  studentName: string;
  submittedAt: string;
}

export interface ReviewQueue {
  count: number;
  items: ReviewQueueItem[];
}

/**
 * «Нужно проверить»: учителю — работы учеников на проверке.
 * Ученику — сколько его работ ждут проверки (без списка).
 */
export async function getReviewQueue(viewer: SchoolViewer): Promise<ReviewQueue> {
  if (viewer.role === "STUDENT") {
    const count = await prisma.homeworkSubmission.count({ where: { studentId: viewer.id, status: "SUBMITTED" } });
    return { count, items: [] };
  }

  if (!viewer.schoolId) return { count: 0, items: [] };
  const where: Prisma.HomeworkSubmissionWhereInput = {
    status: "SUBMITTED",
    homework: {
      schoolId: viewer.schoolId,
      ...(viewer.role === "ADMIN" ? {} : { teacherId: viewer.id }),
    },
  };
  const [count, rows] = await Promise.all([
    prisma.homeworkSubmission.count({ where }),
    prisma.homeworkSubmission.findMany({
      where,
      orderBy: { submittedAt: "asc" },
      take: 3,
      select: {
        id: true,
        homeworkId: true,
        submittedAt: true,
        homework: { select: { title: true } },
        student: { select: { name: true } },
      },
    }),
  ]);

  return {
    count,
    items: rows.map((row) => ({
      submissionId: row.id,
      homeworkId: row.homeworkId,
      homeworkTitle: row.homework.title,
      studentName: row.student.name,
      submittedAt: (row.submittedAt ?? new Date()).toISOString(),
    })),
  };
}
