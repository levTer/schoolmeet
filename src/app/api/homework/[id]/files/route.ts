import { NextResponse } from "next/server";

import { DomainError, handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { attachFileToDraft } from "@/lib/homework";
import { HOMEWORK_LIMITS, isUploadLengthAllowed } from "@/lib/homework-rules";
import { requireRole, requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/**
 * POST /api/homework/[id]/files — прикрепить файл к черновику (multipart, поле `file`).
 *
 * Размер проверяется ДВАЖДЫ и оба раза до обработки содержимого:
 *  1. `Content-Length` — до `request.formData()`, иначе multipart уже
 *     разобран и всё тело лежит в памяти (защита от OOM на 512 МБ процесса);
 *  2. фактический `file.size` — после разбора, для честных клиентов и
 *     chunked-запросов без заголовка.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  try {
    const viewer = await requireViewer();
    requireRole(viewer, ["STUDENT"], "Прикреплять файлы могут только ученики");

    // 1. Гейт по Content-Length: отсекаем заведомо большие тело ДО буферизации.
    if (!isUploadLengthAllowed(request.headers.get("content-length"))) {
      return jsonError(413, "FILE_TOO_LARGE", "Файл больше 10 МБ", {
        fields: { file: "Не больше 10 МБ" },
      });
    }

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
    const attachment = await attachFileToDraft(id, { fileName: file.name, bytes }, viewer);
    return jsonOk({ attachment }, 201);
  } catch (error) {
    return handleRouteError(error, "api/homework/files POST");
  }
}
