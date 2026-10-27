# Установщик EduFlow для Windows (Electron)

Windows-версия EduFlow — полноценное десктопное приложение на Electron
(движок Chromium), как Discord, VS Code или Spotify: собственное окно,
нативное меню, ярлык на рабочем столе, сохранение входа и настроек.

## Что лежит в репозитории

| Путь | Назначение |
| --- | --- |
| `desktop/main.js` | Главный процесс Electron: окно 1280×832, меню, разрешения камеры/микрофона, авто-открытие `https://schoolmeet-vb96.onrender.com` |
| `desktop/preload.js` | Изолированный мост `window.eduflowDesktop` (`contextIsolation: true`, `nodeIntegration: false`) |
| `desktop/offline.html` | Локальная страница «Нет подключения» с кнопками «Повторить» и «Открыть в браузере» |
| `desktop/assets/icon.png` | Иконка окна (дизайн №9) |
| `electron-builder.yml` | Конфиг electron-builder: NSIS-установщик для Windows x64, максимальное сжатие |
| `scripts/build-windows-installer.ts` | Сборка `public/eduflow-setup.exe` + проверки (MZ/PE, NSIS, размер) |
| `public/eduflow-setup.exe` | Готовый установщик, который скачивает кнопка «💻 Скачать для Windows (.exe Установщик)» |

## Сборка

Локально (Windows или Linux с Wine):

```bash
npm install
npm run build:windows   # → public/eduflow-setup.exe
```

В CI установщик собирается на `windows-latest` workflow
`.github/workflows/build-windows-installer.yml`: джоба прогоняет
`npm run build:windows`, проверяет размер и MZ-заголовок, выкладывает артефакт
`EduFlow-Windows-Installer` и коммитит `public/eduflow-setup.exe` в ветку.

## Что получает пользователь

1. Скачивает `EduFlow-Setup.exe` (~80–100 МБ) — полноценный Chromium-движок
   внутри установщика.
2. Запускает файл; при предупреждении SmartScreen нажимает
   «Подробнее» → «Выполнить в любом случае» (сертификат издателя платный,
   приложение не подписано).
3. Установщик NSIS создаёт ярлыки на рабочем столе и в меню «Пуск».
4. Приложение открывается в отдельном окне и сразу показывает платформу.

Обновление — повторный запуск нового установщика; данные профиля сохраняются.

## Почему не ZIP и не MSIX

- ZIP с портативным лаунчером не давал настоящего десктопного приложения —
  это был микро-скрипт, открывавший сайт в браузере.
- Неподписанный MSIX Windows блокирует с ошибкой `0x800B010A`.

NSIS-установщик Electron не требует ни подписи, ни прав администратора
(`requestedExecutionLevel: asInvoker`).

## Service Worker и скачивание

`.exe` входит в `BINARY_DOWNLOAD_EXTENSIONS` в `public/sw.js`, поэтому Service
Worker не перехватывает запрос: файл на ~90 МБ уходит напрямую в сеть, без
кеша, и не подменяется закэшированным HTML главной страницы.
