const CACHE_NAME = "eduflow-pwa-v8";
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
 * `.exe` (полноценный Electron-установщик EduFlow для Windows,
 * `public/eduflow-setup.exe`, ~80–100 МБ), `.apk` (Android), `.dmg` (Mac) и
 * `.zip` — бинарные файлы. Если отдать их через
 * `event.respondWith(fetch(...).catch(() => caches.match("/")))`, то при сбое
 * сети или офлайне браузер получит закэшированный HTML главной страницы и
 * сохранит его под именем `eduflow-setup.exe` — установщик окажется битым
 * (Windows выдаст «Файл повреждён»). Поэтому такие запросы уходят напрямую в
 * сеть, без кэша и подмены, а браузер показывает собственную полосу загрузки.
 */
const BINARY_DOWNLOAD_EXTENSIONS = [
  ".exe",
  ".msi",
  ".msix",
  ".apk",
  ".dmg",
  ".pkg",
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
  // Установщики (.exe/.apk/.dmg/.zip) забираем напрямую: при офлайне SW не
  // должен подсовывать закэшированный HTML вместо бинарного файла — иначе
  // вместо 90-МБ установщика скачается страница сайта с расширением .exe.
  if (isBinaryDownload(url.pathname)) return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(event.request);
      return cached || caches.match("/");
    }),
  );
});
