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

Пять тем (`data-theme` на `<html>`) меняют только акцент и цвет системной полосы,
поэтому сетка, контраст и типографика одинаковы везде:

| id | Название | Акцент | Title bar |
| --- | --- | --- | --- |
| `graphite` | Dark Graphite (базовая) | `#10B981` | `#0B0F17` |
| `indigo` | Indigo Night | `#6366F1` | `#080B18` |
| `emerald` | Emerald Pro | `#34D399` | `#06100C` |
| `violet` | Violet Glow | `#A855F7` | `#0A0813` |
| `slate` | Classic Slate | `#94A3B8` | `#0C1117` |

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
