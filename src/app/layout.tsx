import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { Providers } from "@/components/providers";
import {
  DEFAULT_TEXT_SIZE,
  DEFAULT_THEME,
  LEGACY_THEME_ALIASES,
  LEGACY_THEME_STORAGE_KEY,
  TEXT_SIZE_OPTIONS,
  TEXT_SIZE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  themeBootstrapMap,
} from "@/lib/theme";

import "katex/dist/katex.min.css";
/* Дизайн-токены подключаются ДО globals.css: базовые стили читают переменные. */
import "@/styles/design-tokens.css";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

/**
 * Bootstrap темы: применяется в <head> до первой отрисовки, поэтому пользователь
 * не видит вспышки чужого акцента. Поддерживаются и старые id тем
 * (cyber/ocean/mint) — они нормализуются в актуальные (violet/indigo/graphite).
 */
const appearanceBootstrapScript = `(() => {
  const themes = ${JSON.stringify(themeBootstrapMap())};
  const legacyThemes = ${JSON.stringify(LEGACY_THEME_ALIASES)};
  const textSizes = ${JSON.stringify(TEXT_SIZE_OPTIONS.map(({ id }) => id))};
  let theme = ${JSON.stringify(DEFAULT_THEME)};
  let textSize = ${JSON.stringify(DEFAULT_TEXT_SIZE)};

  const normalizeTheme = (value) => {
    if (typeof value !== "string") return null;
    if (Object.prototype.hasOwnProperty.call(themes, value)) return value;
    return Object.prototype.hasOwnProperty.call(legacyThemes, value) ? legacyThemes[value] : null;
  };

  try {
    let savedTheme = window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    let normalized = normalizeTheme(savedTheme);
    if (!normalized) {
      savedTheme = window.localStorage.getItem(${JSON.stringify(LEGACY_THEME_STORAGE_KEY)});
      normalized = normalizeTheme(savedTheme);
    }
    if (normalized) {
      theme = normalized;
      window.localStorage.setItem(${JSON.stringify(THEME_STORAGE_KEY)}, normalized);
    }

    const savedTextSize = window.localStorage.getItem(${JSON.stringify(TEXT_SIZE_STORAGE_KEY)});
    if (textSizes.includes(savedTextSize)) textSize = savedTextSize;
  } catch {
    // Keep server-rendered defaults when browser storage is unavailable.
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.textSize = textSize;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themes[theme]);
})();`;

export const metadata: Metadata = {
  applicationName: "EduFlow",
  title: {
    default: "EduFlow — Интерактивная образовательная платформа с ИИ",
    template: "%s · EduFlow",
  },
  description:
    "Онлайн-уроки, виртуальная доска, умные ДЗ и ИИ-помощник нового поколения",
  keywords: [
    "EduFlow",
    "видеоуроки для школ",
    "онлайн-уроки",
    "ИИ-доска",
    "GPT-4o Vision",
    "расписание уроков",
    "шифрованный чат",
  ],
  authors: [{ name: "EduFlow" }],
  openGraph: {
    title: "EduFlow — Интерактивная образовательная платформа с ИИ",
    description:
      "Онлайн-уроки, виртуальная доска, умные ДЗ и ИИ-помощник нового поколения",
    type: "website",
    locale: "ru_RU",
    siteName: "EduFlow",
  },
  twitter: {
    card: "summary_large_image",
    title: "EduFlow — Интерактивная образовательная платформа с ИИ",
    description:
      "Онлайн-уроки, виртуальная доска, умные ДЗ и ИИ-помощник нового поколения",
  },
  robots: { index: true, follow: true },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "EduFlow",
  },
};

export const viewport: Viewport = {
  themeColor: "#0B0F17",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

const serviceWorkerScript = `(() => {
  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    });
  }
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      data-theme={DEFAULT_THEME}
      data-text-size={DEFAULT_TEXT_SIZE}
      suppressHydrationWarning
      className="dark scroll-smooth"
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceBootstrapScript }} />
        <script dangerouslySetInnerHTML={{ __html: serviceWorkerScript }} />
        {/* PWA и iOS метатеги для сборки .apk и полноэкранного режима */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0B0F17" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="EduFlow" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
        <link rel="icon" type="image/svg+xml" href="/icon.svg" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-[100dvh] font-sans antialiased`}
      >
        <Providers>
          {/* Единственная прокручиваемая область на мобильных (Zero-Scroll). */}
          <div className="app-frame">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
