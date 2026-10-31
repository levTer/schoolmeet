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
| `desktop/after-pack.js` | Облегчение Chromium перед упаковкой: локали, swiftshader, компилятор шейдеров WebGPU |
| `desktop/THIRD_PARTY_NOTICES.txt` | Уведомление о лицензиях Electron/Chromium (полные тексты — по ссылкам) |
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

## Размер и лимит GitHub

Установщик лежит в git, а GitHub не принимает файлы больше **100 МиБ**
(104 857 600 байт) — `git push` с таким файлом отклоняется. Текущий размер —
≈99,5 МиБ (104 346 967 байт): запас меньше процента, поэтому:

- `desktop/after-pack.js` выкидывает `locales/*.pak` (кроме ru/en), `swiftshader`,
  `dxcompiler.dll`/`dxil.dll` (WebGPU) и `LICENSES.chromium.html` (9 МБ);
- `ffmpeg.dll`, `d3dcompiler_47.dll`, `icudtl.dat`, `resources.pak` трогать
  нельзя: без них ломаются видео, WebGL и русские даты;
- шаг «Commit installer» в workflow падает, если файл превысил лимит, и
  публикует лог сборки коммитом — по нему видно фактический размер.

Когда Electron обновится и установщик перестанет влезать, правильный следующий
шаг — выкладывать `.exe` в GitHub Releases (лимит 2 ГБ на файл, история git не
растёт) и поставить на лендинге ссылку на `/releases/latest/download/eduflow-setup.exe`.
Так уже распространяется macOS-версия (`docs/mac-distribution.md`).

## Что получает пользователь

1. Скачивает `EduFlow-Setup.exe` (~80–100 МБ) — полноценный Chromium-движок
   внутри установщика.
2. Запускает файл; при предупреждении SmartScreen нажимает
   «Подробнее» → «Выполнить в любом случае» (сертификат издателя платный,
   приложение не подписано).
3. Установщик NSIS создаёт ярлыки на рабочем столе и в меню «Пуск».
4. Приложение открывается в отдельном окне и сразу показывает платформу.

Если изменился только веб-интерфейс, после публикации на сервере достаточно
перезапустить приложение или обновить страницу: установленный EXE загружает
актуальную версию сайта. Для изменений самой оболочки нужен новый установщик;
при повторной установке данные профиля сохраняются.

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
