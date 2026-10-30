import { NextResponse } from "next/server";

import { badRequest, handleRouteError, jsonOk } from "@/lib/api";
import { approveReview } from "@/lib/homework";
import { requireRole, requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/**
 * POST /api/homework/[id]/grade — утвердить оценку и отправить ученику.
 * Тело: `{ submissionId, grade, comment? }`. Только учитель-владелец или администратор.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  try {
    const viewer = await requireViewer();
    requireRole(viewer, ["TEACHER", "ADMIN"], "Оценивать работы могут только учителя");

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      throw badRequest("Ожидается JSON с полями submissionId и grade");
    }
    const body = (payload ?? {}) as Record<string, unknown>;
    if (typeof body.submissionId !== "string" || body.submissionId.length === 0 || body.submissionId.length > 64) {
      throw badRequest("Не указана работа ученика", { submissionId: "Выберите работу" });
    }

    const review = await approveReview(id, body.submissionId, { grade: body.grade, comment: body.comment }, viewer);
    return jsonOk({ review });
  } catch (error) {
    return handleRouteError(error, "api/homework/grade POST");
  }
}
