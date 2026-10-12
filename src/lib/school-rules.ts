import { GRADES, type GradeCode } from "@/lib/schedule-rules";

const GRADE_BY_NUMBER = Object.fromEntries(
  GRADES.map((grade) => [grade.replace("GRADE_", ""), grade]),
) as Record<string, GradeCode>;

/** Normalize and validate a school invite code (periods support legacy/custom codes). */
export function normalizeSchoolCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9._-]{2,31}$/.test(code) ? code : null;
}

/** Canonical class label, e.g. "7-В". */
export function normalizeClassName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLocaleUpperCase("ru-RU")
    .replace(/[–—]/g, "-")
    .replace(/\s*-\s*/g, "-");
  return /^(5|6|7|8|9|10|11)-[А-ЯЁA-Z0-9]{1,3}$/.test(normalized) ? normalized : null;
}

export function gradeFromClassName(value: string): GradeCode | null {
  const normalized = normalizeClassName(value);
  if (!normalized) return null;
  return GRADE_BY_NUMBER[normalized.split("-", 1)[0]] ?? null;
}
