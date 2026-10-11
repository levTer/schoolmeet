import type { GradeCode } from "@/lib/schedule-rules";

/**
 * SchoolMeet — общие типы домена.
 *
 * Модели зеркалят `prisma/schema.prisma`. Поля, приходящие из БД как `Date`,
 * описаны как `Date | string`, потому что на границе API (JSON / Server
 * Components) даты сериализуются в строку.
 */

/* -------------------------------------------------------------------------- */
/* Роли                                                                        */
/* -------------------------------------------------------------------------- */

/** Роль пользователя в системе. Зеркалит Prisma `enum Role`. */
export type Role = "ADMIN" | "TEACHER" | "STUDENT";

export const ROLES = ["ADMIN", "TEACHER", "STUDENT"] as const satisfies readonly Role[];

/** Человекочитаемые подписи ролей (ru). */
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Администратор",
  TEACHER: "Учитель",
  STUDENT: "Ученик",
};

/** Что роль может делать — используется для ограничений UI и API. */
export const ROLE_PERMISSIONS: Record<Role, readonly string[]> = {
  ADMIN: [
    "meeting:create",
    "meeting:delete",
    "schedule:write",
    "homework:write",
    "homework:review",
    "board:write",
    "board:manage",
    "ai:use",
    "chat:write",
    "admin:panel",
  ],
  TEACHER: [
    "meeting:create",
    "schedule:write",
    "homework:write",
    "homework:review",
    "board:write",
    "board:manage",
    "ai:use",
    "chat:write",
  ],
  STUDENT: ["meeting:join", "schedule:read", "homework:submit", "board:view", "chat:write"],
};

export function hasPermission(role: Role, permission: string): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Подписи прав (ru) — чтобы в UI показывать не `meeting:create`, а текст. */
export const PERMISSION_LABELS: Record<string, string> = {
  "meeting:create": "Создание уроков",
  "meeting:delete": "Удаление уроков",
  "meeting:join": "Вход в урок",
  "schedule:read": "Просмотр расписания",
  "schedule:write": "Планирование расписания",
  "homework:write": "Выдача домашних заданий",
  "homework:review": "Проверка домашних заданий",
  "homework:submit": "Сдача домашних заданий",
  "board:view": "Просмотр доски",
  "board:write": "Работа на доске",
  "board:manage": "Управление доской",
  "ai:use": "ИИ-помощник",
  "chat:write": "Чат класса",
  "admin:panel": "Админ-панель",
};

/** Права роли человекочитаемым списком. */
export function getPermissionLabels(role: Role): string[] {
  return ROLE_PERMISSIONS[role].map((permission) => PERMISSION_LABELS[permission] ?? permission);
}

/* -------------------------------------------------------------------------- */
/* User                                                                        */
/* -------------------------------------------------------------------------- */

/** Полная модель пользователя (как в БД). */
export interface User {
  id: string;
  email: string;
  /** bcrypt-хеш пароля. Никогда не отдаётся наружу — см. `SafeUser`. */
  password: string;
  name: string;
  role: Role;
  avatar: string | null;
  createdAt: Date | string;
  updatedAt?: Date | string;
}

/** Пользователь без чувствительных полей — то, что можно отдавать клиенту. */
export type SafeUser = Omit<User, "password">;

/** Данные для регистрации. */
export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  role?: Role;
  avatar?: string | null;
}

/** Данные для входа. */
export interface LoginInput {
  email: string;
  password: string;
}

/* -------------------------------------------------------------------------- */
/* Meeting                                                                     */
/* -------------------------------------------------------------------------- */

export interface Meeting {
  id: string;
  title: string;
  meetingCode: string;
  hostId: string;
  startTime: Date | string;
  endTime: Date | string | null;
  isActive: boolean;
  /** Ключ комнаты для AES-256 шифрования чата. */
  encryptionKey: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;

  // Развёрнутые связи (опционально подключаются через `include`)
  host?: SafeUser;
  messages?: ChatMessage[];
  schedule?: Schedule | null;
}

export interface CreateMeetingInput {
  title: string;
  hostId: string;
  startTime?: Date | string;
  endTime?: Date | string | null;
  encryptionKey?: string;
}

/** Что приходит с клиента при входе в комнату по коду. */
export interface JoinMeetingInput {
  meetingCode: string;
}

/* -------------------------------------------------------------------------- */
/* Schedule                                                                    */
/* -------------------------------------------------------------------------- */

/** Дни недели по ISO-8601: 1 — понедельник, 7 — воскресенье. */
export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const DAY_LABELS: Record<DayOfWeek, string> = {
  1: "Понедельник",
  2: "Вторник",
  3: "Среда",
  4: "Четверг",
  5: "Пятница",
  6: "Суббота",
  7: "Воскресенье",
};

export const DAY_SHORT_LABELS: Record<DayOfWeek, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс",
};

export interface Subject {
  id: string;
  name: string;
  /** Фирменный цвет в HEX, например "#a855f7". */
  color: string;
  emoji: string;
}

/** Урок в расписании (слот + предмет + учитель + комната). */
export interface Schedule {
  id: string;
  subjectId: string;
  teacherId: string;
  /** Класс обучения (зеркалит Prisma `enum ClassGrade`): GRADE_5 … GRADE_11. */
  grade: GradeCode;
  dayOfWeek: DayOfWeek;
  /** Время начала в формате "HH:mm", например "09:00". */
  startTime: string;
  /** Время окончания в формате "HH:mm", например "09:45". */
  endTime: string;
  room: string | null;
  /** Код комнаты урока (Meeting.meetingCode). */
  meetingCode: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;

  // Развёрнутые связи
  subject?: Subject;
  teacher?: Pick<SafeUser, "id" | "name">;
}

/** Слот расписания, сгруппированный по дню недели (для отображения сеткой). */
export interface ScheduleDay {
  dayOfWeek: DayOfWeek;
  lessons: Schedule[];
}

/* -------------------------------------------------------------------------- */
/* Homework                                                                    */
/* -------------------------------------------------------------------------- */

export type HomeworkSubmissionStatus = "DRAFT" | "SUBMITTED" | "GRADED";

export const SUBMISSION_STATUS_LABELS: Record<HomeworkSubmissionStatus, string> = {
  DRAFT: "Черновик",
  SUBMITTED: "На проверке",
  GRADED: "Оценено",
};

export interface HomeworkAttachmentInfo {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
}

/** Сводка ДЗ в списке. `mySubmission` — только для ученика, `stats` — только для учителя. */
export interface HomeworkListItem {
  id: string;
  title: string;
  subject: Subject;
  grade: GradeCode;
  /** ISO-дата дедлайна. */
  deadline: string;
  maxScore: number;
  teacher: { id: string; name: string };
  mySubmission?: { status: HomeworkSubmissionStatus; submittedAt: string | null; grade: number | null } | null;
  stats?: { total: number; submitted: number; graded: number };
}

export interface HomeworkDetailInfo {
  id: string;
  title: string;
  /** Условие в Markdown с LaTeX. */
  description: string;
  subject: Subject;
  grade: GradeCode;
  deadline: string;
  maxScore: number;
  teacher: { id: string; name: string };
}

/**
 * Ответ ученика. В нём НЕТ черновика ИИ: ученик видит оценку и комментарий
 * только после утверждения учителем (`approvedAt` не пуст).
 */
export interface StudentSubmissionInfo {
  id: string;
  status: HomeworkSubmissionStatus;
  answer: string;
  draftSavedAt: string | null;
  submittedAt: string | null;
  attachments: HomeworkAttachmentInfo[];
  grade: number | null;
  comment: string | null;
  approvedAt: string | null;
}

/** Проверка учителя: здесь же лежит черновик ИИ (виден только учителю). */
export interface TeacherReviewInfo {
  aiSuggestedGrade: number | null;
  aiDraftComment: string | null;
  aiDraftedAt: string | null;
  grade: number | null;
  comment: string | null;
  approvedAt: string | null;
}

export interface TeacherSubmissionInfo {
  id: string;
  student: { id: string; name: string };
  status: HomeworkSubmissionStatus;
  answer: string;
  draftSavedAt: string | null;
  submittedAt: string | null;
  attachments: HomeworkAttachmentInfo[];
  review: TeacherReviewInfo | null;
}

export type HomeworkDetailView =
  | { view: "student"; homework: HomeworkDetailInfo; submission: StudentSubmissionInfo | null }
  | {
      view: "teacher";
      homework: HomeworkDetailInfo;
      submissions: TeacherSubmissionInfo[];
      /** Ученики класса, которые ещё не сдали работу (черновик не в счёт). */
      missingStudents: { id: string; name: string }[];
    };

/* -------------------------------------------------------------------------- */
/* ChatMessage                                                                 */
/* -------------------------------------------------------------------------- */

export interface ChatMessage {
  id: string;
  meetingId: string;
  userId: string;
  /** Зашифрованный AES-256 (base64) или открытый текст сообщения. */
  content: string;
  encrypted: boolean;
  createdAt: Date | string;

  // Развёрнутые связи
  user?: Pick<SafeUser, "id" | "name" | "avatar" | "role">;
  meeting?: Meeting;
}

export interface SendMessageInput {
  meetingId: string;
  content: string;
  encrypted?: boolean;
}

/** Сообщение, уже расшифрованное на клиенте и готовое к отрисовке. */
export interface DecryptedChatMessage extends Omit<ChatMessage, "content"> {
  content: string;
  decrypted: boolean;
}

/* -------------------------------------------------------------------------- */
/* Прочее                                                                      */
/* -------------------------------------------------------------------------- */

/** Участник видеозвонка (WebRTC / PeerJS) в оперативной памяти комнаты. */
export interface Participant {
  id: string;
  userId: string;
  name: string;
  avatar?: string | null;
  role: Role;
  /** PeerJS-идентификатор для P2P-соединения. */
  peerId?: string;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  /** «Поднятая рука» — запрос слова. */
  isHandRaised: boolean;
  joinedAt: Date | string;
}

/** События Socket.IO, общие для клиента и сервера. */
export interface ServerToClientEvents {
  "participant:joined": (participant: Participant) => void;
  "participant:left": (payload: { userId: string }) => void;
  "participant:updated": (participant: Participant) => void;
  "chat:message": (message: ChatMessage) => void;
  "board:update": (payload: { meetingId: string; data: string }) => void;
  "hand:raised": (payload: { userId: string; isHandRaised: boolean }) => void;
}

export interface ClientToServerEvents {
  "meeting:join": (payload: { meetingId: string; participant: Participant }) => void;
  "meeting:leave": (payload: { meetingId: string }) => void;
  "chat:send": (message: SendMessageInput) => void;
  "board:update": (payload: { meetingId: string; data: string }) => void;
  "hand:raise": (payload: { userId: string; isHandRaised: boolean }) => void;
}

/** Универсальный результат API-обработчика. */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };
