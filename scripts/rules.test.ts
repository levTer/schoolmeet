/**
 * Тесты чистых правил расписания и домашних заданий.
 * Запуск: `npm run test:rules`. База данных и сеть не нужны.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatSchoolLocalInput,
  schoolLocalToDate,
  findLiveLesson,
  findNextLesson,
  formatMinutes,
  getLessonStatus,
  getSchoolClock,
  parseTime,
  slotsOverlap,
  validateCreateLesson,
  validateLessonTimes,
  type SchoolClock,
} from "../src/lib/schedule-rules";
import {
  findAllowedFileType,
  formatTimeLeft,
  getDeadlineIndicator,
  matchesFileSignature,
  parseGrade,
  sanitizeFileName,
  validateAnswer,
  validateCreateHomework,
} from "../src/lib/homework-rules";
import { MockAIProvider } from "../src/lib/ai-provider";
import { getPasswordIssues, normalizeEmail, validateRegisterInput } from "../src/lib/validation";
import { hashPassword, verifyPassword } from "../src/lib/password";
import { gradeFromClassName, normalizeClassName, normalizeSchoolCode } from "../src/lib/school-rules";
import {
  CONFIGURED_ADMIN_INVITE_TOKENS,
  CONFIGURED_SCHOOLS,
  DEFAULT_CLASS_NAMES,
  DEFAULT_SCHOOL,
  GUARANTEED_ADMINS,
  GUARANTEED_ADMIN,
  configuredAdminInviteToken,
  generateBootstrapPassword,
} from "../src/lib/school-config";
import {
  inviteAllowsRole,
  normalizeInviteToken,
  resolveInviteRole,
  rolesForInvite,
} from "../src/lib/invite-rules";
import {
  configuredSchoolInviteData,
  generateInviteToken,
  hasInviteTokenChanges,
  inviteTokensForNewSchool,
  missingInviteTokens,
} from "../src/lib/invite-tokens";
import { buildSchoolRoomId, hasSchoolAccess } from "../src/lib/realtime";
import { buildDashboardFallback, viewerFromClaims, withDeadline } from "../src/lib/dashboard-fallback";
import {
  CLASS_CODE_GRANT_TTL_MS,
  generateClassCode,
  normalizeClassCode,
  signClassCodeGrant,
  verifyClassCodeGrant,
} from "../src/lib/class-code";

const lesson = (dayOfWeek: number, startTime: string, endTime: string, id = `${dayOfWeek}-${startTime}`) => ({
  id,
  dayOfWeek,
  startTime,
  endTime,
});

const clock = (dayOfWeek: number, time: string): SchoolClock => ({ dayOfWeek: dayOfWeek as SchoolClock["dayOfWeek"], minutes: parseTime(time)! });

describe("коды школ и названия классов", () => {
  it("нормализует коды школ, включая точку, и отвергает некорректные", () => {
    assert.equal(normalizeSchoolCode(" school1 "), "SCHOOL1");
    assert.equal(normalizeSchoolCode(" Anna.Terentieva77 "), "ANNA.TERENTIEVA77");
    assert.equal(normalizeSchoolCode("AB"), null);
    assert.equal(normalizeSchoolCode("school code"), null);
  });

  it("содержит три точных секрета и стандартные классы 5-А … 11-Б", () => {
    // Лицей Сингулярити — строгая изоляция классов, остальные школы — гибкие.
    assert.deepEqual(CONFIGURED_SCHOOLS, [
      { name: "Лицей Сингулярити", code: "Sinlycem26", strictClassIsolation: true },
      { name: "Fullhouse Teem  ", code: "Fulhouseteem26", strictClassIsolation: false },
      { name: "Школа Душа", code: "Anna.Terentieva77", strictClassIsolation: false },
    ]);
    assert.deepEqual(DEFAULT_CLASS_NAMES, [
      "5-А", "5-Б", "6-А", "6-Б", "7-А", "7-Б", "8-А", "8-Б", "9-А", "9-Б", "10-А", "10-Б", "11-А", "11-Б",
    ]);
  });

  it("строит Socket.IO-комнату с tenant namespace и не допускает чужую школу", () => {
    assert.equal(buildSchoolRoomId("school-a", "lesson-123"), "room:school-a:lesson-123");
    assert.notEqual(buildSchoolRoomId("school-a", "lesson-123"), buildSchoolRoomId("school-b", "lesson-123"));
    assert.equal(hasSchoolAccess("school-a", "school-a"), true);
    assert.equal(hasSchoolAccess("school-a", "school-b"), false);
    assert.equal(hasSchoolAccess("school-a", null), false);
  });

  it("нормализует названия классов и определяет параллель", () => {
    assert.equal(normalizeClassName(" 7 - в "), "7-В");
    assert.equal(gradeFromClassName("11-Б"), "GRADE_11");
    assert.equal(gradeFromClassName("12-А"), null);
  });
});

describe("регистрация со школой и классом", () => {
  const valid = {
    name: "Анна Иванова",
    email: "anna@example.ru",
    password: "School123",
    role: "STUDENT",
    schoolCode: "school1",
    classId: "class-5a",
  };

  it("нормализует код школы и требует класс ученику", () => {
    const result = validateRegisterInput(valid);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.schoolCode, "SCHOOL1");
      assert.equal(result.data.classId, "class-5a");
    }

    const punctuatedCode = validateRegisterInput({ ...valid, schoolCode: "Anna.Terentieva77" });
    assert.equal(punctuatedCode.ok, true);
    if (punctuatedCode.ok) assert.equal(punctuatedCode.data.schoolCode, "ANNA.TERENTIEVA77");

    const missingClass = validateRegisterInput({ ...valid, classId: "" });
    assert.equal(missingClass.ok, false);
    if (!missingClass.ok) assert.ok(missingClass.fields.classId);
  });

  it("гибкая школа: класс ученику необязателен (classId = null)", () => {
    // Строгая школа (по умолчанию) — по-прежнему требует класс.
    const strict = validateRegisterInput({ ...valid, classId: "" });
    assert.equal(strict.ok, false, "без опции класс обязан быть");

    // Гибкая школа (strictClassIsolation === false) — класс не нужен.
    const flexible = validateRegisterInput({ ...valid, classId: "" }, { classIdOptional: true });
    assert.equal(flexible.ok, true, "в гибкой школе класс должен быть необязателен");
    if (flexible.ok) assert.equal(flexible.data.classId, null, "пустой класс должен становиться null");

    // Класс, если указан, сохраняется.
    const withClass = validateRegisterInput(valid, { classIdOptional: true });
    assert.equal(withClass.ok, true);
    if (withClass.ok) assert.equal(withClass.data.classId, "class-5a");

    // Учителю класс не нужен независимо от политики школы.
    const teacher = validateRegisterInput({ ...valid, role: "TEACHER", classId: null }, { classIdOptional: true });
    assert.equal(teacher.ok, true);
    if (teacher.ok) assert.equal(teacher.data.classId, null);
  });

  it("требует код школы и не принимает класс учителю", () => {
    const missingCode = validateRegisterInput({ ...valid, schoolCode: "" });
    assert.equal(missingCode.ok, false);
    if (!missingCode.ok) assert.ok(missingCode.fields.schoolCode);

    const teacherWithClass = validateRegisterInput({ ...valid, role: "TEACHER", classId: "class-5a" });
    assert.equal(teacherWithClass.ok, false);
    if (!teacherWithClass.ok) assert.ok(teacherWithClass.fields.classId);
  });

  it("по умолчанию не выдаёт ADMIN и TEACHER, но разрешает их по allowedRoles приглашения", () => {
    // Без приглашения (allowedRoles по умолчанию) ADMIN недоступен.
    const adminAttempt = validateRegisterInput({ ...valid, role: "ADMIN", classId: "" });
    assert.equal(adminAttempt.ok, false);
    if (!adminAttempt.ok) assert.ok(adminAttempt.fields.role);

    // Ссылка администратора: ADMIN регистрируется без класса.
    const viaAdminInvite = validateRegisterInput(
      { ...valid, role: "ADMIN", classId: "" },
      { allowedRoles: ["STUDENT", "TEACHER", "ADMIN"] },
    );
    assert.equal(viaAdminInvite.ok, true);
    if (viaAdminInvite.ok) {
      assert.equal(viaAdminInvite.data.role, "ADMIN");
      assert.equal(viaAdminInvite.data.classId, null);
    }

    // Ссылка учителя: TEACHER доступен, ADMIN — нет.
    const viaTeacherInvite = validateRegisterInput(
      { ...valid, role: "TEACHER", classId: null },
      { allowedRoles: ["STUDENT", "TEACHER"] },
    );
    assert.equal(viaTeacherInvite.ok, true);
    if (viaTeacherInvite.ok) assert.equal(viaTeacherInvite.data.role, "TEACHER");

    const adminViaTeacherInvite = validateRegisterInput(
      { ...valid, role: "ADMIN", classId: "" },
      { allowedRoles: ["STUDENT", "TEACHER"] },
    );
    assert.equal(adminViaTeacherInvite.ok, false);
    if (!adminViaTeacherInvite.ok) assert.ok(adminViaTeacherInvite.fields.role);
  });
});

describe("нормализация email и пароли (вход/регистрация)", () => {
  const valid = {
    name: "Анна Иванова",
    email: "anna@example.ru",
    password: "School123",
    role: "STUDENT",
    schoolCode: "Sinlycem26",
    classId: "class-5a",
  };

  it("приводит email к нижнему регистру без пробелов — одинаково на входе и в регистрации", () => {
    // То же, что и `email.toLowerCase().trim()` в register route и authorize.
    assert.equal(normalizeEmail(" Ivan@School.RU "), "ivan@school.ru");
    assert.equal(normalizeEmail("IVAN@SCHOOL.RU"), "ivan@school.ru");

    const result = validateRegisterInput({ ...valid, email: " Anna@School.RU " });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.email, "anna@school.ru");
  });

  it("хеширует пароль bcryptjs с 10 раундами и сверяет compare", async () => {
    const hash = await hashPassword("Admin123!");

    assert.notEqual(hash, "Admin123!");
    // Формат bcrypt-хеша: $2b$10$ + соль + свёртка — стоимость 10 раундов.
    assert.match(hash, /^\$2[aby]\$10\$/);

    assert.equal(await verifyPassword("Admin123!", hash), true);
    assert.equal(await verifyPassword("admin123!", hash), false);
    assert.equal(await verifyPassword("", hash), false);
  });

  it("bootstrap-админы трёх школ не содержат паролей в репозитории", () => {
    assert.deepEqual(
      GUARANTEED_ADMINS.map(({ email, schoolCode, role }) => ({ email, schoolCode, role })),
      [
        { email: "admin@schoolmeet.ru", schoolCode: "Sinlycem26", role: "ADMIN" },
        { email: "fullhouse@schoolmeet.ru", schoolCode: "Fulhouseteem26", role: "ADMIN" },
        { email: "anna@schoolmeet.ru", schoolCode: "Anna.Terentieva77", role: "ADMIN" },
      ],
    );

    for (const admin of GUARANTEED_ADMINS) {
      assert.equal(normalizeEmail(admin.email), admin.email);
      assert.equal(admin.role, "ADMIN");
      assert.ok(CONFIGURED_SCHOOLS.some((school) => school.code === admin.schoolCode));
      // Пароль задаётся ТОЛЬКО окружением: без переменной его в объекте нет.
      assert.equal("password" in admin, false, "пароль bootstrap-админа зашит в исходник");
    }

    // Основной экспорт сохраняется для потребителей, которым нужен первый админ.
    assert.deepEqual(GUARANTEED_ADMIN, GUARANTEED_ADMINS[0]);
    assert.equal(GUARANTEED_ADMIN.schoolCode, DEFAULT_SCHOOL.code);
  });

  it("одноразовый пароль bootstrap-админа проходит политику и не повторяется", () => {
    const passwords = new Set<string>();
    for (let index = 0; index < 20; index += 1) {
      const password = generateBootstrapPassword();
      assert.equal(getPasswordIssues(password).length, 0, `пароль не проходит политику: ${password}`);
      assert.ok(password.length >= 16, "слишком короткий одноразовый пароль");
      passwords.add(password);
    }
    assert.equal(passwords.size, 20, "генератор выдал повторяющиеся пароли");
  });
});

describe("секретные ссылки-приглашения", () => {
  const school = { teacherInviteToken: "teacher-token-1", adminInviteToken: "admin-sinlycem-2026" };

  it("определяет роль по токену и отвергает чужие и пустые", () => {
    assert.equal(resolveInviteRole(school, "teacher-token-1"), "TEACHER");
    assert.equal(resolveInviteRole(school, "admin-sinlycem-2026"), "ADMIN");
    assert.equal(resolveInviteRole(school, " admin-sinlycem-2026 "), "ADMIN");
    assert.equal(resolveInviteRole(school, "wrong-token"), null);
    assert.equal(resolveInviteRole(school, ""), null);
    assert.equal(resolveInviteRole(school, undefined), null);
    assert.equal(resolveInviteRole({}, "teacher-token-1"), null);
    // При коллизии токенов побеждает более привилегированная роль.
    assert.equal(resolveInviteRole({ teacherInviteToken: "same", adminInviteToken: "same" }, "same"), "ADMIN");
    assert.equal(normalizeInviteToken("  tok  "), "tok");
    assert.equal(normalizeInviteToken(42), "");
  });

  it("выдаёт роли по уровню ссылки: публично — всегда только STUDENT", () => {
    assert.deepEqual([...rolesForInvite(null)], ["STUDENT"]);
    assert.deepEqual([...rolesForInvite("TEACHER")], ["STUDENT", "TEACHER"]);
    assert.deepEqual([...rolesForInvite("ADMIN")], ["STUDENT", "TEACHER", "ADMIN"]);

    assert.equal(inviteAllowsRole(null, "STUDENT"), true);
    assert.equal(inviteAllowsRole(null, "TEACHER"), false);
    assert.equal(inviteAllowsRole(null, "ADMIN"), false);
    assert.equal(inviteAllowsRole("TEACHER", "TEACHER"), true);
    assert.equal(inviteAllowsRole("TEACHER", "ADMIN"), false);
    assert.equal(inviteAllowsRole("ADMIN", "ADMIN"), true);
  });

  it("не хранит предустановленных admin-токенов: только переменная окружения", () => {
    // Карта литералов из репозитория удалена полностью (C-01).
    assert.deepEqual({ ...CONFIGURED_ADMIN_INVITE_TOKENS }, {});
    assert.equal(configuredAdminInviteToken("Sinlycem26"), undefined);
    assert.equal(configuredAdminInviteToken("UnknownSchool"), undefined);

    // Значение приходит из окружения (читается при каждом вызове).
    process.env.SCHOOLMEET_ADMIN_INVITE_TOKENS = JSON.stringify({ Sinlycem26: "rotated-token-from-env" });
    try {
      assert.equal(configuredAdminInviteToken("Sinlycem26"), "rotated-token-from-env");
      assert.equal(configuredAdminInviteToken("sinlycem26"), "rotated-token-from-env");
      assert.equal(configuredAdminInviteToken("Anna.Terentieva77"), undefined);
    } finally {
      delete process.env.SCHOOLMEET_ADMIN_INVITE_TOKENS;
    }
    assert.equal(configuredAdminInviteToken("Sinlycem26"), undefined);
  });
});

/**
 * Токены приглашений в БД nullable (`String? @unique`): обязательную колонку без
 * DB-level default PostgreSQL не даёт добавить в непустую таблицу `schools`,
 * из-за чего `prisma db push` падал на Render. Значения выпускает приложение.
 */
describe("выпуск токенов-приглашений (nullable-колонки)", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it("генерирует случайный UUID-токен", () => {
    const token = generateInviteToken();
    assert.match(token, UUID);
    assert.notEqual(token, generateInviteToken());
  });

  it("создаёт оба токена для новой школы: всегда случайные (пресетов больше нет)", () => {
    for (const code of ["Sinlycem26", "UnknownSchool"]) {
      const tokens = inviteTokensForNewSchool(code);
      assert.match(tokens.adminInviteToken, UUID, "admin-токен должен быть случайным");
      assert.match(tokens.teacherInviteToken, UUID);
      assert.notEqual(tokens.adminInviteToken, tokens.teacherInviteToken);
    }
  });

  it("досоздаёт только отсутствующие токены, пустая строка считается отсутствующей", () => {
    assert.deepEqual(missingInviteTokens({ code: "X", teacherInviteToken: "t", adminInviteToken: "a" }), {});
    assert.equal(hasInviteTokenChanges(missingInviteTokens({ code: "X", teacherInviteToken: "t", adminInviteToken: "a" })), false);

    const onlyTeacher = missingInviteTokens({ code: "X", teacherInviteToken: null, adminInviteToken: "a" });
    assert.deepEqual(Object.keys(onlyTeacher), ["teacherInviteToken"]);
    assert.equal(hasInviteTokenChanges(onlyTeacher), true);

    const both = missingInviteTokens({ code: "Sinlycem26", teacherInviteToken: "", adminInviteToken: undefined });
    assert.deepEqual(Object.keys(both).sort(), ["adminInviteToken", "teacherInviteToken"]);
    assert.match(both.adminInviteToken ?? "", UUID, "досозданный admin-токен должен быть случайным");
  });

  it("без переменной окружения admin-токен НЕ откатывается к пресету", () => {
    // Пресета в репозитории нет → «возврат к предустановленному» ничего не меняет.
    const drifted = configuredSchoolInviteData({
      code: "Sinlycem26",
      teacherInviteToken: "teacher-uuid",
      adminInviteToken: "rotated-token",
    });
    assert.deepEqual(drifted, {});

    const intact = configuredSchoolInviteData({
      code: "Sinlycem26",
      teacherInviteToken: "teacher-uuid",
      adminInviteToken: null,
    });
    // Досоздаётся только случайный токен, а не известное из репозитория значение.
    assert.deepEqual(Object.keys(intact), ["adminInviteToken"]);
    assert.match(intact.adminInviteToken ?? "", UUID);
  });

  it("школа без токенов не выдаёт никакую роль приглашения", () => {
    assert.equal(resolveInviteRole({ teacherInviteToken: null, adminInviteToken: null }, "teacher-token-1"), null);
    assert.equal(resolveInviteRole({ teacherInviteToken: null, adminInviteToken: null }, ""), null);
    // Заполненный после backfill токен снова работает.
    assert.equal(
      resolveInviteRole({ teacherInviteToken: "teacher-uuid", adminInviteToken: null }, "teacher-uuid"),
      "TEACHER",
    );
  });
});

describe("время и пересечения", () => {
  it("разбирает HH:mm и отвергает некорректные строки", () => {
    assert.equal(parseTime("09:45"), 585);
    assert.equal(parseTime("9:45"), null);
    assert.equal(parseTime("24:00"), null);
    assert.equal(parseTime("12:60"), null);
    assert.equal(formatMinutes(585), "09:45");
  });

  it("считает соседние уроки без пересечения, а перекрывающиеся — пересекающимися", () => {
    assert.equal(slotsOverlap(lesson(1, "09:00", "09:45"), lesson(1, "09:45", "10:30")), false);
    assert.equal(slotsOverlap(lesson(1, "09:00", "09:45"), lesson(1, "09:30", "10:15")), true);
    assert.equal(slotsOverlap(lesson(1, "09:00", "09:45"), lesson(2, "09:00", "09:45")), false);
  });

  it("проверяет длительность и границы учебного дня", () => {
    assert.equal(validateLessonTimes("09:00", "09:45"), null);
    assert.match(validateLessonTimes("09:00", "08:00")!, /позже/);
    assert.match(validateLessonTimes("09:00", "09:05")!, /не меньше/);
    assert.match(validateLessonTimes("06:00", "07:00")!, /Уроки проводятся/);
    assert.match(validateLessonTimes("20:30", "21:30")!, /Уроки проводятся/);
  });
});

describe("статусы уроков и «до следующего урока»", () => {
  const lessons = [lesson(1, "09:00", "09:45"), lesson(1, "10:00", "10:45"), lesson(3, "08:30", "09:15")];

  it("«Скоро» за 15 минут до начала, «ИДЁТ СЕЙЧАС» внутри урока, «Завершён» после", () => {
    assert.equal(getLessonStatus(lesson(1, "09:00", "09:45"), clock(1, "08:50")), "soon");
    assert.equal(getLessonStatus(lesson(1, "09:00", "09:45"), clock(1, "08:30")), null);
    assert.equal(getLessonStatus(lesson(1, "09:00", "09:45"), clock(1, "09:20")), "live");
    assert.equal(getLessonStatus(lesson(1, "09:00", "09:45"), clock(1, "09:45")), "finished");
  });

  it("уроки прошедших дней недели — завершены, будущих — без статуса", () => {
    assert.equal(getLessonStatus(lesson(1, "09:00", "09:45"), clock(3, "12:00")), "finished");
    assert.equal(getLessonStatus(lesson(5, "09:00", "09:45"), clock(3, "12:00")), null);
  });

  it("ищет следующий урок сегодня и переходит на следующие дни", () => {
    const next = findNextLesson(lessons, clock(1, "09:50"));
    assert.equal(next?.lesson.startTime, "10:00");
    assert.equal(next?.minutesUntil, 10);

    const afterToday = findNextLesson(lessons, clock(1, "11:00"));
    assert.equal(afterToday?.lesson.dayOfWeek, 3);
    assert.equal(afterToday?.minutesUntil, 2 * 24 * 60 + 8 * 60 + 30 - 11 * 60);
  });

  it("если урок того же дня уже начался, следующим будет тот же слот через неделю", () => {
    const next = findNextLesson([lesson(1, "09:00", "09:45")], clock(1, "09:30"));
    assert.equal(next?.minutesUntil, 7 * 24 * 60 - 30);
  });

  it("возвращает null, когда уроков нет, и находит идущий урок", () => {
    assert.equal(findNextLesson([], clock(1, "09:00")), null);
    assert.equal(findLiveLesson(lessons, clock(1, "09:10"))?.startTime, "09:00");
    assert.equal(findLiveLesson(lessons, clock(1, "09:50")), null);
  });

  it("часы школы считают день недели и время в заданном часовом поясе", () => {
    // 2026-10-11 00:30 UTC — воскресенье, 03:30 по Москве (понедельник 12-го по UTC+3 не наступил — это ещё воскресенье 11-го)
    const date = new Date("2026-10-11T00:30:00Z");
    assert.deepEqual(getSchoolClock(date, "Europe/Moscow"), { dayOfWeek: 7, minutes: 3 * 60 + 30 });
    assert.deepEqual(getSchoolClock(date, "UTC"), { dayOfWeek: 7, minutes: 30 });
  });
});

describe("валидация создания урока", () => {
  const valid = {
    subjectId: "subj-1",
    classId: "class-8a",
    grade: "GRADE_8",
    dayOfWeek: 2,
    startTime: "09:00",
    endTime: "09:45",
    room: "  каб. 204 ",
  };

  it("принимает корректный урок и обрезает комнату", () => {
    const result = validateCreateLesson(valid);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.room, "каб. 204");
  });

  it("возвращает ошибки по полям", () => {
    const result = validateCreateLesson({ ...valid, grade: "GRADE_12", dayOfWeek: 9, subjectId: "" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.fields?.grade);
      assert.ok(result.fields?.dayOfWeek);
      assert.ok(result.fields?.subjectId);
    }
  });

  it("пустая комната допустима и становится null", () => {
    const result = validateCreateLesson({ ...valid, room: "" });
    assert.equal(result.ok && result.data.room, null);
  });
});

describe("локальное время школы", () => {
  it("переводит время школы в UTC (Москва = UTC+3, без перехода на летнее время)", () => {
    assert.equal(schoolLocalToDate("2026-10-13T18:00", "Europe/Moscow")?.toISOString(), "2026-10-13T15:00:00.000Z");
    assert.equal(schoolLocalToDate("2026-10-13T18:00", "UTC")?.toISOString(), "2026-10-13T18:00:00.000Z");
    assert.equal(schoolLocalToDate("13.10.2026 18:00", "UTC"), null);
  });

  it("обратное преобразование даёт то же локальное значение", () => {
    const date = new Date("2026-10-13T15:00:00Z");
    assert.equal(formatSchoolLocalInput(date, "Europe/Moscow"), "2026-10-13T18:00");
  });
});

describe("индикаторы дедлайна", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const after = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

  it("🟢 больше 24 ч, 🟡 меньше 24 ч, 🔴 меньше 1 ч, ⚫ просрочено", () => {
    assert.equal(getDeadlineIndicator(after(25 * 60), now).emoji, "🟢");
    assert.equal(getDeadlineIndicator(after(23 * 60), now).emoji, "🟡");
    assert.equal(getDeadlineIndicator(after(59), now).emoji, "🔴");
    assert.equal(getDeadlineIndicator(after(-1), now).emoji, "⚫");
  });

  it("граница 24 часа относится к жёлтому, а не к зелёному", () => {
    assert.equal(getDeadlineIndicator(after(24 * 60), now).tone, "soon");
    assert.equal(getDeadlineIndicator(after(60), now).tone, "soon");
  });

  it("формирует понятную подпись оставшегося времени", () => {
    assert.equal(formatTimeLeft(45), "осталось 45 мин");
    assert.equal(formatTimeLeft(135), "осталось 2 ч 15 мин");
    assert.equal(formatTimeLeft(-90), "просрочено на 1 ч 30 мин");
  });
});

describe("валидация домашних заданий", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const valid = {
    title: "Квадратные уравнения",
    description: "Решите уравнение x^2 = 4 и опишите шаги.",
    subjectId: "subj-1",
    classId: "class-8a",
    grade: "GRADE_8",
    deadline: "2026-10-13T12:00:00Z",
  };

  it("принимает корректное задание и ставит 5 баллов по умолчанию", () => {
    const result = validateCreateHomework(valid, now);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.maxScore, 5);
  });

  it("требует указать конкретный класс школы", () => {
    const result = validateCreateHomework({ ...valid, classId: " " }, now);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.fields?.classId);
  });

  it("отвергает дедлайн в прошлом и слишком короткое условие", () => {
    const result = validateCreateHomework({ ...valid, description: "коротко", deadline: "2026-10-10T12:00:00Z" }, now);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.fields?.description);
      assert.ok(result.fields?.deadline);
    }
  });

  it("оценка — целое число в пределах максимума", () => {
    assert.equal(parseGrade(4, 5), 4);
    assert.equal(parseGrade("3", 5), 3);
    assert.equal(parseGrade(6, 5), null);
    assert.equal(parseGrade(3.5, 5), null);
    assert.equal(parseGrade(0, 5), null);
  });

  it("ограничивает длину ответа", () => {
    assert.equal(validateAnswer("ок").ok, true);
    assert.equal(validateAnswer("а".repeat(20_001)).ok, false);
    assert.equal(validateAnswer(42).ok, false);
  });
});

describe("файлы домашних заданий", () => {
  it("разрешает только известные форматы и проверяет сигнатуру", () => {
    const pdf = findAllowedFileType("Работа.PDF");
    assert.ok(pdf);
    assert.equal(matchesFileSignature(pdf, new TextEncoder().encode("%PDF-1.7 ...")), true);
    // Исполняемый файл, переименованный в PDF, не проходит проверку.
    assert.equal(matchesFileSignature(pdf, new Uint8Array([0x7f, 0x45, 0x4c, 0x46])), false);

    assert.equal(findAllowedFileType("script.exe"), null);
    assert.equal(findAllowedFileType("noextension"), null);
  });

  it("текстовые файлы не должны содержать NUL-байтов", () => {
    const txt = findAllowedFileType("ответ.txt");
    assert.ok(txt);
    assert.equal(matchesFileSignature(txt, new TextEncoder().encode("Ответ: 42")), true);
    assert.equal(matchesFileSignature(txt, new Uint8Array([0x41, 0x00, 0x42])), false);
  });

  it("очищает имя файла от путей и опасных символов", () => {
    assert.equal(sanitizeFileName("../../etc/passwd"), "passwd");
    assert.equal(sanitizeFileName('my "file".pdf'), "my _file_.pdf");
  });
});

describe("ИИ-черновик проверки (MockAIProvider)", () => {
  const provider = new MockAIProvider();
  const base = { description: "Задание", maxScore: 5, isLate: false };

  it("пустой ответ без файлов получает 1 и просьбу связаться с учеником", async () => {
    const draft = await provider.reviewHomework({ ...base, answer: "   ", attachmentCount: 0 });
    assert.equal(draft.suggestedGrade, 1);
    assert.match(draft.draftComment, /не содержит/);
  });

  it("оценка всегда в пределах шкалы и детерминирована", async () => {
    const long = Array.from({ length: 120 }, (_, i) => `слово${i}`).join(" ") + " x = 2 + 2";
    const first = await provider.reviewHomework({ ...base, answer: long, attachmentCount: 2 });
    const second = await provider.reviewHomework({ ...base, answer: long, attachmentCount: 2 });
    assert.ok(first.suggestedGrade >= 1 && first.suggestedGrade <= 5);
    assert.equal(first.suggestedGrade, second.suggestedGrade);
    assert.equal(first.draftComment, second.draftComment);
  });

  it("отмечает опоздание и помечает текст как черновик", async () => {
    const draft = await provider.reviewHomework({ ...base, answer: "Ответ 42", attachmentCount: 0, isLate: true });
    assert.match(draft.draftComment, /после дедлайна/);
    assert.match(draft.draftComment, /Это черновик ИИ/);
  });
});

describe("неубиваемый дашборд: fallback и дедлайны секций", () => {
  it("fallback всегда валиден для рендера кабинета", () => {
    const data = buildDashboardFallback();
    assert.deepEqual(data.lessons, []);
    assert.deepEqual(data.urgent, []);
    assert.deepEqual(data.review, { count: 0, items: [] });
    assert.deepEqual(data.announcements, []);
    assert.equal(data.viewer, null);
    // Данных нет — страница честно помечает себя «неполной», но рендерится.
    assert.equal(data.degraded, true);
  });

  it("fallback не делит массивы между вызовами", () => {
    const first = buildDashboardFallback();
    const second = buildDashboardFallback();
    assert.notEqual(first.lessons, second.lessons);
    assert.notEqual(first.review.items, second.review.items);

    first.lessons.push({ id: "lesson" } as never);
    first.review.items.push({ submissionId: "s" } as never);
    assert.equal(second.lessons.length, 0);
    assert.equal(second.review.items.length, 0);
  });

  it("зритель восстанавливается из подписанного токена, когда БД недоступна", () => {
    const viewer = viewerFromClaims({ id: "u1", role: "TEACHER", schoolId: "s1", classId: null });
    assert.deepEqual(viewer, {
      id: "u1",
      role: "TEACHER",
      schoolId: "s1",
      classId: null,
      className: null,
      grade: null,
      isBanned: false,
    });

    // Заблокированный аккаунт остаётся заблокированным даже без запроса к БД.
    assert.equal(viewerFromClaims({ id: "u2", role: "STUDENT", isBanned: true }).isBanned, true);
  });

  it("withDeadline отдаёт результат, если секция успела", async () => {
    const value = await withDeadline(Promise.resolve("расписание"), "быстрая", 200);
    assert.equal(value, "расписание");
  });

  it("withDeadline возвращает null на «зависшем» запросе вместо вечного ожидания", async () => {
    const never = new Promise<string>(() => undefined);
    const value = await withDeadline(never, "зависшая", 20);
    assert.equal(value, null);
  });

  it("withDeadline пробрасывает ошибку секции наружу (её ловит try/catch страницы)", async () => {
    await assert.rejects(
      withDeadline(Promise.reject(new Error("P2028 при homework.updateMany")), "ошибка", 200),
      /P2028/,
    );
  });

  it("поздняя ошибка брошенной секции не превращается в unhandledRejection", async () => {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => seen.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const late = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error("поздний таймаут Neon")), 30);
      });
      assert.equal(await withDeadline(late, "поздняя", 10), null);
      // Даём «брошенному» промиcу время отклониться.
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.deepEqual(seen, []);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("коды классов и разовый допуск (строгие школы)", () => {
  const SECRET = "test-secret";
  const payload = {
    userId: "u-1",
    classId: "class-8b",
    schoolId: "school-a",
    meetingCode: "math-8b-pn-0830",
    issuedAt: 1_000_000,
  };

  it("генерирует читаемый код класса из названия (без дефиса + 5 символов)", () => {
    const code = generateClassCode("8-Б");
    assert.match(code, /^8B-[A-Z2-9]{5}$/);
    // Криптослучайный суффикс: два вызова дают разные коды.
    assert.notEqual(generateClassCode("8-Б"), generateClassCode("8-Б"));
    // Особый случай: пустое/символьное название не ломает формат.
    assert.match(generateClassCode(""), /^CLASS-[A-Z2-9]{5}$/);
  });

  it("нормализует введённый код класса (регистр, пробелы)", () => {
    assert.equal(normalizeClassCode(" 8b-k7qzm4 "), "8B-K7QZM4");
    assert.equal(normalizeClassCode(42), "");
    assert.equal(normalizeClassCode(null), "");
  });

  it("подписывает допуск и проверяет подпись + привязку (round-trip)", () => {
    const token = signClassCodeGrant(payload, SECRET);
    assert.match(token, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const now = payload.issuedAt + 1000;
    assert.equal(
      verifyClassCodeGrant(token, SECRET, { userId: "u-1", classId: "class-8b", meetingCode: "math-8b-pn-0830" }, { now }),
      true,
      "корректный допуск отклонён",
    );
  });

  it("отвергает подменённый payload (HMAC не сходится)", () => {
    const forged = signClassCodeGrant({ ...payload, userId: "u-attacker" }, SECRET);
    // Переподписывать не дадут: секрет неизвестен атакующему.
    const tamperedBody = forged.split(".")[1];
    const tampered = `v1.${tamperedBody}.deadbeef`;
    assert.equal(
      verifyClassCodeGrant(tampered, SECRET, { userId: "u-attacker", classId: "class-8b", meetingCode: "math-8b-pn-0830" }, { now: payload.issuedAt }),
      false,
    );
    // Даже верная подпись, но чужой класс — отказ.
    assert.equal(
      verifyClassCodeGrant(forged, SECRET, { userId: "u-1", classId: "class-9a", meetingCode: "math-8b-pn-0830" }, { now: payload.issuedAt }),
      false,
    );
  });

  it("отвергает допуск с другим секретом, битую версию и другой meetingCode", () => {
    const token = signClassCodeGrant(payload, SECRET);
    assert.equal(verifyClassCodeGrant(token, "other-secret", { userId: "u-1", classId: "class-8b", meetingCode: "math-8b-pn-0830" }, { now: payload.issuedAt }), false);
    assert.equal(verifyClassCodeGrant(`v9.${token.split(".")[1]}.${token.split(".")[2]}`, SECRET, { userId: "u-1", classId: "class-8b", meetingCode: "math-8b-pn-0830" }, { now: payload.issuedAt }), false);
    assert.equal(verifyClassCodeGrant(token, SECRET, { userId: "u-1", classId: "class-8b", meetingCode: "other-room" }, { now: payload.issuedAt }), false);
    assert.equal(verifyClassCodeGrant("not-a-token", SECRET, { userId: "u-1", classId: "class-8b", meetingCode: "math-8b-pn-0830" }, { now: payload.issuedAt }), false);
  });

  it("отвергает истёкший допуск и «из будущего»", () => {
    const token = signClassCodeGrant(payload, SECRET);
    const expected = { userId: "u-1", classId: "class-8b", meetingCode: "math-8b-pn-0830" };

    assert.equal(verifyClassCodeGrant(token, SECRET, expected, { now: payload.issuedAt + CLASS_CODE_GRANT_TTL_MS + 1 }), false, "истёкший допуск принят");
    assert.equal(verifyClassCodeGrant(token, SECRET, expected, { now: payload.issuedAt - 120_000 }), false, "допуск из будущего принят");
    assert.equal(verifyClassCodeGrant(token, SECRET, expected, { now: payload.issuedAt + CLASS_CODE_GRANT_TTL_MS - 1000 }), true);
  });
});
