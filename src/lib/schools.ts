import { prisma } from "@/lib/prisma";
import { GRADES, type GradeCode } from "@/lib/schedule-rules";
import { gradeFromClassName, normalizeSchoolCode } from "@/lib/school-rules";

export { gradeFromClassName, normalizeClassName, normalizeSchoolCode } from "@/lib/school-rules";

export const DEFAULT_SCHOOL_NAME = "Тестовая Школа";
export const DEFAULT_SCHOOL_CODE = "SCHOOL1";

const DEFAULT_CLASS_LETTERS = ["А", "Б"] as const;
const DEFAULT_CLASS_NAMES = GRADES.flatMap((grade) => {
  const number = grade.replace("GRADE_", "");
  return DEFAULT_CLASS_LETTERS.map((letter) => `${number}-${letter}`);
});

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

function classNameForGrade(grade: GradeCode): string {
  return `${grade.replace("GRADE_", "")}-А`;
}

let defaultSchoolPromise: Promise<SchoolSummary> | null = null;

/**
 * Creates a single default school for existing installations and safely assigns
 * legacy records with no school/class to that tenant. Nullable schema fields let
 * this run against an upgraded database without invalidating existing accounts.
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
  let school = await prisma.school.findUnique({
    where: { code: DEFAULT_SCHOOL_CODE },
    select: { id: true, name: true, code: true },
  });

  // If another school was provisioned first, use the oldest one for legacy data.
  if (!school) {
    school = await prisma.school.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, code: true },
    });
  }
  if (!school) {
    school = await prisma.school.upsert({
      where: { code: DEFAULT_SCHOOL_CODE },
      update: {},
      create: { name: DEFAULT_SCHOOL_NAME, code: DEFAULT_SCHOOL_CODE },
      select: { id: true, name: true, code: true },
    });
  }

  await prisma.class.createMany({
    data: DEFAULT_CLASS_NAMES.map((name) => ({ schoolId: school.id, name })),
    skipDuplicates: true,
  });

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
  });

  return school;
}

/** Persist the default tenant assignment for a legacy user before issuing a session. */
export async function ensureUserSchoolMembership(userId: string) {
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
  await ensureDefaultSchool();
  return prisma.school.findUnique({
    where: { code },
    select: { id: true, name: true, code: true },
  });
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
