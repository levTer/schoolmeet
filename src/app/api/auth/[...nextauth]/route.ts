import NextAuth from "next-auth";

import { authOptions } from "@/lib/auth";

/**
 * Обработчик NextAuth: `GET/POST /api/auth/*`
 * (вход, выход, сессия, CSRF-токен, колбэки провайдеров).
 */
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };

// bcryptjs и Prisma требуют Node.js-рантайма (не edge).
export const runtime = "nodejs";
