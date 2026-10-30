import { NextResponse } from "next/server";

import { handleRouteError, jsonOk } from "@/lib/api";
import { submitHomework } from "@/lib/homework";
import { requireRole, requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/** POST /api/homework/[id]/submit — сдать работу. Статус станет «На проверке». */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  try {
    const viewer = await requireViewer();
    requireRole(viewer, ["STUDENT"], "Сдавать задания могут только ученики");
    const result = await submitHomework(id, viewer);
    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error, "api/homework/submit POST");
  }
}
