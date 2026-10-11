import { PrismaClient } from "@prisma/client";

/**
 * Единственный экземпляр PrismaClient на процесс.
 *
 * В dev-режиме Next.js перезагружает модули при каждом изменении файла, поэтому
 * клиент кладём в `globalThis` — иначе каждый hot-reload открывал бы новое
 * соединение с PostgreSQL и быстро исчерпал лимит подключений.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
