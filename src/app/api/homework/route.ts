import { NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { createHomework, listHomeworkForViewer } from "@/lib/homework";
import { validateCreateHomework } from "@/lib/homework-rules";
import { requireRole, requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/** GET /api/homework — список заданий для текущей роли. */
export async function GET(): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    const homeworks = await listHomeworkForViewer(viewer);
    return jsonOk({ homeworks });
  } catch (error) {
    return handleRouteError(error, "api/homework GET");
  }
}

/**
 * POST /api/homework — выдать задание классу (учитель или администратор).
 * Тело: `{ title, description, subjectId, grade, deadline, maxScore? }`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    requireRole(viewer, ["TEACHER", "ADMIN"], "Выдавать задания могут только учителя");

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonError(400, "BAD_REQUEST", "Ожидается JSON с данными задания");
    }

    const validation = validateCreateHomework(payload, new Date());
    if (!validation.ok) {
      return jsonError(422, "VALIDATION_ERROR", validation.error, { fields: validation.fields });
    }

    const homework = await createHomework(validation.data, viewer);
    return jsonOk({ homework }, 201);
  } catch (error) {
    return handleRouteError(error, "api/homework POST");
  }
}
