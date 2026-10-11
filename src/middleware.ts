import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

import { checkPathRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import type { Role } from "@/types";

/**
 * Пограничный слой приложения: защита разделов, rate-limit и блокировка аккаунта.
 *
 * Проходит все запросы, кроме статики Next.js и файлов (см. `config.matcher`),
 * поэтому защита от флуда работает и для страниц, и для API.
 *
 * Порядок проверок (важен):
 *   1. rate-limit — 100 запросов в минуту на IP (для `/api/auth` — 20,
 *      для `/api/admin` — 60): отсекаем флуд до криптографии и БД;
 *   2. сессия — `/dashboard`, `/meeting`, `/schedule`, `/homework`, `/admin`
 *      и `/api/admin` требуют входа (без сессии — редирект на
 *      `/login?callbackUrl=...`, для API — 401 JSON);
 *   3. RBAC — `/admin`, `/admin/*` и `/api/admin/*` открыты ИСКЛЮЧИТЕЛЬНО роли
 *      ADMIN (суперадмин). Учитель и ученик мгновенно возвращаются в кабинет:
 *      `/dashboard?denied=admin` (для API — 403 JSON);
 *   4. блокировка — забаненный пользователь уходит на `/banned` (страницы) или
 *      получает 403 `ACCOUNT_BANNED` (API); исключение — `/api/auth/*`, чтобы
 *      человек мог выйти из аккаунта.
 *
 * Роль читается из подписанного JWT-cookie, поэтому БД не нужна и middleware
 * остаётся лёгким (edge-рантайм). Актуальность роли и блокировки обеспечивают
 * `jwt`-callback NextAuth и проверки в API/страницах.
 */

/** Разделы, требующие авторизации (страницы и API админ-панели). */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/meeting",
  "/schedule",
  "/homework",
  "/admin",
  "/api/admin",
] as const;

/** Раздел админ-панели: страницы `/admin`, `/admin/*` и API `/api/admin/*`. */
const ADMIN_AREA_PREFIXES = ["/admin", "/api/admin"] as const;

/** Доступ в админ-панель — строго суперадмин (ADMIN). */
const SUPERADMIN_ROLES: readonly Role[] = ["ADMIN"];

/** Куда возвращаем пользователя без прав: метка для toast в кабинете. */
const ADMIN_DENIED_QUERY = "admin";
const ADMIN_DENIED_MESSAGE = "Доступ открыт только Администратору школы";

/** Страница «аккаунт заблокирован» — её саму пропускаем всегда. */
const BANNED_PATH = "/banned";

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Ответ 429: для API — JSON, для страницы — минимальная HTML-заглушка. */
function rateLimitedResponse(retryAfterSeconds: number, isApi: boolean): NextResponse {
  const headers = { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" };

  if (isApi) {
    return NextResponse.json(
      {
        ok: false,
        code: "RATE_LIMITED",
        error: "Слишком много запросов. Подождите минуту и попробуйте снова.",
      },
      { status: 429, headers },
    );
  }

  return new NextResponse(
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Слишком много запросов</title></head>
<body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#06070b;color:#e8ebf7;font-family:system-ui,sans-serif">
<div style="max-width:32rem;padding:2rem;text-align:center">
<div style="font-size:3rem">🛡️</div>
<h1 style="font-size:1.5rem;margin:1rem 0 .5rem">Слишком много запросов</h1>
<p style="color:#94a3b8;line-height:1.6">Школа защищена от перегрузки: не более ${
      process.env.RATE_LIMIT_MAX_REQUESTS ?? 100
    } запросов в минуту с одного адреса.</p>
<p style="color:#94a3b8">Повторите через ${retryAfterSeconds} с.</p>
</div></body></html>`,
    { status: 429, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api");

  /* 1. Rate-limit: общий лимит + строгие правила для /api/auth и /api/admin. */
  const { checks, blocked } = checkPathRateLimit(pathname, request.headers);

  const limitHeaders = checks.reduce<Record<string, string>>((acc, check) => {
    for (const [key, value] of Object.entries(rateLimitHeaders(check.result))) {
      acc[key] = value;
    }
    return acc;
  }, {});

  if (blocked) {
    const response = rateLimitedResponse(blocked.result.retryAfterSeconds, isApi);
    for (const [key, value] of Object.entries(limitHeaders)) response.headers.set(key, value);
    return response;
  }

  const isProtected = matchesPrefix(pathname, PROTECTED_PREFIXES);
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  /* 2. Нет сессии — отправляем на вход и запоминаем, куда человек шёл. */
  if (!token) {
    if (!isProtected) return NextResponse.next({ headers: limitHeaders });

    if (isApi) {
      return NextResponse.json(
        { ok: false, code: "UNAUTHORIZED", error: "Войдите в аккаунт" },
        { status: 401, headers: limitHeaders },
      );
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const role = (token.role as Role | undefined) ?? "STUDENT";
  const isBanned = token.banned === true;

  /* 3. Аккаунт заблокирован администратором. */
  if (isBanned && !pathname.startsWith("/api/auth") && pathname !== BANNED_PATH) {
    if (isApi) {
      return NextResponse.json(
        { ok: false, code: "ACCOUNT_BANNED", error: "Аккаунт заблокирован администратором" },
        { status: 403, headers: limitHeaders },
      );
    }

    const bannedUrl = new URL(BANNED_PATH, request.url);
    return NextResponse.redirect(bannedUrl);
  }

  /* 4. Админ-панель — строго для суперадмина: учитель/ученик уходят в кабинет. */
  if (matchesPrefix(pathname, ADMIN_AREA_PREFIXES) && !SUPERADMIN_ROLES.includes(role)) {
    if (isApi) {
      return NextResponse.json(
        { ok: false, code: "FORBIDDEN", error: ADMIN_DENIED_MESSAGE },
        { status: 403, headers: limitHeaders },
      );
    }

    const dashboardUrl = new URL("/dashboard", request.url);
    dashboardUrl.searchParams.set("denied", ADMIN_DENIED_QUERY);
    return NextResponse.redirect(dashboardUrl);
  }

  /* 5. Доступ разрешён: пробрасываем id/role дальше в заголовках. */
  const headers = new Headers(request.headers);
  headers.set("x-user-id", String(token.id ?? token.sub ?? ""));
  headers.set("x-user-role", role);
  headers.set("x-pathname", pathname);

  const response = NextResponse.next({ request: { headers } });
  for (const [key, value] of Object.entries(limitHeaders)) response.headers.set(key, value);
  return response;
}

export const config = {
  /**
   * Все страницы и API, кроме статики Next.js, файлов ассетов и `/socket.io`.
   *
   * Realtime исключён намеренно: Socket.IO опрашивает сервер (polling) до
   * апгрейда до WebSocket, и общий лимит HTTP-запросов «съедал» бы квоту
   * ученика за минуту. У рукопожатий Socket.IO свой лимит — 40 в минуту на IP
   * (см. `src/server/realtime.ts`).
   */
  matcher: [
    "/((?!_next/static|_next/image|socket.io|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf)$).*)",
  ],
};
