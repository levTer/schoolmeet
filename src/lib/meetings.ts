import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { buildLessonCodeCandidate } from "@/lib/lesson-code";
import { CHAT_HISTORY_LIMIT, type ChatEnvelope } from "@/lib/realtime";
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
  isActive: boolean;
  startTime: Date;
  /** Заполняется при завершении урока (в том числе принудительном). */
  endTime: Date | null;
  host: { id: string; name: string; role: Role };
}

const meetingInclude = {
  host: { select: { id: true, name: true, role: true } },
} as const;

export async function findMeetingByCode(meetingCode: string): Promise<MeetingWithHost | null> {
  const meeting = await prisma.meeting.findUnique({
    where: { meetingCode },
    include: meetingInclude,
  });
  return meeting as MeetingWithHost | null;
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

export async function saveChatMessage(params: {
  meetingId: string;
  userId: string;
  ciphertext: string;
}): Promise<ChatEnvelope> {
  const message = await prisma.chatMessage.create({
    data: {
      meetingId: params.meetingId,
      userId: params.userId,
      content: params.ciphertext,
      encrypted: true,
    },
    include: { user: { select: { id: true, name: true, role: true } } },
  });

  return toEnvelope(message);
}

/** Последние сообщения урока в хронологическом порядке (только шифротекст). */
export async function loadRecentMessages(meetingId: string, limit = CHAT_HISTORY_LIMIT): Promise<ChatEnvelope[]> {
  const messages = await prisma.chatMessage.findMany({
    where: { meetingId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: { select: { id: true, name: true, role: true } } },
  });

  return messages.reverse().map(toEnvelope);
}

interface ChatMessageRow {
  id: string;
  content: string;
  createdAt: Date;
  user: { id: string; name: string; role: Role };
}

function toEnvelope(message: ChatMessageRow): ChatEnvelope {
  return {
    id: message.id,
    ciphertext: message.content,
    createdAt: message.createdAt.toISOString(),
    author: { userId: message.user.id, name: message.user.name, role: message.user.role },
  };
}
