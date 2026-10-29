import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { getSchoolSummary, listClassesForSchool } from "@/lib/schools";
import { gradeFromClassName, normalizeClassName } from "@/lib/school-rules";
import { requireAdminViewer } from "@/lib/session-viewer";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Classes and school code for the current school's administrator. */
export async function GET(): Promise<NextResponse> {
  try {
    const viewer = await requireAdminViewer();

    const [school, classes] = await Promise.all([
      getSchoolSummary(viewer.schoolId),
      listClassesForSchool(viewer.schoolId),
    ]);
    if (!school) return jsonError(404, "SCHOOL_NOT_FOUND", "Школа не найдена");
    return jsonOk({ school, classes });
  } catch (error) {
    return handleRouteError(error, "api/admin/classes GET");
  }
}

/** Create a class within the administrator's school; schoolId is never accepted from the client. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const viewer = await requireAdminViewer();

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonError(400, "BAD_REQUEST", "Ожидается JSON с названием класса");
    }

    const rawName = typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>).name
      : undefined;
    const name = normalizeClassName(rawName);
    const grade = name ? gradeFromClassName(name) : null;
    if (!name || !grade) {
      return jsonError(422, "VALIDATION_ERROR", "Название класса должно быть, например, «7-В»", {
        fields: { name: "Формат: номер класса 5–11 и литера, например 7-В" },
      });
    }

    try {
      const schoolClass = await prisma.class.create({
        data: { name, schoolId: viewer.schoolId },
        select: { id: true, name: true },
      });
      return jsonOk({ schoolClass: { ...schoolClass, grade } }, 201);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return jsonError(409, "CLASS_EXISTS", "Класс с таким названием уже есть", {
          fields: { name: "Введите другое название класса" },
        });
      }
      throw error;
    }
  } catch (error) {
    return handleRouteError(error, "api/admin/classes POST");
  }
}
