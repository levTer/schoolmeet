import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { GRADES, type GradeCode } from "@/lib/schedule-rules";
import { gradeFromClassName, normalizeSchoolCode } from "@/lib/school-rules";
import {
  CONFIGURED_SCHOOLS,
  DEFAULT_CLASS_NAMES,
  DEFAULT_SCHOOL,
  LEGACY_DEFAULT_SCHOOL_CODE,
} from "@/lib/school-config";

export { gradeFromClassName, normalizeClassName, normalizeSchoolCode } from "@/lib/school-rules";
export { CONFIGURED_SCHOOLS, DEFAULT_CLASS_NAMES } from "@/lib/school-config";

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

function classNameForGrade(grade: GradeCode): string {
  return `${grade.replace("GRADE_", "")}-А`;
}

let defaultSchoolPromise: Promise<SchoolSummary> | null = null;

/**
 * Idempotently creates the configured schools and their standard classes.
 * Existing SCHOOL1 installations are migrated/merged into the primary school,
 * preserving user, class, schedule, homework, and meeting references.
 */
export async function provisionConfiguredSchools(db: PrismaClient = prisma): Promise<Map<string, SchoolSummary>> {
  const schools = new Map<string, SchoolSummary>();

  for (const definition of CONFIGURED_SCHOOLS) {
    let school = await db.school.findUnique({
      where: { code: definition.code },
      select: { id: true, name: true, code: true },
    });

    // Reuse the old default-school row when migrating a single-tenant database.
    if (!school && definition.code === DEFAULT_SCHOOL.code) {
      const legacySchool = await db.school.findUnique({
        where: { code: LEGACY_DEFAULT_SCHOOL_CODE },
        select: { id: true, name: true, code: true },
      });
      if (legacySchool) {
        school = await db.school.update({
          where: { id: legacySchool.id },
          data: { name: definition.name, code: definition.code },
          select: { id: true, name: true, code: true },
        });
      }
    }

    if (school) {
      school = await db.school.update({
        where: { id: school.id },
        data: { name: definition.name },
        select: { id: true, name: true, code: true },
      });
    } else {
      school = await db.school.upsert({
        where: { code: definition.code },
        update: { name: definition.name },
        create: { name: definition.name, code: definition.code },
        select: { id: true, name: true, code: true },
      });
    }

    if (!school) throw new Error(`Не удалось создать школу ${definition.name}`);

    await db.class.createMany({
      data: DEFAULT_CLASS_NAMES.map((name) => ({ schoolId: school.id, name })),
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

  return schools;
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
  });
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
  });

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
  await ensureDefaultSchool();
  return prisma.school.findFirst({
    where: { code: { equals: code, mode: "insensitive" } },
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

/** Resolve the tenant for a legacy meeting as well as for newly tenant-scoped meetings. */
export function getMeetingSchoolId(meeting: {
  schoolId: string | null;
  host: { schoolId: string | null };
  schedule?: { schoolId: string | null } | null;
}): string | null {
  return meeting.schoolId ?? meeting.schedule?.schoolId ?? meeting.host.schoolId;
}
