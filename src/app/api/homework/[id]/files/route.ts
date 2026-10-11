import { NextResponse } from "next/server";

import { DomainError, handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { attachFileToDraft } from "@/lib/homework";
import { HOMEWORK_LIMITS } from "@/lib/homework-rules";
import { requireRole, requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/**
 * POST /api/homework/[id]/files — прикрепить файл к черновику (multipart, поле `file`).
 * Размер проверяем до чтения тела, чтобы не держать в памяти лишнее.
 */
export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    requireRole(viewer, ["STUDENT"], "Прикреплять файлы могут только ученики");

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError(400, "BAD_REQUEST", "Ожидается multipart/form-data с полем file");
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonError(422, "VALIDATION_ERROR", "Выберите файл", { fields: { file: "Файл не выбран" } });
    }
    if (file.size > HOMEWORK_LIMITS.maxFileBytes) {
      throw new DomainError(413, "FILE_TOO_LARGE", "Файл больше 10 МБ", { file: "Не больше 10 МБ" });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const attachment = await attachFileToDraft(params.id, { fileName: file.name, bytes }, viewer);
    return jsonOk({ attachment }, 201);
  } catch (error) {
    return handleRouteError(error, "api/homework/files POST");
  }
}
