import { NextResponse } from "next/server";

import { handleRouteError, jsonOk, notFound } from "@/lib/api";
import { getHomeworkDetailForViewer } from "@/lib/homework";
import { requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/**
 * GET /api/homework/[id] — карточка задания.
 * Ученик получает свою работу без черновика ИИ; учитель — все работы класса с черновиками.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  try {
    const viewer = await requireViewer();
    const detail = await getHomeworkDetailForViewer(id, viewer);
    if (!detail) throw notFound("Задание не найдено");
    return jsonOk(detail);
  } catch (error) {
    return handleRouteError(error, "api/homework/[id] GET");
  }
}

