import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  getAIProvider,
  getAIProvidersStatus,
  isAIAction,
  type AIAction,
  type AIRequest,
} from "@/lib/ai-provider";

export const dynamic = "force-dynamic";
/**
 * Внешние ИИ-вызовы (особенно Gemini Vision с изображением доски) могут
 * занимать десятки секунд — поднимаем лимит serverless-функции Vercel.
 * На Hobby-плане с Fluid Compute доступно до 60 с.
 */
export const maxDuration = 60;

/**
 * API ИИ-помощника Лицея Сингулярити (этап 8 — внешний ИИ-движок).
 *
 * ВСЕ вызовы Groq / Gemini / OpenRouter выполняются ЗДЕСЬ, на сервере
 * (Vercel, Европа). Сервер работает прокси-посредником: браузер учителя
 * обращается только к своему домену, поэтому ИИ доступен в РФ БЕЗ VPN,
 * а API-ключи никогда не попадают в клиентский бандл.
 *
 * Провайдера выбирает `AutoAIProvider` (src/lib/ai-provider.ts):
 *   • изображение доски → Gemini Vision → OpenRouter Vision → Mock;
 *   • текст/задача      → Groq → OpenRouter :free → Gemini → Mock.
 * Сбой любого звена не роняет API — запрос автоматически уходит следующему.
 *
 * БЕЗОПАСНОСТЬ: доступ — только для ролей TEACHER и ADMIN. Любая попытка
 * ученика (STUDENT) обратиться к `/api/ai` завершается 403 Forbidden, а UI
 * ИИ-панели для учеников вообще не отрисовывается.
 */

const MAX_PROMPT_LENGTH = 2000;
/**
 * data URL фрагмента доски (PNG base64) — до ~6 МБ: настоящего распознавания
 * рукописных формул (Gemini Vision) требуются полноценные снимки области.
 */
const MAX_IMAGE_LENGTH = 6 * 1024 * 1024;

/** Роль пользователя в сессии (см. `src/types/next-auth.d.ts`). */
type SessionRole = "ADMIN" | "TEACHER" | "STUDENT";

/**
 * GET /api/ai — сведения об ИИ-движке для бейджа в UI:
 * активный провайдер (AutoAI/Mock) и статусы всех звеньев цепочки
 * (какие API-ключи подключены, какие модели используются).
 */
export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if ((session.user.role as SessionRole) === "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { provider, statuses } = getAIProvidersStatus();
  return NextResponse.json({
    ok: true,
    data: {
      provider,
      providers: statuses,
    },
  });
}

/**
 * POST /api/ai — запрос к ИИ-помощнику.
 * Тело: `{ action, prompt, imageDataUrl?, context?: { meetingTitle } }`.
 * Ответ: `{ ok, data: { text, latex?, drawing?, providerId?, model? } }`.
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
    // Цепочка AutoAIProvider гарантирует ответ (последнее звено — локальный Mock).
    const response = await getAIProvider().complete(aiRequest);
    return NextResponse.json({ ok: true, data: response });
  } catch (error) {
    console.error("[api/ai] Все провайдеры ИИ не ответили:", error);
    return NextResponse.json(
      { ok: false, error: "ИИ-помощник временно недоступен", code: "PROVIDER_ERROR" },
      { status: 500 },
    );
  }
}
