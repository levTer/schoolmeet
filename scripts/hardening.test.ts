/**
 * Регрессионные тесты ужесточения безопасности и надёжности (`HARDENING`).
 *
 * Запуск: `npm run test:hardening` (входит в `npm test`). База данных и сеть не
 * нужны: проверяются чистые модули и контракты исходников.
 *
 * Покрывает то, что раньше проверялось «глазами»:
 *  1. P0 — в репозитории нет паролей и invite-токенов администратора;
 *  2. блокировка аккаунта после серии неудачных входов (brute-force);
 *  3. доверие `X-Forwarded-For` только за доверенным прокси;
 *  4. security-заголовки и CSP в `next.config.mjs`;
 *  5. гейт размера загрузки ДО буферизации multipart;
 *  6. лимиты памяти ИИ (Vision) и отдельный потолок для изображений;
 *  7. health-check, обслуживание БД при старте и индексы под горячие запросы;
 *  8. CI, который действительно запускает тесты и сборку.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  HOMEWORK_LIMITS,
  isUploadLengthAllowed,
} from "../src/lib/homework-rules";
import {
  LOGIN_MAX_FAILURES,
  loginLockStatus,
  registerLoginFailure,
  resetLoginFailures,
  resetLoginGuard,
  trackedLoginAccounts,
} from "../src/lib/login-guard";
import {
  getClientIp,
  getClientIpFromNodeHeaders,
  trustProxyHeaders,
} from "../src/lib/rate-limit";
import { generateBootstrapPassword, GUARANTEED_ADMINS } from "../src/lib/school-config";
import { classCodeGrantSecret } from "../src/lib/class-code";
import { getPasswordIssues } from "../src/lib/validation";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

function sourceWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* -------------------------------------------------------------------------- */
/* 1. P0: секретов администратора в репозитории нет                            */
/* -------------------------------------------------------------------------- */

describe("P0: в репозитории нет секретов администратора", () => {
  it("school-config не содержит паролей и invite-токенов литералами", () => {
    const config = sourceWithoutComments(readSource("src/lib/school-config.ts"));

    for (const leaked of ["Admin123!", "Fullhouse123!", "Anna123!", "admin-sinlycem-2026", "admin-fulhouse-2026", "admin-annat-2026"]) {
      assert.ok(!config.includes(leaked), `в исходнике остался секрет: ${leaked}`);
    }

    // Значения приходят только из окружения.
    assert.match(config, /SCHOOLMEET_ADMIN_INVITE_TOKENS/);
    assert.match(config, /SCHOOLMEET_BOOTSTRAP_ADMIN_PASSWORDS/);
    // Legacy-имя переменной поддерживается, чтобы деплои не сломались.
    assert.match(config, /SCHOOLMEET_DEMO_ADMIN_PASSWORDS/);
  });

  it("bootstrap-админы не несут пароль без переменной окружения", () => {
    for (const admin of GUARANTEED_ADMINS) {
      assert.equal("password" in admin, false, `${admin.email}: пароль должен приходить только из env`);
    }
  });

  it("одноразовый пароль случаен и проходит политику пароля", () => {
    const first = generateBootstrapPassword();
    const second = generateBootstrapPassword();
    assert.notEqual(first, second);
    assert.equal(getPasswordIssues(first).length, 0);
    assert.equal(getPasswordIssues(second).length, 0);
  });

  it("provisioning не обновляет существующего администратора", () => {
    const schools = readSource("src/lib/schools.ts");
    const body = schools.slice(schools.indexOf("async function ensureGuaranteedAdmin"));
    const end = body.indexOf("let defaultSchoolPromise");
    const fn = body.slice(0, end > 0 ? end : undefined);

    assert.match(fn, /if \(existing\) return;/, "существующий админ должен оставаться нетронутым");
    assert.ok(!/db\.user\.update\(/.test(fn), "рестарт не должен менять администратора (бан/роль/пароль)");
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Блокировка подбора пароля                                               */
/* -------------------------------------------------------------------------- */

describe("защита входа от подбора пароля", () => {
  it("блокирует аккаунт после серии провалов и считает retryAfter", () => {
    resetLoginGuard();
    const email = "student@school.ru";
    const now = 1_000_000;

    for (let attempt = 1; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      const status = registerLoginFailure(email, now);
      assert.equal(status.locked, false, `блокировка включилась раньше ${LOGIN_MAX_FAILURES} провалов`);
    }

    const locked = registerLoginFailure(email, now);
    assert.equal(locked.locked, true, "после лимита провалов аккаунт должен блокироваться");
    assert.ok(locked.retryAfterSeconds > 0, "нет Retry-After");

    // Блокировка действует и проверяется отдельно.
    assert.equal(loginLockStatus(email, now + 1_000).locked, true);
    // По истечении — снимается автоматически.
    assert.equal(loginLockStatus(email, now + locked.retryAfterSeconds * 1_000 + 1).locked, false);
  });

  it("следующая серия провалов удваивает блокировку", () => {
    resetLoginGuard();
    const email = "teacher@school.ru";
    const now = 5_000_000;

    for (let index = 0; index < LOGIN_MAX_FAILURES; index += 1) registerLoginFailure(email, now);
    const first = loginLockStatus(email, now);
    assert.equal(first.locked, true);

    // Имитируем продолжение после истечения первой блокировки.
    const later = now + first.retryAfterSeconds * 1_000 + 1_000;
    for (let index = 0; index < LOGIN_MAX_FAILURES; index += 1) registerLoginFailure(email, later);
    const second = loginLockStatus(email, later);

    assert.equal(second.locked, true);
    assert.ok(
      second.retryAfterSeconds > first.retryAfterSeconds,
      "вторая блокировка должна быть строже первой",
    );
  });

  it("успешный вход сбрасывает счётчик провалов", () => {
    resetLoginGuard();
    const email = "ivan@school.ru";
    const now = 9_000_000;

    for (let index = 0; index < LOGIN_MAX_FAILURES - 1; index += 1) registerLoginFailure(email, now);
    resetLoginFailures(email);
    assert.deepEqual(loginLockStatus(email, now), { locked: false, retryAfterSeconds: 0, failures: 0 });

    // Счётчик начинается заново: одного провала мало для блокировки.
    assert.equal(registerLoginFailure(email, now).locked, false);
  });

  it("не пухнет бесконечно и нормализует email", () => {
    resetLoginGuard();
    registerLoginFailure("  Anna@School.RU ", 1);
    assert.equal(loginLockStatus("anna@school.ru", 2).failures, 1, "email не нормализуется");
    assert.ok(trackedLoginAccounts() <= 1, "счётчик создаёт лишние записи");
  });

  it("auth.ts использует блокировку и не логирует email", () => {
    const auth = readSource("src/lib/auth.ts");
    assert.match(auth, /loginLockStatus\(/, "вход не проверяет блокировку");
    assert.match(auth, /registerLoginFailure\(/, "неудачный вход не учитывается");
    assert.match(auth, /resetLoginFailures\(/, "успешный вход не сбрасывает счётчик");

    // Персональные данные в логах: ищем интерполяцию email в console.*.
    const logs = auth.match(/console\.(log|warn|error)\([^)]*\)/g) ?? [];
    for (const line of logs) {
      assert.ok(!/\$\{cleanEmail\}|\$\{email\}/.test(line), `email попадает в лог: ${line.slice(0, 80)}`);
    }
    assert.ok(!/Login attempt for/.test(auth), "лог входа всё ещё печатает email");
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Доверие X-Forwarded-For                                                 */
/* -------------------------------------------------------------------------- */

describe("rate-limit: X-Forwarded-For только за доверенным прокси", () => {
  const headersWithXff = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1", "x-real-ip": "5.6.7.8" });

  it("по умолчанию заголовкам не доверяет", () => {
    assert.equal(trustProxyHeaders({}), false, "без платформы и флага заголовки не доверенные");
    assert.equal(trustProxyHeaders({ NODE_ENV: "production" }), false);
  });

  it("доверяет известным платформам и явному флагу", () => {
    assert.equal(trustProxyHeaders({ RENDER: "true" }), true);
    assert.equal(trustProxyHeaders({ VERCEL: "1" }), true);
    assert.equal(trustProxyHeaders({ FLY_APP_NAME: "eduflow" }), true);
    assert.equal(trustProxyHeaders({ TRUST_PROXY_HEADERS: "true" }), true);
    // Явный `false` сильнее платформы: оператор знает лучше.
    assert.equal(trustProxyHeaders({ RENDER: "true", TRUST_PROXY_HEADERS: "false" }), false);
  });

  it("без доверия IP из заголовков не берётся — квоту нельзя подделать", () => {
    assert.equal(getClientIp(headersWithXff, { trusted: false }), "unknown");
    assert.equal(getClientIp(headersWithXff, { trusted: true }), "1.2.3.4");
  });

  it("в Node-контексте без доверия используется адрес сокета", () => {
    const ip = getClientIpFromNodeHeaders(
      { "x-forwarded-for": "1.2.3.4" },
      "::ffff:203.0.113.9",
      { trusted: false },
    );
    assert.equal(ip, "203.0.113.9", "адрес пира должен быть источником истины");

    const trusted = getClientIpFromNodeHeaders({ "x-forwarded-for": "1.2.3.4" }, "203.0.113.9", { trusted: true });
    assert.equal(trusted, "1.2.3.4");
  });

  it("Socket.IO передаёт адрес сокета в rate-limit", () => {
    const realtime = readSource("src/server/realtime.ts");
    assert.match(
      realtime,
      /getClientIpFromNodeHeaders\(socket\.handshake\.headers, socket\.handshake\.address\)/,
      "рукопожатие считает лимит по подделываемому заголовку",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Security-заголовки                                                      */
/* -------------------------------------------------------------------------- */

describe("security-заголовки и CSP", () => {
  const config = readSource("next.config.mjs");

  it("объявлены обязательные заголовки", () => {
    for (const header of [
      "Content-Security-Policy",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Cross-Origin-Opener-Policy",
      "Permissions-Policy",
      "Strict-Transport-Security",
    ]) {
      assert.ok(config.includes(header), `нет заголовка ${header}`);
    }
  });

  it("CSP закрывает кликджекинг, внешние скрипты и эксфильтрацию", () => {
    assert.match(config, /frame-ancestors 'none'/, "нет frame-ancestors");
    assert.match(config, /X-Frame-Options", value: "DENY"/, "нет X-Frame-Options: DENY");
    assert.match(config, /script-src 'self'/, "script-src не ограничен своим origin");
    assert.match(config, /object-src 'none'/, "нет object-src 'none'");
    assert.match(config, /base-uri 'self'/, "нет base-uri");
    assert.match(config, /connect-src 'self'/, "connect-src не ограничен");
    assert.match(config, /upgrade-insecure-requests/);
  });

  it("камера и микрофон разрешены только своему origin", () => {
    assert.match(config, /camera=\(self\)/);
    assert.match(config, /microphone=\(self\)/);
    assert.match(config, /geolocation=\(\)/);
  });

  it("версия фреймворка не раскрывается", () => {
    assert.match(config, /poweredByHeader: false/);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Загрузка файлов: размер проверяется до буферизации                      */
/* -------------------------------------------------------------------------- */

describe("загрузка файлов ДЗ", () => {
  it("гейт по Content-Length работает до разбора multipart", () => {
    assert.equal(isUploadLengthAllowed(null), true, "chunked-запрос без заголовка должен проходить");
    assert.equal(isUploadLengthAllowed(String(HOMEWORK_LIMITS.maxUploadRequestBytes)), true);
    assert.equal(isUploadLengthAllowed(String(HOMEWORK_LIMITS.maxUploadRequestBytes + 1)), false);
    assert.equal(isUploadLengthAllowed("999999999999"), false, "огромное тело должно отсекаться");
    assert.equal(isUploadLengthAllowed("abc"), false, "мусор в заголовке должен отсекаться");
  });

  it("маршрут проверяет Content-Length ДО request.formData()", () => {
    const route = readSource("src/app/api/homework/[id]/files/route.ts");
    const gateIndex = route.indexOf("isUploadLengthAllowed(request.headers.get(\"content-length\"))");
    const formDataIndex = route.indexOf("await request.formData()");

    assert.ok(gateIndex > 0, "нет гейта по Content-Length");
    assert.ok(formDataIndex > 0, "не найден разбор multipart");
    assert.ok(
      gateIndex < formDataIndex,
      "размер проверяется после того, как тело уже прочитано в память",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Лимиты памяти ИИ                                                        */
/* -------------------------------------------------------------------------- */

describe("ИИ: потолки одновременной работы", () => {
  const route = readSource("src/app/api/ai/route.ts");

  it("изображения ограничены отдельным, более строгим лимитом", () => {
    assert.match(route, /MAX_CONCURRENT_VISION_REQUESTS = [1-4]/, "нет лимита на Vision-запросы");
    assert.match(route, /activeVisionRequests/, "лимит объявлен, но не считается");
    assert.match(route, /isVision && activeVisionRequests >= MAX_CONCURRENT_VISION_REQUESTS/);
    assert.match(route, /if \(isVision\) activeVisionRequests -= 1;/, "счётчик Vision не освобождается");
  });

  it("размер изображения и промпта ограничен", () => {
    assert.match(route, /MAX_IMAGE_LENGTH = \d+ \* 1024 \* 1024/);
    assert.match(route, /MAX_PROMPT_LENGTH = \d+/);
  });
});

/* -------------------------------------------------------------------------- */
/* 7. Надёжность эксплуатации                                                 */
/* -------------------------------------------------------------------------- */

describe("надёжность: health-check, обслуживание БД, индексы", () => {
  it("есть /api/health с проверкой БД и без подробностей наружу", () => {
    const health = readSource("src/app/api/health/route.ts");
    assert.match(health, /prisma\.\$queryRaw`SELECT 1`/, "health не проверяет БД");
    assert.match(health, /status: db\.ok \? "ok" : "degraded"/, "нет состояния degraded");
    assert.match(health, /status: db\.ok \? 200 : 503/, "монитор не увидит отказ (нужен 503)");
    assert.match(health, /["']Cache-Control["']\s*:\s*"no-store"/, "ответ health кэшируется");
    assert.ok(!/DATABASE_URL|password/i.test(health), "health отдаёт секреты конфигурации");
  });

  it("при старте закрываются зависшие записи и фантомные уроки", () => {
    const maintenance = readSource("src/lib/startup-maintenance.ts");
    assert.match(maintenance, /finishAllStaleAttendance/);
    assert.match(maintenance, /releaseStaleMeetings/);

    const attendance = readSource("src/lib/attendance.ts");
    assert.match(attendance, /export async function finishAllStaleAttendance/, "нет глобального закрытия посещаемости");
    assert.match(attendance, /leftAt: null, joinedAt: \{ lt: cutoff \}/, "неверный фильтр зависших записей");
    assert.match(attendance, /export async function releaseStaleMeetings/);
    assert.match(attendance, /status: "idle", isActive: false, callStartedAt: null/);

    const server = readSource("server.ts");
    assert.match(server, /await runStartupMaintenance\(\)/, "обслуживание не вызывается при старте");
    assert.match(server, /catch \(error\) \{\s*console\.error\("\[startup\] Обслуживание/, "падение обслуживания роняет сервер");
  });

  it("под горячие запросы ДЗ добавлен составной индекс", () => {
    const schema = readSource("prisma/schema.prisma");
    const model = schema.slice(schema.indexOf("model HomeworkSubmission {"));
    const body = model.slice(0, model.indexOf("\n}"));
    assert.match(body, /@@index\(\[studentId, status\]\)/, "нет индекса (studentId, status) — будет seq scan");
  });

  it("один запрос зрителя вместо трёх для уже привязанных аккаунтов", () => {
    const viewer = readSource("src/lib/school-viewer.ts");
    assert.match(viewer, /const needsMembership =/, "быстрый путь не выделен");
    assert.match(
      viewer,
      /if \(needsMembership\) \{\s*await ensureUserSchoolMembership\(userId\);/,
      "ensureUserSchoolMembership вызывается на каждом запросе",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 8. CI                                                                      */
/* -------------------------------------------------------------------------- */

describe("CI проверяет веб-приложение", () => {
  const ci = readSource(".github/workflows/ci.yml");

  it("запускается на pull_request и push в main", () => {
    assert.match(ci, /pull_request:/);
    assert.match(ci, /branches: \[main\]/);
  });

  it("выполняет линт, типы, тесты и сборку", () => {
    assert.match(ci, /npm ci/);
    assert.match(ci, /prisma generate/, "без генерации клиента типы не проверяются");
    assert.match(ci, /npm run lint/, "нет проверки линта (next build его больше не запускает)");
    assert.match(ci, /tsc --noEmit/, "нет проверки типов");
    assert.match(ci, /npm test/, "тесты не запускаются");
    assert.match(ci, /npm run build/, "сборка не проверяется");
    assert.match(ci, /npm audit --audit-level=high/, "аудит зависимостей не блокирует сборку");
  });

  it("не содержит послаблений: упавший шаг валит пайплайн", () => {
    // `continue-on-error` превращает проверку в декорацию: падение видно, но
    // мерж не блокируется. Такой шаг здесь недопустим.
    assert.ok(!/continue-on-error/.test(ci), "в ci.yml есть continue-on-error");
    for (const workflow of ["android-build.yml", "android-smoke.yml", "build-mac-dmg.yml",
      "build-windows-installer.yml"]) {
      const source = readSource(`.github/workflows/${workflow}`);
      assert.ok(!/continue-on-error/.test(source), `${workflow}: continue-on-error скрывает падение`);
    }
  });
});

describe("допуск по коду класса: секрет не имеет боевого фолбэка", () => {
  const original = { secret: process.env.NEXTAUTH_SECRET, env: process.env.NODE_ENV };

  function restore() {
    if (original.secret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = original.secret;
    process.env.NODE_ENV = original.env;
  }

  it("в production без NEXTAUTH_SECRET бросает, а не подписывает известной строкой", () => {
    try {
      delete process.env.NEXTAUTH_SECRET;
      process.env.NODE_ENV = "production";
      assert.throws(() => classCodeGrantSecret(), /NEXTAUTH_SECRET/);
    } finally {
      restore();
    }
  });

  it("в production использует NEXTAUTH_SECRET", () => {
    try {
      process.env.NEXTAUTH_SECRET = "server-secret";
      process.env.NODE_ENV = "production";
      assert.equal(classCodeGrantSecret(), "server-secret");
    } finally {
      restore();
    }
  });

  it("вне production допускает dev-секрет, чтобы тесты работали без окружения", () => {
    try {
      delete process.env.NEXTAUTH_SECRET;
      process.env.NODE_ENV = "development";
      assert.equal(classCodeGrantSecret(), "schoolmeet-class-code-dev-secret");
    } finally {
      restore();
    }
  });
});
