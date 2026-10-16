# Лицей Сингулярити

**Лицей Сингулярити** — школьная платформа видеозвонков и уроков с ИИ-доской и расписанием
(аналог Zoom, адаптированный под школу). **Проект завершён: этапы 1–8 в main.**

🚀 **Этап 8 (финал)** — 100% бесплатный ИИ-движок и деплой:
- **Groq Cloud** (GPT-OSS 120B / 20B, бесплатный тариф) — конспекты, решения задач, формулы,
  JSON-чертежи, черновики проверки ДЗ; если вендор снял модель — мгновенный перебор списка;
- **Google Gemini Flash** (Vision, бесплатная квота, ключ без карты) — распознавание рукописных
  формул с изображения доски; при 404 модель автоматически заменяется резервной;
- **OpenRouter** (`:free` модели) — резервное звено; **MockAIProvider** — локальный гарант
  работоспособности без единого ключа;
- **AutoAIProvider** — waterfall-цепочка авто-выбора и переключения: изображение → Gemini Vision,
  текст → Groq, сбой/нет ключа → следующий провайдер без падения API;
- **ИИ в РФ без VPN**: все вызовы нейросетей выполняет сервер (`/api/ai` на Vercel, Европа) —
  прокси-посредник; ключи никогда не покидают сервер;
- **WebRTC STUN/TURN**: пул публичных STUN Google + кастомные TURN через `NEXT_PUBLIC_TURN_SERVERS`
  для школьных Wi-Fi с фаерволами;
- **vercel.json** и пошаговое руководство бесплатного деплоя **[DEPLOYMENT.md](DEPLOYMENT.md)**
  (Neon/Supabase → ключи Groq/Gemini → Vercel → prisma db push/seed → PWA/APK).

Этап 7 — дашборд, мобильная адаптация и PWA («Добавить на главный экран»).

Этап 5 — расписание для 5–11 классов (День/Неделя, статусы уроков, красная линия текущего времени,
проверка пересечений), домашние задания с дедлайнами (🟢 >24ч · 🟡 <24ч · 🔴 <1ч · ⚫ просрочено),
загрузка файлов (drag-drop, автосохранение черновика каждые 10 с) и проверка учителем с черновиком ИИ.

Этап 4 — интерактивная доска: Fabric.js-доска (карандаш, фигуры, стрелки,
текст, стикеры, ластик, лассо, Undo/Redo, страницы, экспорт PNG) с realtime-синхронизацией
через Socket.IO и курсорами участников; голосовой ввод через нативный Web Speech API;
ИИ-помощник учителя с черчением по JSON-инструкциям и распознаванием формул в LaTeX.

## Стек

| Слой        | Технологии                                              |
| ----------- | ------------------------------------------------------- |
| Фронтенд    | Next.js 14 (App Router), TypeScript, Tailwind CSS, ESLint |
| Состояние   | Zustand                                                  |
| Реальное время | Socket.IO (сервер + клиент), нативный WebRTC (`RTCPeerConnection`), STUN Google + TURN |
| Доска       | Fabric.js + JSON-чертежи от ИИ                            |
| ИИ-движок   | Groq (Llama 3.3 70B / DeepSeek R1) + Gemini Flash Vision + OpenRouter `:free` + локальный Mock; авто-фоллбэк, нативный `fetch` (без SDK) |
| БД / ORM    | PostgreSQL + Prisma (Neon / Supabase бесплатно)           |
| Авторизация | NextAuth.js, bcryptjs                                    |
| Шифрование  | crypto-js (AES-256-CBC + HMAC-SHA256 для чата)           |
| Деплой      | Vercel (Hobby, бесплатно) + vercel.json — см. [DEPLOYMENT.md](DEPLOYMENT.md) |
| Утилиты     | clsx, tailwind-merge, date-fns, lucide-react             |

## Быстрый старт

```bash
# 1. Зависимости
npm install

# 2. Окружение
cp .env.example .env      # затем заполните DATABASE_URL, NEXTAUTH_SECRET
                          # ИИ-ключи (GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY)
                          # необязательны — без них работает локальный MockAIProvider

# 3. База данных (нужен запущенный PostgreSQL; бесплатно — Neon.tech / Supabase)
npx prisma generate       # генерация клиента
npx prisma db push        # синхронизация схемы (или prisma migrate dev --name init)

# 4. Демо-аккаунты и запуск
npm run db:seed           # admin@ / teacher@ / student@schoolmeet.dev
npm run dev               # http://localhost:3000 (Next.js и Socket.IO на одном порту)
```

Полезные команды:

```bash
npm run build      # прод-сборка (Vercel выполняет её автоматически)
npm run start      # прод-сервер (server.ts: Next.js + Socket.IO), нужен npm run build
npm run lint       # ESLint
npm run test       # смоук-тесты ИИ-движка + тесты правил (сеть и БД не нужны)
npm run db:seed    # демо-аккаунты (пароль из SEED_PASSWORD)
npm run db:push    # синхронизация схемы без миграций
npm run db:studio  # веб-UI для просмотра данных
```

Бесплатный деплой в продакшен (Vercel + Neon + Groq/Gemini) — пошагово в
**[DEPLOYMENT.md](DEPLOYMENT.md)**.

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
src/lib/admin-permissions.ts       Права админ-панели (раздел строго для ADMIN)
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
src/app/dashboard|admin            Кабинет пользователя и админ-панель (только ADMIN)
server.ts                          Точка входа: один HTTP-сервер для Next.js и Socket.IO (dev и start)
src/server/realtime.ts             Socket.IO: авторизация по JWT-сессии, проверка Origin, комнаты,
                                   signal / raise-hand / chat-message, лимиты и история чата,
                                   приватная доставка сообщения только автору и адресату
src/lib/realtime.ts                Контракт событий Socket.IO, лимиты, проверка кода комнаты
src/lib/crypto.ts                  encryptMessage / decryptMessage: AES-256-CBC + HMAC (crypto-js)
src/lib/lesson-code.ts             Читаемые коды уроков (matematika-101-klass) с суффиксом при коллизии
src/lib/meetings.ts                Доступ к данным уроков и сообщений чата (Prisma)
src/lib/chat-rules.ts              Приватные сообщения чата: адресат, видимость, подписи ленты
src/lib/webrtc-config.ts           ICE: пул STUN Google + TURN из NEXT_PUBLIC_TURN_SERVERS
                                   (legacy-override — NEXT_PUBLIC_ICE_SERVERS)
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
src/lib/ai-provider.ts             Контракт ИИ + AutoAIProvider: waterfall-цепочка авто-выбора
                                   (текст → Groq → OpenRouter → Gemini → Mock; изображение доски
                                   → Gemini Vision → OpenRouter Vision → Mock), latexToReadableText
src/lib/ai-providers/types.ts      Общий контракт: AIRequest/AIResponse/DrawingInstruction/статусы
src/lib/ai-providers/shared.ts     Нативный fetch с таймаутом, парсеры JSON/LaTeX, русские промпты
src/lib/ai-providers/groq.ts       Groq Cloud: GPT-OSS 120B/20B + мгновенный перебор моделей
src/lib/ai-providers/gemini.ts     Gemini Flash Vision: формулы с доски, v1beta + перебор моделей
src/lib/ai-providers/openrouter.ts OpenRouter: резервные :free-модели (текст и vision)
src/lib/ai-providers/mock.ts       MockAIProvider: локальные ответы без сети — гарант работоспособности
src/lib/drawing-engine.ts          JSON-инструкции ИИ → фигуры Fabric.js (треугольники, графики…)
src/app/api/ai/route.ts            POST/GET — серверный ИИ-прокси (ТОЛЬКО TEACHER / ADMIN, STUDENT → 403)
src/components/meeting/            MeetingRoom, PreJoinScreen, VideoGrid, Controls, Chat, MeetingLobby,
                                   Whiteboard (доска + курсоры), AIAssistant (панель учителя)
src/components/ui/                 Поля формы, градиентная кнопка, алерты, Markdown-рендер,
                                   каркас модалок modal.tsx (z-[999], центрирование, скролл)
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
| `/admin`, `/admin/*`          | Только `ADMIN` (суперадмин)             |
| `/banned`                     | Заблокированный аккаунт (остальным — `/dashboard`) |
| `/api/admin/*`                | Только `ADMIN` (суперадмин)             |

- Сессия — подписанный JWT (30 дней); `id` и `role` кладутся в токен в `jwt`-callback
  и доступны как `session.user.id` / `session.user.role` на сервере и на клиенте.
- `src/middleware.ts` проверяет cookie до рендера страницы: без сессии — редирект на
  `/login?callbackUrl=...` (для `/api/admin/*` — `401`), а учителя или ученика на `/admin`
  возвращает в `/dashboard?denied=admin` с toast «Доступ открыт только Администратору школы».
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

Кроме сида приложение само создаёт и при каждом старте обновляет **гарантированных
администраторов** всех трёх школ. На странице `/login` демо-кнопок нет — форма входа
чистая, поэтому реквизиты ниже вводятся вручную:

| Школа | Email | Пароль |
|---|---|---|
| Лицей Сингулярити (`Sinlycem26`) | `admin@schoolmeet.ru` | `Admin123!` |
| Fullhouse (`Fulhouseteem26`) | `fullhouse@schoolmeet.ru` | `Fullhouse123!` |
| Anna T (`Anna.Terentieva77`) | `anna@schoolmeet.ru` | `Anna123!` |

Конфигурация хранится в `GUARANTEED_ADMINS` (`src/lib/school-config.ts`), а создание и
обновление выполняет `provisionConfiguredSchools` (`src/lib/schools.ts`). Аккаунты нужны,
чтобы в свежем деплое без сида был рабочий вход в `/admin` для каждой школы: роль `ADMIN`
через публичную регистрацию не выдаётся. После первого входа в продакшен замените эти
демо-пароли через админ-панель.

Email на регистрации и на входе приводится к одному виду — `value.toLowerCase().trim()`
(`src/lib/validation.ts` → `cleanEmail` в `/api/auth/register` и в `authorize` из `src/lib/auth.ts`).
Пароли хранятся только как bcrypt-хеш (bcryptjs, 10 раундов): `src/lib/password.ts`.
После регистрации форма уводит на `/login?registered=true&email=<логин>`, и страница входа
подставляет email в поле ввода автоматически.

## Модель данных

- **Role** — `ADMIN`, `TEACHER`, `STUDENT`.
- **User** — `id`, `email`, `password` (bcrypt), `name`, `role`, `avatar`, `createdAt`.
- **Meeting** — `id`, `title`, `meetingCode`, `hostId`, `startTime`, `endTime`, `isActive`, `encryptionKey`.
- **Schedule** — `id`, `title`, `subject`, `teacherId`, `dayOfWeek` (1–7 по ISO), `startTime`/`endTime`
  (`"HH:mm"`), `meetingId`.
- **ChatMessage** — `id`, `meetingId`, `userId`, `recipientId` (`null` — сообщение видит вся
  комната урока, иначе это приватное сообщение одному участнику), `content`, `encrypted`,
  `createdAt`.
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
- Приватные сообщения урока (`ChatMessage.recipientId`) доставляются только автору и адресату:
  сервер отправляет событие их сокетам, а история чата выбирается с фильтром видимости
  (`chatVisibilityWhere` в `src/lib/chat-rules.ts`) — третий участник не увидит чужую переписку
  ни в ленте, ни после перезахода в урок. Адресат обязан быть в комнате и учиться в той же школе
  (`RECIPIENT_NOT_IN_ROOM` / `CHAT_RECIPIENT_NOT_FOUND`), сообщение себе отклоняется.
- Медиапоток идёт напрямую между браузерами по WebRTC/SRTP (mesh: каждый с каждым). Сигналинг
  (SDP и ICE) проходит через Socket.IO, медиа через сервер не проходит.
- ИИ-панель и `/api/ai` открыты **только для TEACHER и ADMIN**: ученики не видят UI ИИ, а сервер
  отвечает на любые вызовы `/api/ai` статусом **403 Forbidden**. Внешние нейросети (Groq / Gemini /
  OpenRouter) вызываются **только на сервере** — браузер обращается лишь к своему API, поэтому ИИ
  работает в РФ **без VPN**, а API-ключи никогда не попадают в клиентский бандл. Без ключей ИИ
  остаётся полностью локальным (`MockAIProvider`).
- Доска: события рисования (`whiteboard-*`) проверяются на сервере — учитель решает, кто рисует
  («Рисуют все» / «Рисует учитель»), а перегрузка событиями ограничена рейт-лимитами.
- Для работы в школьных сетях с симметричным NAT добавьте TURN-релей через
  `NEXT_PUBLIC_TURN_SERVERS` (по умолчанию используется пул публичных STUN Google).
- **Rate-limit** (`src/lib/rate-limit.ts`, `middleware.ts`): не более 100 запросов в минуту с одного IP,
  для `/api/auth` — 20 (защита от подбора пароля), для `/api/admin` — 60, для рукопожатий Socket.IO — 40.
  Превышение — `429` с `Retry-After` (страницы получают понятную HTML-заглушку), ответы несут заголовки
  `X-RateLimit-*`. Хранилище — в памяти процесса: при нескольких инстансах нужен Redis.
- **Админ-панель** (`/admin`) доступна ИСКЛЮЧИТЕЛЬНО роли `ADMIN` (суперадмин): и страницы, и
  `/api/admin/*` закрыты в middleware, TEACHER/STUDENT получают редирект `/dashboard?denied=admin`
  (для API — `403`), ссылка «Админ-панель» в навбаре рендерится только для `ADMIN`; API проверяет
  права повторно (`requireCapability`) — интерфейс не является защитой. Все изменения (роли, бан, пароль, завершение урока, объявления) пишутся в `AuditLog`
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
- ✅ **Этап 7** — дашборд, мобильная адаптация и PWA: нижняя навигация, manifest.json, иконки,
  «Добавить на главный экран» (см. DEPLOYMENT.md, шаг 5).
- ✅ **Этап 8 (ФИНАЛ)** — 100% бесплатный ИИ-движок: Groq (GPT-OSS 120B/20B, бесплатный тариф)
  для текста и JSON-чертежей, Gemini Flash Vision для распознавания формул с доски, OpenRouter
  `:free` как резерв, локальный Mock как гарант; устаревшие ID моделей перебираются автоматически
  (404 `model_not_found` → следующая модель в том же запросе);
  `AutoAIProvider` — waterfall-автопереключение без падения API; серверный прокси на Vercel —
  ИИ доступен в РФ без VPN; WebRTC: STUN-пул Google + `NEXT_PUBLIC_TURN_SERVERS`; `vercel.json`;
  руководство деплоя [DEPLOYMENT.md](DEPLOYMENT.md). Смоук-тесты движка: `npm run test:ai`.
- ✅ **Этап 8+ (UI/безопасность)** — свободный ввод и голос в ИИ-панели (крупное текстовое поле,
  «Отправить», 🎤 Web Speech API, шаблоны ниже как быстрые подсказки, переключатель «Передать доску»
  со снимком доски в Gemini Vision), сетка карточек предметов в модалке расписания (каталог
  `src/lib/subjects.ts`, автозаполнение пустой таблицы `subjects`), слои модалок `z-[100]`/`z-[90]`
  и отступ `pt-24/28` на `/homework`, админ-панель строго для `ADMIN`.

- ✅ **Этап 8+ (модалки и приватный чат)** — единый каркас модалок `src/components/ui/modal.tsx`
  (подложка `fixed inset-0 z-[999]` с собственным скроллом, центрирование `min-h-full`, карточка
  `sm:w-full sm:max-w-2xl`): модалка домашнего задания больше не растягивается по горизонтали и не
  обрезается, страховка от регресса — `npm run test:ui`. Приватные сообщения в чате урока:
  `ChatMessage.recipientId`, компактный селект адресата «Всем» / участник, доставка только автору и
  адресату, фильтр истории по видимости (`src/lib/chat-rules.ts`) и выделение в ленте —
  `bg-indigo-900/40`, 🔒 и подпись «Приватно для …» / «Приватно от …». Тесты: `npm run test:chat`.

**Проект завершён.** Итоговая сборка: `npm run build`, запуск: `npm run start` (или деплой на
Vercel — [DEPLOYMENT.md](DEPLOYMENT.md)).
