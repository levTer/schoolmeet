import { NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { findSchoolByCode, listClassesForSchool } from "@/lib/schools";
import { normalizeSchoolCode } from "@/lib/school-rules";

export const dynamic = "force-dynamic";

/** Public lookup used by registration; only exposes the school name and its classes. */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const codeParam = new URL(request.url).searchParams.get("code");
    const code = normalizeSchoolCode(codeParam);
    if (!code) return jsonError(422, "INVALID_SCHOOL_CODE", "Введите корректный код школы", {
      fields: { schoolCode: "Код должен содержать от 3 до 32 латинских букв, цифр или дефисов" },
    });

    const school = await findSchoolByCode(code);
    if (!school) {
      return jsonError(404, "SCHOOL_NOT_FOUND", "Школа с таким кодом не найдена", {
        fields: { schoolCode: "Проверьте код школы" },
      });
    }

    const classes = await listClassesForSchool(school.id);
    return jsonOk({ school: { name: school.name, code: school.code }, classes });
  } catch (error) {
    return handleRouteError(error, "api/schools/check GET");
  }
}
