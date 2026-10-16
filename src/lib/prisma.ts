import { PrismaClient } from "@prisma/client";

/**
 * Единственный экземпляр PrismaClient на процесс.
 *
 * В dev-режиме Next.js перезагружает модули при каждом изменении файла, поэтому
 * клиент кладём в `globalThis` — иначе каждый hot-reload открывал бы новое
 * соединение с PostgreSQL и быстро исчерпал лимит подключений.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Converts a Neon direct endpoint into its PgBouncer endpoint when needed,
 * and caps each application process at ten database connections. Prefer
 * setting DATABASE_URL to Neon’s `-pooler` URL explicitly in production;
 * this fallback also protects deployments that were configured with a direct
 * Neon URL by mistake.
 */
export function getPooledDatabaseUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;

  try {
    const url = new URL(rawUrl);
    const isNeon = url.hostname.endsWith(".neon.tech");
    if (isNeon && /^ep-[^.]+\./.test(url.hostname) && !url.hostname.includes("-pooler.")) {
      url.hostname = url.hostname.replace(/^([^.]*)\./, "$1-pooler.");
    }

    url.searchParams.set("connection_limit", "10");
    if (isNeon) url.searchParams.set("pgbouncer", "true");
    return url.toString();
  } catch {
    // Leave validation of malformed connection strings to Prisma itself.
    return rawUrl;
  }
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: { url: getPooledDatabaseUrl(process.env.DATABASE_URL) },
    },
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

// Preserve the singleton across HMR and concurrent module imports in every
// runtime mode; a process still owns its own isolated client/pool.
globalForPrisma.prisma = prisma;

/**
 * Опции интерактивных транзакций (`prisma.$transaction(async (tx) => …)`).
 *
 * Neon — serverless PostgreSQL: после простоя соединение поднимается секунды,
 * а ответы приходят с сетевой задержкой. Дефолтный лимит Prisma (5 с на
 * транзакцию, 2 с на ожидание слота пула) на таких задержках заканчивается
 * ошибкой P2028 «Transaction already closed» — именно она роняла рендер
 * `/dashboard`, когда фоновая досыпка тенанта выполняла `homework.updateMany`.
 *
 * 15 с на выполнение и 10 с на ожидание соединения покрывают «холодный» старт
 * Neon, но всё равно завершают зависшую транзакцию, не удерживая запрос вечно.
 * Использовать вместе с `isolationLevel` через спред:
 * `{ ...INTERACTIVE_TRANSACTION_OPTIONS, isolationLevel: … }`.
 */
export const INTERACTIVE_TRANSACTION_OPTIONS = {
  maxWait: 10000,
  timeout: 15000,
} as const;
