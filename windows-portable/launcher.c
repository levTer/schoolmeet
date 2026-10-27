/*
 * EduFlow — портативный лаунчер для Windows (eduflow-portable.exe).
 *
 * Собран как GUI-приложение (подсистема WINDOWS): при запуске не открывается
 * консольное окно, а сразу появляется окно EduFlow в режиме приложения.
 *
 * Почему именно так, а не Electron/MSIX:
 *   - MSIX требует доверенного сертификата издателя (ошибка 0x800B010A), а
 *     покупка кода подписи не нужна: один .exe без зависимостей и установки.
 *   - Лаунчер не тащит собственный Chromium (100+ МБ). Он открывает сайт
 *     EduFlow в «app mode» уже установленного в Windows 10/11 браузера
 *     (Microsoft Edge есть в системе по умолчанию, Chrome — если установлен):
 *     окно без адресной строки и вкладок, с отдельным профилем приложения.
 *   - Если Edge/Chrome не найдены, ссылка открывается в браузере по умолчанию.
 *
 * Адрес приложения можно переопределить: файл `eduflow.url` рядом с .exe
 * (одна строка, UTF-8 или UTF-16LE, с BOM или без).
 *
 * Сборка: npm run build:windows (см. windows-portable/README.md).
 */

#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN

#include <windows.h>
#include <shellapi.h>
#include <string.h>
#include <wchar.h>

#ifndef EDUFLOW_DEFAULT_URL
#define EDUFLOW_DEFAULT_URL L"https://schoolmeet-vb96.onrender.com"
#endif

#define EDUFLOW_APP_TITLE L"EduFlow"
#define EDUFLOW_CONFIG_FILE L"eduflow.url"
#define MAX_PATH_LONG 4096

static const wchar_t *kDefaultUrl = EDUFLOW_DEFAULT_URL;

/* Сколько символов можно дописать в буфер, не выходя за его границу. */
static size_t room_left(const wchar_t *buffer, DWORD capacity) {
  size_t used = wcslen(buffer);
  return used < capacity ? (size_t)capacity - used : 0;
}

static BOOL append(wchar_t *buffer, DWORD capacity, const wchar_t *text) {
  size_t left = room_left(buffer, capacity);
  size_t len = wcslen(text);
  if (len >= left) return FALSE;
  wcscat(buffer, text);
  return TRUE;
}

static BOOL file_exists(const wchar_t *path) {
  DWORD attrs = GetFileAttributesW(path);
  return attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_DIRECTORY);
}

/** Каталог, из которого запущен .exe (без завершающего обратного слэша). */
static BOOL exe_dir(wchar_t *out, DWORD capacity) {
  DWORD len = GetModuleFileNameW(NULL, out, capacity);
  if (len == 0 || len >= capacity) return FALSE;
  for (DWORD i = len; i > 0; i--) {
    if (out[i - 1] == L'\\' || out[i - 1] == L'/') {
      out[i - 1] = L'\0';
      return TRUE;
    }
  }
  out[0] = L'\0';
  return FALSE;
}

static void trim(wchar_t *text) {
  size_t len = wcslen(text);
  while (len > 0 && (text[len - 1] == L'\r' || text[len - 1] == L'\n' ||
                     text[len - 1] == L' ' || text[len - 1] == L'\t' ||
                     text[len - 1] == 0xFEFF || text[len - 1] == L'"')) {
    text[--len] = L'\0';
  }
  size_t start = 0;
  while (text[start] == L' ' || text[start] == L'\t' || text[start] == 0xFEFF || text[start] == L'"') {
    start++;
  }
  if (start > 0) {
    size_t i = 0;
    while (text[start + i] != L'\0') {
      text[i] = text[start + i];
      i++;
    }
    text[i] = L'\0';
  }
}

/** Читает `eduflow.url` рядом с .exe. Возвращает TRUE, если адрес валиден. */
static BOOL load_url_override(const wchar_t *dir, wchar_t *out, DWORD capacity) {
  wchar_t path[MAX_PATH_LONG];
  if (wcslen(dir) + wcslen(EDUFLOW_CONFIG_FILE) + 2 >= MAX_PATH_LONG) return FALSE;

  path[0] = L'\0';
  append(path, MAX_PATH_LONG, dir);
  append(path, MAX_PATH_LONG, L"\\");
  append(path, MAX_PATH_LONG, EDUFLOW_CONFIG_FILE);

  HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL,
                            OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) return FALSE;

  unsigned char raw[4096];
  DWORD read = 0;
  BOOL ok = ReadFile(file, raw, sizeof(raw), &read, NULL);
  CloseHandle(file);
  if (!ok || read == 0) return FALSE;

  BOOL valid = FALSE;
  if (read >= 2 && raw[0] == 0xFF && raw[1] == 0xFE) {
    /* UTF-16LE с BOM: копируем как есть. */
    size_t chars = (read - 2) / sizeof(wchar_t);
    if (chars + 1 >= capacity) chars = capacity - 2;
    memcpy(out, raw + 2, chars * sizeof(wchar_t));
    out[chars] = L'\0';
    valid = TRUE;
  } else {
    DWORD skip = (read >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF) ? 3 : 0;
    int wide = MultiByteToWideChar(CP_UTF8, 0, (const char *)raw + skip, (int)(read - skip),
                                   out, (int)capacity - 1);
    if (wide > 0) {
      out[wide] = L'\0';
      valid = TRUE;
    }
  }
  if (!valid) return FALSE;

  trim(out);
  if (CompareStringOrdinal(out, 7, L"http://", 7, TRUE) != CSTR_EQUAL &&
      CompareStringOrdinal(out, 8, L"https://", 8, TRUE) != CSTR_EQUAL) {
    out[0] = L'\0';
    return FALSE;
  }
  return TRUE;
}

/** Путь к браузеру из реестра: App Paths\<exe>. */
static BOOL app_path_from_registry(HKEY root, const wchar_t *exe, wchar_t *out, DWORD capacity) {
  wchar_t key[512];
  key[0] = L'\0';
  append(key, 512, L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\");
  append(key, 512, exe);

  HKEY handle = NULL;
  if (RegOpenKeyExW(root, key, 0, KEY_READ, &handle) != ERROR_SUCCESS) return FALSE;

  DWORD bytes = capacity * sizeof(wchar_t);
  DWORD type = 0;
  LONG status = RegQueryValueExW(handle, NULL, NULL, &type, (LPBYTE)out, &bytes);
  RegCloseKey(handle);
  if (status != ERROR_SUCCESS || (type != REG_SZ && type != REG_EXPAND_SZ)) return FALSE;

  out[capacity - 1] = L'\0';
  trim(out);
  return file_exists(out);
}

/** Ищет Edge, затем Chrome — сначала в реестре, затем в стандартных каталогах. */
static BOOL find_chromium_browser(wchar_t *out, DWORD capacity) {
  static const wchar_t *kAppPaths[] = {L"msedge.exe", L"chrome.exe"};
  for (size_t i = 0; i < sizeof(kAppPaths) / sizeof(kAppPaths[0]); i++) {
    if (app_path_from_registry(HKEY_CURRENT_USER, kAppPaths[i], out, capacity)) return TRUE;
    if (app_path_from_registry(HKEY_LOCAL_MACHINE, kAppPaths[i], out, capacity)) return TRUE;
  }

  struct {
    const wchar_t *env;
    const wchar_t *exe;
  } kCandidates[] = {
      {L"ProgramFiles(x86)", L"Microsoft\\Edge\\Application\\msedge.exe"},
      {L"ProgramFiles", L"Microsoft\\Edge\\Application\\msedge.exe"},
      {L"LocalAppData", L"Microsoft\\Edge\\Application\\msedge.exe"},
      {L"ProgramFiles", L"Google\\Chrome\\Application\\chrome.exe"},
      {L"ProgramFiles(x86)", L"Google\\Chrome\\Application\\chrome.exe"},
      {L"LocalAppData", L"Google\\Chrome\\Application\\chrome.exe"},
  };

  for (size_t i = 0; i < sizeof(kCandidates) / sizeof(kCandidates[0]); i++) {
    wchar_t base[MAX_PATH_LONG];
    DWORD len = GetEnvironmentVariableW(kCandidates[i].env, base, MAX_PATH_LONG);
    if (len == 0 || len >= MAX_PATH_LONG) continue;
    out[0] = L'\0';
    if (!append(out, capacity, base)) continue;
    if (!append(out, capacity, L"\\")) continue;
    if (!append(out, capacity, kCandidates[i].exe)) continue;
    if (file_exists(out)) return TRUE;
  }
  return FALSE;
}

/** Каталог профиля приложения: %LOCALAPPDATA%\EduFlow\Portable. */
static BOOL app_profile_dir(wchar_t *out, DWORD capacity) {
  wchar_t local[MAX_PATH_LONG];
  DWORD len = GetEnvironmentVariableW(L"LOCALAPPDATA", local, MAX_PATH_LONG);
  if (len == 0 || len >= MAX_PATH_LONG) return FALSE;
  out[0] = L'\0';
  if (!append(out, capacity, local)) return FALSE;
  if (!append(out, capacity, L"\\EduFlow")) return FALSE;
  CreateDirectoryW(out, NULL);
  if (!append(out, capacity, L"\\Portable")) return FALSE;
  CreateDirectoryW(out, NULL);
  return file_exists(out);
}

/** Запускает browser в режиме приложения. Возвращает TRUE, если процесс создан. */
static BOOL launch_app_window(const wchar_t *browser, const wchar_t *url) {
  wchar_t command[MAX_PATH_LONG];
  command[0] = L'\0';

  if (!append(command, MAX_PATH_LONG, L"\"")) return FALSE;
  if (!append(command, MAX_PATH_LONG, browser)) return FALSE;
  if (!append(command, MAX_PATH_LONG, L"\" --app=\"")) return FALSE;
  if (!append(command, MAX_PATH_LONG, url)) return FALSE;
  if (!append(command, MAX_PATH_LONG,
              L"\" --window-size=1360,900 --no-first-run --no-default-browser-check"
              L" --disable-features=TranslateUI")) {
    return FALSE;
  }

  wchar_t profile[MAX_PATH_LONG];
  if (app_profile_dir(profile, MAX_PATH_LONG)) {
    if (!append(command, MAX_PATH_LONG, L" --user-data-dir=\"")) return FALSE;
    if (!append(command, MAX_PATH_LONG, profile)) return FALSE;
    if (!append(command, MAX_PATH_LONG, L"\"")) return FALSE;
  }

  STARTUPINFOW startup;
  PROCESS_INFORMATION process;
  ZeroMemory(&startup, sizeof(startup));
  startup.cb = sizeof(startup);
  ZeroMemory(&process, sizeof(process));

  BOOL created = CreateProcessW(browser, command, NULL, NULL, FALSE, 0, NULL, NULL, &startup, &process);
  if (!created) return FALSE;
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return TRUE;
}

int WINAPI WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR raw_arguments, int show) {
  (void)instance;
  (void)previous;
  (void)raw_arguments;
  (void)show;

  wchar_t url[4096];
  url[0] = L'\0';

  wchar_t dir[MAX_PATH_LONG];
  BOOL have_dir = exe_dir(dir, MAX_PATH_LONG);
  if (!have_dir || !load_url_override(dir, url, 4096)) {
    lstrcpynW(url, kDefaultUrl, 4096);
  }

  wchar_t browser[MAX_PATH_LONG];
  if (find_chromium_browser(browser, MAX_PATH_LONG) && launch_app_window(browser, url)) {
    return 0;
  }

  /* Запасной путь: браузер по умолчанию. */
  HINSTANCE result = ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);
  if ((INT_PTR)result > 32) return 0;

  wchar_t message[4600];
  message[0] = L'\0';
  append(message, 4600, L"Не удалось открыть EduFlow.\n\n"
                         L"Проверьте подключение к интернету и откройте адрес вручную:\n");
  append(message, 4600, url);
  MessageBoxW(NULL, message, EDUFLOW_APP_TITLE, MB_ICONERROR | MB_OK);
  return 1;
}
