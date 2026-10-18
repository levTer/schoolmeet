/**
 * Регрессионные тесты исправлений безопасности (C-01, C-02, H-01, H-02, H-03).
 *
 * Запуск: `npm run test:security` (входит в `npm test`). База данных, сеть и
 * браузер не нужны: проверяются чистые правила доступа и контракты исходников.
 *
 * Покрывает ровно то, что аудит (`AUDIT.md`) отнёс к Critical/High:
 *  1. доступ к уроку: школа + класс расписания (H-02);
 *  2. синхронизация JWT: роль/школа только из БД, fail-closed при сбое (H-01);
 *  3. изоляция объявлений по школе: фильтр тенанта во всех операциях (H-03);
 *  4. invite-токены: публичные пути не возвращают пресет из репозитория (C-01);
 *  5. гарантированные демо-админы: пароль не перетирается при старте (C-02);
 *  6. секреты не утекают в клиентские бандлы.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  applyDatabaseSnapshot,
  isSessionAuthoritative,
  keepSessionOnDatabaseError,
  sessionRevocationReason,
  shouldSyncSession,
  UNTRUSTED_SESSION_FIELDS,
  type DatabaseUserSnapshot,
  type SessionToken,
} from "../src/lib/auth-token";
import {
  isSchoolStaff,
  resolveMeetingAccess,
  type MeetingAccessViewer,
} from "../src/lib/meeting-access";
import { configuredInviteTokensRestored, provisioningInviteData } from "../src/lib/invite-tokens";
import { signClassCodeGrant, verifyClassCodeGrant } from "../src/lib/class-code";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

/** Исходник без комментариев: секреты в документации допустимы, в коде — нет. */
function stripComments(source: string): string {
  return source.replace(/\/\*[^]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Клиентские компоненты, которые обязаны оставаться без секретов. */
const CLIENT_SOURCES = [
  "src/components/auth/register-form.tsx",
  "src/components/auth/login-form.tsx",
  "src/components/admin/announcements-manager.tsx",
  "src/components/admin/users-table.tsx",
  "src/components/admin/school-settings-panel.tsx",
  "src/components/dashboard/announcement-banner.tsx",
  "src/components/meeting/MeetingRoom.tsx",
  "src/hooks/useSocket.ts",
  "src/lib/client-api.ts",
] as const;

/* -------------------------------------------------------------------------- */
/* H-02. Доступ к уроку: школа и класс расписания                              */
/* -------------------------------------------------------------------------- */

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";
const CLASS_8A = "class-8a";
const CLASS_8B = "class-8b";

const student8a: MeetingAccessViewer = { id: "u-student-8a", role: "STUDENT", schoolId: SCHOOL_A, classId: CLASS_8A };
const student8b: MeetingAccessViewer = { id: "u-student-8b", role: "STUDENT", schoolId: SCHOOL_A, classId: CLASS_8B };
const studentNoClass: MeetingAccessViewer = { id: "u-student-noclass", role: "STUDENT", schoolId: SCHOOL_A, classId: null };
const teacher: MeetingAccessViewer = { id: "u-teacher", role: "TEACHER", schoolId: SCHOOL_A, classId: null };
const admin: MeetingAccessViewer = { id: "u-admin", role: "ADMIN", schoolId: SCHOOL_A, classId: null };
const foreignStudent: MeetingAccessViewer = { id: "u-foreign", role: "STUDENT", schoolId: SCHOOL_B, classId: CLASS_8A };

describe("H-02: доступ к уроку ограничен школой и классом", () => {
  it("учитель и администратор школы допущены, ученик — нет", () => {
    assert.equal(isSchoolStaff("TEACHER"), true);
    assert.equal(isSchoolStaff("ADMIN"), true);
    assert.equal(isSchoolStaff("STUDENT"), false);
  });

  it("чужой школе урок недоступен под кодом 404 (без подтверждения существования)", () => {
    const decision = resolveMeetingAccess({ schoolId: SCHOOL_A, scheduleClassId: CLASS_8A }, foreignStudent);
    if (decision.ok) assert.fail("ученик чужой школы получил доступ к уроку");
    assert.equal(decision.code, "SCHOOL_MISMATCH");
    assert.equal(decision.status, 404);
  });

  it("урок без школы или у зрителя без школы — отказ (fail-closed)", () => {
    for (const meeting of [
      { schoolId: null, scheduleClassId: null },
      { schoolId: SCHOOL_A, scheduleClassId: null },
    ]) {
      const decision = resolveMeetingAccess(meeting, { ...student8a, schoolId: null });
      assert.equal(decision.ok, false);
    }
    const noTenant = resolveMeetingAccess({ schoolId: null, scheduleClassId: null }, student8a);
    assert.equal(noTenant.ok, false);
  });

  it("СТРОГАЯ школа: ученик НЕ попадает в урок другого класса (403)", () => {
    const decision = resolveMeetingAccess(
      { schoolId: SCHOOL_A, scheduleClassId: CLASS_8B, strictClassIsolation: true },
      student8a,
    );
    if (decision.ok) assert.fail("ученик чужого класса получил доступ к уроку");
    assert.equal(decision.code, "CLASS_FORBIDDEN");
    assert.equal(decision.status, 403);
  });

  it("СТРОГАЯ школа: ученик без класса не проходит в урок, привязанный к классу", () => {
    assert.equal(
      resolveMeetingAccess({ schoolId: SCHOOL_A, scheduleClassId: CLASS_8A, strictClassIsolation: true }, studentNoClass).ok,
      false,
    );
  });

  it("ГИБКАЯ школа: любой ученик школы заходит на любые уроки школы (по умолчанию и явно)", () => {
    for (const viewer of [student8a, student8b, studentNoClass]) {
      // Без флага — гибкий режим (default).
      assert.equal(resolveMeetingAccess({ schoolId: SCHOOL_A, scheduleClassId: CLASS_8B }, viewer).ok, true, `не прошёл ${viewer.classId ?? "без класса"}`);
      // Явный false — то же поведение.
      assert.equal(
        resolveMeetingAccess({ schoolId: SCHOOL_A, scheduleClassId: CLASS_8B, strictClassIsolation: false }, viewer).ok,
        true,
      );
    }
  });

  it("ученик своего класса, учитель и администратор проходят при ЛЮБОЙ политике", () => {
    for (const strictClassIsolation of [true, false]) {
      for (const viewer of [student8a, teacher, admin]) {
        const decision = resolveMeetingAccess(
          { schoolId: SCHOOL_A, scheduleClassId: CLASS_8A, strictClassIsolation },
          viewer,
        );
        assert.deepEqual(decision, { ok: true }, `не прошёл ${viewer.role} (strict=${strictClassIsolation})`);
      }
    }
  });

  it("внеплановая встреча школы (без класса) открыта всем школе", () => {
    for (const viewer of [student8a, student8b, studentNoClass, teacher, admin]) {
      assert.equal(resolveMeetingAccess({ schoolId: SCHOOL_A, scheduleClassId: null }, viewer).ok, true);
    }
  });

  it("ведущий урока заходит, даже если у него больше нет роли учителя", () => {
    const meeting = { schoolId: SCHOOL_A, scheduleClassId: CLASS_8B, hostId: student8b.id, strictClassIsolation: true };
    assert.equal(resolveMeetingAccess(meeting, student8b).ok, true);
    // В строгой школе другой ученик к чужому уроку не допущен…
    assert.equal(resolveMeetingAccess(meeting, studentNoClass).ok, false);
    // …в гибкой — допущен (политика школы мягче).
    assert.equal(resolveMeetingAccess({ ...meeting, strictClassIsolation: false }, studentNoClass).ok, true);
  });
});

/* -------------------------------------------------------------------------- */
/* H-02 (расширение): строгие/гибкие школы и допуск по коду класса             */
/* -------------------------------------------------------------------------- */

describe("политика классов: схема, provisioning, допуск по коду", () => {
  const schema = readSource("prisma/schema.prisma");

  it("у School есть strictClassIsolation (default false), у Class — code @unique", () => {
    const schoolModel = schema.slice(schema.indexOf("model School {"), schema.indexOf("model Class {"));
    assert.match(schoolModel, /strictClassIsolation\s+Boolean\s+@default\(false\)/, "нет strictClassIsolation у School");
    const classModel = schema.slice(schema.indexOf("model Class {"), schema.indexOf("model User {"));
    assert.match(classModel, /code\s+String\?\s+@unique/, "нет code String? @unique у Class");
  });

  it("provisioning: СИНГУЛЯРИТИ — strict, Fullhouse/Школа Душа — flexible", () => {
    const config = readSource("src/lib/school-config.ts");
    assert.match(config, /code: "Sinlycem26", strictClassIsolation: true/, "Сингулярити не строгий в конфиге");
    assert.match(config, /code: "Fulhouseteem26", strictClassIsolation: false/);
    assert.match(config, /code: "Anna\.Terentieva77", strictClassIsolation: false/);

    const schools = readSource("src/lib/schools.ts");
    assert.match(schools, /strictClassIsolation: definition\.strictClassIsolation/, "provisioning не пишет политику в БД");
    assert.match(schools, /async function backfillClassCodes/, "нет досыпания кодов классов");
    assert.match(schools, /await backfillClassCodes\(db\)/, "досыпание не вызывается при старте");
  });

  it("маршрут кода класса: сверка с Class.code → подписанный разовый допуск", () => {
    const route = readSource("src/app/api/meetings/[code]/class-access/route.ts");
    assert.match(route, /checkMeetingAccess\(/, "не используется единое правило доступа");
    assert.match(route, /signClassCodeGrant\(/, "не выдаётся подписанный допуск");
    assert.match(route, /normalizeClassCode\(/, "код класса не нормализуется при вводе");
    assert.match(route, /NOT_FOUND/, "чужая школа должна получать 404 (без подтверждения урока)");
    assert.match(route, /CLASS_CODE_INVALID/, "нет кода отказа для неверного кода класса");
  });

  it("socket join-room и API урока принимают допуск, checkMeetingAccess его верифицирует", () => {
    const realtime = readSource("src/server/realtime.ts");
    const joinIndex = realtime.indexOf('socket.on("join-room"');
    const joinBody = realtime.slice(joinIndex, realtime.indexOf('socket.on("leave-room"'));
    assert.match(joinBody, /classCodeGrant/, "join-room не читает допуск из payload");
    assert.match(joinBody, /\{ classCodeGrant \}/, "допуск не передаётся в checkMeetingAccess");

    const apiRoute = readSource("src/app/api/meetings/[code]/route.ts");
    assert.match(apiRoute, /searchParams\.get\("grant"\)/, "API не читает ?grant=");
    assert.match(apiRoute, /\{ classCodeGrant \}/, "допуск не передаётся в checkMeetingAccess");

    const meetings = readSource("src/lib/meetings.ts");
    assert.match(meetings, /verifyClassCodeGrant\(/, "допуск не верифицируется");
    assert.match(meetings, /classCodeGrantSecret\(\)/, "нет секрета подписи допуска");
    assert.match(meetings, /meeting\.school\?\.strictClassIsolation \?\? false/, "политика школы не передаётся в правило доступа");
  });

  it("допуск привязан к пользователю, классу и комнате (не переносится)", () => {
    const now = Date.now();
    const token = signClassCodeGrant(
      { userId: "u-1", classId: CLASS_8B, schoolId: SCHOOL_A, meetingCode: "room-1", issuedAt: now },
      "secret",
    );
    assert.equal(verifyClassCodeGrant(token, "secret", { userId: "u-1", classId: CLASS_8B, meetingCode: "room-1" }), true);
    assert.equal(verifyClassCodeGrant(token, "secret", { userId: "u-1", classId: CLASS_8B, meetingCode: "room-2" }), false, "допуск перенёсся в другую комнату");
    assert.equal(verifyClassCodeGrant(token, "secret", { userId: "u-2", classId: CLASS_8B, meetingCode: "room-1" }), false, "допуск перенёсся на другого пользователя");
    assert.equal(verifyClassCodeGrant(token, "secret", { userId: "u-1", classId: CLASS_8A, meetingCode: "room-1" }), false, "допуск перенёсся в другой класс");
  });

  it("смена класса: только STUDENT гибкой школы, tenant из сессии, без bump версии сессии", () => {
    const route = readSource("src/app/api/classes/membership/route.ts");
    assert.match(route, /viewer\.role !== "STUDENT"/, "не-ученикам разрешена смена класса");
    assert.match(route, /policy\.strictClassIsolation/, "не проверяется политика школы");
    assert.ok(
      !/sessionVersion:\s*\{\s*increment/.test(route),
      "смена класса бьёт версию сессии — токен будет аннулирован",
    );
    assert.match(route, /schoolId: viewer\.schoolId/, "тенант не взят из сессии");

    const classesRoute = readSource("src/app/api/classes/route.ts");
    assert.match(classesRoute, /strictClassIsolation/, "не отдаётся политика школы");
    assert.match(classesRoute, /currentClassId: viewer\.classId/, "не отдаётся текущий класс");
  });

  it("UI: Select класса для гибких школ, модалка кода для строгих", () => {
    const navbar = readSource("src/components/layout/Navbar.tsx");
    assert.match(navbar, /<ClassSwitcher/, "в Navbar нет переключателя класса");

    const switcher = readSource("src/components/layout/ClassSwitcher.tsx");
    assert.match(switcher, /<select/, "гибкая школа: нет Select для переключения класса");
    assert.match(switcher, /api\/classes\/membership/, "смена класса не идёт через API");
    assert.match(switcher, /strictClassIsolation/, "компонент не знает о политике школы");

    const page = readSource("src/app/meeting/[id]/page.tsx");
    assert.match(page, /meeting\.school\?\.strictClassIsolation/, "страница урока не знает о политике школы");
    assert.match(page, /<ClassCodeGate/, "нет модалки ввода кода класса для строгих школ");

    const gate = readSource("src/components/meeting/ClassCodeGate.tsx");
    assert.match(gate, /class-access/, "модалка не запрашивает допуск по коду");
    assert.match(gate, /sessionStorage/, "допуск не переживает перезагрузку страницы");
    assert.match(gate, /classCodeGrant={grant}/, "допуск не передаётся в комнату/сокет");
  });
});

/* -------------------------------------------------------------------------- */
/* H-01. Синхронизация JWT: только БД, fail-closed                             */
/* -------------------------------------------------------------------------- */

const dbUser = (overrides: Partial<DatabaseUserSnapshot> = {}): DatabaseUserSnapshot => ({
  role: "TEACHER",
  name: "Учитель",
  avatar: null,
  isBanned: false,
  schoolId: SCHOOL_A,
  classId: null,
  schoolName: "Лицей Сингулярити",
  sessionVersion: 0,
  ...overrides,
});

const syncedToken = (overrides: Partial<SessionToken> = {}): SessionToken => ({
  id: "u-1",
  role: "TEACHER",
  schoolId: SCHOOL_A,
  classId: null,
  schoolName: "Лицей Сингулярити",
  name: "Учитель",
  picture: null,
  banned: false,
  sessionVersion: 0,
  syncedAt: 1_000_000,
  ...overrides,
});

describe("H-01: JWT доверяет только БД", () => {
  it("роль, школа, класс, бан и версия сессии объявлены недоверенными для клиента", () => {
    assert.deepEqual([...UNTRUSTED_SESSION_FIELDS], [
      "role",
      "schoolId",
      "classId",
      "schoolName",
      "banned",
      "sessionVersion",
    ]);
  });

  it("права из клиентского payload в токен не попадают", () => {
    // jwt-callback получает update-payload отдельным аргументом и обязан его
    // игнорировать: ни одна функция модуля не принимает клиентские claims.
    const token = syncedToken({ role: "STUDENT" });
    const withDb = applyDatabaseSnapshot(token, dbUser({ role: "TEACHER" }), 2_000_000, "u-1");

    assert.equal(withDb.role, "TEACHER");
    assert.equal(withDb.schoolId, SCHOOL_A);
    // Исходный токен не мутируется — при ошибке БД отдаём прежнее значение.
    assert.equal(token.role, "STUDENT");
  });

  it("при trigger=update данные всё равно перечитываются из БД", () => {
    assert.equal(shouldSyncSession(syncedToken({ syncedAt: Date.now() }), { trigger: "update", now: Date.now(), refreshMs: 60_000 }), true);
    // Без триггера и в пределах окна — перечитывать не нужно.
    assert.equal(shouldSyncSession(syncedToken({ syncedAt: Date.now() }), { trigger: null, now: Date.now(), refreshMs: 60_000 }), false);
    // Токен без подтверждённых БД привилегий синхронизируется всегда.
    assert.equal(shouldSyncSession({ id: "u-1", role: "STUDENT" }, { trigger: null, now: Date.now(), refreshMs: 60_000 }), true);
  });

  it("удалённый, заблокированный или «сменивший версию» пользователь теряет сессию", () => {
    assert.equal(sessionRevocationReason(null, syncedToken()), "USER_DELETED");
    assert.equal(sessionRevocationReason(undefined, syncedToken()), "USER_DELETED");
    assert.equal(sessionRevocationReason(dbUser({ isBanned: true }), syncedToken()), "ACCOUNT_BANNED");
    // Смена пароля/роли подняла sessionVersion — старый токен аннулируется (H-06).
    assert.equal(sessionRevocationReason(dbUser({ sessionVersion: 3 }), syncedToken({ sessionVersion: 2 })), "SESSION_EXPIRED");
    assert.equal(sessionRevocationReason(dbUser(), syncedToken()), null);
  });

  it("при недоступной БД токен без подтверждённых прав аннулируется, а syncedAt не сдвигается", () => {
    const now = Date.now();
    // Неподтверждённый токен (роль есть, но нет syncedAt) — fail-closed.
    assert.equal(keepSessionOnDatabaseError({ id: "u-1", role: "ADMIN", schoolId: SCHOOL_A, classId: null }, { now, graceMs: 86_400_000 }), false);

    // Подтверждённый токен живёт в пределах grace-окна…
    assert.equal(keepSessionOnDatabaseError(syncedToken({ syncedAt: now - 1_000 }), { now, graceMs: 86_400_000 }), true);
    // …но не дольше: иначе устаревшие права консервировались бы навсегда.
    assert.equal(keepSessionOnDatabaseError(syncedToken({ syncedAt: now - 200_000_000 }), { now, graceMs: 86_400_000 }), false);

    // Ошибка БД и не должна продлевать срок сверки.
    const before = syncedToken({ syncedAt: 1_000 });
    const after = applyDatabaseSnapshot(before, dbUser(), 5_000, "u-1");
    assert.equal(after.syncedAt, 5_000);
    assert.equal(before.syncedAt, 1_000);
  });

  it("админ-страницы подтверждают роль «живой» записью из БД, а не только JWT", () => {
    // H-01: страница /admin/users доверяла session.user.role и принимала claim,
    // попавший в токен при сбое сверки с БД.
    for (const page of ["src/app/admin/layout.tsx", "src/app/admin/users/page.tsx"]) {
      const source = readSource(page);
      assert.match(source, /getLiveAdminViewer\(\)/, `${page} не проверяет роль по БД`);
    }

    const viewer = readSource("src/lib/session-viewer.ts");
    assert.match(viewer, /async function getLiveAdminViewer/, "нет живой проверки администратора");
    assert.match(
      viewer,
      /return viewer\.role === "ADMIN" \? viewer : null/,
      "роль администратора не сверяется с БД",
    );
  });

  it("авторитетность токена требует роль, tenant и syncedAt", () => {
    assert.equal(isSessionAuthoritative(syncedToken()), true);
    assert.equal(isSessionAuthoritative({ role: "ADMIN", schoolId: SCHOOL_A, classId: null }), false);
    assert.equal(isSessionAuthoritative({ role: "ADMIN", schoolId: undefined, classId: null, syncedAt: 1 }), false);
    assert.equal(isSessionAuthoritative({ schoolId: SCHOOL_A, classId: null, syncedAt: 1 }), false);
  });
});

/* -------------------------------------------------------------------------- */
/* C-01. Invite-токены                                                         */
/* -------------------------------------------------------------------------- */

describe("C-01: публичная инициализация не возвращает известный admin-токен", () => {
  it("provisioning заполняет только отсутствующие токены", () => {
    const rotated = provisioningInviteData({
      code: "Sinlycem26",
      teacherInviteToken: "teacher-token",
      adminInviteToken: "ротированный-админом-токен",
    });
    assert.deepEqual(rotated, {});

    const missing = provisioningInviteData({ code: "Sinlycem26", teacherInviteToken: null, adminInviteToken: "a" });
    assert.deepEqual(Object.keys(missing), ["teacherInviteToken"]);
  });

  it("возврат к предустановленному значению выключен по умолчанию", () => {
    assert.equal(configuredInviteTokensRestored(), false);
  });

  it("публичные пути больше не импортируют configuredSchoolInviteData", () => {
    const check = readSource("src/app/api/schools/check/route.ts");
    assert.ok(
      !check.includes("configuredSchoolInviteData"),
      "публичный /api/schools/check не должен откатывать admin-токен к пресету",
    );
    assert.match(check, /provisioningInviteData/, "нет безопасного досыпания токенов");

    const schools = readSource("src/lib/schools.ts");
    assert.ok(
      !schools.includes("configuredSchoolInviteData("),
      "startup provisioning не должен перетирать ротированный admin-токен",
    );
    assert.match(schools, /provisioningInviteData\(/);
  });

  it("endpoint проверки школы не отдаёт токены наружу", () => {
    const check = readSource("src/app/api/schools/check/route.ts");
    const body = check.slice(check.indexOf("return NextResponse.json({\n    valid: true"));
    assert.ok(!body.includes("InviteToken"), "токены приглашения утекли в JSON ответа");
    assert.match(check, /resolveInviteRole\(school,/, "уровень ссылки считается на сервере");
  });
});

/* -------------------------------------------------------------------------- */
/* C-02. Гарантированные демо-админы                                           */
/* -------------------------------------------------------------------------- */

describe("C-02: пароль администратора не перетирается при старте", () => {
  it("provisioning обновляет профиль, но не сбрасывает пароль без явного флага", () => {
    const schools = readSource("src/lib/schools.ts");
    const fn = schools.slice(schools.indexOf("async function ensureGuaranteedAdmin"));
    const end = fn.indexOf("let defaultSchoolPromise");
    const body = fn.slice(0, end > 0 ? end : undefined);

    assert.match(body, /if \(!existing\)/, "создание должно быть условным");
    assert.match(body, /demoAdminPasswordResetEnabled\(\)/, "сброс пароля только по флагу оператора");

    // Хеш пароля пишется ровно дважды: при создании аккаунта и в ветке
    // явного сброса. Безусловного «перетёрли пароль при каждом старте» нет.
    const hashWrites = body.match(/password: bcryptjs\.hashSync\(admin\.password/g)?.length ?? 0;
    assert.equal(hashWrites, 2, "пароль должен писаться только при создании и при явном сбросе");

    const updateBranch = body.slice(body.indexOf("const data = demoAdminPasswordResetEnabled()"));
    assert.match(updateBranch, /password: bcryptjs\.hashSync/);
  });

  it("пароли демо-админов можно переопределить переменной окружения", () => {
    const config = readSource("src/lib/school-config.ts");
    assert.match(config, /SCHOOLMEET_DEMO_ADMIN_PASSWORDS/);
    assert.match(config, /SCHOOLMEET_DISABLE_DEMO_ADMIN_SEED/);
    // Пароли не печатаются в лог.
    const schools = readSource("src/lib/schools.ts");
    assert.ok(
      !/console\.(log|warn|error)\([^)]*admin\.password/.test(schools),
      "пароль демо-админа попадает в лог",
    );
  });

  it("сид не печатает пароль демо-аккаунтов", () => {
    const seed = readSource("prisma/seed.ts");
    assert.ok(!/пароль: \$\{SEED_PASSWORD\}/.test(seed), "сид печатает пароль в лог");
  });

  it("публичные документы не содержат пароль гарантированного администратора", () => {
    const readme = readSource("README.md");
    const deployment = readSource("DEPLOYMENT.md");
    for (const doc of [readme, deployment]) {
      assert.ok(!doc.includes("Admin123!"), "README/DEPLOYMENT всё ещё публикуют демо-пароль");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* H-03. Изоляция объявлений по школе                                          */
/* -------------------------------------------------------------------------- */

describe("H-03: объявления изолированы по школе", () => {
  it("модель Announcement содержит schoolId, связь и индекс", () => {
    const schema = readSource("prisma/schema.prisma");
    const model = schema.slice(schema.indexOf("model Announcement {"));
    const body = model.slice(0, model.indexOf("\n}"));
    assert.match(body, /schoolId\s+String\?/, "нет schoolId у Announcement");
    assert.match(body, /school\s+School\?\s+@relation\(fields: \[schoolId\]/, "нет связи со школой");
    assert.match(body, /@@index\(\[schoolId,/, "нет индекса по школе");
  });

  it("каждая операция модуля фильтруется по школе сессии", () => {
    const source = readSource("src/lib/announcements.ts");

    // Единственная точка формирования фильтра и проверка на отсутствие школы.
    assert.match(source, /function tenantWhere\(schoolId/, "нет общей функции фильтра тенанта");
    assert.match(source, /if \(!schoolId\) throw tenantRequired\(\)/, "отсутствие школы не запрещает доступ");

    const calls = [...source.matchAll(/prisma\.announcement\.(findMany|findFirst|updateMany|deleteMany|create)\(/g)];
    assert.ok(calls.length >= 5, "не удалось найти вызовы Prisma по объявлениям");
    for (const call of calls) {
      const start = call.index ?? 0;
      const chunk = source.slice(start, start + 600);
      assert.match(chunk, /tenantWhere\(/, `${call[1]} уходит в базу без фильтра по школе`);
    }

    // create пишет schoolId из сессии.
    assert.match(source, /schoolId: tenantWhere\(params\.schoolId\)\.schoolId/, "create не проставляет школу");

    // findUnique по одному id больше не используется (он не фильтрует школу).
    assert.ok(
      !/prisma\.announcement\.findUnique\(/.test(source),
      "findUnique по id не фильтрует tenant — используйте findFirst с tenantWhere",
    );
  });

  it("API и страницы берут школу только из сессии", () => {
    const publicRoute = readSource("src/app/api/announcements/route.ts");
    assert.match(publicRoute, /requireSchoolViewer\(\)/, "публичный список объявлений не требует школу");

    const adminRoute = readSource("src/app/api/admin/announcements/route.ts");
    assert.match(adminRoute, /requireSchoolViewer\(\)/);
    assert.match(adminRoute, /schoolId: viewer\.schoolId/);
    assert.ok(!/schoolId:\s*(raw|body|payload)/.test(adminRoute), "школа берётся из тела запроса");

    const adminItemRoute = readSource("src/app/api/admin/announcements/[id]/route.ts");
    assert.ok((adminItemRoute.match(/viewer\.schoolId/g)?.length ?? 0) >= 4, "PATCH/DELETE не фильтруют школу");

    const dashboard = readSource("src/lib/dashboard-data.ts");
    assert.match(dashboard, /schoolId: activeViewer\.schoolId/, "кабинет не передаёт школу зрителя");
  });

  it("старые объявления без школы привязываются к школе автора при старте", () => {
    const schools = readSource("src/lib/schools.ts");
    assert.match(schools, /async function backfillAnnouncementSchools/, "нет досыпания tenant у объявлений");
    assert.match(schools, /await backfillAnnouncementSchools\(db\)/, "досыпание не вызывается при старте");
  });
});

/* -------------------------------------------------------------------------- */
/* Утечки секретов в клиент                                                    */
/* -------------------------------------------------------------------------- */

describe("секреты не попадают в клиентский бандл", () => {
  it("school-config не импортируется клиентскими компонентами", () => {
    const config = readSource("src/lib/school-config.ts");
    assert.ok(config.includes("SCHOOLMEET_ADMIN_INVITE_TOKENS"), "нет переопределения токенов через env");

    for (const candidate of CLIENT_SOURCES) {
      const source = readSource(candidate);
      for (const forbidden of ["@/lib/school-config", "@/lib/invite-tokens"]) {
        assert.ok(
          !source.includes(forbidden),
          `${candidate} импортирует серверный модуль секретов ${forbidden}`,
        );
      }
    }
  });

  it("клиентские компоненты не получают invite-токены иначе как из админ-панели", () => {
    // Панель ссылок-приглашений — единственное место, где токены уходят в
    // браузер, и только администратору школы (серверный рендер /admin).
    const panel = readSource("src/components/admin/invite-links-panel.tsx");
    assert.match(panel, /adminInviteToken/, "панель приглашений должна показывать ссылку администратору");

    for (const candidate of CLIENT_SOURCES.filter((path) => !path.includes("invite-links-panel"))) {
      const source = stripComments(readSource(candidate));
      assert.ok(
        !/adminInviteToken|teacherInviteToken|GUARANTEED_ADMINS/.test(source),
        `${candidate} содержит секреты приглашений`,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Прочие контракты (H-05, H-06)                                               */
/* -------------------------------------------------------------------------- */

describe("сборка не меняет схему БД и сессии отзываются", () => {
  it("build не запускает prisma db push с разрешением потери данных", () => {
    const pkg = readSource("package.json");
    const parsed = JSON.parse(pkg) as { scripts: Record<string, string> };
    assert.ok(
      !parsed.scripts.build.includes("--accept-data-loss"),
      "build по-прежнему меняет схему БД с риском потери данных (H-05)",
    );
    assert.ok(!parsed.scripts.build.includes("db push"), "build не должен накатывать схему");
  });

  it("смена пароля/роли поднимает sessionVersion и рвёт сокеты", () => {
    const schema = readSource("prisma/schema.prisma");
    const userModel = schema.slice(schema.indexOf("model User {"), schema.indexOf("model Meeting {"));
    assert.match(userModel, /sessionVersion\s+Int\s+@default\(0\)/, "нет версии сессии у пользователя");

    const adminUsers = readSource("src/lib/admin-users.ts");
    assert.match(adminUsers, /sessionVersion: \{ increment: 1 \}/, "смена пароля/роли не отзывает сессии (H-06)");

    const patchRoute = readSource("src/app/api/admin/users/[id]/route.ts");
    assert.match(patchRoute, /sessionsRevoked/, "PATCH пользователя не отзывает сессии");
    assert.match(patchRoute, /disconnectUser\(user\.id/, "активные сокеты не разрываются");

    const promote = readSource("src/app/api/auth/promote/route.ts");
    assert.match(promote, /sessionVersion: \{ increment: 1 \}/, "повышение до ADMIN не отзывает старые токены");
  });

  it("join-room проверяет доступ до socket.join, а handshake несёт класс ученика", () => {
    const realtime = readSource("src/server/realtime.ts");
    const joinIndex = realtime.indexOf('socket.on("join-room"');
    const joinBody = realtime.slice(joinIndex, realtime.indexOf('socket.on("leave-room"'));

    assert.ok(joinBody.indexOf("checkMeetingAccess(meeting") < joinBody.indexOf("socket.join(roomId)"), "проверка выполняется после входа в комнату");
    assert.match(realtime, /classId: dbUser\.classId \?\? null/, "handshake не читает класс ученика из БД");
    assert.match(realtime, /CLASS_FORBIDDEN/, "нет отдельного кода отказа для чужого класса");
  });
});
