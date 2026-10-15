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
