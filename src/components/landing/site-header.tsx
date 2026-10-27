"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { LayoutDashboard, Menu, ShieldCheck, X } from "lucide-react";

import { AppearanceSettingsMenu } from "@/components/theme/AppearanceSettingsMenu";
import { PwaInstallButton } from "@/components/pwa-install-button";
import { cn } from "@/lib/utils";
import { getThemeOption } from "@/lib/theme";
import { useTheme } from "@/components/theme/theme-provider";
import { Logo } from "./logo";

const NO_DRAG_STYLE = { WebkitAppRegion: "no-drag" } as unknown as CSSProperties;
const DRAG_STYLE = { WebkitAppRegion: "drag" } as unknown as CSSProperties;

const NAV_LINKS = [
  { href: "/#features", label: "Возможности" },
  { href: "/#schedule", label: "Расписание" },
  { href: "/#ai-board", label: "ИИ-Доска" },
] as const;

export function SiteHeader() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const { theme } = useTheme();
  const currentTheme = getThemeOption(theme);
  // Гость видит «Войти / Регистрация», авторизованный — переход в кабинет.
  const { data: session, status } = useSession();
  const isAuthenticated = status === "authenticated";

  useEffect(() => {
    setIsDesktop(Boolean(window.eduflowDesktop?.isDesktop));
  }, []);

  useEffect(() => {
    window.eduflowDesktop?.setTheme?.({
      backgroundColor: currentTheme.background,
      symbolColor: currentTheme.accent,
    });
  }, [currentTheme.accent, currentTheme.background]);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      style={DRAG_STYLE}
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        isScrolled || isMenuOpen
          ? "border-b border-white/10 bg-ink-950/80 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div
        className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8"
        style={isDesktop ? { paddingRight: "env(titlebar-area-width, 140px)" } : undefined}
      >
        <div style={NO_DRAG_STYLE}><Logo schoolName={session?.user?.schoolName || "EduFlow"} /></div>

        {/* Десктопная навигация */}
        <nav className="hidden items-center gap-1 md:flex" style={NO_DRAG_STYLE}>
          {NAV_LINKS.map((link) => (
            <a
              style={NO_DRAG_STYLE}
              key={link.href}
              href={link.href}
              className="rounded-full px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div style={NO_DRAG_STYLE}><PwaInstallButton className="ml-auto md:ml-0" /></div>

        <div className="hidden items-center gap-3 md:flex" style={NO_DRAG_STYLE}>
          <AppearanceSettingsMenu />

          {isAuthenticated ? (
            <Link
              style={NO_DRAG_STYLE}
              href="/dashboard"
              className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.03]"
            >
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              <LayoutDashboard className="relative h-4 w-4" />
              <span className="relative">Личный кабинет</span>
            </Link>
          ) : (
            <>
              <Link
                style={NO_DRAG_STYLE}
                href="/login"
                className="rounded-full px-4 py-2 text-sm font-medium text-slate-300 transition hover:text-white"
              >
                Войти
              </Link>
              <Link
                style={NO_DRAG_STYLE}
                href="/auth/register"
                className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.03]"
              >
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                <span className="relative">Регистрация</span>
              </Link>
            </>
          )}
        </div>

        {/* Настройки и навигация (мобильная версия) */}
        <div className="flex items-center gap-2 md:hidden" style={NO_DRAG_STYLE}>
          <AppearanceSettingsMenu />
          <button
            style={NO_DRAG_STYLE}
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
            aria-label={isMenuOpen ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={isMenuOpen}
          >
            {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Мобильное меню */}
      {isMenuOpen && (
        <div className="animate-fade-in border-t border-white/10 bg-ink-950/95 px-5 py-5 backdrop-blur-xl md:hidden" style={NO_DRAG_STYLE}>
          <nav className="flex flex-col gap-1" style={NO_DRAG_STYLE}>
            {NAV_LINKS.map((link) => (
              <a
                style={NO_DRAG_STYLE}
                key={link.href}
                href={link.href}
                onClick={() => setIsMenuOpen(false)}
                className="rounded-xl px-4 py-3 text-base text-slate-200 transition hover:bg-white/5 hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="mt-4 flex flex-col gap-2">
            {isAuthenticated ? (
              <Link
                style={NO_DRAG_STYLE}
                href="/dashboard"
                onClick={() => setIsMenuOpen(false)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-gradient px-4 py-3 text-center text-sm font-semibold text-white shadow-glow"
              >
                <LayoutDashboard className="h-4 w-4" />
                Личный кабинет
              </Link>
            ) : (
              <>
                <Link
                  style={NO_DRAG_STYLE}
                  href="/login"
                  onClick={() => setIsMenuOpen(false)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm font-medium text-slate-200"
                >
                  Войти
                </Link>
                <Link
                  style={NO_DRAG_STYLE}
                  href="/auth/register"
                  onClick={() => setIsMenuOpen(false)}
                  className="rounded-xl bg-brand-gradient px-4 py-3 text-center text-sm font-semibold text-white shadow-glow"
                >
                  Регистрация
                </Link>
              </>
            )}
          </div>
        </div>
      )}

      {/* Полоска безопасности под шапкой */}
      <div className="hidden border-t border-white/5 bg-white/[0.02] md:block">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-8 py-1.5 text-[11px] text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-brand-300" />
          Шифрование чата AES-256 · Видео по WebRTC / SRTP · Доступ только для участников
        </div>
      </div>
    </header>
  );
}
