const CACHE_NAME = "eduflow-pwa-v7";
const PRECACHE_URLS = [
  "/",
  "/manifest.json",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/favicon.ico",
];

/**
 * Расширения установщиков, которые Service Worker не перехватывает.
 *
 * `.apk` (Android), `.dmg` (Mac), `.zip` + `.exe` (портативная Windows-версия) и
 * `.msix` (Windows 10/11) — бинарные файлы. Если отдать их через
 * `event.respondWith(fetch(...).catch(() => caches.match("/")))`, то при сбое
 * сети или офлайне браузер получит закэшированный HTML главной страницы и
 * сохранит его под именем `eduflow.apk` / `eduflow-windows.zip` — установщик
 * окажется битым. Поэтому такие запросы уходят напрямую в сеть, без кэша и
 * подмены.
 */
const BINARY_DOWNLOAD_EXTENSIONS = [
  ".apk",
  ".dmg",
  ".exe",
  ".msix",
  ".msixbundle",
  ".appx",
  ".zip",
];

function isBinaryDownload(pathname) {
  const lowerPath = pathname.toLowerCase();
  return BINARY_DOWNLOAD_EXTENSIONS.some((extension) => lowerPath.endsWith(extension));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io")) return;
  // Установщики (.apk/.msix/.dmg/.zip/.exe) забираем напрямую: при офлайне SW
  // не должен подсовывать закэшированный HTML вместо бинарного файла (иначе
  // скачается страница с расширением .apk, .zip или .exe).
  if (isBinaryDownload(url.pathname)) return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(event.request);
      return cached || caches.match("/");
    }),
  );
});
