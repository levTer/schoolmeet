import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { Providers } from "@/components/providers";

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

export const metadata: Metadata = {
  title: {
    default: "SchoolMeet — видеоуроки для школ с ИИ-доской",
    template: "%s · SchoolMeet",
  },
  description:
    "SchoolMeet — платная платформа видеозвонков и уроков для школ: HD-видео, интерактивная ИИ-доска с GPT-4o Vision, школьное расписание с ролями и защищённый чат на AES-256.",
  keywords: [
    "SchoolMeet",
    "видеоуроки для школ",
    "онлайн-уроки",
    "ИИ-доска",
    "GPT-4o Vision",
    "расписание уроков",
    "шифрованный чат",
  ],
  authors: [{ name: "SchoolMeet" }],
  openGraph: {
    title: "SchoolMeet — Zoom нового поколения для школ с ИИ-ассистентом",
    description:
      "HD-видеозвонки, интерактивная доска с распознаванием формул, расписание с ролями и защищённый чат — в одной платформе.",
    type: "website",
    locale: "ru_RU",
    siteName: "SchoolMeet",
  },
  robots: { index: true, follow: true },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SchoolMeet",
  },
};

export const viewport: Viewport = {
  themeColor: "#05060f",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="dark scroll-smooth">
      <head>
        {/* iOS PWA: полноэкранный режим, иконка на рабочем столе */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/icon-192.svg" />
        <link rel="icon" type="image/svg+xml" href="/icon-192.svg" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-ink-950 font-sans antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
