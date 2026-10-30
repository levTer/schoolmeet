/**
 * «Школа Душа»: один класс вместо параллелей, регистрация без выбора класса
 * и вход в текущий урок в один клик (ОБНОВЛЕНИЕ #76).
 *
 * Проверяем две вещи:
 *  1. чистые правила — набор классов школы и построение карточки живого урока;
 *  2. контракт исходников — onboarding не должен «потерять» автоподстановку
 *     класса, скрытие сетки классов и кнопку прямого входа в комнату.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CLASS_NAMES,
  SINGLE_CLASS_NAME,
  defaultClassNamesForSchool,
  isSingleClassSchool,
} from "../src/lib/school-config";
import { liveLessonFromMeeting, liveLessonFromSchedule } from "../src/lib/live-lesson-rules";
import { canonicalSchoolCode } from "../src/lib/school-rules";
import type { Schedule } from "../src/types";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

describe("единый класс «Школы Душа»", () => {
  it("школа Anna.Terentieva77 одноклассная, остальные — с параллелями", () => {
    assert.equal(isSingleClassSchool("Anna.Terentieva77"), true);
    // Код приходит из формы/ссылки в любом регистре.
    assert.equal(isSingleClassSchool("  anna.terentieva77 "), true);
    assert.equal(isSingleClassSchool("Sinlycem26"), false);
    assert.equal(isSingleClassSchool("Fulhouseteem26"), false);
    assert.equal(isSingleClassSchool(null), false);
  });

  it("короткие коды DUSHA и SOUL ведут в «Школу Душа»", () => {
    assert.equal(canonicalSchoolCode("DUSHA"), "ANNA.TERENTIEVA77");
    assert.equal(canonicalSchoolCode(" soul "), "ANNA.TERENTIEVA77");
    assert.equal(canonicalSchoolCode("Anna.Terentieva77"), "ANNA.TERENTIEVA77");
    assert.equal(canonicalSchoolCode("Sinlycem26"), "SINLYCEM26");
    assert.equal(canonicalSchoolCode("AB"), null);
    // Псевдоним тоже считается одноклассной школой: сетка классов скрыта.
    assert.equal(isSingleClassSchool("DUSHA"), true);
  });

  it("набор классов: ровно один «Общий» вместо 5-А … 11-Б", () => {
    assert.equal(SINGLE_CLASS_NAME, "Общий");
    assert.deepEqual(defaultClassNamesForSchool("Anna.Terentieva77"), [SINGLE_CLASS_NAME]);
    assert.deepEqual(defaultClassNamesForSchool("Sinlycem26"), DEFAULT_CLASS_NAMES);
    assert.equal(defaultClassNamesForSchool("Sinlycem26").length, 14);
  });

  it("provisioning удаляет старые классы и перепривязывает данные школы", () => {
    const schools = readSource("src/lib/schools.ts");
    assert.match(schools, /export async function ensureSchoolClasses/, "нет приведения набора классов школы");
    assert.match(schools, /isSingleClassSchool\(code\)/, "provisioning не знает про одноклассные школы");
    assert.match(schools, /SINGLE_CLASS_NAME/, "не используется название единого класса");
    assert.match(schools, /tx\.user\.updateMany\(/, "пользователи не перепривязываются к классу");
    assert.match(schools, /tx\.schedule\.updateMany\(/, "уроки не перепривязываются к классу");
    assert.match(schools, /tx\.homework\.updateMany\(/, "ДЗ не перепривязываются к классу");
    assert.match(schools, /tx\.class\.deleteMany\(/, "старые классы не удаляются");
    assert.match(schools, /await ensureSchoolClasses\(db,/, "provisioning не вызывает приведение классов");

    const seed = readSource("prisma/seed.ts");
    assert.match(seed, /seedOpenLesson/, "сид не создаёт открытый урок школы");
    assert.match(seed, /isSingleClassSchool\(/, "сид не различает одноклассные школы");
  });

  it("список классов школы включает класс без номера параллели", () => {
    const schools = readSource("src/lib/schools.ts");
    const body = schools.slice(schools.indexOf("export async function listClassesForSchool"));
    assert.doesNotMatch(
      body.slice(0, 900),
      /\.filter\(\(row\): row is SchoolClassOption => row\.grade !== null\)/,
      "классы «Общий» отфильтровываются и выбор класса остаётся пустым",
    );
    assert.match(readSource("src/lib/schools.ts"), /grade: GradeCode \| null/, "тип класса не допускает null-параллель");
  });
});

describe("скрытие выбора класса при регистрации", () => {
  const check = readSource("src/app/api/schools/check/route.ts");
  const form = readSource("src/components/auth/register-form.tsx");
  const register = readSource("src/app/api/auth/register/route.ts");

  it("API проверки школы отдаёт isSingleClass и defaultClassId", () => {
    assert.match(check, /const isSingleClass = isSingleClassSchool\(school\.code\) \|\| classes\.length === 1/, "признак одного класса не считается");
    assert.match(check, /defaultClassId/, "класс по умолчанию не возвращается");
    assert.match(check, /isSingleClass,\n\s+defaultClassId,/, "поля не попадают в верхний уровень ответа");
    assert.match(check, /isSingleClass, defaultClassId \}/, "поля не попадают в data-контракт");
  });

  it("форма прячет сетку классов и подставляет единственный класс", () => {
    assert.match(form, /isSingleClass === true/, "форма не читает признак одного класса");
    assert.match(form, /defaultClassId/, "форма не использует класс по умолчанию");
    assert.match(form, /schoolCheck && isSingleClass \?/, "сетка классов не скрывается для одноклассной школы");
    assert.match(form, /if \(autoClassId\) setClassId\(autoClassId\)/, "класс не подставляется автоматически");
    // Прежний контракт «без класса» для гибких школ остаётся на месте.
    assert.match(form, /Без класса/, "пропал вариант «без класса»");
    assert.match(form, /classId: effectiveRole === "STUDENT" \? classId \|\| null : null/, "изменился контракт отправки classId");
  });

  it("регистрация сама назначает единственный класс и не требует параллель", () => {
    assert.match(register, /resolveSingleClassId/, "роут не ищет класс по умолчанию");
    assert.match(register, /gradeMayBeMissing/, "класс без параллели считается ошибкой");
  });
});

describe("вход в текущий урок в один клик", () => {
  const dashboard = readSource("src/app/dashboard/page.tsx");
  const card = readSource("src/components/dashboard/live-lesson-card.tsx");
  const data = readSource("src/lib/dashboard-data.ts");
  const live = readSource("src/lib/live-lesson.ts");
  const page = readSource("src/app/meeting/page.tsx");

  it("кабинет загружает живой урок и ставит карточку в самый верх", () => {
    assert.match(data, /findLiveLessonForViewer/, "кабинет не ищет урок «прямо сейчас»");
    assert.match(live, /listOpenSchoolMeetings/, "не ищутся открытые комнаты школы");
    assert.match(live, /checkMeetingAccess/, "доступ к комнате не проверяется");
    assert.match(dashboard, /LiveLessonCard lesson=\{liveLesson\}/, "карточка живого урока не рисуется");
    assert.match(dashboard, /data\.liveLesson/, "данные живого урока не читаются");
  });

  it("карточка: пульсирующая красная точка и крупная зелёная кнопка входа", () => {
    assert.match(card, /animate-ping/, "нет пульсирующей красной точки");
    assert.match(card, /bg-rose-500/, "точка не красная");
    assert.match(card, /ПРЯМО СЕЙЧАС ИДЁТ УРОК/, "нет заголовка «идёт урок»");
    assert.match(card, /ВОЙТИ В УРОК ПРЯМО СЕЙЧАС/, "нет кнопки входа в урок");
    assert.match(card, /bg-emerald-400/, "кнопка входа не зелёная");
    assert.match(card, /\/meeting\?room=/, "кнопка ведёт не в комнату урока");
  });

  it("страница /meeting открывает комнату по ?room= и ?lessonId= без ввода кода", () => {
    assert.match(page, /searchParams: Promise<\{ room\?: string; lessonId\?: string \}>/, "страница не принимает прямую ссылку на урок");
    assert.match(page, /const \{ room, lessonId \} = await searchParams/, "searchParams не разворачивается (Next.js 16 требует await)");
    assert.match(page, /redirect\(`\/meeting\/\$\{directRoom\}`\)/, "код комнаты не открывает урок сразу");
    assert.match(page, /findMeetingCodeById/, "id урока не разрешается в код комнаты");
    assert.match(page, /redirect\(`\/meeting\/\$\{code\}`\)/, "id урока не открывает комнату");
  });
});

describe("карточка живого урока: построение из слота и из комнаты", () => {
  it("слот расписания отдаёт предмет, учителя и время", () => {
    const lesson: Schedule = {
      id: "sched-1",
      subjectId: "subject-math",
      teacherId: "teacher-1",
      schoolId: "school-dusha",
      classId: "class-obshiy",
      className: "Общий",
      grade: "GRADE_8",
      dayOfWeek: 3,
      startTime: "10:00",
      endTime: "10:45",
      room: "онлайн",
      meetingCode: "matematika-obshiy",
      subject: { id: "subject-math", name: "Математика", color: "#a855f7", emoji: "📐" },
      teacher: { id: "teacher-1", name: "Анна Терентьева" },
    };

    const card = liveLessonFromSchedule(lesson);
    assert.equal(card.meetingCode, "matematika-obshiy");
    assert.equal(card.subjectName, "Математика");
    assert.equal(card.subjectEmoji, "📐");
    assert.equal(card.teacherName, "Анна Терентьева");
    assert.equal(card.startTime, "10:00");
    assert.equal(card.endTime, "10:45");
    assert.equal(card.origin, "schedule");
  });

  it("открытая комната школы отдаёт название и ведущего", () => {
    const card = liveLessonFromMeeting({
      title: "Открытый урок: Школа Душа",
      meetingCode: "otkrytyy-urok-dusha",
      host: { name: "Анна Терентьева" },
    });
    assert.equal(card.meetingCode, "otkrytyy-urok-dusha");
    assert.equal(card.title, "Открытый урок: Школа Душа");
    assert.equal(card.teacherName, "Анна Терентьева");
    assert.equal(card.startTime, null);
    assert.equal(card.origin, "meeting");
  });
});
