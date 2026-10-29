import type { GradeCode } from "@/lib/schedule-rules";
import type { Role } from "@/types";

/**
 * Мост между API админ-панели и живым Socket.IO-сервером.
 *
 * Next.js (страницы и API) и Socket.IO работают в одном процессе (`server.ts`),
 * но в разных модулях. Чтобы админ мог «выкинуть» участников из урока или
 * мгновенно разорвать сессии заблокированного пользователя, сервер realtime
 * публикует здесь свой управляющий интерфейс, а API-роуты его вызывают.
 *
 * Хранилище — `globalThis`, поэтому переживает hot-reload в dev-режиме и
 * доступно из любого модуля процесса.
 *
 * Если реестр пуст (одноразовый серверный рендер, скрипт, второй инстанс без
 * Socket.IO), вызовы возвращают `null` — админское действие всё равно
 * применяется в БД, просто живые соединения закрыть нечем. Вызывающий код
 * обязан обработать это и вернуть пользователю честное сообщение.
 */

export interface LiveParticipant {
  socketId: string;
  userId: string;
  name: string;
  role: Role;
  /** Класс ученика (для учителей и администраторов — null). */
  grade: GradeCode | null;
  /** Когда сокет вошёл в комнату (ISO). */
  joinedAt: string;
}

export interface LiveRoom {
  /** Namespaced Socket.IO ID: `room:${schoolId}:${lessonId}`. */
  roomId: string;
  meetingId: string | null;
  participants: LiveParticipant[];
  /** Первый по времени вход в комнату (ISO) — «урок идёт с…». */
  startedAt: string | null;
}

export interface CloseRoomOptions {
  /** Машинная причина, уходит клиенту (`admin_force_end`). */
  reason: string;
  /** Текст для участников. */
  message: string;
  /** Кто инициировал (id администратора). */
  actorId?: string;
}

export interface EndCallRoomOptions {
  schoolId: string;
  meetingId: string;
  meetingCode: string;
  endedBy: { id: string; name: string };
  endedAt: string;
}

export interface RealtimeControl {
  /** Комнаты, в которых прямо сейчас есть участники. */
  listLiveRooms(schoolId: string): LiveRoom[];
  /** Сколько человек в namespaced Socket.IO-комнате. */
  countParticipants(roomId: string): number;
  /**
   * Закрывает все комнаты урока: участники получают `room-closed` и покидают
   * комнату (сокет остаётся подключённым — человек просто возвращается в кабинет).
   * Возвращает число отключённых сокетов и затронутые коды комнат.
   */
  closeMeeting(meetingId: string, options: CloseRoomOptions): { closedSockets: number; roomIds: string[] };
  /**
   * Завершает урок для всех участников: рассылает `CALL_ENDED`, очищает
   * состояние комнаты и оповещает лобби школы (`ACTIVE_CALLS_CHANGED`).
   */
  endCallForAll(options: EndCallRoomOptions): { closedSockets: number; roomId: string };
  /** Разрывает все соединения пользователя (используется при блокировке). */
  disconnectUser(userId: string, options: { reason: string; message: string }): number;
  /** Есть ли у пользователя активные сокеты. */
  isUserOnline(userId: string): boolean;
}

const REGISTRY_KEY = Symbol.for("schoolmeet.realtime.control");

type Registry = { control?: RealtimeControl };

function registry(): Registry {
  const scope = globalThis as unknown as Record<symbol, Registry | undefined>;
  let store = scope[REGISTRY_KEY];
  if (!store) {
    store = {};
    scope[REGISTRY_KEY] = store;
  }
  return store;
}

/** Публикует управляющий интерфейс Socket.IO-сервера (вызывает `attachRealtime`). */
export function registerRealtimeControl(control: RealtimeControl): void {
  registry().control = control;
}

/** Снимает регистрацию (остановка сервера, тесты). */
export function unregisterRealtimeControl(): void {
  registry().control = undefined;
}

/** Текущий управляющий интерфейс или `null`, если Socket.IO в этом процессе нет. */
export function getRealtimeControl(): RealtimeControl | null {
  return registry().control ?? null;
}

/** Сводка «онлайн» по комнатам без обращения к БД — для метрик обзора. */
export function liveRoomsSummary(schoolId: string): { rooms: number; participants: number } {
  if (!schoolId?.trim()) return { rooms: 0, participants: 0 };
  const control = getRealtimeControl();
  if (!control) return { rooms: 0, participants: 0 };

  try {
    const rooms = control.listLiveRooms(schoolId);
    return {
      rooms: rooms.length,
      participants: rooms.reduce((total, room) => total + room.participants.length, 0),
    };
  } catch (error) {
    console.error("[realtime-control] Не удалось получить список комнат:", error);
    return { rooms: 0, participants: 0 };
  }
}
