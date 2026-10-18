import { Prisma, type PrismaClient } from "@prisma/client";
import bcryptjs from "bcryptjs";
import { generateClassCode } from "@/lib/class-code";
import { INTERACTIVE_TRANSACTION_OPTIONS, prisma } from "@/lib/prisma";
import { GRADES, type GradeCode } from "@/lib/schedule-rules";
import { gradeFromClassName, normalizeSchoolCode } from "@/lib/school-rules";
import { normalizeInviteToken, resolveInviteRole, type InviteRole } from "@/lib/invite-rules";
import {
  inviteTokensForNewSchool,
  missingInviteTokens,
  provisioningInviteData,
} from "@/lib/invite-tokens";
import {
  CONFIGURED_SCHOOLS,
  DEFAULT_CLASS_NAMES,
  DEFAULT_SCHOOL,
  GUARANTEED_ADMINS,
  LEGACY_DEFAULT_SCHOOL_CODE,
  demoAdminPasswordResetEnabled,
  demoAdminSeedDisabled,
} from "@/lib/school-config";

export { gradeFromClassName, normalizeClassName, normalizeSchoolCode } from "@/lib/school-rules";
export { CONFIGURED_SCHOOLS, DEFAULT_CLASS_NAMES, GUARANTEED_ADMINS, GUARANTEED_ADMIN } from "@/lib/school-config";

export const DEFAULT_SCHOOL_NAME = DEFAULT_SCHOOL.name;
export const DEFAULT_SCHOOL_CODE = DEFAULT_SCHOOL.code;

export interface SchoolClassOption {
  id: string;
  name: string;
  grade: GradeCode;
}

export interface SchoolSummary {
  id: string;
  name: string;
  code: string;
}

/**
 * Школа вместе со своими секретными токенами-приглашениями.
 *
 * Токены nullable: колонки `teacherInviteToken` / `adminInviteToken` объявлены как
 * `String? @unique`, чтобы `prisma db push` мог добавить их в уже заполненную
 * таблицу `schools` (PostgreSQL отказывается добавлять NOT NULL-колонку без
 * DB-level default). Приложение выпускает недостающие значения само — см.
 * `backfillSchoolInviteTokens` и `getSchoolInviteSummary`, — поэтому `null`
 * здесь означает лишь «записать токен в БД не удалось».
 */
export interface SchoolInviteSummary extends SchoolSummary {
  teacherInviteToken: string | null;
  adminInviteToken: string | null;
}

const SCHOOL_INVITE_SELECT = {
  id: true,
  name: true,
  code: true,
  teacherInviteToken: true,
  adminInviteToken: true,
} as const;

function classNameForGrade(grade: GradeCode): string {
  return `${grade.replace("GRADE_", "")}-А`;
}

/**
 * Условно заполняет NULL-токены одной школы.
 *
 * Каждая колонка пишется отдельным `updateMany` с фильтром `token: null`: при
 * параллельных запросах (несколько инстансов Render, гонка регистрации) токен
 * сохранит только первый вызов, чужое значение не перезапишется.
 *
 * Возвращает `true`, если строку изменил именно этот вызов и её надо перечитать.
 */
async function fillMissingInviteTokens(
  db: PrismaClient,
  school: { id: string; code: string; teacherInviteToken: string | null; adminInviteToken: string | null },
): Promise<boolean> {
  const missing = missingInviteTokens(school);
  let written = false;

  if (missing.teacherInviteToken) {
    const { count } = await db.school.updateMany({
      where: { id: school.id, teacherInviteToken: null },
      data: { teacherInviteToken: missing.teacherInviteToken },
    });
    written = written || count > 0;
  }

  if (missing.adminInviteToken) {
    const { count } = await db.school.updateMany({
      where: { id: school.id, adminInviteToken: null },
      data: { adminInviteToken: missing.adminInviteToken },
    });
    written = written || count > 0;
  }

  return written;
}

/**
 * Выпускает недостающие токены приглашений у ВСЕХ школ базы.
 *
 * Нужно после накатывания схемы на живую базу: у строк, созданных до того, как
 * колонки стали nullable, токенов нет. Идемпотентно — вызывается при старте
 * приложения (`ensureDefaultSchool`) и в сиде. Возвращает число дополненных школ.
 */
export async function backfillSchoolInviteTokens(db: PrismaClient = prisma): Promise<number> {
  const rows = await db.school.findMany({
    where: { OR: [{ teacherInviteToken: null }, { adminInviteToken: null }] },
    select: SCHOOL_INVITE_SELECT,
  });

  let filled = 0;
  for (const row of rows) {
    if (await fillMissingInviteTokens(db, row)) filled += 1;
  }
  return filled;
}

/**
 * Гарантирует существование демо-администратора в заданной школе (C-02).
 *
 * Зачем: роль ADMIN нельзя получить через публичную форму регистрации, поэтому
 * пустая база (свежий деплой без сида) осталась бы без администратора — и в
 * админ-панель никто не смог бы войти.
 *
 * Как теперь безопасно:
 *  - аккаунт СОЗДАЁТСЯ, только если его нет (пароль сразу хешируется bcrypt,
 *    в открытом виде никуда не пишется и не логируется);
 *  - у уже существующего аккаунта пароль НЕ перетирается: иначе смена пароля
 *    через админ-панель отменялась бы следующим стартом сервера. Обновляются
 *    только имя, роль, школа и снятие блокировки;
 *  - принудительный возврат демо-пароля — только по явному флагу оператора
 *    `SCHOOLMEET_RESET_DEMO_ADMIN_PASSWORDS=true` (разовая процедура);
 *  - всю инициализацию можно выключить: `SCHOOLMEET_DISABLE_DEMO_ADMIN_SEED=true`.
 */
async function ensureGuaranteedAdmin(
  db: PrismaClient,
  schoolId: string,
  admin: (typeof GUARANTEED_ADMINS)[number],
): Promise<void> {
  if (demoAdminSeedDisabled()) return;

  const email = admin.email.toLowerCase().trim();
  const profile = {
    name: admin.name,
    role: admin.role,
    schoolId,
    classId: null,
    grade: null,
    isBanned: false,
  } as const;

  // Ищем без учёта регистра: аккаунт мог быть создан до нормализации email
  // («Admin@SchoolMeet.ru») — его надо обновить, а не дублировать второй строкой.
  const existing = await db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });

  try {
    if (!existing) {
      await db.user.create({
        data: { email, password: bcryptjs.hashSync(admin.password, 10), ...profile },
      });
      console.warn(`[schools] Создан гарантированный администратор ${email} для школы ${admin.schoolCode}.`);
      return;
    }

    const data = demoAdminPasswordResetEnabled()
      ? { ...profile, password: bcryptjs.hashSync(admin.password, 10) }
      : { ...profile };

    await db.user.update({ where: { id: existing.id }, data });
  } catch (error) {
    // Параллельный инстанс успел создать аккаунт первым — уникальный индекс
    // победил, для нас это не ошибка.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }
}

/**
 * Досыпает `schoolId` объявлениям, созданным до появления колонки.
 *
 * Модель `Announcement` стала tenant-scoped (исправление H-03), но старые записи
 * остались с `schoolId = null`. Их привязываем к школе автора, а если автор уже
 * удалён или без школы — к основной школе: «общих» для всех школ объявлений в
 * базе не остаётся. Идемпотентно: запись идет через `updateMany` с фильтром
 * `schoolId: null`, поэтому параллельные инстансы не конфликтуют.
 */
export async function backfillAnnouncementSchools(db: PrismaClient = prisma): Promise<number> {
  const rows = await db.announcement.findMany({
    where: { schoolId: null },
    select: { id: true, author: { select: { schoolId: true } } },
  });
  if (rows.length === 0) return 0;

  const primary = await db.school.findUnique({
    where: { code: DEFAULT_SCHOOL_CODE },
    select: { id: true },
  });

  let filled = 0;
  for (const row of rows) {
    const schoolId = row.author?.schoolId ?? primary?.id ?? null;
    if (!schoolId) continue;
    const { count } = await db.announcement.updateMany({
      where: { id: row.id, schoolId: null },
      data: { schoolId },
    });
    filled += count;
  }
  return filled;
}

let defaultSchoolPromise: Promise<SchoolSummary> | null = null;

/**
 * Idempotently creates the configured schools and their standard classes.
 * Existing SCHOOL1 installations are migrated/merged into the primary school,
 * preserving user, class, schedule, homework, and meeting references.
 *
 * Также создаёт/обновляет гарантированных демо-администраторов всех
 * настроенных школ (см. `ensureGuaranteedAdmin`).
 */
export async function provisionConfiguredSchools(db: PrismaClient = prisma): Promise<Map<string, SchoolSummary>> {
  const schools = new Map<string, SchoolSummary>();

  for (const definition of CONFIGURED_SCHOOLS) {
    let school = await db.school.findUnique({
      where: { code: definition.code },
      select: SCHOOL_INVITE_SELECT,
    });

    // Reuse the old default-school row when migrating a single-tenant database.
    if (!school && definition.code === DEFAULT_SCHOOL.code) {
      const legacySchool = await db.school.findUnique({
        where: { code: LEGACY_DEFAULT_SCHOOL_CODE },
        select: SCHOOL_INVITE_SELECT,
      });
      if (legacySchool) {
        school = await db.school.update({
          where: { id: legacySchool.id },
          data: { name: definition.name, code: definition.code },
          select: SCHOOL_INVITE_SELECT,
        });
      }
    }

    if (!school) {
      // Новая школа создаётся сразу с обоими токенами приглашений: колонки
      // nullable и DB-level default у них нет (см. `@/lib/invite-tokens`).
      school = await db.school.upsert({
        where: { code: definition.code },
        update: { name: definition.name, strictClassIsolation: definition.strictClassIsolation },
        create: {
          name: definition.name,
          code: definition.code,
          strictClassIsolation: definition.strictClassIsolation,
          ...inviteTokensForNewSchool(definition.code),
        },
        select: SCHOOL_INVITE_SELECT,
      });
    }

    if (!school) throw new Error(`Не удалось создать школу ${definition.name}`);

    const schoolId = school.id;

    // Существующая школа: синхронизируем имя и политику изоляции классов
    // (Лицей Сингулярити — strict, остальные — flexible), возвращаем
    // admin-токен настроенных школ к детерминированному пресету и выпускаем
    // недостающие токены.
    school = await db.school.update({
      where: { id: schoolId },
      // Только досыпание отсутствующих токенов: сохранённый в БД admin-токен
      // (в том числе ротированный администратором) не перетирается — C-01.
      data: {
        name: definition.name,
        strictClassIsolation: definition.strictClassIsolation,
        ...provisioningInviteData({ ...school, code: definition.code }),
      },
      select: SCHOOL_INVITE_SELECT,
    });

    await db.class.createMany({
      data: DEFAULT_CLASS_NAMES.map((name) => ({ schoolId, name })),
      skipDuplicates: true,
    });
    schools.set(school.code, school);
  }

  const primarySchool = schools.get(DEFAULT_SCHOOL.code);
  const legacySchool = await db.school.findUnique({
    where: { code: LEGACY_DEFAULT_SCHOOL_CODE },
    select: { id: true },
  });
  if (primarySchool && legacySchool && primarySchool.id !== legacySchool.id) {
    await mergeSchoolData(db, legacySchool.id, primarySchool.id);
  }

  // Гарантированные админы всех трёх школ: свежий деплой без сида получает
  // рабочий вход в `/admin` для каждого настроенного тенанта. Идемпотентно —
  // каждый аккаунт создаётся/обновляется под свой демо-конфиг.
  for (const admin of GUARANTEED_ADMINS) {
    const school = schools.get(admin.schoolCode);
    if (school) await ensureGuaranteedAdmin(db, school.id, admin);
  }

  // Школы вне CONFIGURED_SCHOOLS (созданные вручную или до того, как колонки
  // токенов стали nullable) тоже получают токены приглашений.
  await backfillSchoolInviteTokens(db);

  // Объявления, созданные до появления `Announcement.schoolId`, привязываем к
  // школе автора — иначе они остались бы «общими» для всех тенантов (H-03).
  try {
    await backfillAnnouncementSchools(db);
  } catch (error) {
    console.error("[schools] Не удалось досыпать школу у объявлений:", error);
  }

  // Коды классов для приглашений (строгие школы): у классов, созданных до
  // появления `Class.code`, значения нет — досыпаем идемпотентно.
  try {
    await backfillClassCodes(db);
  } catch (error) {
    console.error("[schools] Не удалось досыпать коды классов:", error);
  }

  return schools;
}

/**
 * Досыпает `Class.code` (код класса для приглашений) существующим классам.
 *
 * Код нужен в строгих школах (`strictClassIsolation = true`): ученик другого
 * класса получает вход в урок, введя код класса (см. `src/lib/class-code.ts`
 * и `/api/meetings/[code]/class-access`). Формат — «название без дефиса +
 * случайные 5 символов», например `5A-K7QZM4`: коротко, читаемо и глобально
 * уникально (уникальный индекс `classes.code`). Идемпотентно: строки с кодом
 * не трогаются, параллельные инстансы не конфликтуют (`where: code: null`
 * неявно — обновляем конкретную строку, при гонке P2002 пробуем новый код).
 */
export async function backfillClassCodes(db: PrismaClient = prisma): Promise<number> {
  const rows = await db.class.findMany({ where: { code: null }, select: { id: true, name: true } });

  let filled = 0;
  for (const row of rows) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await db.class.update({ where: { id: row.id }, data: { code: generateClassCode(row.name) } });
        filled += 1;
        break;
      } catch (error) {
        // Уникальный код занят (практически невозможно — 5 криптослучайных
        // символов), пробуем сгенерировать заново.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
        throw error;
      }
    }
  }
  return filled;
}

/** Move legacy tenant data without losing class links or deleting records. */
async function mergeSchoolData(db: PrismaClient, sourceSchoolId: string, targetSchoolId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const source = await tx.school.findUnique({ where: { id: sourceSchoolId }, select: { id: true } });
    if (!source || source.id === targetSchoolId) return;

    const sourceClasses = await tx.class.findMany({
      where: { schoolId: sourceSchoolId },
      select: { id: true, name: true },
    });
    const targetClasses = await tx.class.findMany({
      where: { schoolId: targetSchoolId },
      select: { id: true, name: true },
    });
    const targetClassByName = new Map(targetClasses.map((schoolClass) => [schoolClass.name, schoolClass.id]));

    for (const sourceClass of sourceClasses) {
      const targetClassId = targetClassByName.get(sourceClass.name);
      if (targetClassId) {
        await tx.user.updateMany({ where: { classId: sourceClass.id }, data: { classId: targetClassId } });
        await tx.schedule.updateMany({ where: { classId: sourceClass.id }, data: { classId: targetClassId } });
        await tx.homework.updateMany({ where: { classId: sourceClass.id }, data: { classId: targetClassId } });
        await tx.class.delete({ where: { id: sourceClass.id } });
      } else {
        await tx.class.update({ where: { id: sourceClass.id }, data: { schoolId: targetSchoolId } });
      }
    }

    await tx.user.updateMany({ where: { schoolId: sourceSchoolId }, data: { schoolId: targetSchoolId } });
    await tx.schedule.updateMany({ where: { schoolId: sourceSchoolId }, data: { schoolId: targetSchoolId } });
    await tx.homework.updateMany({ where: { schoolId: sourceSchoolId }, data: { schoolId: targetSchoolId } });
    await tx.meeting.updateMany({ where: { schoolId: sourceSchoolId }, data: { schoolId: targetSchoolId } });
    await tx.school.delete({ where: { id: sourceSchoolId } });
  }, INTERACTIVE_TRANSACTION_OPTIONS);
}

/**
 * Creates the configured tenants and safely assigns legacy records with no
 * school/class to the primary school. Nullable schema fields let this run
 * against installations upgraded from the original single-school version.
 */
export function ensureDefaultSchool(): Promise<SchoolSummary> {
  if (!defaultSchoolPromise) {
    defaultSchoolPromise = ensureDefaultSchoolAndBackfill().catch((error: unknown) => {
      defaultSchoolPromise = null;
      throw error;
    });
  }
  return defaultSchoolPromise;
}

async function ensureDefaultSchoolAndBackfill(): Promise<SchoolSummary> {
  const schools = await provisionConfiguredSchools();
  const school = schools.get(DEFAULT_SCHOOL_CODE);
  if (!school) throw new Error("Не удалось создать основную школу");

  const classes = await prisma.class.findMany({
    where: { schoolId: school.id },
    select: { id: true, name: true },
  });
  const classIdByGrade = new Map<GradeCode, string>();
  for (const schoolClass of classes) {
    const grade = gradeFromClassName(schoolClass.name);
    if (grade && schoolClass.name === classNameForGrade(grade)) classIdByGrade.set(grade, schoolClass.id);
  }

  await prisma.$transaction(async (tx) => {
    for (const grade of GRADES) {
      const classId = classIdByGrade.get(grade);
      if (!classId) continue;

      await tx.user.updateMany({
        where: { schoolId: null, role: "STUDENT", grade },
        data: { schoolId: school.id, classId },
      });
      await tx.user.updateMany({
        where: { schoolId: school.id, classId: null, role: "STUDENT", grade },
        data: { classId },
      });
      await tx.schedule.updateMany({
        where: { schoolId: null, grade },
        data: { schoolId: school.id, classId },
      });
      await tx.schedule.updateMany({
        where: { schoolId: school.id, classId: null, grade },
        data: { classId },
      });
      await tx.homework.updateMany({
        where: { schoolId: null, grade },
        data: { schoolId: school.id, classId },
      });
      await tx.homework.updateMany({
        where: { schoolId: school.id, classId: null, grade },
        data: { classId },
      });
    }

    // Non-students and grade-less users still belong to the legacy school.
    await tx.user.updateMany({ where: { schoolId: null }, data: { schoolId: school.id } });
    await tx.schedule.updateMany({ where: { schoolId: null }, data: { schoolId: school.id } });
    await tx.homework.updateMany({ where: { schoolId: null }, data: { schoolId: school.id } });

    // Backfill the explicit tenant on existing meetings before allowing joins.
    const meetings = await tx.meeting.findMany({
      where: { schoolId: null },
      select: {
        id: true,
        host: { select: { schoolId: true } },
        schedule: { select: { schoolId: true } },
      },
    });
    for (const meeting of meetings) {
      const meetingSchoolId = meeting.schedule?.schoolId ?? meeting.host.schoolId;
      if (!meetingSchoolId) continue;
      await tx.meeting.updateMany({
        where: { id: meeting.id, schoolId: null },
        data: { schoolId: meetingSchoolId },
      });
    }
  }, INTERACTIVE_TRANSACTION_OPTIONS);

  return school;
}

/** Persist a user's tenant assignment before issuing a session or socket. */
export async function ensureUserSchoolMembership(userId: string) {
  // Ensures all configured schools/classes exist even when the seed was skipped.
  await ensureDefaultSchool();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, schoolId: true, classId: true, grade: true, role: true },
  });
  if (!user) return null;

  if (!user.schoolId) {
    await ensureDefaultSchool();
  } else if (!user.classId && user.role === "STUDENT" && user.grade) {
    const grade = user.grade as GradeCode;
    const legacyClass = await prisma.class.findUnique({
      where: { schoolId_name: { schoolId: user.schoolId, name: classNameForGrade(grade) } },
      select: { id: true },
    });
    if (legacyClass) {
      await prisma.user.updateMany({
        where: { id: userId, schoolId: user.schoolId, classId: null },
        data: { classId: legacyClass.id },
      });
    }
  }

  const assigned = await prisma.user.findUnique({
    where: { id: userId },
    select: { schoolId: true, classId: true },
  });
  return assigned?.schoolId ? { schoolId: assigned.schoolId, classId: assigned.classId } : null;
}

export async function findSchoolByCode(value: unknown): Promise<SchoolSummary | null> {
  const code = normalizeSchoolCode(value);
  if (!code) return null;
  // Подготовка тенантов не должна ронять проверку/регистрацию, если школа уже есть
  // или её только что создал `/api/schools/check`.
  try {
    await ensureDefaultSchool();
  } catch (error) {
    console.error("[schools] Не удалось подготовить школы, ищем код напрямую:", error);
  }
  return prisma.school.findFirst({
    where: { code: { equals: code, mode: "insensitive" } },
    select: { id: true, name: true, code: true },
  });
}

/** Токены-приглашения школы (для админ-панели и проверки `invite`). */
export async function getSchoolInviteSummary(schoolId: string): Promise<SchoolInviteSummary | null> {
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: SCHOOL_INVITE_SELECT });
  return school ? withInviteTokens(school) : null;
}

/**
 * Возвращает школу с выпущенными токенами приглашений.
 *
 * Колонки токенов nullable, поэтому у строк, созданных до накатывания текущей
 * схемы (или в обход приложения), их может не быть. Недостающие значения
 * досоздаются условной записью, после чего строка перечитывается: вызывающий
 * код всегда получает токены, которые реально лежат в БД.
 */
async function withInviteTokens(school: SchoolInviteSummary): Promise<SchoolInviteSummary> {
  if (!(await fillMissingInviteTokens(prisma, school))) return school;
  const fresh = await prisma.school.findUnique({ where: { id: school.id }, select: SCHOOL_INVITE_SELECT });
  return fresh ?? school;
}

/**
 * Находит школу по коду и определяет уровень `invite`-ссылки.
 *
 * Если код не указал школу, но токен валиден сам по себе, — используется школа,
 * которой принадлежит токен (ссылка приглашения всегда содержит свой токен).
 * Возвращает `inviteRole: null` для публичной регистрации (без токена).
 */
export async function findSchoolForInvite(
  code: unknown,
  invite: unknown,
): Promise<{ school: SchoolInviteSummary; inviteRole: InviteRole | null } | null> {
  const token = normalizeInviteToken(invite);

  const byCode = await findSchoolByCode(code);
  if (byCode) {
    // `getSchoolInviteSummary` заодно выпускает недостающие токены школы.
    const school = await getSchoolInviteSummary(byCode.id);
    if (school) return { school, inviteRole: resolveInviteRole(school, token) };
  }

  if (token) {
    const byToken = await prisma.school.findFirst({
      where: { OR: [{ teacherInviteToken: token }, { adminInviteToken: token }] },
      select: SCHOOL_INVITE_SELECT,
    });
    if (byToken) return { school: await withInviteTokens(byToken), inviteRole: resolveInviteRole(byToken, token) };
  }

  return null;
}

export async function listClassesForSchool(schoolId: string): Promise<SchoolClassOption[]> {
  const rows = await prisma.class.findMany({
    where: { schoolId },
    select: { id: true, name: true },
  });
  return rows
    .map((row) => ({ ...row, grade: gradeFromClassName(row.name) }))
    .filter((row): row is SchoolClassOption => row.grade !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
}

export async function getSchoolSummary(schoolId: string): Promise<SchoolSummary | null> {
  return prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true, code: true },
  });
}

/**
 * Политика изоляции классов школы (`strictClassIsolation`).
 *
 * `null` — школа не найдена (вызывающий код отказывает в доступе, fail-closed).
 */
export async function getSchoolPolicy(
  schoolId: string,
): Promise<{ strictClassIsolation: boolean } | null> {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { strictClassIsolation: true },
  });
  return school ? { strictClassIsolation: school.strictClassIsolation } : null;
}

/** Resolve the tenant for a legacy meeting as well as for newly tenant-scoped meetings. */
export function getMeetingSchoolId(meeting: {
  schoolId: string | null;
  host: { schoolId: string | null };
  schedule?: { schoolId: string | null } | null;
}): string | null {
  return meeting.schoolId ?? meeting.schedule?.schoolId ?? meeting.host.schoolId;
}
