/**
 * Кастомный сервер EduFlow: Next.js (страницы, API) и Socket.IO (realtime)
 * работают на одном HTTP-порту.
 *
 *   npm run dev    — разработка (NODE_ENV=development, HMR Next.js сохраняется)
 *   npm run start  — продакшен (сначала `npm run build`)
 *
 * Переменные: PORT (по умолчанию 3000), HOST (по умолчанию 0.0.0.0).
 */
import { createServer } from "node:http";

import next from "next";

import { attachRealtime } from "./src/server/realtime";
import { provisionConfiguredSchools } from "./src/lib/schools";
import { runStartupMaintenance } from "./src/lib/startup-maintenance";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

async function main(): Promise<void> {
  // Школы и гарантированные демо-админы инициализируются при каждом старте
  // (идемпотентно): свежий деплой без сида сразу получает рабочий вход в `/admin`
  // во всех трёх школах. `provisionConfiguredSchools` создаёт/обновляет
  // admin@schoolmeet.ru, fullhouse@schoolmeet.ru и anna@schoolmeet.ru.
  try {
    await provisionConfiguredSchools();
    console.log("✓ Школы и гарантированные администраторы готовы");
  } catch (error) {
    // БД может быть временно недоступна — сервер поднимается, а инициализация
    // продублируется лениво при первом входе (`ensureUserSchoolMembership`).
    console.error("[startup] Не удалось инициализировать школы и администратора:", error);
  }

  // Хвосты после падения/редеплоя: зависшая посещаемость и «фантомные» активные
  // уроки. Best-effort: сбой обслуживания не мешает серверу подняться.
  try {
    await runStartupMaintenance();
  } catch (error) {
    console.error("[startup] Обслуживание БД не выполнено:", error);
  }

  const app = next({ dev, hostname: host, port });
  const handle = app.getRequestHandler();

  await app.prepare();

  const server = createServer((req, res) => {
    void handle(req, res);
  });

  attachRealtime(server);

  server.listen(port, host, () => {
    const mode = dev ? "development" : "production";
    console.log(`▲ EduFlow (${mode}) готов: http://${host}:${port}`);
    console.log(`  Socket.IO: ${"/socket.io"} (тот же порт)`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    // Не ждём открытые сокеты дольше пары секунд.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Не удалось запустить сервер:", error);
  process.exit(1);
});
