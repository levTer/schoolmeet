import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  getAIProvider,
  isAIAction,
  type AIAction,
  type AIRequest,
} from "@/lib/ai-provider";

export const dynamic = "force-dynamic";

/**
 * API ИИ-помощника SchoolMeet (этап 4).
 *
 * ЭТАП 4 — ТОЛЬКО ЛОКАЛЬНЫЙ MOCK. Внешние нейросети не вызываются: роут
 * передаёт запрос единственной локальной реализации `MockAIProvider`.
 *
 * БЕЗОПАСНОСТЬ: доступ — только для ролей TEACHER и ADMIN. Любая попытка
 * ученика (STUDENT) обратиться к `/api/ai` завершается 403 Forbidden, а UI
 * ИИ-панели для учеников вообще не отрисовывается.
 */

const MAX_PROMPT_LENGTH = 2000;
/** data URL фрагмента доски (PNG base64) — до ~32 КБ в base64. */
const MAX_IMAGE_LENGTH = 32 * 1024;

/** Роль пользователя в сессии (см. `src/types/next-auth.d.ts`). */
type SessionRole = "ADMIN" | "TEACHER" | "STUDENT";

/** GET /api/ai — сведения о текущем провайдере ИИ (для бейджа в UI). */
export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if ((session.user.role as SessionRole) === "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const provider = getAIProvider();
  return NextResponse.json({
    ok: true,
    data: {
      provider: { id: provider.id, name: provider.name, isLocal: provider.isLocal },
    },
  });
}

/**
 * POST /api/ai — запрос к ИИ-помощнику.
 * Тело: `{ action, prompt, imageDataUrl?, context?: { meetingTitle } }`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Ожидается JSON с полями action и prompt", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const action = payload.action;
  if (!isAIAction(action)) {
    return NextResponse.json(
      { ok: false, error: "Неизвестное действие ИИ", code: "BAD_ACTION" },
      { status: 400 },
    );
  }

  const prompt = typeof payload.prompt === "string" ? payload.prompt.slice(0, MAX_PROMPT_LENGTH) : "";
  const imageDataUrl =
    typeof payload.imageDataUrl === "string" && payload.imageDataUrl.startsWith("data:image/")
      ? payload.imageDataUrl.slice(0, MAX_IMAGE_LENGTH)
      : undefined;

  const rawContext = payload.context;
  const meetingTitle =
    typeof rawContext === "object" && rawContext !== null
      ? (rawContext as Record<string, unknown>).meetingTitle
      : undefined;

  const aiRequest: AIRequest = {
    action: action as AIAction,
    prompt,
    imageDataUrl,
    context: typeof meetingTitle === "string" ? { meetingTitle: meetingTitle.slice(0, 120) } : undefined,
  };

  try {
    const provider = getAIProvider();
    const response = await provider.complete(aiRequest);
    return NextResponse.json({ ok: true, data: response });
  } catch (error) {
    console.error("[api/ai] Провайдер ИИ не ответил:", error);
    return NextResponse.json(
      { ok: false, error: "ИИ-помощник временно недоступен", code: "PROVIDER_ERROR" },
      { status: 500 },
    );
  }
}
