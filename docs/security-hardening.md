# Ужесточение безопасности и надёжности

Документ фиксирует, **что изменено кодом** после независимого ревью
(`INDEPENDENT-REVIEW.md`), и **что осталось сделать руками** — с точными шагами.
Каждый пункт из раздела 1 покрыт регрессионным тестом (`npm run test:hardening`,
`npm run test:security`), то есть не может «отвалиться» незаметно.

---

## 1. Что исправлено в коде

### 1.1. P0 — доступ администратора по умолчанию

**Было:** в публичном репозитории лежали пароли bootstrap-админов
(`Admin123!`, `Fullhouse123!`, `Anna123!`) и детерминированные admin-invite-токены
(`admin-sinlycem-2026` и др.). Приложение создавало эти аккаунты на любом свежем
деплое, а `POST /api/auth/register` с известным токеном выдавал роль `ADMIN`.
Итог: деплой без переопределённых env можно было забрать в администратора.

**Стало:**

| Что | Изменение |
|---|---|
| Пароли админов | Из исходников удалены полностью. Источник — только `SCHOOLMEET_BOOTSTRAP_ADMIN_PASSWORDS` (legacy-имя `SCHOOLMEET_DEMO_ADMIN_PASSWORDS` поддерживается). Без переменной выдаётся **криптослучайный одноразовый** пароль, который печатается в лог **один раз** — при создании аккаунта |
| Invite-токены | Литералы удалены. Источник — только `SCHOOLMEET_ADMIN_INVITE_TOKENS`. Без переменной школа получает случайный UUID, а ссылка админа видна лишь в админ-панели |
| Повторный запуск | `ensureGuaranteedAdmin` **не изменяет** существующий аккаунт вообще: рестарт больше не снимает бан, не возвращает понижённую роль и не перетирает пароль |
| Условие создания | Bootstrap-админ создаётся, только если в школе **нет ни одного** активного `ADMIN` |
| Ленивый bootstrap при входе | `authorize()` больше не вызывает provisioning, если оператор запретил инициализацию (`SCHOOLMEET_DISABLE_BOOTSTRAP_ADMIN=true`) |
| Публичный `/api/schools/check` | Больше **не пишет** в существующую школу (раньше досыпал токены и синхронизировал классы). Создание осталось только для трёх настроенных школ. Добавлен собственный rate-limit |

**Что должен сделать владелец деплоя (обязательно, 5 минут):**

```bash
# 1. Сгенерировать секреты
openssl rand -base64 32   # для каждого админа
openssl rand -hex 24      # для invite-токена каждой школы

# 2. Задать в панели хостинга:
SCHOOLMEET_BOOTSTRAP_ADMIN_PASSWORDS='{"admin@schoolmeet.ru":"…","fullhouse@schoolmeet.ru":"…","anna@schoolmeet.ru":"…"}'
SCHOOLMEET_ADMIN_INVITE_TOKENS='{"Sinlycem26":"…","Fulhouseteem26":"…","Anna.Terentieva77":"…"}'

# 3. Проверить журнал на подозрительные повышения роли
SELECT "createdAt", action, "userId", details, ip
FROM audit_logs
WHERE action IN ('user.role.change', 'auth.login')
ORDER BY "createdAt" DESC
LIMIT 100;
```

> Если деплой уже работал с прежними значениями — считайте пароли и токены
> скомпрометированными: смените пароли трёх админов в админ-панели и
> перегенерируйте invite-токены (переменная + перезапуск).

### 1.2. Брутфорс и учётные записи

- Новый модуль `src/lib/login-guard.ts`: **5 неудачных попыток за 15 минут**
  блокируют вход в аккаунт на минуту, каждая следующая серия удваивает
  блокировку (до 15 минут). Успешный вход сбрасывает счётчик.
- Пароль и email **не попадают в логи**. Раньше `console.log('[AUTH] Login
  attempt for: <email>')` писал персональные данные школьников в логи хостинга.
- Успешный вход пишется в `AuditLog` (действие `auth.login`) — не чаще одной
  записи на пользователя в час, чтобы не заливать БД.

### 1.3. Rate-limit нельзя обойти заголовком

- `X-Forwarded-For` теперь принимается **только за доверенным прокси**:
  `TRUST_PROXY_HEADERS=true` либо известная платформа (Render/Vercel/Railway/Fly).
- Без доверия в Node-контексте используется **адрес сокета**
  (`socket.handshake.address`) — подделать его клиент не может.
- В middleware без доверенного прокси все локальные запросы делят одну корзину
  (безопаснее, чем позволить клиенту выбирать себе квоту).

### 1.4. Security-заголовки (было: ни одного)

`next.config.mjs` теперь отдаёт на каждый ответ:

| Заголовок | Значение / зачем |
|---|---|
| `Content-Security-Policy` | `default-src 'self'`, внешние скрипты запрещены, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `connect-src 'self' wss:` |
| `X-Frame-Options` | `DENY` — кликджекинг поверх запроса камеры/микрофона невозможен |
| `Strict-Transport-Security` | 2 года, `includeSubDomains`, `preload` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(self)`, `microphone=(self)`, `display-capture=(self)`, `geolocation=()`, `payment=()` |
| `X-Content-Type-Options` | `nosniff` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `X-Powered-By` | отключён (`poweredByHeader: false`) |

### 1.5. Память и производительность

- **Загрузка файлов ДЗ:** размер проверяется по `Content-Length` **до**
  `request.formData()`. Раньше тело уже лежало в памяти, когда «проверяли размер».
- **ИИ:** изображения (Vision) ограничены отдельным, более строгим лимитом —
  2 одновременных запроса вместо 4 (6 МБ base64 на каждый).
- **Аутентификация:** `getSchoolViewer` делает **один** запрос вместо трёх для
  аккаунтов, уже привязанных к школе. `ensureUserSchoolMembership` (тяжёлая
  досыпка) вызывается только для legacy-аккаунтов.
- **Индекс:** `homework_submissions(studentId, status)` — горячие запросы
  дашборда и «мои задания» больше не сканируют таблицу целиком.
- **Файлы ДЗ на эфемерном диске:** вместо молчаливой потери данных на Vercel
  сохраняется явная ошибка `STORAGE_EPHEMERAL` с инструкцией в логе.

### 1.6. Надёжность эксплуатации

- **CI** (`.github/workflows/ci.yml`): `npm ci` → `prisma generate` →
  `tsc --noEmit` → `npm test` → `npm run build` → `npm audit` → скан секретов.
  Раньше ни один PR не запускал тесты.
- **Health-check** `GET /api/health`: проверка БД с таймаутом 3 с, `503` при
  отказе, `Cache-Control: no-store`, никаких секретов наружу.
- **Обслуживание при старте** (`runStartupMaintenance`): закрывает зависшие
  записи посещаемости (`leftAt = null` старше 12 ч) и возвращает «фантомные»
  активные уроки в `idle`. Раньше после рестарта в отчётах и лобби висели
  призраки.
- **Тесты:** добавлен `npm run test:hardening` (28 проверок) на все инварианты
  выше; обновлены `rules`/`security` тесты под новую модель секретов.

---

## 2. Что осталось за пределами кода

Ниже — честный список того, что **нельзя** закрыть правкой файлов в этом
репозитории: нужны внешние сервисы, бюджеты или продуктовые решения.

### 2.1. Мажорное обновление Next.js (1 critical advisory)

`npm audit` показывает `critical` по `next@14.2.35` (DoS через Image Optimizer
и RSC-десериализацию); ветка 14 не получает патчей. Обновление требует
переписать сигнатуры роутов (`params`/`searchParams` стали `Promise`) и
проверить сборку — делать это «слепо», без возможности прогнать `next build`,
опаснее, чем оставить как есть.

**План:**
1. Ветка `chore/next-15`: `npm i next@15 react@19 react-dom@19 @types/react@19`.
2. Механически: `{ params }: { params: { id: string } }` →
   `{ params }: { params: Promise<{ id: string }> }` + `const { id } = await params`
   (34 роута, 8 динамических страниц).
3. `next build` локально, затем зелёный CI, затем прод.
4. После обновления убрать `continue-on-error` у шага `npm audit` в CI — аудит
   станет блокирующим.

### 2.2. Nonce-based CSP

Сейчас `script-src` разрешает `'unsafe-inline'` (Next вставляет inline-скрипты
гидратации). Следующий шаг — nonce через middleware:

```ts
// middleware.ts
const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
// подставить nonce в Content-Security-Policy и передать заголовком x-nonce
```

Next автоматически добавит nonce к своим скриптам. Требует проверки всех
клиентских виджетов (Fabric.js, KaTeX, Web Speech) на отсутствие inline-обработчиков.

### 2.3. Redis: rate-limit и Socket.IO

Счётчики лимитов, блокировки входа, комнаты, доска и «закреплённые сообщения»
живут в памяти процесса. Это корректно для **одного** инстанса; при
горизонтальном масштабировании нужен:

```bash
npm i @socket.io/redis-adapter ioredis
```

```ts
const pub = new Redis(process.env.REDIS_URL!);
const sub = pub.duplicate();
io.adapter(createAdapter(pub, sub));
```

и отдельное хранилище для `rate-limit.ts` / `login-guard.ts` (Redis `INCR` + `EXPIRE`).

### 2.4. Объектное хранилище для файлов ДЗ

Локальный диск не переживает serverless и редеплой Render. Нужен S3/R2:
presigned PUT (браузер грузит напрямую) + presigned GET в маршруте
`/api/homework/[id]/files/[fileId]`. Пока `FILES_PERSISTENT` не задан, Vercel
честно отвечает ошибкой вместо тихой потери файла.

### 2.5. Миграции БД

Сейчас схема накатывается `prisma db push` — истории и отката нет. Порядок
перехода (нужен доступ к БД разработчика):

```bash
# 1. Снять baseline с текущей схемы
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/0001_baseline/migration.sql

# 2. Пометить baseline применённым на существующих базах
npx prisma migrate resolve --applied 0001_baseline

# 3. Дальше — только migrate deploy в деплое
npx prisma migrate deploy
```

`db:push` оставить для локальной разработки.

### 2.6. Артефакты в git (96 МБ `.exe`)

`public/eduflow-setup.exe` (96 МБ) увеличивает клон и деплой. Перенос:

```bash
gh release upload v1.0.0 public/eduflow-setup.exe
git rm --cached public/eduflow-setup.exe
echo "public/eduflow*.exe" >> .gitignore
```

на лендинге — ссылка на `releases/latest/download/eduflow-setup.exe`.
**Не сделано автоматически:** это ломает работающую кнопку скачивания, нужно
согласие владельца на смену способа доставки.

### 2.7. Подтверждение email и сброс пароля

Требуют провайдера писем (Resend/Postmark/SES) и шаблонов. Сейчас пароль
меняет администратор школы. Рекомендуемая схема: `PasswordResetToken`
(хеш токена, TTL 1 час, одноразовый) + письмо со ссылкой; email подтверждается
до выдачи роли выше `STUDENT`.

### 2.8. Наблюдаемость

`console.error` — единственный канал. Нужны Sentry (frontend + server),
метрики Socket.IO и алерт на `/api/health != 200`.

---

## 3. Как проверить, что ничего не откатилось

```bash
npm run test:hardening   # 28 проверок на инварианты этого документа
npm test                 # полный набор (478 проверок)
npx tsc --noEmit         # после prisma generate
```

CI выполняет то же самое на каждый PR, плюс сборку и скан секретов.
