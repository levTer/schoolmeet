import { NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { saveDraftAnswer } from "@/lib/homework";
import { validateAnswer } from "@/lib/homework-rules";
import { requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/** PUT /api/homework/[id]/draft — автосохранение черновика ответа. Тело: `{ answer }`. */
export async function PUT(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonError(400, "BAD_REQUEST", "Ожидается JSON с полем answer");
    }

    const answer = validateAnswer((payload as { answer?: unknown } | null)?.answer);
    if (!answer.ok) return jsonError(422, "VALIDATION_ERROR", answer.error, { fields: answer.fields });

    const result = await saveDraftAnswer(params.id, answer.data, viewer);
    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error, "api/homework/draft PUT");
  }
}
