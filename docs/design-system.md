# EduFlow · Design System «Telegram × Twitch Dark»

Единая дизайн-система для всех пяти поверхностей продукта: **Web Desktop**,
**Web Mobile**, **Android APK**, **Windows `.exe`** и **macOS `.dmg`**.

## 1. Токены

Источник значений — [`src/styles/design-tokens.css`](../src/styles/design-tokens.css)
(подключается в `src/app/layout.tsx` перед `globals.css`), мост в Tailwind —
[`tailwind.config.ts`](../tailwind.config.ts).

| Токен | Значение | Назначение |
| --- | --- | --- |
| `--bg-primary` | `#0B0F17` | фон страницы (глубокий графит) |
| `--bg-card` | `#111827` | карточки (`rounded-2xl`, `border-white/10`) |
| `--accent-primary` | `#10B981` | акцент: **только** активные элементы |
| `--text-primary` | `#F9FAFB` | основной текст |
| `--text-secondary` | `#9CA3AF` | подписи и вторичный текст |
| `--radius-card` | `1rem` | `rounded-2xl` |
| `--navbar-height` | `56px` | шапка приложения |
| `--titlebar-height` | `38px` | системная полоса Electron |
| `--titlebar-color` | `#0B0F17` | цвет нативной полосы / статус-бара |

Типографика сдержанная: заголовки `text-base`/`text-lg` `font-semibold`,
подзаголовки `text-sm font-medium`, подписи `text-xs text-slate-400`.
Никаких гигантских заголовков и радужных градиентов.

## 2. Темы

Темы (`data-theme` на `<html>`) меняют только акцент, вторую краску палитры и
цвет системной полосы, поэтому сетка, контраст и типографика одинаковы везде.
Всего 21 тема: базовая пятёрка дизайн-системы и 16 цветовых палитр с
референсов (`CORE_THEME_OPTIONS` и `PALETTE_THEME_OPTIONS` в
[`src/lib/theme.ts`](../src/lib/theme.ts)).

### Базовые темы

| id | Название | Акцент | Title bar |
| --- | --- | --- | --- |
| `graphite` | Dark Graphite (базовая) | `#10B981` | `#0B0F17` |
| `indigo` | Indigo Night | `#6366F1` | `#080B18` |
| `emerald` | Emerald Pro | `#34D399` | `#06100C` |
| `violet` | Violet Glow | `#A855F7` | `#0A0813` |
| `slate` | Classic Slate | `#94A3B8` | `#0C1117` |

### Цветовые палитры с референсов

Каждая палитра хранит **точные** подписи и hex-коды красок референса в поле
`palette` — меню «Внешний вид» показывает их один в один. Тёмная краска
палитры задаёт поверхности, выразительная становится акцентом
(`--accent-primary`), остальные — второй краской (`--accent-secondary`).

| id | Палитра (hex как на референсе) | Акцент |
| --- | --- | --- |
| `plum-berry` | Сливово-малиновая: `#CA054D` · `#3B1C32` · `#A4D4B4` · `#FFCF9C` | `#CA054D` |
| `mint-navy` | Мятно-синяя: `#B9E3C6` · `#59C9A5` · `#D81E5B` · `#23395B` | `#D81E5B` |
| `moss-cyan` | Мшисто-циановая: `#4F6F3A` · `#00E5FF` | `#00E5FF` |
| `forest-lime` | Лесная: `#B8C98A` · `#365447` · `#7650A8` | `#B8C98A` |
| `neon-mint` | Неоново-мятная: `#00F5D4` · `#FF286B` · `#171717` | `#00F5D4` |
| `petrol-vintage` | Петрольная: `#F2C14E` · `#28666E` · `#F4EDE0` | `#F2C14E` |
| `navy-magenta` | Тёмно-синяя малиновая: `#1B263B` · `#F72585` | `#F72585` |
| `teal-orange` | Бирюзово-оранжевая: `#2A9D8F` · `#F4A261` | `#F4A261` |
| `toxic-lime` | Ядовито-жёлтая: `#123B2A` · `#E5FF00` | `#E5FF00` |
| `indigo-ice` | Индиго-ледяная: `#19152F` · `#A5E7FF` | `#A5E7FF` |
| `pine-ash` | Хвойно-пепельная: `#1B4332` · `#D9D9D9` | `#D9D9D9` |
| `olive-cream` | Оливково-кремовая: `#606C38` · `#FEFAE0` | `#FEFAE0` |
| `purple-sky` | Пурпурно-голубая: `#7209B7` · `#4CC9F0` | `#4CC9F0` |
| `lilac-yellow` | Сиренево-жёлтая: `#8338EC` · `#FFBE0B` | `#FFBE0B` |
| `lemon-charcoal` | Лимонно-угольная: `#FFF44F` · `#1C1C1E` | `#FFF44F` |
| `azure-white` | Лазурно-белая: `#00B4D8` · `#FFFFFF` | `#FFFFFF` |

Светлые краски (`#FFF44F`, `#FEFAE0`, `#FFFFFF`, `#A5E7FF`, …) становятся
акцентом заливки, поэтому текст и иконки на ней берут цвет из
`--accent-contrast` (Tailwind: `text-brand-contrast`) — белый на тёмных
акцентах и почти чёрный на светлых.

Старые id (`cyber`, `ocean`, `mint`) автоматически переводятся в актуальные
(`violet`, `indigo`, `graphite`) при чтении `localStorage`.

## 3. Синхронизация нативного хрома

`ThemeProvider` → `syncNativeChrome()` ([`src/lib/native-chrome.ts`](../src/lib/native-chrome.ts)):

```ts
// Android APK (MainActivity.AndroidBridge)
window.AndroidApp?.setStatusBarColor(theme.bgColor);

// Windows .exe / macOS .dmg (desktop/preload.js → ipcRenderer)
window.eduflowDesktop?.setTheme({
  backgroundColor: theme.titlebar,
  symbolColor: theme.symbol,
});
```

* **Android** — `WindowCompat.setDecorFitsSystemWindows(window, false)`,
  прозрачный статус-бар, `@JavascriptInterface setStatusBarColor(hex)`
  перекрашивает статус-бар и панель навигации. Сборка и подпись v1/v2/v3 —
  workflow [`android-build.yml`](../.github/workflows/android-build.yml).
* **Windows / macOS** — `titleBarStyle: 'hidden'` +
  `titleBarOverlay: { color, symbolColor, height: 38 }`; IPC
  `update-titlebar-theme` обновляет overlay без перезапуска окна.

## 4. Zero-Scroll на мобильных

```css
@media (max-width: 767px) {
  html, body { height: 100dvh; overflow: hidden; }
}
```

Прокручивается только внутренний контейнер `.app-frame`; шапка и нижняя
навигация остаются на месте, safe-area учитывается через
`env(safe-area-inset-top / bottom)`.

## 5. Правила

1. Карточка — `<div className="card">` (`#111827`, `rounded-2xl`, `border-white/10`).
2. Акцент — только на активном пункте навигации, основной кнопке действия,
   фокусе и индикаторе «идёт урок».
3. Заголовки не крупнее `text-lg` внутри приложения и `text-3xl` на лендинге.
4. Новые цвета не хардкодятся: добавляйте токен в `design-tokens.css` и мост в
   `tailwind.config.ts`.
