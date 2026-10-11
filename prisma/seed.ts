/**
 * Демо-данные SchoolMeet: пользователи, предметы, расписание и домашние задания.
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

const prisma = new PrismaClient();

/** Email-ы совпадают с демо-подсказками в src/lib/demo-accounts.ts. */
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "schoolmeet";

const ACCOUNTS: ReadonlyArray<{ email: string; name: string; role: Role; grade: ClassGrade | null }> = [
  { email: "admin@schoolmeet.dev", name: "Алина Смирнова", role: "ADMIN", grade: null },
  { email: "teacher@schoolmeet.dev", name: "Пётр Кузнецов", role: "TEACHER", grade: null },
  { email: "teacher2@schoolmeet.dev", name: "Ольга Морозова", role: "TEACHER", grade: null },
  { email: "student@schoolmeet.dev", name: "Иван Петров", role: "STUDENT", grade: "GRADE_8" },
  { email: "student9@schoolmeet.dev", name: "Мария Соколова", role: "STUDENT", grade: "GRADE_9" },
];

const SUBJECTS = [
  { name: "Математика", color: "#a855f7", emoji: "🧮" },
  { name: "Физика", color: "#00b4ff", emoji: "⚡" },
  { name: "Химия", color: "#22c55e", emoji: "🧪" },
  { name: "Литература", color: "#f97316", emoji: "📖" },
  { name: "История", color: "#eab308", emoji: "📜" },
  { name: "Биология", color: "#10b981", emoji: "🌿" },
  { name: "Информатика", color: "#06b6d4", emoji: "💻" },
  { name: "Английский", color: "#3b82f6", emoji: "🇬🇧" },
  { name: "Русский", color: "#ec4899", emoji: "📝" },
  { name: "Физкультура", color: "#ef4444", emoji: "🏃" },
] as const;

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

async function seedAccounts(passwordHash: string): Promise<void> {
  for (const account of ACCOUNTS) {
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: { name: account.name, role: account.role, grade: account.grade, password: passwordHash },
      create: { ...account, password: passwordHash },
      select: { email: true, role: true, grade: true },
    });
    const gradeText = user.grade ? ` · ${user.grade}` : "";
    console.log(`✓ ${user.role.padEnd(7)} ${user.email}${gradeText}  (пароль: ${SEED_PASSWORD})`);
  }
}

async function seedSubjects(): Promise<Map<string, string>> {
  for (const subject of SUBJECTS) {
    await prisma.subject.upsert({
      where: { name: subject.name },
      update: { color: subject.color, emoji: subject.emoji },
      create: subject,
    });
  }
  const rows = await prisma.subject.findMany({ select: { id: true, name: true } });
  return new Map(rows.map((row) => [row.name, row.id]));
}

async function seedSchedule(subjectIds: Map<string, string>, teacherIds: Map<TeacherKey, string>): Promise<void> {
  if ((await prisma.schedule.count()) > 0) {
    console.log("• Расписание уже есть — пропускаем");
    return;
  }

  for (const [grade, lessons] of Object.entries(SCHEDULE_SEED) as [ClassGrade, LessonSeed[]][]) {
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
          encryptionKey: randomBytes(32).toString("hex"),
        },
      });
      await prisma.schedule.create({
        data: { subjectId, teacherId, grade, dayOfWeek, startTime, endTime, room, meetingCode },
      });
    }
  }
  console.log("• Расписание для 8 и 9 классов создано");
}

async function seedHomework(subjectIds: Map<string, string>, teacherIds: Map<TeacherKey, string>): Promise<void> {
  if ((await prisma.homework.count()) > 0) {
    console.log("• Домашние задания уже есть — пропускаем");
    return;
  }

  for (const item of homeworkSeed(new Date())) {
    await prisma.homework.create({
      data: {
        title: item.title,
        description: item.description,
        subjectId: subjectIds.get(item.subject) ?? "",
        teacherId: teacherIds.get(item.teacher) ?? "",
        grade: item.grade,
        deadline: item.deadline,
        maxScore: item.maxScore,
      },
    });
  }
  console.log("• Демо-задания созданы");
}

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  await seedAccounts(passwordHash);
  const subjectIds = await seedSubjects();

  const teachers = await prisma.user.findMany({
    where: { email: { in: ["teacher@schoolmeet.dev", "teacher2@schoolmeet.dev"] } },
    select: { id: true, email: true },
  });
  const teacherIds = new Map<TeacherKey, string>([
    ["teacher", teachers.find((t) => t.email === "teacher@schoolmeet.dev")?.id ?? ""],
    ["teacher2", teachers.find((t) => t.email === "teacher2@schoolmeet.dev")?.id ?? ""],
  ]);

  await seedSchedule(subjectIds, teacherIds);
  await seedHomework(subjectIds, teacherIds);

  console.log("\nДемо-данные готовы. Админ-панель доступна ролям ADMIN и TEACHER.");
}

main()
  .catch((error: unknown) => {
    console.error("Не удалось выполнить сид:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
