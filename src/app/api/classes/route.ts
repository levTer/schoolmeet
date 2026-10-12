import { NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { listClassesForSchool } from "@/lib/schools";
import { requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/** Returns class options only for the signed-in user's school. */
export async function GET(): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    if (!viewer.schoolId) return jsonError(409, "SCHOOL_REQUIRED", "Аккаунт не привязан к школе");

    const classes = await listClassesForSchool(viewer.schoolId);
    return jsonOk({ classes });
  } catch (error) {
    return handleRouteError(error, "api/classes GET");
  }
}
