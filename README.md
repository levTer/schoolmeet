# schoolmeet

**SchoolMeet** — платная школьная платформа видеозвонков и уроков с ИИ-доской и расписанием
(аналог Zoom, адаптированный под школу).

Этап 4 — интерактивная доска и ИИ-архитектура: Fabric.js-доска (карандаш, фигуры, стрелки,
текст, стикеры, ластик, лассо, Undo/Redo, страницы, экспорт PNG) с realtime-синхронизацией
через Socket.IO и курсорами участников; голосовой ввод через нативный Web Speech API;
ИИ-помощник учителя на **локальном MockAIProvider** (без внешних нейросетей) с черчением
по JSON-инструкциям и «распознаванием» формул в LaTeX.

## Стек

| Слой        | Технологии                                              |
| ----------- | ------------------------------------------------------- |
| Фронтенд    | Next.js 14 (App Router), TypeScript, Tailwind CSS, ESLint |
| Состояние   | Zustand                                                  |
| Реальное время | Socket.IO (сервер + клиент), нативный WebRTC (`RTCPeerConnection`) |
| Доска       | Fabric.js + GPT-4o Vision (OpenAI SDK)                   |
| БД / ORM    | PostgreSQL + Prisma                                      |
| Авторизация | NextAuth.js, bcryptjs                                    |
| Шифрование  | crypto-js (AES-256-CBC + HMAC-SHA256 для чата)           |
| Утилиты     | clsx, tailwind-merge, date-fns, lucide-react             |

## Быстрый старт

```bash
# 1. Зависимости
npm install

# 2. Окружение
cp .env.example .env      # затем заполните DATABASE_URL, NEXTAUTH_SECRET, OPENAI_API_KEY

# 3. База данных (нужен запущенный PostgreSQL)
npx prisma generate       # генерация клиента
npx prisma migrate dev --name init

# 4. Демо-аккаунты и запуск
npm run db:seed           # admin@ / teacher@ / student@schoolmeet.dev
npm run dev               # http://localhost:3000 (Next.js и Socket.IO на одном порту)
```

Полезные команды:

```bash
npm run build      # прод-сборка
npm run start      # прод-сервер (server.ts: Next.js + Socket.IO), нужен npm run build
npm run lint       # ESLint
npm run db:seed    # демо-аккаунты (пароль из SEED_PASSWORD)
npm run db:push    # синхронизация схемы без миграций
npm run db:studio  # веб-UI для просмотра данных
```

## Структура

```
prisma/schema.prisma               Enum Role + модели User / Meeting / Schedule / ChatMessage
prisma/seed.mjs                    Демо-аккаунты ADMIN / TEACHER / STUDENT (npm run db:seed)
src/middleware.ts                  Защита /dashboard, /meeting, /schedule, /admin + RBAC для /admin
src/lib/auth.ts                    NextAuth: CredentialsProvider, JWT/session callbacks с id и role
src/lib/password.ts                bcryptjs: hashPassword() / verifyPassword()
src/lib/validation.ts              Валидация регистрации (общая для API и форм) + контракты ответов
src/lib/auth-errors.ts             Коды ошибок входа → тексты для пользователя
src/lib/prisma.ts                  Singleton PrismaClient
src/app/api/auth/[...nextauth]     Обработчик NextAuth (вход, выход, сессия, CSRF)
src/app/api/auth/register          POST-регистрация: валидация → уникальность email → bcrypt → БД
src/app/login|register             Страницы входа и регистрации (формы в src/components/auth)
src/app/dashboard|admin            Кабинет пользователя и админ-панель (ADMIN / TEACHER)
server.ts                          Точка входа: один HTTP-сервер для Next.js и Socket.IO (dev и start)
src/server/realtime.ts             Socket.IO: авторизация по JWT-сессии, проверка Origin, комнаты,
                                   signal / raise-hand / chat-message, лимиты и история чата
src/lib/realtime.ts                Контракт событий Socket.IO, лимиты, проверка кода комнаты
src/lib/crypto.ts                  encryptMessage / decryptMessage: AES-256-CBC + HMAC (crypto-js)
src/lib/lesson-code.ts             Читаемые коды уроков (matematika-101-klass) с суффиксом при коллизии
src/lib/meetings.ts                Доступ к данным уроков и сообщений чата (Prisma)
src/lib/webrtc-config.ts           ICE-серверы из NEXT_PUBLIC_ICE_SERVERS (по умолчанию STUN)
src/app/api/meetings/route.ts      POST — создать урок (только TEACHER / ADMIN)
src/app/api/meetings/[code]/route.ts GET — урок по коду для участника (нужна сессия)
src/app/meeting/page.tsx           Лобби: создание урока для учителя, вход по коду для ученика
src/app/meeting/[id]/page.tsx      Комната урока: предпроверка устройств и звонок
src/hooks/useSocket.ts             Подключение Socket.IO, подписка на события комнаты, переподключение
src/hooks/useWebRTC.ts             Камера, микрофон, демонстрация экрана, RTCPeerConnection mesh
src/hooks/useSpeakingIndicator.ts  Определение говорящего по уровню звука (AnalyserNode)
src/hooks/useElapsed.ts            Таймер длительности звонка
src/hooks/useWhiteboard.ts         Доска Fabric.js: инструменты, Undo/Redo, страницы, синхронизация
src/hooks/useVoiceInput.ts         Голосовой ввод через нативный Web Speech API (без серверов)
src/lib/ai-provider.ts             AIProvider + MockAIProvider: русские конспекты/решения/формулы
src/lib/drawing-engine.ts          JSON-инструкции ИИ → фигуры Fabric.js (треугольники, графики…)
src/app/api/ai/route.ts            POST/GET — ИИ-помощник (ТОЛЬКО TEACHER / ADMIN, STUDENT → 403)
src/components/meeting/            MeetingRoom, PreJoinScreen, VideoGrid, Controls, Chat, MeetingLobby,
                                   Whiteboard (доска + курсоры), AIAssistant (панель учителя)
src/components/ui/                 Поля формы, градиентная кнопка, алерты, Markdown-рендер
src/components/layout/app-shell.tsx Каркас внутренних страниц: навбар + контент
src/components/layout/Navbar.tsx   Шапка с профилем, ролью и кнопкой «Выйти» (signOut)
src/components/layout/app-shell.tsx Каркас внутренних страниц: навбар + контент
src/components/auth/               AuthShell и формы входа/регистрации
src/components/providers.tsx       SessionProvider для клиентских компонентов
src/components/landing/            Секции лендинга (шапка, hero, мокап урока, фичи, футер)
src/lib/utils.ts                   cn(), sanitizeRedirectPath(), код комнаты, инициалы, время
src/types/index.ts                 Интерфейсы User / Meeting / Schedule / ChatMessage, роли, права
src/types/next-auth.d.ts           Расширение типов сессии NextAuth полем role
```

## Авторизация и роли

| Маршрут                       | Доступ                                  |
| ----------------------------- | --------------------------------------- |
| `/`, `/login`, `/register`    | Публично                                |
| `/dashboard`, `/schedule`, `/meeting` | Любая авторизованная роль      |
| `/admin`                      | Только `ADMIN` и `TEACHER`              |

- Сессия — подписанный JWT (30 дней); `id` и `role` кладутся в токен в `jwt`-callback
  и доступны как `session.user.id` / `session.user.role` на сервере и на клиенте.
- `src/middleware.ts` проверяет cookie до рендера страницы: без сессии — редирект на
  `/login?callbackUrl=...`, а ученика на `/admin` возвращает в `/dashboard?denied=/admin`.
- Пароли хешируются bcrypt (10 раундов). Роль `ADMIN` через `POST /api/auth/register`
  выдать нельзя — только `STUDENT` или `TEACHER` (админа создаёт сид).
- `POST /api/auth/register` отвечает `201` с созданным пользователем, `409` при занятом
  email, `422` с ошибками по полям и `500` при недоступной БД.

Демо-аккаунты после `npm run db:seed` (пароль задаётся `SEED_PASSWORD`, по умолчанию
`schoolmeet`): `admin@schoolmeet.dev`, `teacher@schoolmeet.dev`, `student@schoolmeet.dev`.
Подсказки с демо-доступами на странице входа включаются флагом
`NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS=1` (по умолчанию выключены).

## Модель данных

- **Role** — `ADMIN`, `TEACHER`, `STUDENT`.
- **User** — `id`, `email`, `password` (bcrypt), `name`, `role`, `avatar`, `createdAt`.
- **Meeting** — `id`, `title`, `meetingCode`, `hostId`, `startTime`, `endTime`, `isActive`, `encryptionKey`.
- **Schedule** — `id`, `title`, `subject`, `teacherId`, `dayOfWeek` (1–7 по ISO), `startTime`/`endTime`
  (`"HH:mm"`), `meetingId`.
- **ChatMessage** — `id`, `meetingId`, `userId`, `content`, `encrypted`, `createdAt`.

Права ролей описаны в `ROLE_PERMISSIONS` (`src/types/index.ts`): учитель планирует расписание и
ведёт доску, ученик только просматривает расписание и участвует в уроке.

## Безопасность

- Пароли хранятся в виде bcrypt-хешей, поле `password` никогда не отдаётся клиенту (см. `SafeUser`).
- Звонки и realtime доступны только с действующей сессией NextAuth: Socket.IO проверяет JWT-cookie
  при рукопожатии, а подключения с чужим `Origin` отклоняются.
- Сообщения чата шифруются AES-256 (crypto-js, AES-256-CBC + HMAC-SHA256) перед отправкой; сервер
  хранит и пересылает только шифротекст. Ключ урока (`encryptionKey`, уникален для каждого урока)
  выдаётся только участникам после входа, поэтому это шифрование при хранении и передаче, а не
  сквозное шифрование «end-to-end» (сервер может расшифровать сообщения своим ключом).
- Медиапоток идёт напрямую между браузерами по WebRTC/SRTP (mesh: каждый с каждым). Сигналинг
  (SDP и ICE) проходит через Socket.IO, медиа через сервер не проходит.
- ИИ-панель и `/api/ai` открыты **только для TEACHER и ADMIN**: ученики не видят UI ИИ, а сервер
  отвечает на любые вызовы `/api/ai` статусом **403 Forbidden**. На этапе 4 ИИ работает полностью
  локально (`MockAIProvider`) — данные никуда не отправляются, внешние нейросети не вызываются.
- Доска: события рисования (`whiteboard-*`) проверяются на сервере — учитель решает, кто рисует
  («Рисуют все» / «Рисует учитель»), а перегрузка событиями ограничена рейт-лимитами.
- Для работы в школьных сетях с симметричным NAT нужен TURN-сервер (см. `NEXT_PUBLIC_ICE_SERVERS`).
- Реальный `.env` в репозиторий не попадает (см. `.gitignore`), в git лежит только `.env.example`.

## Статус этапов

- ✅ **Этап 1** — фундамент и лендинг.
- ✅ **Этап 2** — авторизация (NextAuth + bcrypt), роли, защита маршрутов, кабинет и админ-панель.
- ✅ **Этап 3** — видеозвонки WebRTC (mesh), realtime на Socket.IO, чат с AES-256, предпроверка
  устройств, сетка видео 1/2/4/9, подсветка говорящего, таймер звонка, новая палитра сайта.
- ✅ **Этап 4** — интерактивная доска (Fabric.js, Undo/Redo, страницы, PNG, синхронизация и
  курсоры через Socket.IO, права учителя), голосовой ввод (Web Speech API), MockAIProvider
  с черчением и LaTeX-формулами, ИИ-панель учителя (только TEACHER / ADMIN).
- ⏭ Следующий этап — подключение внешнего ИИ (GPT-4o Vision) в финале проекта.
