import type { NextResponse } from "next/server";

import { handleRouteError, jsonOk } from "@/lib/api";
import { listActiveCallsForViewer } from "@/lib/call-queries";
import { requireSchoolViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/** GET /api/meetings/active — live calls the current viewer may join. */
export async function GET(): Promise<NextResponse> {
  try {
    const viewer = await requireSchoolViewer();
    return jsonOk({ calls: await listActiveCallsForViewer(viewer) });
  } catch (error) {
    return handleRouteError(error, "api/meetings/active GET");
  }
}
