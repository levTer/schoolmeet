# schoolmeet

**SchoolMeet** — платная школьная платформа видеозвонков и уроков с ИИ-доской и расписанием
(аналог Zoom, адаптированный под школу).

Этап 1 — фундамент и лендинг: Next.js 14 (App Router) + TypeScript + Tailwind CSS + Prisma,
доменные типы и премиальный тёмный лендинг с фиолетово-голубыми градиентами.

## Стек

| Слой        | Технологии                                              |
| ----------- | ------------------------------------------------------- |
| Фронтенд    | Next.js 14 (App Router), TypeScript, Tailwind CSS, ESLint |
| Состояние   | Zustand                                                  |
| Реальное время | Socket.IO (сервер + клиент), PeerJS, WebRTC           |
| Доска       | Fabric.js + GPT-4o Vision (OpenAI SDK)                   |
| БД / ORM    | PostgreSQL + Prisma                                      |
| Авторизация | NextAuth.js, bcryptjs                                    |
| Шифрование  | crypto-js (AES-256 для чата)                             |
| Утилиты     | clsx, tailwind-merge, date-fns, lucide-react             |

## Быстрый старт

```bash
# 1. Зависимости
npm install

# 2. Окружение
cp .env.example .env      # затем заполните DATABASE_URL, NEXTAUTH_SECRET, OPENAI_API_KEY, ENCRYPTION_KEY

# 3. База данных (нужен запущенный PostgreSQL)
npx prisma generate       # генерация клиента
npx prisma migrate dev --name init

# 4. Демо-аккаунты и запуск
npm run db:seed           # admin@ / teacher@ / student@schoolmeet.dev
npm run dev               # http://localhost:3000
```

Полезные команды:

```bash
npm run build      # прод-сборка
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
src/app/meeting|schedule           Каркасы разделов урока и расписания (этап 3)
src/components/layout/Navbar.tsx   Шапка с профилем, ролью и кнопкой «Выйти» (signOut)
src/components/layout/app-shell.tsx Каркас внутренних страниц: навбар + контент
src/components/auth/               AuthShell и формы входа/регистрации
src/components/ui/                 Поля формы, градиентная кнопка, алерты
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
- Сообщения чата шифруются AES-256 на клиенте; сервер хранит только шифротекст.
- Медиапоток идёт по WebRTC/SRTP, ключ комнаты (`encryptionKey`) уникален для каждого урока.
- Реальный `.env` в репозиторий не попадает (см. `.gitignore`), в git лежит только `.env.example`.

## Статус этапов

- ✅ **Этап 1** — фундамент и лендинг.
- ✅ **Этап 2** — авторизация (NextAuth + bcrypt), роли, защита маршрутов, кабинет и админ-панель.
- ⏭ Этап 3 — видеозвонки (PeerJS/WebRTC), чат на Socket.IO, ИИ-доска (Fabric.js + GPT-4o Vision).
