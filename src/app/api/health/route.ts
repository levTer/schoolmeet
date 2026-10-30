import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getRealtimeControl } from "@/lib/realtime-control";

/**
 * GET /api/health — проверка живости для балансировщика/монитора.
 *
 * Отвечает 200, только если доступна БД: без неё приложение не обслуживает
 * ни вход, ни уроки, поэтому «зелёный» статус был бы ложью.
 *
 * Публичный (вне PROTECTED_PREFIXES), но без подробностей: наружу уходят
 * только факты «БД отвечает / не отвечает», её задержка и время работы
 * процесса. Ни версий, ни строк подключения, ни имён таблиц.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DB_TIMEOUT_MS = 3000;

async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number | null }> {
  const startedAt = Date.now();
  try {
    const probe = prisma.$queryRaw`SELECT 1`;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT_MS).unref?.(),
    );
    await Promise.race([probe, timeout]);
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    console.error("[health] Проверка БД не прошла:", error instanceof Error ? error.message : error);
    return { ok: false, latencyMs: null };
  }
}

export async function GET(): Promise<NextResponse> {
  const db = await checkDatabase();
  const realtime = getRealtimeControl() !== null;

  return NextResponse.json(
    {
      ok: db.ok,
      status: db.ok ? "ok" : "degraded",
      checks: {
        database: { ok: db.ok, latencyMs: db.latencyMs },
        // На Vercel кастомного сервера нет — realtime там ожидаемо отсутствует.
        realtime: { ok: realtime || Boolean(process.env.VERCEL), attached: realtime },
      },
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    {
      status: db.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
