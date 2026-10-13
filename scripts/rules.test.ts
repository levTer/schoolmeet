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
  GUARANTEED_ADMIN,
  configuredAdminInviteToken,
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
    assert.deepEqual(CONFIGURED_SCHOOLS, [
      { name: "Лицей Сингулярити", code: "Sinlycem26" },
      { name: "Fullhouse Teem  ", code: "Fulhouseteem26" },
      { name: "Школа Душа", code: "Anna.Terentieva77" },
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

  it("гарантированный демо-админ: нормализованный email, роль ADMIN и школа Sinlycem26", () => {
    assert.equal(GUARANTEED_ADMIN.email, "admin@schoolmeet.ru");
    assert.equal(normalizeEmail(GUARANTEED_ADMIN.email), GUARANTEED_ADMIN.email);
    assert.equal(GUARANTEED_ADMIN.role, "ADMIN");
    assert.equal(GUARANTEED_ADMIN.schoolCode, DEFAULT_SCHOOL.code);
    assert.ok(CONFIGURED_SCHOOLS.some((school) => school.code === GUARANTEED_ADMIN.schoolCode));

    // Пароль демо-админа должен проходить собственную политику формы регистрации.
    assert.equal(getPasswordIssues(GUARANTEED_ADMIN.password).length, 0);
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

  it("задаёт предустановленные admin-токены трёх школ", () => {
    assert.deepEqual({ ...CONFIGURED_ADMIN_INVITE_TOKENS }, {
      Sinlycem26: "admin-sinlycem-2026",
      Fulhouseteem26: "admin-fulhouse-2026",
      "Anna.Terentieva77": "admin-annat-2026",
    });
    assert.equal(configuredAdminInviteToken("Sinlycem26"), "admin-sinlycem-2026");
    assert.equal(configuredAdminInviteToken("sinlycem26"), "admin-sinlycem-2026");
    assert.equal(configuredAdminInviteToken("Anna.Terentieva77"), "admin-annat-2026");
    assert.equal(configuredAdminInviteToken("UnknownSchool"), undefined);
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

  it("создаёт оба токена для новой школы: пресет админа у настроенных, случайные у остальных", () => {
    const configured = inviteTokensForNewSchool("Sinlycem26");
    assert.equal(configured.adminInviteToken, CONFIGURED_ADMIN_INVITE_TOKENS.Sinlycem26);
    assert.match(configured.teacherInviteToken, UUID);

    const custom = inviteTokensForNewSchool("UnknownSchool");
    assert.match(custom.adminInviteToken, UUID);
    assert.match(custom.teacherInviteToken, UUID);
    assert.notEqual(custom.adminInviteToken, custom.teacherInviteToken);
  });

  it("досоздаёт только отсутствующие токены, пустая строка считается отсутствующей", () => {
    assert.deepEqual(missingInviteTokens({ code: "X", teacherInviteToken: "t", adminInviteToken: "a" }), {});
    assert.equal(hasInviteTokenChanges(missingInviteTokens({ code: "X", teacherInviteToken: "t", adminInviteToken: "a" })), false);

    const onlyTeacher = missingInviteTokens({ code: "X", teacherInviteToken: null, adminInviteToken: "a" });
    assert.deepEqual(Object.keys(onlyTeacher), ["teacherInviteToken"]);
    assert.equal(hasInviteTokenChanges(onlyTeacher), true);

    const both = missingInviteTokens({ code: "Sinlycem26", teacherInviteToken: "", adminInviteToken: undefined });
    assert.deepEqual(Object.keys(both).sort(), ["adminInviteToken", "teacherInviteToken"]);
    assert.equal(both.adminInviteToken, CONFIGURED_ADMIN_INVITE_TOKENS.Sinlycem26);
  });

  it("возвращает admin-токен настроенной школы к пресету и не трогает заполненные", () => {
    const drifted = configuredSchoolInviteData({
      code: "Sinlycem26",
      teacherInviteToken: "teacher-uuid",
      adminInviteToken: "случайный-токен-из-старой-базы",
    });
    assert.deepEqual(drifted, { adminInviteToken: CONFIGURED_ADMIN_INVITE_TOKENS.Sinlycem26 });

    const intact = configuredSchoolInviteData({
      code: "Sinlycem26",
      teacherInviteToken: "teacher-uuid",
      adminInviteToken: CONFIGURED_ADMIN_INVITE_TOKENS.Sinlycem26,
    });
    assert.deepEqual(intact, {});
    assert.equal(hasInviteTokenChanges(intact), false);
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
