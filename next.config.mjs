/**
 * Конфигурация Next.js + security-заголовки.
 *
 * Заголовки задаются здесь, а не только в middleware: так они применяются к
 * страницам, API, статике и редиректам NextAuth. Состав проверяется тестом
 * `scripts/hardening.test.ts` — пропажа заголовка ломает CI, а не прод.
 *
 * CSP «строгая по источнику, терпимая по inline»:
 *  - script-src 'self' 'unsafe-inline' — Next вставляет inline-скрипты
 *    гидратации; внешние скрипты запрещены полностью (главный вектор XSS);
 *  - frame-ancestors 'none' + X-Frame-Options: DENY — кликджекинг поверх
 *    запроса камеры/микрофона невозможен;
 *  - connect-src ограничен своим origin и WSS — эксфильтрация токена на чужой
 *    домен через fetch/WebSocket не пройдёт; внешние ИИ-вызовы идут с сервера,
 *    а STUN/TURN — не HTTP-транспорт;
 *  - media-src blob: нужен MediaRecorder (запись урока);
 *  - object-src 'none', base-uri 'self', form-action 'self'.
 *
 * Ужесточение до nonce-based CSP — в docs/security-hardening.md.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: true,
  swcMinify: true,
  // Заголовок X-Powered-By раскрывает версию фреймворка.
  poweredByHeader: false,

  async headers() {
    const dev = process.env.NODE_ENV !== "production";

    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "media-src 'self' blob: data:",
      `connect-src 'self' wss: ws:${dev ? " http://localhost:3000" : ""}`,
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "frame-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // Дубль для браузеров, которые ещё не понимают frame-ancestors.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // Камера/микрофон/экран — только своему origin, остальное запрещено.
          {
            key: "Permissions-Policy",
            value: [
              "camera=(self)",
              "microphone=(self)",
              "display-capture=(self)",
              "geolocation=()",
              "payment=()",
              "usb=()",
              "serial=()",
              "bluetooth=()",
              "interest-cohort=()",
            ].join(", "),
          },
          // HSTS: два года + поддомены. localhost браузеры игнорируют.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        // Имена установщиков не меняются между релизами — кэшируем ненадолго,
        // но с обязательной ревалидацией.
        source: "/:file(eduflow-setup.exe|eduflow.apk|eduflow.dmg)",
        headers: [{ key: "Cache-Control", value: "public, max-age=300, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
