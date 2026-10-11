import { NextResponse } from "next/server";

import { badRequest, handleRouteError, jsonOk } from "@/lib/api";
import { generateAiReviewDraft } from "@/lib/homework";
import { requireRole, requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/**
 * POST /api/homework/[id]/ai-review — черновик проверки от ИИ.
 * ТОЛЬКО TEACHER / ADMIN: ученик получает 403 Forbidden.
 * Тело: `{ submissionId }`. Ответ виден только учителю.
 */
export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    requireRole(viewer, ["TEACHER", "ADMIN"], "ИИ-проверка доступна только учителям");

    const submissionId = await readSubmissionId(request);
    const review = await generateAiReviewDraft(params.id, submissionId, viewer);
    return jsonOk({ review });
  } catch (error) {
    return handleRouteError(error, "api/homework/ai-review POST");
  }
}

async function readSubmissionId(request: Request): Promise<string> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw badRequest("Ожидается JSON с полем submissionId");
  }
  const submissionId = (payload as { submissionId?: unknown } | null)?.submissionId;
  if (typeof submissionId !== "string" || submissionId.length === 0 || submissionId.length > 64) {
    throw badRequest("Не указана работа ученика", { submissionId: "Выберите работу" });
  }
  return submissionId;
}
