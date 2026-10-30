import { NextResponse } from "next/server";

import { handleRouteError, jsonOk } from "@/lib/api";
import { getAttachmentForDownload, removeAttachmentFromDraft } from "@/lib/homework";
import { requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

interface FileRouteParams {
  params: Promise<{ id: string; fileId: string }>;
}

/** GET /api/homework/[id]/files/[fileId] — скачать файл (ученик-автор или учитель задания). */
export async function GET(_request: Request, { params }: FileRouteParams): Promise<NextResponse> {
  const { id, fileId } = await params;
  try {
    const viewer = await requireViewer();
    const file = await getAttachmentForDownload(id, fileId, viewer);

    const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    const encodedName = encodeURIComponent(file.fileName);

    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.bytes.length),
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleRouteError(error, "api/homework/files GET");
  }
}

/** DELETE /api/homework/[id]/files/[fileId] — убрать файл из черновика до сдачи. */
export async function DELETE(_request: Request, { params }: FileRouteParams): Promise<NextResponse> {
  const { id, fileId } = await params;
  try {
    const viewer = await requireViewer();
    await removeAttachmentFromDraft(id, fileId, viewer);
    return jsonOk({ deleted: true });
  } catch (error) {
    return handleRouteError(error, "api/homework/files DELETE");
  }
}
