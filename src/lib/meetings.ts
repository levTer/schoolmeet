import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";

import { classCodeGrantSecret, verifyClassCodeGrant } from "@/lib/class-code";
import { canViewChatEnvelope, chatVisibilityWhere } from "@/lib/chat-rules";
import { prisma } from "@/lib/prisma";
import { buildLessonCodeCandidate } from "@/lib/lesson-code";
import {
  resolveMeetingAccess,
  type MeetingAccessDecision,
  type MeetingAccessViewer,
} from "@/lib/meeting-access";
import { CHAT_HISTORY_LIMIT, hasSchoolAccess, type ChatEnvelope } from "@/lib/realtime";
import { ensureUserSchoolMembership, getMeetingSchoolId } from "@/lib/schools";
import type { Role } from "@/types";

/**
 * Работа с уроками (Meeting) и сообщениями чата (ChatMessage).
 * Модуль используется и API-роутами Next.js, и сокет-сервером `server.ts`.
 */

const MAX_CODE_ATTEMPTS = 5;

export interface MeetingWithHost {
  id: string;
  title: string;
  meetingCode: string;
  encryptionKey: string;
  hostId: string;
  schoolId: string | null;
  isActive: boolean;
  startTime: Date;
  /** Заполняется при завершении урока (в том числе принудительном). */
  endTime: Date | null;
  host: { id: string; name: string; role: Role; schoolId: string | null };
  /**
   * Слот расписания, к которому привязана комната: `classId` ограничивает вход
   * учеников других классов (H-02).
   */
  schedule: { schoolId: string | null; classId: string | null } | null;
  /** Политика изоляции классов школы (`strictClassIsolation`). */
  school: { id: string; strictClassIsolation: boolean } | null;
}

const meetingInclude = {
  host: { select: { id: true, name: true, role: true, schoolId: true } },
  // `classId` нужен для проверки доступа: урок, привязанный к классу
  // расписания, недоступен ученикам других классов (исправление H-02).
  schedule: { select: { schoolId: true, classId: true } },
  // Политика школы определяет строгую/гибкую модель доступа к урокам (H-02).
  school: { select: { id: true, strictClassIsolation: true } },
} as const;

export async function findMeetingByCode(meetingCode: string): Promise<MeetingWithHost | null> {
  const meeting = await prisma.meeting.findUnique({
    where: { meetingCode },
    include: meetingInclude,
  });
  return meeting as MeetingWithHost | null;
}

/**
 * Полная проверка доступа к уроку: школа + политика классов (H-02).
 *
 * Единая точка для HTTP-роутов и Socket.IO: раньше проверялась только школа,
 * из-за чего ученик другого класса той же школы мог войти в чужой урок по коду.
 * Базовое правило живёт в `@/lib/meeting-access` (чистый модуль, покрыт
 * тестами); здесь добавляется разовый допуск по коду класса для строгих школ:
 * `options.classCodeGrant` — подписанный токен, выданный
 * `/api/meetings/[code]/class-access` после проверки `Class.code` (связан с
 * пользователем, классом урока и комнатой, живёт час — `src/lib/class-code.ts`).
 */
export function checkMeetingAccess(
  meeting: MeetingWithHost,
  viewer: MeetingAccessViewer,
  options: { classCodeGrant?: string | null } = {},
): MeetingAccessDecision {
  const strictClassIsolation = meeting.school?.strictClassIsolation ?? false;
  const decision = resolveMeetingAccess(
    {
      schoolId: getMeetingSchoolId(meeting),
      scheduleClassId: meeting.schedule?.classId ?? null,
      hostId: meeting.hostId,
      strictClassIsolation,
    },
    viewer,
  );

  if (decision.ok) return decision;

  // Строгая школа + чужой класс: принимаем только подписанный разовый допуск,
  // привязанный к ЭТОЙ комнате и ЭТОМУ пользователю. SCHOOL_MISMATCH таким
  // образом пробить нельзя — мы дошли до него, значит школы совпадают.
  if (decision.code === "CLASS_FORBIDDEN" && strictClassIsolation) {
    const scheduleClassId = meeting.schedule?.classId ?? null;
    const grant = options.classCodeGrant;
    if (scheduleClassId && typeof grant === "string" && grant) {
      if (
        verifyClassCodeGrant(grant, classCodeGrantSecret(), {
          userId: viewer.id ?? "",
          classId: scheduleClassId,
          meetingCode: meeting.meetingCode,
        })
      ) {
        return { ok: true };
      }
    }
  }

  return decision;
}

/** Случайный ключ комнаты: 256 бит в hex (64 символа) для AES-256. */
export function generateRoomEncryptionKey(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Создаёт урок с читаемым кодом. При коллизии кода пробует вариант с суффиксом,
 * а при гонке двух запросов (P2002 на уникальном индексе) повторяет попытку.
 */
export async function createMeeting(params: { title: string; hostId: string }): Promise<MeetingWithHost> {
  const hostMembership = await ensureUserSchoolMembership(params.hostId);
  if (!hostMembership) throw new Error("MEETING_HOST_NOT_FOUND");

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const meetingCode = buildLessonCodeCandidate(params.title, attempt);

    const taken = await prisma.meeting.findUnique({ where: { meetingCode }, select: { id: true } });
    if (taken) continue;

    try {
      const meeting = await prisma.meeting.create({
        data: {
          title: params.title,
          meetingCode,
          hostId: params.hostId,
          schoolId: hostMembership.schoolId,
          encryptionKey: generateRoomEncryptionKey(),
        },
        include: meetingInclude,
      });
      return meeting as MeetingWithHost;
    } catch (error) {
      const isUniqueViolation =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!isUniqueViolation) throw error;
    }
  }

  throw new Error("Не удалось подобрать свободный код урока");
}

/** Поля сообщения, которые сервер отдаёт клиенту (автор и адресат — без лишнего). */
const chatMessageInclude = {
  user: { select: { id: true, name: true, role: true } },
  recipient: { select: { id: true, name: true } },
} as const;

/**
 * Сохраняет сообщение чата.
 *
 * `recipientId = null` — публичное сообщение для всей комнаты. Иначе сообщение
 * приватное: адресат обязан существовать и учиться в той же школе, что и урок,
 * иначе приватную переписку можно было бы использовать для пробоя между
 * тенантами (ошибка `CHAT_RECIPIENT_NOT_FOUND`).
 */
export async function saveChatMessage(params: {
  meetingId: string;
  userId: string;
  ciphertext: string;
  recipientId?: string | null;
}): Promise<ChatEnvelope> {
  const recipientId = params.recipientId ?? null;

  const [user, meeting, recipient] = await Promise.all([
    prisma.user.findUnique({ where: { id: params.userId }, select: { schoolId: true } }),
    prisma.meeting.findUnique({ where: { id: params.meetingId }, include: meetingInclude }),
    recipientId
      ? prisma.user.findUnique({ where: { id: recipientId }, select: { id: true, schoolId: true } })
      : Promise.resolve(null),
  ]);
  if (!user || !meeting || !hasSchoolAccess(user.schoolId, getMeetingSchoolId(meeting))) {
    throw new Error("CHAT_SCHOOL_MISMATCH");
  }
  if (recipientId && (!recipient || !hasSchoolAccess(recipient.schoolId, getMeetingSchoolId(meeting)))) {
    throw new Error("CHAT_RECIPIENT_NOT_FOUND");
  }

  const message = await prisma.chatMessage.create({
    data: {
      meetingId: params.meetingId,
      userId: params.userId,
      recipientId,
      content: params.ciphertext,
      encrypted: true,
    },
    include: chatMessageInclude,
  });

  return toEnvelope(message);
}

/**
 * Последние сообщения урока в хронологическом порядке (только шифротекст).
 *
 * Выборка сразу отсечена по видимости (`chatVisibilityWhere`): зрителю приходят
 * публичные сообщения, адресованные лично ему и отправленные им самим — чужая
 * приватная переписка не покидает базу.
 */
export async function loadRecentMessages(
  meetingId: string,
  schoolId: string,
  viewerUserId: string,
  limit = CHAT_HISTORY_LIMIT,
): Promise<ChatEnvelope[]> {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, include: meetingInclude });
  if (!meeting || !hasSchoolAccess(schoolId, getMeetingSchoolId(meeting))) {
    throw new Error("CHAT_SCHOOL_MISMATCH");
  }

  const messages = await prisma.chatMessage.findMany({
    where: { meetingId, OR: chatVisibilityWhere(viewerUserId) },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: chatMessageInclude,
  });

  // Контрольная проверка поверх SQL-фильтра: правила видимости одни и те же.
  return messages
    .reverse()
    .map(toEnvelope)
    .filter((envelope) => canViewChatEnvelope(envelope, viewerUserId));
}

/**
 * Конверт сообщения по id — только в рамках урока.
 *
 * Нужен закреплению сообщений: сервер отдаёт плашке чата ровно то сообщение,
 * которое уже было доставлено участникам, и только если закрепивший имеет
 * право его видеть (приватное сообщение не «утекает» в плашку комнаты).
 */
export async function loadChatEnvelopeById(
  meetingId: string,
  messageId: string,
): Promise<ChatEnvelope | null> {
  const message = await prisma.chatMessage.findFirst({
    where: { id: messageId, meetingId },
    select: {
      id: true,
      content: true,
      createdAt: true,
      recipientId: true,
      user: { select: { id: true, name: true, role: true } },
      recipient: { select: { id: true, name: true } },
    },
  });
  return message ? toEnvelope(message) : null;
}

interface ChatMessageRow {
  id: string;
  content: string;
  createdAt: Date;
  user: { id: string; name: string; role: Role };
  recipientId: string | null;
  recipient: { id: string; name: string } | null;
}

function toEnvelope(message: ChatMessageRow): ChatEnvelope {
  return {
    id: message.id,
    ciphertext: message.content,
    createdAt: message.createdAt.toISOString(),
    author: { userId: message.user.id, name: message.user.name, role: message.user.role },
    recipient: message.recipientId
      ? { userId: message.recipientId, name: message.recipient?.name ?? "" }
      : null,
  };
}
