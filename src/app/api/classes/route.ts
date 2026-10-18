import { NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { getSchoolPolicy, listClassesForSchool } from "@/lib/schools";
import { requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/**
 * Returns class options only for the signed-in user's school, плюс политика
 * школы (`strictClassIsolation`) и текущий класс ученика — UI (Navbar)
 * решает, показывать Select переключения (гибкая школа) или бейдж
 * (строгая школа).
 */
export async function GET(): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    if (!viewer.schoolId) return jsonError(409, "SCHOOL_REQUIRED", "Аккаунт не привязан к школе");

    const [classes, policy] = await Promise.all([
      listClassesForSchool(viewer.schoolId),
      getSchoolPolicy(viewer.schoolId),
    ]);
    return jsonOk({
      classes,
      currentClassId: viewer.classId,
      strictClassIsolation: policy?.strictClassIsolation ?? false,
    });
  } catch (error) {
    return handleRouteError(error, "api/classes GET");
  }
}
