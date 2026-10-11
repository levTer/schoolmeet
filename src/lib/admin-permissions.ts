import type { Role } from "@/types";

/**
 * Права внутри админ-панели (RBAC).
 *
 * Раздел `/admin` — строго для суперадмина: `src/middleware.ts` и
 * `src/app/admin/layout.tsx` пускают туда ТОЛЬКО роль ADMIN (учитель и ученик
 * получают `/dashboard?denied=admin` + toast «Доступ открыт только
 * Администратору школы»). Поэтому все права ниже выданы исключительно ADMIN;
 * единственное ограничение — действия над самим собой (нельзя заблокировать или
 * повысить собственную учётную запись).
 *
 * Учителя при этом не теряют НИЧЕГО из своих функций: расписание, выдача и
 * проверка ДЗ с ИИ, видеозвонки и ИИ-доска живут вне админ-панели и
 * контролируются правами ролей (`ROLE_PERMISSIONS`, `src/types/index.ts`).
 *
 * Модуль чистый (без Prisma и Node API): его импортируют и серверные проверки,
 * и клиентские компоненты — UI просто прячет/выключает недоступные кнопки,
 * а окончательное решение всё равно принимает API.
 */

export type AdminCapability =
  | "stats.view"
  | "users.view"
  | "users.create"
  | "users.edit"
  | "users.role.change"
  | "users.grade.change"
  | "users.password.reset"
  | "users.ban"
  | "meetings.view"
  | "meetings.end"
  | "attendance.view"
  | "announcements.view"
  | "announcements.manage"
  | "audit.view";

/** Человекочитаемые подписи прав — используются в подсказках UI. */
export const CAPABILITY_LABELS: Record<AdminCapability, string> = {
  "stats.view": "Просмотр статистики",
  "users.view": "Просмотр пользователей",
  "users.create": "Создание пользователей",
  "users.edit": "Редактирование профиля",
  "users.role.change": "Смена роли",
  "users.grade.change": "Назначение класса",
  "users.password.reset": "Сброс пароля",
  "users.ban": "Блокировка аккаунта",
  "meetings.view": "Просмотр активных уроков",
  "meetings.end": "Завершение уроков",
  "attendance.view": "Просмотр посещаемости",
  "announcements.view": "Просмотр объявлений",
  "announcements.manage": "Управление объявлениями",
  "audit.view": "Журнал действий",
};

export interface AdminActor {
  id: string;
  role: Role;
}

/** Объект действия (кого или что меняем). Для общих прав не нужен. */
export interface AdminTarget {
  id?: string;
  role?: Role;
}

/** Действия, которые запрещено применять к самому себе. */
const SELF_FORBIDDEN: readonly AdminCapability[] = ["users.ban", "users.role.change"];

export function isAdmin(role: Role): boolean {
  return role === "ADMIN";
}

/**
 * Разрешено ли действие в админ-панели.
 *
 * Если `target` не передан, проверяется «принципиальная» возможность роли
 * (используется UI для отрисовки кнопок). Раздел закрыт для всех, кроме ADMIN.
 */
export function canAdmin(
  actor: AdminActor,
  capability: AdminCapability,
  target?: AdminTarget,
): boolean {
  if (!isAdmin(actor.role)) return false;
  if (target?.id && target.id === actor.id && SELF_FORBIDDEN.includes(capability)) return false;
  return true;
}

/** Причина отказа — текст для toast/подсказки. `null` — действие разрешено. */
export function adminDenyReason(
  actor: AdminActor,
  capability: AdminCapability,
  target?: AdminTarget,
): string | null {
  if (canAdmin(actor, capability, target)) return null;

  if (target?.id && target.id === actor.id && SELF_FORBIDDEN.includes(capability)) {
    return capability === "users.ban"
      ? "Нельзя заблокировать собственную учётную запись"
      : "Нельзя менять собственную роль";
  }

  if (!isAdmin(actor.role)) return "Доступ в админ-панель открыт только Администратору школы";

  return `Недостаточно прав: ${CAPABILITY_LABELS[capability].toLowerCase()}`;
}

/** Карта прав для интерфейса: какие кнопки показывать активными. */
export function adminCapabilities(
  actor: AdminActor,
  target?: AdminTarget,
): Record<AdminCapability, boolean> {
  const capabilities = Object.keys(CAPABILITY_LABELS) as AdminCapability[];
  return capabilities.reduce(
    (acc, capability) => {
      acc[capability] = canAdmin(actor, capability, target);
      return acc;
    },
    {} as Record<AdminCapability, boolean>,
  );
}

/**
 * Можно ли принудительно завершить урок.
 * Администратор — любой урок, учитель — только свой (он его и ведёт в комнате;
 * в админ-панели эта кнопка доступна лишь суперадмину).
 */
export function canEndMeeting(actor: AdminActor, meeting: { hostId: string }): boolean {
  if (isAdmin(actor.role)) return true;
  return actor.role === "TEACHER" && meeting.hostId === actor.id;
}

export function meetingEndDenyReason(actor: AdminActor, meeting: { hostId: string }): string | null {
  if (canEndMeeting(actor, meeting)) return null;
  return "Учитель может завершить только свой урок";
}
