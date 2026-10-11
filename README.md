# schoolmeet

**SchoolMeet** — платная школьная платформа видеозвонков и уроков с ИИ-доской и расписанием
(аналог Zoom, адаптированный под школу).

Этап 5 — расписание для 5–11 классов (День/Неделя, статусы уроков, красная линия текущего времени,
проверка пересечений), домашние задания с дедлайнами (🟢 >24ч · 🟡 <24ч · 🔴 <1ч · ⚫ просрочено),
загрузка файлов (drag-drop, автосохранение черновика каждые 10 с) и проверка учителем с черновиком ИИ.

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
src/middleware.ts                  Rate-limit -> сессия -> RBAC для /admin -> бан: защита /dashboard,
                                   /meeting, /schedule, /homework, /admin
src/lib/auth.ts                    NextAuth: CredentialsProvider, JWT/session callbacks с id и role
src/lib/password.ts                bcryptjs: hashPassword() / verifyPassword()
src/lib/validation.ts              Валидация регистрации (общая для API и форм) + контракты ответов
src/lib/auth-errors.ts             Коды ошибок входа → тексты для пользователя
src/lib/prisma.ts                  Singleton PrismaClient
src/lib/rate-limit.ts              Rate-limit (fixed window): 100/мин на IP, /api/auth - 20, /api/admin - 60
src/lib/audit.ts                   Журнал действий: writeAuditLog / listAuditLogs, расшифровка details
src/lib/admin-permissions.ts       Права админ-панели: что ADMIN и TEACHER могут делать с кем
src/lib/admin-stats.ts             Метрики обзора: ученики, учителя, активные уроки, ДЗ, графики классов
src/lib/admin-users.ts             Поиск/фильтры пользователей, создание, смена роли и класса, сброс пароля
src/lib/admin-meetings.ts          Активные уроки и принудительное завершение (через Socket.IO)
src/lib/attendance.ts              Посещаемость: вход/выход, длительность, «зависшие» записи
src/lib/announcements.ts           Объявления школы: валидация, публикация, выборка для зрителя
src/lib/realtime-control.ts        Мост «API <-> Socket.IO»: живые комнаты, закрытие урока, отключение сессий
src/app/api/auth/[...nextauth]     Обработчик NextAuth (вход, выход, сессия, CSRF)
src/app/api/auth/register          POST-регистрация: валидация → уникальность email → bcrypt → БД
src/app/api/admin/stats|users|…    Админ-API: метрики, пользователи, уроки, посещаемость, объявления, аудит
src/app/api/announcements          Активные объявления для баннера на /dashboard (с учётом класса)
src/app/admin/*                    Админ-панель: обзор, пользователи, активные уроки, объявления, журнал
src/app/banned/page.tsx            Экран «аккаунт заблокирован администратором» + выход из аккаунта
src/components/admin/              Таблица пользователей, модалки, графики (SVG), доска активных уроков
src/components/dashboard/announcement-banner.tsx Плавающий баннер объявлений школы
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
| `/banned`                     | Заблокированный аккаунт (остальным — `/dashboard`) |
| `/api/admin/*`                | Только `ADMIN` и `TEACHER` (по правам роли) |

- Сессия — подписанный JWT (30 дней); `id` и `role` кладутся в токен в `jwt`-callback
  и доступны как `session.user.id` / `session.user.role` на сервере и на клиенте.
- `src/middleware.ts` проверяет cookie до рендера страницы: без сессии — редирект на
  `/login?callbackUrl=...`, а ученика на `/admin` возвращает в `/dashboard?denied=/admin`.
- Пароли хешируются bcrypt (10 раундов). Роль `ADMIN` через `POST /api/auth/register`
  выдать нельзя — только `STUDENT` или `TEACHER` (админа создаёт сид).
- `POST /api/auth/register` отвечает `201` с созданным пользователем, `409` при занятом
  email, `422` с ошибками по полям и `500` при недоступной БД.
- Блокировка (`isBanned`) проверяется на входе (пароль не принимается, код `ACCOUNT_BANNED`),
  в middleware (страницы → `/banned`, API → `403 ACCOUNT_BANNED`) и при рукопожатии Socket.IO.
  Смена роли и блокировка применяются к живой сессии в течение минуты (`jwt`-callback
  перечитывает роль/бан из БД), а активное соединение разрывается сразу: сокет получает
  `session-revoked`.

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
- **AttendanceRecord** — `id`, `meetingId`, `userId`, `joinedAt`, `leftAt`, `durationMinutes`:
  вход в урок и выход из него (пишется Socket.IO-сервером, «зависшие» записи закрываются по таймауту).
- **Announcement** — `id`, `title`, `content`, `targetGrade` (класс 5–11 или `null` — вся школа),
  `authorId`, `isActive`, `createdAt`: общешкольные объявления для баннера на дашборде.
- **AuditLog** — `id`, `userId`, `action`, `details` (JSON-строка), `ip`, `createdAt`: журнал
  действий администрации (роли, баны, сброс пароля, завершение урока, объявления).
- **User.isBanned** — блокировка аккаунта администратором: вход запрещён, сессии разрываются.

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
- **Rate-limit** (`src/lib/rate-limit.ts`, `middleware.ts`): не более 100 запросов в минуту с одного IP,
  для `/api/auth` — 20 (защита от подбора пароля), для `/api/admin` — 60, для рукопожатий Socket.IO — 40.
  Превышение — `429` с `Retry-After` (страницы получают понятную HTML-заглушку), ответы несут заголовки
  `X-RateLimit-*`. Хранилище — в памяти процесса: при нескольких инстансах нужен Redis.
- **Админ-панель** (`/admin`) доступна только `ADMIN` и `TEACHER`, ученик получает редирект
  `/dashboard?denied=...`; API проверяет права повторно (`requireCapability`) — интерфейс не является
  защитой. Все изменения (роли, бан, пароль, завершение урока, объявления) пишутся в `AuditLog`
  вместе с IP автора; журнал виден только администратору.
- Заблокированный аккаунт немедленно теряет живое соединение (`session-revoked`), а его сокет-сессии
  принудительно закрываются; вход и рукопожатие Socket.IO отклоняются с `ACCOUNT_BANNED`.
- Принудительное завершение урока («Завершить урок» в `/admin/meetings`) рассылает участникам
  `room-closed`, закрывает записи посещаемости и на 30 минут запрещает вход ученикам
  (ведущий и администратор могут вернуться, чтобы не потерять урок).
- Реальный `.env` в репозиторий не попадает (см. `.gitignore`), в git лежит только `.env.example`.

## Статус этапов

- ✅ **Этап 1** — фундамент и лендинг.
- ✅ **Этап 2** — авторизация (NextAuth + bcrypt), роли, защита маршрутов, кабинет и админ-панель.
- ✅ **Этап 3** — видеозвонки WebRTC (mesh), realtime на Socket.IO, чат с AES-256, предпроверка
  устройств, сетка видео 1/2/4/9, подсветка говорящего, таймер звонка, новая палитра сайта.
- ✅ **Этап 4** — интерактивная доска (Fabric.js, Undo/Redo, страницы, PNG, синхронизация и
  курсоры через Socket.IO, права учителя), голосовой ввод (Web Speech API), MockAIProvider
  с черчением и LaTeX-формулами, ИИ-панель учителя (только TEACHER / ADMIN).
- ✅ **Этап 5** — расписание 5–11 классов (`/schedule`, ученик видит только свой класс, учитель —
  свои уроки), домашние задания (`/homework`), файлы в `UPLOAD_DIR`, виджеты дашборда. ИИ-черновик
  проверки (`MockAIProvider`, только TEACHER / ADMIN) виден только учителю; ученик получает оценку
  после «Утвердить и отправить». Тесты правил: `npm run test:rules`.
- ✅ **Этап 6** — админ-панель `/admin`: обзор школы с метриками и SVG-графиками (активность по дням
  недели, успеваемость 5–11 классов), управление пользователями (поиск, фильтры, создание и правка,
  сброс пароля, бан с мгновенным разрывом сессий), активные уроки и посещаемость с принудительным
  завершением через Socket.IO, общешкольные объявления с баннером на дашборде, журнал действий
  (`AuditLog`) и rate-limit в middleware. Демо-данные: `npm run db:seed`.
- ⏭ Следующий этап — подключение внешнего ИИ (GPT-4o Vision) в финале проекта.
