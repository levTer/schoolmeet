import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { Providers } from "@/components/providers";
import {
  DEFAULT_TEXT_SIZE,
  DEFAULT_THEME,
  LEGACY_THEME_STORAGE_KEY,
  TEXT_SIZE_OPTIONS,
  TEXT_SIZE_STORAGE_KEY,
  THEME_OPTIONS,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

import "katex/dist/katex.min.css";
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

const appearanceBootstrapScript = `(() => {
  const themes = ${JSON.stringify(
    Object.fromEntries(THEME_OPTIONS.map(({ id, background }) => [id, background])),
  )};
  const textSizes = ${JSON.stringify(TEXT_SIZE_OPTIONS.map(({ id }) => id))};
  let theme = ${JSON.stringify(DEFAULT_THEME)};
  let textSize = ${JSON.stringify(DEFAULT_TEXT_SIZE)};

  try {
    let savedTheme = window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    if (!Object.prototype.hasOwnProperty.call(themes, savedTheme)) {
      savedTheme = window.localStorage.getItem(${JSON.stringify(LEGACY_THEME_STORAGE_KEY)});
    }
    if (Object.prototype.hasOwnProperty.call(themes, savedTheme)) theme = savedTheme;

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
  title: {
    default: "Лицей Сингулярити — видеоуроки с ИИ-доской",
    template: "%s · Лицей Сингулярити",
  },
  description:
    "Лицей Сингулярити — школьная платформа видеозвонков и уроков: HD-видео, интерактивная ИИ-доска с GPT-4o Vision, расписание с ролями и защищённый чат на AES-256.",
  keywords: [
    "Лицей Сингулярити",
    "видеоуроки для школ",
    "онлайн-уроки",
    "ИИ-доска",
    "GPT-4o Vision",
    "расписание уроков",
    "шифрованный чат",
  ],
  authors: [{ name: "Лицей Сингулярити" }],
  openGraph: {
    title: "Лицей Сингулярити — Zoom нового поколения для школ с ИИ-ассистентом",
    description:
      "HD-видеозвонки, интерактивная доска с распознаванием формул, расписание с ролями и защищённый чат — в одной платформе.",
    type: "website",
    locale: "ru_RU",
    siteName: "Лицей Сингулярити",
  },
  robots: { index: true, follow: true },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Сингулярити",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
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
        <meta name="theme-color" content="#0f172a" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
        <link rel="icon" type="image/svg+xml" href="/icon-192.svg" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-[100dvh] font-sans antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
