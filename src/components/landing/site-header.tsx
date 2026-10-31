"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { LayoutDashboard, Menu, X } from "lucide-react";

import { AppearanceSettingsMenu } from "@/components/theme/AppearanceSettingsMenu";
import { PwaInstallButton } from "@/components/pwa-install-button";
import { useTheme } from "@/components/theme/theme-provider";
import { useDesktopTitlebar } from "@/hooks/useDesktopTitlebar";
import { useIsApp } from "@/hooks/useIsApp";
import { getThemeOption } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";

/* Electron drag-region: шапка тянет окно, интерактив — нет. */
const NO_DRAG_STYLE = { WebkitAppRegion: "no-drag" } as unknown as CSSProperties;
const DRAG_STYLE = { WebkitAppRegion: "drag" } as unknown as CSSProperties;

const NAV_LINKS = [
  { href: "/#features", label: "Возможности" },
  { href: "/#schedule", label: "Расписание" },
  { href: "/#ai-board", label: "ИИ-доска" },
] as const;

/**
 * Шапка гостевого лендинга.
 *
 * Та же дизайн-система, что и в кабинете: 56px, тонкая окантовка, логотип
 * EduFlow слева, спокойное название школы, без крупных зелёных заголовков.
 * На мобильных учитывает `env(safe-area-inset-top)` (edge-to-edge PWA/APK).
 */
export function SiteHeader() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { isWindowsDesktop, titlebarStyle } = useDesktopTitlebar();
  const { theme } = useTheme();
  const isApp = useIsApp();
  const currentTheme = getThemeOption(theme);
  // Гость видит «Войти», авторизованный — переход в кабинет.
  const { data: session, status } = useSession();
  const isAuthenticated = status === "authenticated";

  /* Нативный хром: Electron titleBarOverlay + Android status bar. */
  useEffect(() => {
    window.eduflowDesktop?.setTheme?.({
      backgroundColor: currentTheme.titlebar,
      symbolColor: currentTheme.symbol,
    });
    if (window.AndroidApp?.setStatusBarColor) {
      window.AndroidApp.setStatusBarColor(currentTheme.bgColor);
    }
  }, [currentTheme]);

  return (
    <header
      style={DRAG_STYLE}
      className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-canvas/90 pt-[env(safe-area-inset-top)] backdrop-blur-xl"
    >
      <div
        className={cn(
          "mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-5",
          isWindowsDesktop && "max-w-none",
        )}
        style={titlebarStyle}
      >
        <div className="flex min-w-0 items-center" style={NO_DRAG_STYLE}>
          <Logo size="sm" schoolName={session?.user?.schoolName || "EduFlow"} />
        </div>

        {/* Десктопная навигация */}
        <nav
          className={cn("ml-3 hidden items-center gap-0.5 md:flex", isWindowsDesktop && "shrink-0")}
          style={NO_DRAG_STYLE}
        >
          {NAV_LINKS.map((link) => (
            <a
              style={NO_DRAG_STYLE}
              key={link.href}
              href={link.href}
              className={cn(
                "inline-flex h-9 items-center rounded-lg px-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-white",
                isWindowsDesktop && "max-[850px]:px-1.5",
              )}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5" style={NO_DRAG_STYLE}>
          {/* В установленном приложении кнопка установки скрыта. */}
          {!isApp ? <PwaInstallButton /> : null}

          <span style={NO_DRAG_STYLE}>
            <AppearanceSettingsMenu />
          </span>

          <div className="hidden items-center gap-1.5 md:flex" style={NO_DRAG_STYLE}>
            {isAuthenticated ? (
              <Link
                style={NO_DRAG_STYLE}
                href="/dashboard"
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-500 px-3 text-sm font-medium text-canvas transition hover:bg-brand-400"
              >
                <LayoutDashboard className="h-4 w-4" />
                Кабинет
              </Link>
            ) : (
              <>
                <Link
                  style={NO_DRAG_STYLE}
                  href="/login"
                  className="inline-flex h-9 items-center rounded-lg px-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/[0.05] hover:text-white"
                >
                  Войти
                </Link>
                <Link
                  style={NO_DRAG_STYLE}
                  href="/auth/register"
                  className="inline-flex h-9 items-center rounded-lg bg-brand-500 px-3 text-sm font-medium text-canvas transition hover:bg-brand-400"
                >
                  Регистрация
                </Link>
              </>
            )}
          </div>

          {/* Мобильное меню */}
          <button
            style={NO_DRAG_STYLE}
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-200 transition hover:bg-white/[0.08] md:hidden"
            aria-label={isMenuOpen ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={isMenuOpen}
          >
            {isMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Выпадающее мобильное меню */}
      {isMenuOpen ? (
        <div
          className="animate-fade-in border-t border-white/10 bg-canvas/95 px-3 py-3 backdrop-blur-xl md:hidden"
          style={NO_DRAG_STYLE}
        >
          <nav className="flex flex-col gap-0.5">
            {NAV_LINKS.map((link) => (
              <a
                style={NO_DRAG_STYLE}
                key={link.href}
                href={link.href}
                onClick={() => setIsMenuOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.05] hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className={cn("mt-2 flex flex-col gap-1.5 border-t border-white/10 pt-3")}>
            {isAuthenticated ? (
              <Link
                style={NO_DRAG_STYLE}
                href="/dashboard"
                onClick={() => setIsMenuOpen(false)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-canvas"
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
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-center text-sm font-medium text-slate-200"
                >
                  Войти
                </Link>
                <Link
                  style={NO_DRAG_STYLE}
                  href="/auth/register"
                  onClick={() => setIsMenuOpen(false)}
                  className="rounded-lg bg-brand-500 px-4 py-2.5 text-center text-sm font-medium text-canvas"
                >
                  Регистрация
                </Link>
              </>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}
