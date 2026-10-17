/**
 * Демо-данные Лицея Сингулярити: пользователи, предметы, расписание и домашние задания.
 *
 * Роль ADMIN нельзя получить через форму регистрации (см. PUBLIC_ROLES),
 * поэтому администратора создаём здесь.
 *
 * Запуск:  npm run db:seed        (после `npm run db:push`)
 * Пароль:  SEED_PASSWORD, по умолчанию "schoolmeet".
 *
 * Расписание и ДЗ создаются только в пустой базе: повторный запуск их не дублирует.
 */
import { randomBytes } from "node:crypto";

import { PrismaClient, type ClassGrade, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";

import { slugifyTitle } from "../src/lib/lesson-code";
import { provisionConfiguredSchools } from "../src/lib/schools";
import { DEFAULT_SCHOOL, DEFAULT_CLASS_NAMES } from "../src/lib/school-config";
import { DEFAULT_SUBJECTS } from "../src/lib/subjects";

const prisma = new PrismaClient();

/** Email-ы совпадают с демо-подсказками в src/lib/demo-accounts.ts. */
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "schoolmeet";

const ACCOUNTS: ReadonlyArray<{ email: string; name: string; role: Role; grade: ClassGrade | null }> = [
  { email: "admin@schoolmeet.dev", name: "Алина Смирнова", role: "ADMIN", grade: null },
  { email: "teacher@schoolmeet.dev", name: "Пётр Кузнецов", role: "TEACHER", grade: null },
  { email: "teacher2@schoolmeet.dev", name: "Ольга Морозова", role: "TEACHER", grade: null },
  { email: "student@schoolmeet.dev", name: "Иван Петров", role: "STUDENT", grade: "GRADE_8" },
  { email: "student8b@schoolmeet.dev", name: "Дарья Волкова", role: "STUDENT", grade: "GRADE_8" },
  { email: "student9@schoolmeet.dev", name: "Мария Соколова", role: "STUDENT", grade: "GRADE_9" },
  { email: "student9b@schoolmeet.dev", name: "Артём Лебедев", role: "STUDENT", grade: "GRADE_9" },
  { email: "student5@schoolmeet.dev", name: "Никита Егоров", role: "STUDENT", grade: "GRADE_5" },
  { email: "student6@schoolmeet.dev", name: "София Ковалёва", role: "STUDENT", grade: "GRADE_6" },
  { email: "student7@schoolmeet.dev", name: "Егор Новиков", role: "STUDENT", grade: "GRADE_7" },
  { email: "student10@schoolmeet.dev", name: "Полина Захарова", role: "STUDENT", grade: "GRADE_10" },
  { email: "student11@schoolmeet.dev", name: "Роман Фёдоров", role: "STUDENT", grade: "GRADE_11" },
];

type TeacherKey = "teacher" | "teacher2";

/** Строка демо-расписания: [день ISO, начало, конец, предмет, учитель, кабинет]. */
type LessonSeed = [number, string, string, string, TeacherKey, string];

/** Учителя не могут вести два урока одновременно, поэтому у 9 класса сдвинуто время. */
const SCHEDULE_SEED: Partial<Record<ClassGrade, LessonSeed[]>> = {
  GRADE_8: [
    [1, "08:30", "09:15", "Математика", "teacher", "каб. 204"],
    [1, "09:25", "10:10", "Русский", "teacher2", "каб. 112"],
    [2, "08:30", "09:15", "Физика", "teacher", "каб. 310"],
    [2, "09:25", "10:10", "Литература", "teacher2", "каб. 112"],
    [3, "08:30", "09:15", "Информатика", "teacher", "компьютерный класс"],
    [4, "08:30", "09:15", "Математика", "teacher", "каб. 204"],
    [4, "09:25", "10:10", "История", "teacher2", "каб. 118"],
    [5, "08:30", "09:15", "Русский", "teacher2", "каб. 112"],
    [5, "09:25", "10:10", "Физика", "teacher", "каб. 310"],
  ],
  GRADE_9: [
    [1, "10:20", "11:05", "Математика", "teacher", "каб. 205"],
    [1, "11:15", "12:00", "Литература", "teacher2", "каб. 112"],
    [2, "10:20", "11:05", "Информатика", "teacher", "компьютерный класс"],
    [3, "10:20", "11:05", "Физика", "teacher", "каб. 310"],
    [3, "11:15", "12:00", "Русский", "teacher2", "каб. 112"],
    [4, "10:20", "11:05", "Математика", "teacher", "каб. 205"],
    [5, "10:20", "11:05", "Физика", "teacher", "каб. 310"],
  ],
};

const SHORT_DAY: Record<number, string> = { 1: "pn", 2: "vt", 3: "sr", 4: "ch", 5: "pt", 6: "sb", 7: "vs" };

/** Задания для демо: дедлайны относительны к моменту запуска сида. */
function homeworkSeed(now: Date) {
  const hours = (value: number) => new Date(now.getTime() + value * 60 * 60 * 1000);
  return [
    {
      title: "Квадратные уравнения",
      subject: "Математика",
      grade: "GRADE_8" as const,
      teacher: "teacher" as const,
      deadline: hours(60),
      maxScore: 5,
      description: `## Задание

Решите уравнения и запишите ход решения.

1. $x^2 - 5x + 6 = 0$
2. $2x^2 + 3x - 2 = 0$

Формула корней:

$$x_{1,2} = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$

> Укажите дискриминант $D$ для каждого уравнения.`,
    },
    {
      title: "Закон Ома для участка цепи",
      subject: "Физика",
      grade: "GRADE_8" as const,
      teacher: "teacher" as const,
      deadline: hours(6),
      maxScore: 5,
      description: `## Задача

Сопротивление проводника $R = 12\\,\\Omega$, напряжение $U = 36\\,\\text{В}$.

Найдите силу тока $I$ по закону Ома $I = \\frac{U}{R}$ и постройте краткое пояснение.`,
    },
    {
      title: "Сочинение-рассуждение",
      subject: "Литература",
      grade: "GRADE_8" as const,
      teacher: "teacher2" as const,
      deadline: hours(0.5),
      maxScore: 5,
      description: `## Тема

Почему герои классической литературы остаются понятными современному читателю?

Объём: 150–200 слов. Используйте один пример из прочитанного произведения.`,
    },
    {
      title: "Производная функции",
      subject: "Математика",
      grade: "GRADE_9" as const,
      teacher: "teacher" as const,
      deadline: hours(-24),
      maxScore: 5,
      description: `## Задание

Найдите производную функции $f(x) = 3x^3 - 2x + 7$ и вычислите $f'(2)$.`,
    },
  ];
}

async function seedAccounts(passwordHash: string, schoolId: string): Promise<void> {
  const classes = await prisma.class.findMany({
    where: { schoolId, name: { in: DEFAULT_CLASS_NAMES } },
    select: { id: true, name: true },
  });
  const classByName = new Map(classes.map((schoolClass) => [schoolClass.name, schoolClass.id]));

  for (const account of ACCOUNTS) {
    const className = account.grade ? `${account.grade.replace("GRADE_", "")}-А` : null;
    const classId = className ? classByName.get(className) ?? null : null;
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: {
        name: account.name,
        role: account.role,
        grade: account.grade,
        password: passwordHash,
        schoolId,
        classId,
      },
      create: { ...account, password: passwordHash, schoolId, classId },
      select: { email: true, role: true, grade: true },
    });
    const gradeText = user.grade ? ` · ${user.grade}` : "";
    // Пароль в лог НЕ печатаем: логи deployment'ов читают не только владельцы,
    // а демо-пароль и так задаётся переменной SEED_PASSWORD (находка C-02).
    console.log(`✓ ${user.role.padEnd(7)} ${user.email}${gradeText}`);
  }
}

async function seedSubjects(): Promise<Map<string, string>> {
  for (const subject of DEFAULT_SUBJECTS) {
    await prisma.subject.upsert({
      where: { name: subject.name },
      update: { color: subject.color, emoji: subject.emoji },
      create: subject,
    });
  }
  const rows = await prisma.subject.findMany({ select: { id: true, name: true } });
  return new Map(rows.map((row) => [row.name, row.id]));
}

async function seedSchedule(
  subjectIds: Map<string, string>,
  teacherIds: Map<TeacherKey, string>,
  schoolId: string,
): Promise<void> {
  if ((await prisma.schedule.count()) > 0) {
    console.log("• Расписание уже есть — пропускаем");
    return;
  }

  const classes = await prisma.class.findMany({
    where: { schoolId, name: { in: DEFAULT_CLASS_NAMES } },
    select: { id: true, name: true },
  });
  const classByName = new Map(classes.map((schoolClass) => [schoolClass.name, schoolClass.id]));

  for (const [grade, lessons] of Object.entries(SCHEDULE_SEED) as [ClassGrade, LessonSeed[]][]) {
    const classId = classByName.get(`${grade.replace("GRADE_", "")}-А`);
    if (!classId) throw new Error(`Нет класса для ${grade} в школе ${DEFAULT_SCHOOL.name}`);

    for (const [dayOfWeek, startTime, endTime, subjectName, teacherKey, room] of lessons) {
      const subjectId = subjectIds.get(subjectName);
      const teacherId = teacherIds.get(teacherKey);
      if (!subjectId || !teacherId) throw new Error(`Нет предмета или учителя для ${subjectName}`);

      const meetingCode = `${slugifyTitle(subjectName)}-${grade.toLowerCase().replace("_", "-")}-${SHORT_DAY[dayOfWeek]}-${startTime.replace(":", "")}`;
      await prisma.meeting.create({
        data: {
          title: `${subjectName} · ${grade}`,
          meetingCode,
          hostId: teacherId,
          schoolId,
          encryptionKey: randomBytes(32).toString("hex"),
        },
      });
      await prisma.schedule.create({
        data: { subjectId, teacherId, grade, schoolId, classId, dayOfWeek, startTime, endTime, room, meetingCode },
      });
    }
  }
  console.log("• Расписание для 8 и 9 классов создано");
}

async function seedHomework(
  subjectIds: Map<string, string>,
  teacherIds: Map<TeacherKey, string>,
  schoolId: string,
): Promise<void> {
  if ((await prisma.homework.count()) > 0) {
    console.log("• Домашние задания уже есть — пропускаем");
    return;
  }

  const classes = await prisma.class.findMany({
    where: { schoolId, name: { in: DEFAULT_CLASS_NAMES } },
    select: { id: true, name: true },
  });
  const classByName = new Map(classes.map((schoolClass) => [schoolClass.name, schoolClass.id]));

  for (const item of homeworkSeed(new Date())) {
    const classId = classByName.get(`${item.grade.replace("GRADE_", "")}-А`);
    if (!classId) throw new Error(`Нет класса для ${item.grade} в школе ${DEFAULT_SCHOOL.name}`);

    await prisma.homework.create({
      data: {
        title: item.title,
        description: item.description,
        subjectId: subjectIds.get(item.subject) ?? "",
        teacherId: teacherIds.get(item.teacher) ?? "",
        grade: item.grade,
        schoolId,
        classId,
        deadline: item.deadline,
        maxScore: item.maxScore,
      },
    });
  }
  console.log("• Демо-задания созданы");
}

/**
 * Детерминированный генератор «случайных» чисел: демо-данные должны
 * выглядеть живыми, но повторный запуск сида обязан давать то же самое.
 */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** Демо-объявления: одно для всей школы и два — для отдельных классов. */
async function seedAnnouncements(adminId: string, schoolId: string): Promise<void> {
  if ((await prisma.announcement.count()) > 0) {
    console.log("• Объявления уже есть — пропускаем");
    return;
  }

  const items: ReadonlyArray<{ title: string; content: string; targetGrade: ClassGrade | null }> = [
    {
      title: "Родительское собрание в пятницу",
      content:
        "В пятницу в 18:00 в актовом зале состоится общешкольное родительское собрание.\nПриходите с вопросами — расскажем про новый формат домашних заданий с ИИ-проверкой.",
      targetGrade: null,
    },
    {
      title: "Пробный экзамен по математике",
      content:
        "В среду на первом уроке пишем пробный вариант ОГЭ. Возьмите с собой черновики и линейку.\nРазбор ошибок — в пятницу на консультации.",
      targetGrade: "GRADE_9",
    },
    {
      title: "Экскурсия в планетарий",
      content:
        "В субботу едем в планетарий: сбор у школы в 10:30, возвращаемся к 15:00.\nЗапишитесь у классного руководителя до четверга.",
      targetGrade: "GRADE_8",
    },
  ];

  for (const item of items) {
    // `schoolId` объявления = школа сида: объявления изолированы по тенантам
    // и не попадают в другие школы (исправление H-03).
    await prisma.announcement.create({ data: { ...item, authorId: adminId, schoolId } });
  }
  console.log("• Демо-объявления созданы (вся школа, 8 и 9 классы)");
}

/**
 * Демо-оценки за домашние задания: без них график «Успеваемость по классам»
 * в админ-панели выглядел бы пустым.
 */
async function seedGradedHomework(schoolId: string): Promise<void> {
  if ((await prisma.homeworkSubmission.count()) > 0) {
    console.log("• Ответы на ДЗ уже есть — пропускаем");
    return;
  }

  const random = createRandom(20261011);
  const homeworks = await prisma.homework.findMany({
    where: { schoolId },
    select: { id: true, grade: true, deadline: true, maxScore: true, classId: true },
  });
  const students = await prisma.user.findMany({
    where: { role: "STUDENT", schoolId, grade: { not: null } },
    select: { id: true, grade: true, classId: true },
  });

  let created = 0;

  for (const homework of homeworks) {
    const classmates = students.filter(
      (student) => student.grade === homework.grade && student.classId === homework.classId,
    );
    for (const student of classmates) {
      const grade = 3 + Math.floor(random() * 3); // 3, 4 или 5 — детерминированно
      const submittedAt = new Date(homework.deadline.getTime() - 90 * 60 * 1000);
      const approvedAt = new Date(homework.deadline.getTime() + 60 * 60 * 1000);

      const submission = await prisma.homeworkSubmission.create({
        data: {
          homeworkId: homework.id,
          studentId: student.id,
          answer: "Решение приложено: использовал формулы из конспекта урока.",
          status: "GRADED",
          draftSavedAt: new Date(submittedAt.getTime() - 3600 * 1000),
          submittedAt,
        },
      });

      await prisma.homeworkReview.create({
        data: {
          submissionId: submission.id,
          reviewerId: (await prisma.homework.findUnique({
            where: { id: homework.id },
            select: { teacherId: true },
          }))?.teacherId ?? student.id,
          grade: Math.min(grade, homework.maxScore),
          comment: "Аккуратно оформлено, есть небольшие замечания по пояснениям.",
          approvedAt,
        },
      });

      created += 1;
    }
  }

  console.log(`• Демо-оценки за ДЗ созданы (${created})`);
}

/**
 * Демо-посещаемость за последние три недели.
 * Используется графиком «Активность звонков по дням недели».
 */
async function seedAttendance(schoolId: string): Promise<void> {
  if ((await prisma.attendanceRecord.count()) > 0) {
    console.log("• Записи посещаемости уже есть — пропускаем");
    return;
  }

  const random = createRandom(42);
  const lessons = await prisma.schedule.findMany({
    where: { schoolId, grade: { in: ["GRADE_8", "GRADE_9"] } },
    select: { grade: true, classId: true, startTime: true, meetingCode: true },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });
  const meetings = await prisma.meeting.findMany({
    where: { meetingCode: { in: lessons.map((lesson) => lesson.meetingCode) } },
    select: { id: true, meetingCode: true },
  });
  const meetingByCode = new Map(meetings.map((meeting) => [meeting.meetingCode, meeting.id]));

  const students = await prisma.user.findMany({
    where: { role: "STUDENT", schoolId, grade: { in: ["GRADE_8", "GRADE_9"] } },
    select: { id: true, grade: true, classId: true },
  });

  const records: {
    meetingId: string;
    userId: string;
    joinedAt: Date;
    leftAt: Date;
    durationMinutes: number;
  }[] = [];

  for (let dayOffset = 20; dayOffset >= 0; dayOffset -= 1) {
    const day = new Date();
    day.setDate(day.getDate() - dayOffset);
    day.setHours(0, 0, 0, 0);

    const weekday = day.getDay();
    if (weekday === 0 || weekday === 6) continue; // занятия только по будням

    for (const lesson of lessons) {
      const meetingId = meetingByCode.get(lesson.meetingCode);
      if (!meetingId) continue;

      const [hours, minutes] = lesson.startTime.split(":").map(Number);
      const joinedAt = new Date(day);
      joinedAt.setHours(hours, minutes + Math.floor(random() * 4), 0, 0);

      // Не показываем «будущие» входы в сегодняшний день.
      if (joinedAt.getTime() > Date.now()) continue;

      for (const student of students) {
        if (student.grade !== lesson.grade || student.classId !== lesson.classId) continue;
        if (random() > 0.75) continue; // кто-то иногда пропускает урок

        const durationMinutes = 20 + Math.floor(random() * 40);
        const leftAt = new Date(joinedAt.getTime() + durationMinutes * 60 * 1000);

        records.push({
          meetingId,
          userId: student.id,
          joinedAt,
          leftAt: leftAt.getTime() > Date.now() ? new Date() : leftAt,
          durationMinutes,
        });
      }
    }
  }

  if (records.length > 0) {
    await prisma.attendanceRecord.createMany({ data: records });
  }

  console.log(`• Демо-посещаемость создана (${records.length} записей)`);
}

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  const schools = await provisionConfiguredSchools(prisma);
  const primarySchool = schools.get(DEFAULT_SCHOOL.code);
  if (!primarySchool) throw new Error(`Не удалось создать школу ${DEFAULT_SCHOOL.name}`);

  await seedAccounts(passwordHash, primarySchool.id);
  const subjectIds = await seedSubjects();

  const teachers = await prisma.user.findMany({
    where: { email: { in: ["teacher@schoolmeet.dev", "teacher2@schoolmeet.dev"] } },
    select: { id: true, email: true },
  });
  const teacherIds = new Map<TeacherKey, string>([
    ["teacher", teachers.find((t) => t.email === "teacher@schoolmeet.dev")?.id ?? ""],
    ["teacher2", teachers.find((t) => t.email === "teacher2@schoolmeet.dev")?.id ?? ""],
  ]);

  await seedSchedule(subjectIds, teacherIds, primarySchool.id);
  await seedHomework(subjectIds, teacherIds, primarySchool.id);

  const admin = await prisma.user.findUnique({
    where: { email: "admin@schoolmeet.dev" },
    select: { id: true },
  });

  await seedAnnouncements(admin?.id ?? teacherIds.get("teacher") ?? "", primarySchool.id);
  await seedGradedHomework(primarySchool.id);
  await seedAttendance(primarySchool.id);

  console.log("\nДемо-данные готовы. Админ-панель: /admin — только для роли ADMIN.");
  console.log(
    `Пароль демо-аккаунтов задан переменной SEED_PASSWORD (в логи он не пишется). Смените его через /admin/users перед продакшеном.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error("Не удалось выполнить сид:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
