import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

import type { Role } from "@/types";

/**
 * Защита приватных разделов платформы.
 *
 * - `/dashboard`, `/meeting`, `/schedule`, `/admin` доступны только с сессией;
 * - `/admin` — только роли ADMIN или TEACHER (ученика вернём в кабинет);
 * - остальные страницы (лендинг, `/login`, `/register`) проходят насквозь.
 *
 * Роль читается из подписанного JWT-cookie, поэтому БД не нужна и middleware
 * остаётся лёгким (edge-рантайм).
 */

/** Разделы, требующие авторизации. */
const PROTECTED_PREFIXES = ["/dashboard", "/meeting", "/schedule", "/admin"] as const;

/** Разделы, доступные только персоналу школы. */
const STAFF_PREFIXES = ["/admin"] as const;

const STAFF_ROLES: readonly Role[] = ["ADMIN", "TEACHER"];

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isProtected = matchesPrefix(pathname, PROTECTED_PREFIXES);
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  /* 1. Нет сессии — отправляем на вход и запоминаем, куда человек шёл. */
  if (!token) {
    if (!isProtected) return NextResponse.next();

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const role = (token.role as Role | undefined) ?? "STUDENT";

  /* 2. Раздел для персонала, а роль не подходит — возвращаем в кабинет. */
  if (matchesPrefix(pathname, STAFF_PREFIXES) && !STAFF_ROLES.includes(role)) {
    const dashboardUrl = new URL("/dashboard", request.url);
    dashboardUrl.searchParams.set("denied", pathname);
    return NextResponse.redirect(dashboardUrl);
  }

  /* 3. Доступ разрешён: пробрасываем id/role дальше в заголовках. */
  const headers = new Headers(request.headers);
  headers.set("x-user-id", String(token.id ?? token.sub ?? ""));
  headers.set("x-user-role", role);
  headers.set("x-pathname", pathname);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    "/dashboard",
    "/dashboard/:path*",
    "/meeting",
    "/meeting/:path*",
    "/schedule",
    "/schedule/:path*",
    "/admin",
    "/admin/:path*",
  ],
};
