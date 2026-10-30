import { NextResponse } from "next/server";

import { handleRouteError, jsonOk } from "@/lib/api";
import { deleteLesson } from "@/lib/schedule";
import { requireRole, requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/** DELETE /api/schedule/[id] — удалить урок (владелец-учитель или администратор). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  try {
    const viewer = await requireViewer();
    requireRole(viewer, ["TEACHER", "ADMIN"]);
    await deleteLesson(id, viewer);
    return jsonOk({ deleted: true });
  } catch (error) {
    return handleRouteError(error, "api/schedule DELETE");
  }
}
