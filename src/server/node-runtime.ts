/**
 * Подготовка Node-рантайма ДО загрузки Next.js.
 *
 * Next.js 16 в `next/dist/server/node-environment-baseline.js` выставляет
 * `globalThis.AsyncLocalStorage`, если его нет в среде. Это делает CLI
 * (`next dev` / `next start`), но кастомный сервер (`server.ts`) загружает
 * Next напрямую, поэтому без этой подготовки рендер падает с
 *
 *   Invariant: AsyncLocalStorage accessed in runtime where it is not available
 *
 * — и приложение не отвечает ни на один запросе. В Node.js 24 `AsyncLocalStorage`
 * уже глобальный; на 22 (наш минимум) его нужно выставить самим.
 *
 * Модуль обязан импортироваться раньше `next` (см. `server.ts`): импорты
 * выполняются в порядке объявления, поэтому полифилл успевает до инициализации
 * Next.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const runtime = globalThis as { AsyncLocalStorage?: unknown };

if (typeof runtime.AsyncLocalStorage !== "function") {
  runtime.AsyncLocalStorage = AsyncLocalStorage;
}
