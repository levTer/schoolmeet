# 🚀 Лицей Сингулярити — руководство по бесплатному деплою

Полный путь от пустого репозитория до работающей школьной платформы:
**бесплатная база PostgreSQL → бесплатные ИИ-ключи (Groq + Gemini) → деплой на Vercel →
миграции и демо-данные → установка как мобильное приложение (PWA/APK).**

Все сервисы в этом гайде имеют **навсегда бесплатные тарифы без привязки банковской карты**.
Ориентировочное время прохождения: **20–30 минут**.

---

## 🧠 Почему ИИ работает в России БЕЗ VPN

Это ключевая архитектурная особенность Лицея Сингулярити (этап 8):

```
Учитель в РФ                Сервер Vercel (Европа, fra1)         ИИ-провайдеры
┌──────────────┐   HTTPS    ┌─────────────────────────┐  HTTPS   ┌──────────────┐
│  Браузер     │ ─────────► │  /api/ai (serverless)   │ ───────► │ Groq         │
│  (Россия)    │  свой      │  AutoAIProvider:        │  ключи   │ Gemini       │
│              │  домен     │  Groq → OpenRouter →    │  только  │ OpenRouter   │
│              │ ◄───────── │  Gemini → Mock          │ ◄─────── │              │
└──────────────┘   ответ    └─────────────────────────┘          └──────────────┘
```

- Браузер пользователя обращается **только к своему домену школы** (`https://ваша-школа.vercel.app/api/ai`).
  Этот домен доступен из РФ без ограничений.
- Все вызовы Groq / Gemini / OpenRouter выполняет **сервер Vercel в Европе** — он выступает
  прокси-посредником. Для провайдеров запрос приходит с европейского IP сервера, а не из РФ.
- **API-ключи никогда не покидают сервер**: они хранятся в переменных окружения Vercel и не попадают
  ни в клиентский JavaScript-бандл, ни в браузер пользователя.
- Если внешний провайдер недоступен, исчерпал лимит или ключ не задан — `AutoAIProvider`
  автоматически переключается на следующее звено цепочки, а в крайнем случае — на локальный
  `MockAIProvider`. **API школы не падает никогда.**

Бесплатные лимиты движка:

| Провайдер | Модели | Бесплатный лимит | Роль в Лицее Сингулярити |
|---|---|---|---|
| **Groq Cloud** | GPT-OSS 120B / GPT-OSS 20B (+ `qwen3.8-27b`) | **1 000 запросов/день на модель** | Конспекты, решения задач, формулы, JSON-чертежи, черновики проверки ДЗ |
| **Google Gemini** | Gemini 3.8 Flash (Vision) + резерв 3.6/3.5/3.1/2.5 | **бесплатная дневная квота** (AI Studio, без карты) | Распознавание рукописных формул с изображения доски |
| **OpenRouter** | любые `:free` модели | ~50–1000 запросов/день (зависит от модели) | Резервное звено цепочки |
| **MockAI (локально)** | заготовленные русские шаблоны | ∞ | Гарант работоспособности без ключей |

---

## Шаг 1. Бесплатная база PostgreSQL за 1 минуту (Neon.tech или Supabase)

### Вариант A — Neon.tech (рекомендуется: пул соединений для serverless)

1. Откройте **[neon.tech](https://neon.tech)** → **Sign Up** (можно войти через Google/GitHub — карта не нужна).
2. Нажмите **Create Project**: имя `schoolmeet`, регион **AWS eu-central-1 (Frankfurt)**
   (ближе к серверу Vercel и к пользователям из РФ), план **Free**.
3. После создания проекта откройте **Connection Details** и скопируйте строку подключения.
   Для Vercel берите **pooled connection string** (с суффиксом `-pooler`) — она выдерживает
   множество коротких serverless-соединений:

   ```
   postgresql://user:password@ep-xxxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

4. Это значение — ваш `DATABASE_URL`. Приложение дополнительно ограничивает пул Prisma
   десятью соединениями на процесс и автоматически добавляет `pgbouncer=true` для Neon.
   Используйте именно hostname с `-pooler`; авто-подстановка служит защитой от ошибочной
   прямой строки, но не заменяет проверку настроек проекта в панели Neon.

### Вариант B — Supabase

1. Откройте **[supabase.com](https://supabase.com)** → **Start your project** → войдите через GitHub.
2. **New project**: имя `schoolmeet`, регион **Central EU (Frankfurt)**, план **Free**.
3. Дождитесь инициализации (~2 минуты) → **Project Settings → Database → Connection string → URI**.
   Скопируйте строку вида:

   ```
   postgresql://postgres.xxxx:password@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
   ```

   (порт **6543** — это пулер PgBouncer, он нужен для Vercel; пароль подставьте из **Database Password**.)
4. Это значение — ваш `DATABASE_URL`.

> 💡 Обязательный параметр для облака: `?sslmode=require` (Neon добавляет его сам; для Supabase допишите вручную).

---

## Шаг 2. Бесплатные API-ключи ИИ (Groq + Gemini, без карт)

Оба ключа **необязательны** для запуска — без них ИИ-панель работает на локальном MockAIProvider.
Но чтобы получить настоящий ИИ бесплатно, выполните 2–3 минуты:

### 2.1 Groq Cloud — бесплатный тариф (1 000 запросов/день на модель)

1. Откройте **[console.groq.com](https://console.groq.com)** → войдите через Google/GitHub (карта не требуется).
2. Слева выберите **API Keys** → **Create API Key** → имя `schoolmeet` → **Submit**.
3. Скопируйте ключ вида `gsk_...` — это `GROQ_API_KEY`. Ключ показывается один раз!

Тот же ключ `GROQ_API_KEY` включает и **Groq Vision** — резервный анализ снимка доски
(`llama-3.2-11b-vision-preview`, автоматический переход на `llama-3.2-90b-vision-preview`;
переопределяется `GROQ_VISION_MODEL`). Если `GEMINI_API_KEY` не задан или Gemini вернул ошибку,
снимок доски уходит в Groq Vision, и учитель всё равно получает реальный разбор.

Модели уже настроены в коде (переопределяются переменными `GROQ_MODEL` / `GROQ_REASONING_MODEL`):
- `openai/gpt-oss-120b` — конспекты, формулы, чертежи, пошаговые решения и проверка задач
  (reasoning), 500 t/s, 131k контекста;
- резерв — `openai/gpt-oss-20b` (1000 t/s) и `qwen/qwen3.8-27b`.

Groq регулярно снимает модели с обслуживания, поэтому Лицей Сингулярити **сам перебирает**
список `GROQ_FALLBACK_MODELS`: если модель ответила 404 `model_not_found` или
400 `model_decommissioned`, запрос в том же вызове уходит на следующую, а снятую
ID движок запоминает и больше не опрашивает (актуальный список —
[console.groq.com/docs/deprecations](https://console.groq.com/docs/deprecations)).

### 2.2 Google Gemini — бесплатная дневная квота (Vision)

1. Откройте **[aistudio.google.com](https://aistudio.google.com)** → войдите в Google-аккаунт (карта не требуется).
2. Нажмите **Get API key** → **Create API key** → скопируйте ключ вида `AIza...` — это `GEMINI_API_KEY`.

Gemini Vision — основной провайдер распознавания доски (резервный — Groq Vision, см. шаг 2.1). Модель по умолчанию — `gemini-3.8-flash`
(свежая стабильная Flash-модель); если в аккаунте её нет (404 `NOT_FOUND`), код
**автоматически** — в том же запросе — перебирает `GEMINI_FALLBACK_MODELS`:
`gemini-3.6-flash` → `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-2.5-flash`
→ `gemini-2.5-flash-lite`. Модели Gemini 1.5 и 2.0 Google окончательно выключил
(29.09.2025 и 01.06.2026) — они лежат в конце списка как аварийный резерв и не
расходуют запросы.

### 2.3 OpenRouter (необязательно, третий резерв)

1. Откройте **[openrouter.ai](https://openrouter.ai)** → **Sign In** → **Keys** → **Create Key**.
2. Скопируйте ключ `sk-or-...` — это `OPENROUTER_API_KEY`.
3. Актуальный список бесплатных моделей: **[openrouter.ai/models?q=free](https://openrouter.ai/models?q=free)**
   (по умолчанию заданы `meta-llama/llama-3.3-70b-instruct:free` и `google/gemini-2.0-flash-exp:free`;
   если модель уберут — поменяйте `OPENROUTER_MODEL` / `OPENROUTER_VISION_MODEL`, движок не упадёт).

---

## Шаг 3. Бесплатный деплой на Vercel.com

### 3.1. Импорт репозитория

1. Откройте **[vercel.com](https://vercel.com)** → **Sign Up** → войдите через **GitHub** (план **Hobby** — бесплатно навсегда).
2. **Add New… → Project** → найдите в списке ваш форк `schoolmeet` → **Import**.
   (Если репозитория нет в списке — **Adjust GitHub App Permissions** и разрешите Vercel доступ к нему.)
3. Vercel сам определит Next.js 14 и подхватит **[vercel.json](vercel.json)**:
   - `framework: nextjs`, сборка `prisma generate && next build`;
   - регион функции — **Франкфурт (fra1)**: минимальная задержка до РФ и ближний к Neon/Supabase.

### 3.2. Переменные окружения (Environment Variables)

Перед первым деплоем раскройте **Environment Variables** и добавьте:

| Переменная | Значение | Обязательна? |
|---|---|---|
| `DATABASE_URL` | строка подключения из шага 1 (pooled, со `sslmode=require`) | ✅ да |
| `NEXTAUTH_SECRET` | случайный секрет, сгенерируйте: `openssl rand -base64 32` | ✅ да |
| `NEXTAUTH_URL` | адрес деплоя, например `https://schoolmeet.vercel.app` | ✅ да |
| `GROQ_API_KEY` | ключ `gsk_...` из шага 2.1 | ⭕ нет (без него ИИ → OpenRouter/Mock) |
| `GEMINI_API_KEY` | ключ `AIza...` из шага 2.2 | ⭕ нет (без него анализ доски → Groq Vision) |
| `OPENROUTER_API_KEY` | ключ `sk-or-...` из шага 2.3 | ⭕ нет |
| `NEXT_PUBLIC_SCHOOL_TIMEZONE` | `Europe/Moscow` (часовой пояс школы) | ⭕ рекомендуется |
| `NEXT_PUBLIC_TURN_SERVERS` | JSON-массив TURN-серверов (см. раздел WebRTC ниже) | ⭕ нет |

> ⚠️ Переменные с префиксом `NEXT_PUBLIC_` видны браузеру — так и задумано (таймзона, ICE-серверы).
> ИИ-ключи префикса **не имеют** и на клиент не попадают никогда.

4. Нажмите **Deploy**. Сборка занимает 2–4 минуты. Готово — платформа доступна по адресу
   `https://ваш-проект.vercel.app`! 🎉
5. После смены `NEXTAUTH_URL`/ключей перезапустите деплой: **Deployments → ⋯ → Redeploy**.

### 3.3. Что работает на Vercel, а что требует постоянного сервера (важно!)

Лицей Сингулярити использует два сервера: Next.js (страницы + API + **ИИ-прокси**) и Socket.IO
(realtime: сигналинг WebRTC-звонков, синхронизация доски, шифрованный чат). Vercel — serverless:
HTTP-запросы работают идеально, а постоянные WebSocket-соединения не поддерживаются.

| Функция | Vercel (бесплатно) |
|---|---|
| Авторизация, роли, админ-панель, аудит | ✅ полностью |
| Расписание 5–11 классов | ✅ полностью |
| Домашние задания + файлы + черновик проверки ИИ | ✅ полностью |
| **ИИ-помощник учителя (Groq / Gemini / OpenRouter)** | ✅ полностью — серверный прокси |
| PWA / мобильный режим | ✅ полностью |
| Живые видеоуроки (WebRTC + Socket.IO realtime) | ⚠️ нужен постоянный процесс |

Для **живых уроков** запустите сборку на любом хостинге с постоянным процессом — там Next.js и
Socket.IO поднимаются на одном порту (`server.ts`):

```bash
npm run db:deploy    # ОТДЕЛЬНЫЙ шаг: накатить схему БД (было внутри build — см. ниже)
npm run build        # prisma generate + next build: схему БД больше НЕ меняет
npm run start        # PORT=3000 HOST=0.0.0.0 — Next.js + Socket.IO на одном порту
```

> ⚠️ **Сборка больше не меняет схему БД.** Раньше `npm run build` выполнял
> `prisma db push --accept-data-loss`, то есть любой деплой мог разрушительно
> изменить боевую базу. Теперь schema push вынесен в отдельный шаг
> `npm run db:deploy` (без `--accept-data-loss`): запускайте его осознанно и
> только после бэкапа (находка H-05 аудита).

Бесплатные/дешёвые варианты: VPS за ~300 ₽/мес (Timeweb, Beget, Aeza — полный функционал),
Render/Railway/Fly.io (бесплатные или триальные тарифы). Переменные окружения — те же,
плюс `PORT`/`HOST`. Инструкция идентична шагам 1–2 и 4.

> 💡 Файлы домашних заданий пишутся в каталог `UPLOAD_DIR` (`./storage/uploads`). На serverless
> диск эфемерный (файлы живут до перезапуска функции), поэтому для продакшена ДЗ-файлов
> используйте вариант с постоянным сервером или подключите объектное хранилище
> (S3-совместимое: Cloudflare R2 бесплатно 10 ГБ, Supabase Storage 1 ГБ) в `src/lib/file-storage.ts`.

### 3.4. WebRTC в школьных сетях: STUN и TURN

- **По умолчанию ничего настраивать не нужно**: в `src/lib/webrtc-config.ts` уже прописан проверенный
  пул публичных STUN-серверов Google (`stun.l.google.com:19302` + зеркала `stun1…stun4`).
  В домашних сетях и мобильном интернете видео работает peer-to-peer через них.
- **Школьный Wi-Fi с симметричным NAT/файрволом** может блокировать прямые соединения —
  тогда медиа идёт через TURN-релей. Задайте его переменной `NEXT_PUBLIC_TURN_SERVERS` (JSON-массив):

  ```json
  [
    {"urls": "turn:turn.school.ru:3478", "username": "schoolmeet", "credential": "секрет"},
    {"urls": "turns:turn.school.ru:5349", "username": "schoolmeet", "credential": "секрет"}
  ]
  ```

  Поддерживаются и короткие формы: `"turn:host:3478"` (без авторизации) и `turns:` (TLS).
- Где взять TURN бесплатно:
  - для тестов — открытый релей **[metered.ca Open Relay](https://www.metered.ca/tools/openrelay/)**
    (`openrelay.metered.ca:80/443/4455`, логин/пароль `openrelayproject`);
  - для продакшена — собственный **[coturn](https://github.com/coturn/coturn)** на том же VPS
    (5 минут настройки, безлимитно и под вашим контролем).
- Legacy-переменная `NEXT_PUBLIC_ICE_SERVERS` по-прежнему работает и полностью переопределяет
  список ICE-серверов (максимальный приоритет).

---

## Шаг 4. Миграции и начальные данные (prisma db push + db seed)

Схему БД и демо-данные нужно залить **один раз** в облачную базу из шага 1. Удобнее всего
выполнить это со своего компьютера (Vercel shell для этого не нужен):

```bash
# 1. Клонируйте репозиторий и установите зависимости
git clone https://github.com/<ваш-аккаунт>/schoolmeet.git
cd schoolmeet
npm install

# 2. Создайте локальный .env и впишите ОБЛАЧНЫЙ DATABASE_URL из шага 1
cp .env.example .env
#    DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require"

# 3. Создайте таблицы в облачной базе (без папки миграций — идеально для старта)
npx prisma db push        # == npm run db:push / npm run db:deploy

# 4. Залейте начальные данные: демо-аккаунты, предметы, расписание, ДЗ
npx prisma db seed        # == npm run db:seed
```

Сид создаёт аккаунты (пароль задаётся `SEED_PASSWORD` в `.env`, по умолчанию `schoolmeet`):

| Роль | Email | Пароль |
|---|---|---|
| Администратор | `admin@schoolmeet.dev` | `schoolmeet` |
| Учитель | `teacher@schoolmeet.dev` | `schoolmeet` |
| Ученик 8 класса | `student@schoolmeet.dev` | `schoolmeet` |

Расписание и ДЗ создаются только в пустой базе — повторный запуск сида ничего не дублирует.

Независимо от сида приложение само создаёт и при каждом старте обновляет **гарантированных
администраторов** всех трёх школ. Конфигурация — `GUARANTEED_ADMINS` в
`src/lib/school-config.ts`, создание и обновление — `provisionConfiguredSchools`:

| Роль | Email | Пароль | Школа |
|---|---|---|---|
| Администратор | `admin@schoolmeet.ru` | `SCHOOLMEET_DEMO_ADMIN_PASSWORDS` | `Sinlycem26` |
| Администратор | `fullhouse@schoolmeet.ru` | `SCHOOLMEET_DEMO_ADMIN_PASSWORDS` | `Fulhouseteem26` |
| Администратор | `anna@schoolmeet.ru` | `SCHOOLMEET_DEMO_ADMIN_PASSWORDS` | `Anna.Terentieva77` |

Пароли задаются переменной окружения `SCHOOLMEET_DEMO_ADMIN_PASSWORDS`
(JSON вида `{"admin@schoolmeet.ru": "…", "fullhouse@schoolmeet.ru": "…"}`). Без неё
используется демо-значение из публичного репозитория — в продуктиве так оставлять нельзя.

> 🔐 **Первый шаг после запуска продакшена** — задайте свои пароли через
> `SCHOOLMEET_DEMO_ADMIN_PASSWORDS` и смените их у демо-аккаунтов через админ-панель
> (`/admin/users` → «Сбросить пароль») либо удалите демо-пользователей, создав реальных.
> Приложение создаёт гарантированных администраторов только если их нет, и не перетирает
> уже изменённый пароль при каждом старте; автосоздание отключается переменной
> `SCHOOLMEET_DISABLE_DEMO_ADMIN_SEED=true`.
> Роль `ADMIN` через публичную регистрацию получить нельзя — только через сид, гарантированных
> администраторов или существующего администратора.

Проверить данные можно локально: `npm run db:studio` (веб-UI Prisma) или разделами `/admin`
на задеплоенном сайте.

---

## Шаг 5. Использование как мобильное приложение (PWA) и сборка APK

Лицей Сингулярити — **Progressive Web App**: manifest, иконки и мобильная навигация уже в репозитории
(`public/manifest.json`, `public/icon-192.svg`, `public/icon-512.svg`). PWA не требует публикации
в сторах, обновляется вместе с сайтом и занимает ~1 МБ.

### 5.1. Android — «Добавить на главный экран»

1. Откройте сайт школы в **Chrome** на телефоне.
2. Появится автоматический баннер **«Установить приложение»** (или меню ⋮ → **«Добавить на главный экран»**).
3. Иконка Лицея Сингулярити появится на рабочем столе; приложение запускается в полноэкранном режиме
   (`display: standalone`), без адресной строки браузера.

### 5.2. iPhone / iPad (iOS)

1. Откройте сайт в **Safari** (обязательно; в Chrome на iOS установка недоступна).
2. Нажмите кнопку **«Поделиться»** (квадрат со стрелкой вверх).
3. Выберите **«На экран Домой»** → **Добавить**.

### 5.3. Полноценный APK для Android (раздача в школе без браузера)

**Способ 1 — PWABuilder (проще всего, бесплатно, 10 минут):**

1. Задеплойте сайт (шаг 3) и откройте **[pwabuilder.com](https://www.pwabuilder.com)**.
2. Введите адрес школы, например `https://schoolmeet.vercel.app` → **Start**.
3. Перейдите на вкладку **Android Package** → **Generate Package** →
   подпишите своим ключом (инструкция на сайте) или используйте тестовую подпись → скачайте **APK/AAB**.
4. Раздайте APK ученикам (сайт школы, QR-код в классе). PWABuilder упаковывает PWA в нативную
   оболочку **TWA (Trusted Web Activity)** — внутри работает ваш же сайт, обновления прилетают автоматически.

**Способ 2 — Bubblewrap CLI (локально, нужен Node.js и JDK 17):**

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://schoolmeet.vercel.app/manifest.json
bubblewrap build        # на выходе: app-release-signed.apk и .aab
```

> 📌 Для TWA-оболочки сайт должен быть доступен по HTTPS (Vercel даёт его автоматически) и
> отдавать заголовок `assetlinks.json` для подписи — PWABuilder подскажет, куда его положить
> (`public/.well-known/assetlinks.json`). Для обычной раздачи APK тестовой подписи это не требуется.

---

## 📋 Сводная таблица переменных окружения

| Переменная | Где взять | Назначение |
|---|---|---|
| `DATABASE_URL` | Neon.tech / Supabase (шаг 1) | PostgreSQL (pooled + SSL для облака) |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` | подпись JWT-сессий |
| `NEXTAUTH_URL` | адрес деплоя Vercel | колбэки NextAuth, OpenRouter-атрибуция |
| `GROQ_API_KEY` | console.groq.com (шаг 2.1) | текстовый ИИ и резервный Groq Vision (анализ доски) |
| `GEMINI_API_KEY` | aistudio.google.com (шаг 2.2) | основной Vision (Gemini 1.5 Flash): анализ доски и формул |
| `OPENROUTER_API_KEY` | openrouter.ai (шаг 2.3) | резервные `:free` модели |
| `GROQ_MODEL` / `GROQ_REASONING_MODEL` | — | переопределение моделей Groq (по умолчанию `openai/gpt-oss-120b`) |
| `GROQ_VISION_MODEL` | — | Vision-модель Groq (по умолчанию `llama-3.2-11b-vision-preview`, резерв — `llama-3.2-90b-vision-preview`) |
| `GEMINI_MODEL` | — | переопределение модели Gemini (по умолчанию `gemini-3.8-flash`) |
| `OPENROUTER_MODEL` / `OPENROUTER_VISION_MODEL` | — | переопределение моделей OpenRouter |
| `AI_PROVIDER` | — | `auto` (по умолчанию) / `groq` / `gemini` / `openrouter` / `mock` |
| `AI_TIMEOUT_MS` | — | таймаут внешнего ИИ-вызова (по умолчанию 30000) |
| `NEXT_PUBLIC_SCHOOL_TIMEZONE` | — | часовой пояс школы (`Europe/Moscow`) |
| `NEXT_PUBLIC_TURN_SERVERS` | metered.ca / свой coturn | TURN-релеи для школьных Wi-Fi |
| `NEXT_PUBLIC_ICE_SERVERS` | — | legacy: полный override списка ICE |
| `UPLOAD_DIR` | — | каталог файлов ДЗ (по умолчанию `./storage/uploads`) |
| `RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_WINDOW_MS` | — | рейт-лимит (100/мин по умолчанию) |
| `SEED_PASSWORD` | — | пароль демо-аккаунтов сида |
| `PORT` / `HOST` | — | для `npm run start` (3000 / 0.0.0.0) |

Полный список с комментариями — в **[.env.example](.env.example)**.

---

## 🔧 Диагностика ИИ-движка

- **Какой провайдер активен?** Авторизуйтесь учителем и откройте `GET /api/ai` (или посмотрите
  бейдж в ИИ-панели урока): вернётся имя активного движка и статусы всех звеньев цепочки —
  какие ключи заданы, какие модели используются, кто первый в очереди.
- **Каждый ответ ИИ помечен** фактическим провайдером и моделью (под ответом в ИИ-панели).
- **Логи Vercel** (`vercel logs` или вкладка Logs деплоя) показывают переключения цепочки:
  `[ai-auto] complete: провайдер "groq" не ответил (...) — переключение`.
- Типичные ситуации:

| Симптом | Причина | Решение |
|---|---|---|
| Ответы помечены `mock` | ключи не заданы или `AI_PROVIDER=mock` | добавьте `GROQ_API_KEY`/`GEMINI_API_KEY` → Redeploy |
| Groq отвечает ошибкой 429 | дневной/минутный лимит исчерпан | подождите; запросы уже уходят в OpenRouter/Mock автоматически |
| Gemini 404 NOT_FOUND | модель недоступна в аккаунте | код сам откатится на `gemini-3.6-flash` и далее по `GEMINI_FALLBACK_MODELS`; либо задайте `GEMINI_MODEL` |
| Groq 404 `model_not_found` / 400 `model_decommissioned` | модель снята вендором | код мгновенно переходит на следующую из `GROQ_FALLBACK_MODELS`; при желании задайте `GROQ_MODEL` (актуальные ID: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`) |
| Формулы/доска не распознаются | нет `GEMINI_API_KEY` и `GROQ_API_KEY` | добавьте `GROQ_API_KEY` (Gemini необязателен); Vision-цепочка: Gemini 1.5 Flash → Groq Vision (`llama-3.2-vision`) → OpenRouter Vision → Mock |
| Видео не соединяется в школьной сети | симметричный NAT, нет TURN | задайте `NEXT_PUBLIC_TURN_SERVERS` (metered.ca или coturn) |

Локальная проверка движка без сети и базы: `npm run test:ai` (84 смоук-проверки: парсинг
ответов Groq/Gemini/OpenRouter, мгновенный перебор моделей при 404/`model_decommissioned`,
waterfall-переключения, STUN/TURN-конфиг).

---

## ✅ Чек-лист запуска

- [ ] База Neon/Supabase создана, `DATABASE_URL` (pooled, `sslmode=require`) скопирован
- [ ] `GROQ_API_KEY` получен (console.groq.com)
- [ ] `GEMINI_API_KEY` получен (aistudio.google.com)
- [ ] Репозиторий импортирован в Vercel, переменные окружения заполнены
- [ ] Деплой зелёный, сайт открывается по `https://...vercel.app`
- [ ] `npx prisma db push` + `npx prisma db seed` выполнены против облачной базы
- [ ] Вход под `admin@schoolmeet.dev` работает, демо-пароль изменён
- [ ] ИИ-панель учителя отвечает, бейдж показывает Groq/Gemini (не Mock)
- [ ] (Для живых уроков) сервер `npm run start` поднят на хостинге с постоянным процессом
- [ ] (Для школьного Wi-Fi) `NEXT_PUBLIC_TURN_SERVERS` задан
- [ ] PWA установлен на телефон / APK собран через PWABuilder

**Готово! Школа в эфире. 🎓**
