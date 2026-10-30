import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  AI_IMAGE_MAX_BYTES,
  buildUpstreamImageUrl,
  parseAiImageRequest,
  type AiImageRequest,
} from "@/lib/ai-image";

export const dynamic = "force-dynamic";
/** Генерация картинки занимает 5–20 секунд — даём функции запас по времени. */
export const maxDuration = 40;

/** Сколько картинок держим в памяти, чтобы доска не перезапрашивала их. */
const CACHE_LIMIT = 24;
/** Таймаут генератора: дольше ждать бессмысленно, пользователь уже ушёл. */
const UPSTREAM_TIMEOUT_MS = 25_000;

interface CachedImage {
  type: string;
  body: Uint8Array;
}

/**
 * Кэш в памяти процесса.
 *
 * `Map` сохраняет порядок вставки, поэтому самая старая запись — первая:
 * при переполнении удаляем именно её. Это не Redis и не переживает рестарт, но
 * повторные показы одной и той же доски (переподключение, второй ученик) не
 * дёргают генератор заново.
 */
const cache = new Map<string, CachedImage>();

function cacheKey({ prompt, seed }: AiImageRequest): string {
  return `${seed}:${prompt}`;
}

function rememberImage(request: AiImageRequest, image: CachedImage): void {
  const key = cacheKey(request);
  cache.delete(key);
  cache.set(key, image);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * GET /api/ai/image?prompt=…&seed=… — прокси к генератору иллюстраций.
 *
 * Почему через сервер, а не ссылкой на генератор напрямую:
 *  • CSP разрешает картинки только со своего origin (`img-src 'self' data:
 *    blob:`), поэтому внешняя ссылка молча блокировалась и рисунки ИИ не
 *    появлялись;
 *  • запрос к внешнему домену делает сервер, которому он доступен всегда;
 *  • адрес генератора строится из `prompt` + `seed`, произвольный URL в запрос
 *    не принимается — SSRF невозможен.
 *
 * Доступ — любому вошедшему пользователю: картинки на доске видят и ученики,
 * а не только учитель, создавший иллюстрацию.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = parseAiImageRequest(new URL(request.url).searchParams);
  if (!parsed) {
    return NextResponse.json({ error: "Некорректный запрос иллюстрации" }, { status: 422 });
  }

  const cached = cache.get(cacheKey(parsed));
  if (cached) {
    return new NextResponse(cached.body.slice(), {
      headers: {
        "Content-Type": cached.type,
        "Cache-Control": "public, max-age=604800, immutable",
        "X-EduFlow-Image-Cache": "hit",
      },
    });
  }

  try {
    const upstream = await fetch(buildUpstreamImageUrl(parsed), {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: { accept: "image/*" },
      cache: "no-store",
    });

    if (!upstream.ok) {
      // Генератор — внешний сервис: его отказ не должен выглядеть как ошибка
      // сайта, поэтому возвращаем 502 и короткий текст для лога движка.
      return NextResponse.json({ error: "Генератор иллюстраций недоступен" }, { status: 502 });
    }

    const type = upstream.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) {
      return NextResponse.json({ error: "Генератор вернул не изображение" }, { status: 502 });
    }

    const body = new Uint8Array(await upstream.arrayBuffer());
    if (body.byteLength === 0 || body.byteLength > AI_IMAGE_MAX_BYTES) {
      return NextResponse.json({ error: "Изображение пустое или слишком большое" }, { status: 502 });
    }

    rememberImage(parsed, { type, body });

    return new NextResponse(body, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=604800, immutable",
        "X-EduFlow-Image-Cache": "miss",
      },
    });
  } catch {
    return NextResponse.json({ error: "Генератор иллюстраций не ответил" }, { status: 504 });
  }
}
