"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import type { Session } from "next-auth";
import {
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Video,
  type LucideIcon,
} from "lucide-react";

import { Logo } from "@/components/landing/logo";
import { PwaInstallButton } from "@/components/pwa-install-button";
import { ClassSwitcher } from "@/components/layout/ClassSwitcher";
import { AppearanceSettingsMenu } from "@/components/theme/AppearanceSettingsMenu";
import { useTheme } from "@/components/theme/theme-provider";
import { useDesktopTitlebar } from "@/hooks/useDesktopTitlebar";
import { useIsApp } from "@/hooks/useIsApp";
import { getThemeOption } from "@/lib/theme";
import { ROLE_LABELS, type Role } from "@/types";
import { cn, getInitials } from "@/lib/utils";

/*
 * Electron drag-region: шапка тянет окно, любой интерактивный элемент — нет.
 * Инлайн-стили обязательны: это Chromium-специфичное свойство, которого нет
 * в Tailwind. Дублируется утилитами `.drag-region` / `.no-drag` в globals.css.
 */
const NO_DRAG_STYLE = { WebkitAppRegion: "no-drag" } as unknown as CSSProperties;
const DRAG_STYLE = { WebkitAppRegion: "drag" } as unknown as CSSProperties;

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Роли, которым доступен пункт. `null` — доступен всем авторизованным. */
  roles: readonly Role[] | null;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Кабинет", icon: LayoutDashboard, roles: null },
  { href: "/schedule", label: "Расписание", icon: CalendarDays, roles: null },
  { href: "/homework", label: "ДЗ", icon: ClipboardList, roles: null },
  { href: "/meeting", label: "Урок", icon: Video, roles: null },
  { href: "/admin", label: "Админ", icon: ShieldCheck, roles: ["ADMIN"] },
];

const ROLE_BADGES: Record<Role, string> = {
  ADMIN: "border-rose-400/25 bg-rose-500/10 text-rose-200",
  TEACHER: "border-brand-400/25 bg-brand-500/10 text-brand-200",
  STUDENT: "border-white/10 bg-white/[0.04] text-slate-300",
};

/**
 * Шапка авторизованной части приложения.
 *
 * Дизайн-система: высота 56px, тонкая окантовка снизу, логотип EduFlow и
 * название школы слева (без крупных зелёных надписей), профиль-аватар справа.
 * На мобильных учитывается `env(safe-area-inset-top)` (Edge-to-Edge APK/PWA).
 *
 * Внутри установленного приложения (`useIsApp() === true`) кнопка установки
 * `[↓]` не рендерится вовсе: обновления приходят с сервера вместе с оболочкой.
 *
 * Тема синхронизируется с нативным хромом: Electron получает цвета
 * `titleBarOverlay`, Android — цвет статус-бара через мост `AndroidApp`.
 */
export function Navbar({ user }: { user: Session["user"] | null }) {
  const pathname = usePathname();
  const { theme } = useTheme();
  const isApp = useIsApp();
  const { isWindowsDesktop, titlebarStyle } = useDesktopTitlebar();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isMobileProfileOpen, setIsMobileProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const mobileProfileRef = useRef<HTMLDivElement>(null);

  const role: Role | null = user?.role ?? null;
  const schoolName = user?.schoolName || "EduFlow";
  const isAuthenticated = Boolean(user && role);
  const currentTheme = getThemeOption(theme);

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.roles) return true;
    if (item.href === "/admin") return role === "ADMIN";
    return role !== null && item.roles.includes(role);
  });

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

  /* Закрываем меню при переходе на другую страницу. */
  useEffect(() => {
    setIsProfileOpen(false);
    setIsMobileProfileOpen(false);
  }, [pathname]);

  /* Закрытие выпадающего профиля по клику вне и по Escape. */
  useEffect(() => {
    if (!isProfileOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsProfileOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isProfileOpen]);

  useEffect(() => {
    if (!isMobileProfileOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (mobileProfileRef.current && !mobileProfileRef.current.contains(event.target as Node)) {
        setIsMobileProfileOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileProfileOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isMobileProfileOpen]);

  const handleSignOut = () => {
    void signOut({ callbackUrl: "/" });
  };

  return (
    <header
      className="sticky top-0 z-50 shrink-0 border-b border-white/10 bg-canvas/90 pt-[env(safe-area-inset-top)] backdrop-blur-xl"
      style={DRAG_STYLE}
    >
      <div
        className={cn(
          "mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-5",
          isWindowsDesktop && "max-w-none",
        )}
        style={titlebarStyle}
      >
        {/* Логотип + название школы: аккуратно, без крупного зелёного текста. */}
        <div className="flex min-w-0 items-center" style={NO_DRAG_STYLE}>
          <Logo size="sm" schoolName={schoolName} />
        </div>

        {/* Навигация (десктоп) */}
        <nav
          className={cn("ml-2 hidden items-center gap-0.5 md:flex", isWindowsDesktop && "shrink-0")}
          style={NO_DRAG_STYLE}
        >
          {visibleItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;

            return (
              <Link
                style={NO_DRAG_STYLE}
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors",
                  isWindowsDesktop && "max-[850px]:px-1.5",
                  isActive
                    ? "bg-brand-500/15 text-white"
                    : "text-slate-400 hover:bg-white/[0.05] hover:text-white",
                )}
              >
                <Icon className={cn("h-4 w-4", isActive && "text-brand-300")} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Установка [↓] — только вне приложения (useIsApp скрывает её в APK/EXE/PWA). */}
        <div className="ml-auto flex items-center gap-1.5" style={NO_DRAG_STYLE}>
          {!isApp ? <PwaInstallButton /> : null}

          <span style={NO_DRAG_STYLE}>
            <AppearanceSettingsMenu />
          </span>

          {/* Десктоп: профиль с именем и ролью. */}
          {isAuthenticated && user && role ? (
            <div ref={profileRef} className="relative hidden md:block">
              <button
                style={NO_DRAG_STYLE}
                type="button"
                onClick={() => setIsProfileOpen((open) => !open)}
                aria-expanded={isProfileOpen}
                aria-haspopup="menu"
                aria-label="Меню профиля"
                className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-1.5 transition hover:border-white/20 hover:bg-white/[0.07] sm:pr-2.5"
              >
                <Avatar name={user.name} image={user.image} />
                <span className="hidden text-left lg:block">
                  <span className="block max-w-[9rem] truncate text-sm font-medium leading-tight text-white">
                    {user.name ?? "Пользователь"}
                  </span>
                  <span className="block text-[11px] leading-tight text-slate-400">
                    {ROLE_LABELS[role]}
                  </span>
                </span>
              </button>

              {isProfileOpen ? (
                <div
                  role="menu"
                  style={NO_DRAG_STYLE}
                  className="animate-fade-up absolute right-0 mt-2 w-72 overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-xl"
                >
                  <div className="border-b border-white/10 p-3.5">
                    <p className="truncate text-sm font-medium text-white">
                      {user.name ?? "Пользователь"}
                    </p>
                    <p className="truncate text-xs text-slate-400">{user.email}</p>
                    <span
                      className={cn(
                        "mt-2 inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium",
                        ROLE_BADGES[role],
                      )}
                    >
                      {ROLE_LABELS[role]} · {role}
                    </span>
                  </div>

                  <div className="border-b border-white/10 p-2">
                    <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Мой класс
                    </p>
                    <ClassSwitcher />
                  </div>

                  <div className="p-1.5">
                    {visibleItems.map((item) => (
                      <Link
                        style={NO_DRAG_STYLE}
                        key={item.href}
                        href={item.href}
                        role="menuitem"
                        className="flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-300 transition hover:bg-white/[0.05] hover:text-white"
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </Link>
                    ))}

                    <Link
                      style={NO_DRAG_STYLE}
                      href="/account/security"
                      role="menuitem"
                      className="flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-300 transition hover:bg-white/[0.05] hover:text-white"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      Безопасность
                    </Link>

                    <button
                      style={NO_DRAG_STYLE}
                      type="button"
                      role="menuitem"
                      onClick={handleSignOut}
                      className="mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-rose-300 transition hover:bg-rose-500/10 hover:text-rose-200"
                    >
                      <LogOut className="h-4 w-4" />
                      Выйти
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <Link
              style={NO_DRAG_STYLE}
              href="/login"
              className="hidden items-center rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-300 transition hover:bg-white/[0.05] hover:text-white md:inline-flex"
            >
              Войти
            </Link>
          )}

          {/* Мобильный профиль: только аватар, меню — в поповере. */}
          {isAuthenticated && user && role ? (
            <div ref={mobileProfileRef} className="relative md:hidden" style={NO_DRAG_STYLE}>
              <button
                style={NO_DRAG_STYLE}
                type="button"
                onClick={() => setIsMobileProfileOpen((open) => !open)}
                aria-label="Открыть профиль"
                aria-expanded={isMobileProfileOpen}
                aria-haspopup="menu"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-90"
              >
                <Avatar name={user.name} image={user.image} />
              </button>

              {isMobileProfileOpen ? (
                <div
                  role="menu"
                  className="animate-fade-up absolute right-0 top-full z-[70] mt-2 w-64 overflow-hidden rounded-2xl border border-white/10 bg-surface pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl"
                >
                  <div className="border-b border-white/10 p-3.5">
                    <p className="truncate text-sm font-medium text-white">{user.name ?? "Пользователь"}</p>
                    <p className="truncate text-xs text-slate-400">{user.email}</p>
                    <span
                      className={cn(
                        "mt-2 inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium",
                        ROLE_BADGES[role],
                      )}
                    >
                      {ROLE_LABELS[role]} · {role}
                    </span>
                  </div>
                  <div className="p-1.5">
                    {role === "STUDENT" ? (
                      <div className="mb-1 px-2 pb-1 pt-1">
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          Мой класс
                        </p>
                        <ClassSwitcher />
                      </div>
                    ) : null}
                    <Link
                      style={NO_DRAG_STYLE}
                      href="/dashboard#profile"
                      role="menuitem"
                      onClick={() => setIsMobileProfileOpen(false)}
                      className="flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-300 transition hover:bg-white/[0.05] hover:text-white"
                    >
                      <LayoutDashboard className="h-4 w-4" />
                      Профиль
                    </Link>
                    <Link
                      style={NO_DRAG_STYLE}
                      href="/account/security"
                      role="menuitem"
                      className="flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-300 transition hover:bg-white/[0.05] hover:text-white"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      Безопасность
                    </Link>

                    <button
                      style={NO_DRAG_STYLE}
                      type="button"
                      role="menuitem"
                      onClick={handleSignOut}
                      className="mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-rose-300 transition hover:bg-rose-500/10 hover:text-rose-200"
                    >
                      <LogOut className="h-4 w-4" />
                      Выйти
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <Link
              style={NO_DRAG_STYLE}
              href="/login"
              className="inline-flex h-9 items-center rounded-lg px-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/[0.05] hover:text-white md:hidden"
            >
              Войти
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

/** Аватар пользователя: фото из профиля или инициалы на акценте темы. */
function Avatar({
  name,
  image,
  size = "md",
}: {
  name?: string | null;
  image?: string | null;
  size?: "md" | "lg";
}) {
  const initials = getInitials(name ?? "SM") || "SM";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-gradient font-semibold text-brand-contrast",
        size === "md" ? "h-7 w-7 text-[11px]" : "h-10 w-10 text-sm",
      )}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt={name ?? "Аватар"} className="h-full w-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}
