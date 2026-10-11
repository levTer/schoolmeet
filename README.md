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

# 4. Разработка
npm run dev               # http://localhost:3000
```

Полезные команды:

```bash
npm run build     # прод-сборка
npm run lint      # ESLint
npx prisma studio # веб-UI для просмотра данных
```

## Структура

```
prisma/schema.prisma           Enum Role + модели User / Meeting / Schedule / ChatMessage
src/app/layout.tsx             Корневой layout: метаданные, шрифты, тёмная тема
src/app/page.tsx               Лендинг: Hero → Features → ИИ-Доска → Расписание → CTA → Footer
src/app/login|register         Заглушки этапа 2 (авторизация)
src/components/landing/        Секции лендинга (шапка, hero, мокап урока, фичи, футер)
src/lib/utils.ts               cn(), генератор кода комнаты, инициалы, формат времени
src/types/index.ts             Интерфейсы User / Meeting / Schedule / ChatMessage, роли, события Socket.IO
src/types/next-auth.d.ts       Расширение типов сессии NextAuth полем role
```

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
- ⏭ Этап 2 — авторизация (NextAuth), роли, кабинет учителя/ученика.
- ⏭ Этап 3 — видеозвонки (PeerJS/WebRTC), чат на Socket.IO, ИИ-доска (Fabric.js + GPT-4o Vision).
