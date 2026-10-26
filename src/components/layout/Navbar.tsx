"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import type { Session } from "next-auth";
import {
  CalendarDays,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Video,
  type LucideIcon,
} from "lucide-react";

import { Logo } from "@/components/landing/logo";
import { ClassSwitcher } from "@/components/layout/ClassSwitcher";
import { AppearanceSettingsMenu } from "@/components/theme/AppearanceSettingsMenu";
import { ROLE_LABELS, type Role } from "@/types";
import { cn, getInitials } from "@/lib/utils";

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
  { href: "/admin", label: "Админ-панель", icon: ShieldCheck, roles: ["ADMIN"] },
];

const ROLE_BADGES: Record<Role, string> = {
  ADMIN: "border-rose-400/30 bg-rose-500/15 text-rose-200",
  TEACHER: "border-brand-400/30 bg-brand-500/15 text-brand-100",
  STUDENT: "border-accent-400/30 bg-accent-500/15 text-accent-300",
};

/**
 * Шапка авторизованной части приложения.
 *
 * Показывает профиль текущего пользователя (инициалы/аватар, имя, email),
 * его роль и кнопку «Выйти» (`signOut`). Пункты меню фильтруются по ролям:
 * «Админ-панель» видит ТОЛЬКО ADMIN — учителя и ученики этой ссылки не получают
 * (сам раздел /admin дополнительно закрыт middleware).
 *
 * `user` приходит из серверного `AppShell` (`getServerSession`), поэтому
 * профиль и роль уже есть в первом HTML-ответе — без мигания «загрузки».
 */
export function Navbar({ user }: { user: Session["user"] | null }) {
  const pathname = usePathname();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isMobileProfileOpen, setIsMobileProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const mobileProfileRef = useRef<HTMLDivElement>(null);

  const role: Role | null = user?.role ?? null;
  const schoolName = user?.schoolName || "SchoolMeet";
  const isAuthenticated = Boolean(user && role);

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.roles) return true;
    if (item.href === "/admin") return role === "ADMIN";
    return role !== null && item.roles.includes(role);
  });

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
    <header className="sticky top-0 z-50 border-b border-white/10 bg-ink-950/75 backdrop-blur-2xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-8 md:h-16">
        <div className="flex items-center gap-6">
          <Logo size="sm" schoolName={schoolName} />
        </div>

        {/* Навигация (десктоп) */}
        <nav className="hidden items-center gap-1 md:flex">
          {visibleItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm transition",
                  isActive
                    ? "bg-brand-500/15 text-white shadow-inner-top ring-1 ring-brand-400/30"
                    : "text-slate-400 hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Настройки внешнего вида и профиль (десктоп) */}
        <div className="hidden items-center gap-3 md:flex">
          {!isAuthenticated && (
            <>
              <Link
                href="/login"
                className="rounded-full px-4 py-2 text-sm font-medium text-slate-300 transition hover:text-white"
              >
                Войти
              </Link>
              <Link
                href="/auth/register"
                className="rounded-full bg-brand-gradient px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.03]"
              >
                Регистрация
              </Link>
              <AppearanceSettingsMenu />
            </>
          )}

          {isAuthenticated && user && role && (
            <div className="flex items-center gap-2">
              {/* Переключение класса (гибкая школа — Select, строгая — бейдж). */}
              <ClassSwitcher />

              <div ref={profileRef} className="relative">
                <button
                  type="button"
                  onClick={() => setIsProfileOpen((open) => !open)}
                  aria-expanded={isProfileOpen}
                  aria-haspopup="menu"
                  className="group flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] py-1.5 pl-1.5 pr-3 transition hover:bg-white/[0.08]"
                >
                  <Avatar name={user.name} image={user.image} />
                  <span className="text-left">
                    <span className="block max-w-[10rem] truncate text-sm font-medium leading-tight text-white">
                      {user.name ?? "Пользователь"}
                    </span>
                    <span className="block text-[11px] leading-tight text-slate-400">
                      {ROLE_LABELS[role]}
                    </span>
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-slate-500 transition",
                      isProfileOpen && "rotate-180 text-slate-300",
                    )}
                  />
                </button>

                {isProfileOpen && (
                  <div
                    role="menu"
                    className="animate-fade-up absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-white/10 bg-ink-900/95 shadow-glow backdrop-blur-2xl"
                  >
                    <div className="border-b border-white/5 p-4">
                      <p className="truncate text-sm font-medium text-white">
                        {user.name ?? "Пользователь"}
                      </p>
                      <p className="truncate text-xs text-slate-400">{user.email}</p>
                      <span
                        className={cn(
                          "mt-2 inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                          ROLE_BADGES[role],
                        )}
                      >
                        {ROLE_LABELS[role]} · {role}
                      </span>
                    </div>

                    <div className="p-1.5">
                      {visibleItems.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          role="menuitem"
                          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
                        >
                          <item.icon className="h-4 w-4" />
                          {item.label}
                        </Link>
                      ))}

                      <button
                        type="button"
                        role="menuitem"
                        onClick={handleSignOut}
                        className="mt-0.5 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-rose-300 transition hover:bg-rose-500/10 hover:text-rose-200"
                      >
                        <LogOut className="h-4 w-4" />
                        Выйти
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <AppearanceSettingsMenu />

              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-slate-300 transition hover:border-rose-400/30 hover:bg-rose-500/10 hover:text-rose-200"
              >
                <LogOut className="h-4 w-4" />
                Выйти
              </button>
            </div>
          )}
        </div>

        {/* Компактная мобильная шапка: логотип, профиль и настройки. */}
        <div className="flex items-center gap-2 md:hidden">
          {isAuthenticated && user && role ? (
            <div ref={mobileProfileRef} className="relative">
              <button
                type="button"
                onClick={() => setIsMobileProfileOpen((open) => !open)}
                aria-label="Открыть профиль"
                aria-expanded={isMobileProfileOpen}
                aria-haspopup="menu"
                className="inline-flex min-h-[46px] min-w-[46px] items-center justify-center rounded-full ring-offset-2 ring-offset-ink-950 transition hover:ring-2 hover:ring-brand-400/50"
              >
                <Avatar name={user.name} image={user.image} />
              </button>

              {isMobileProfileOpen && (
                <div
                  role="menu"
                  className="animate-fade-up safe-pb absolute right-0 top-full z-[70] mt-2 w-64 overflow-hidden rounded-2xl border border-white/10 bg-ink-900/95 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-glow backdrop-blur-2xl"
                >
                  <div className="border-b border-white/5 p-4">
                    <p className="truncate text-sm font-medium text-white">{user.name ?? "Пользователь"}</p>
                    <p className="truncate text-xs text-slate-400">{user.email}</p>
                    <span className={cn(
                      "mt-2 inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                      ROLE_BADGES[role],
                    )}>
                      {ROLE_LABELS[role]} · {role}
                    </span>
                  </div>
                  <div className="p-1.5">
                    {role === "STUDENT" && (
                      <div className="mb-1 px-3 pb-1.5 pt-1">
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          Мой класс
                        </p>
                        <ClassSwitcher />
                      </div>
                    )}
                    <Link
                      href="/dashboard#profile"
                      role="menuitem"
                      onClick={() => setIsMobileProfileOpen(false)}
                      className="flex min-h-[46px] items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
                    >
                      <LayoutDashboard className="h-4 w-4" />
                      Профиль
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleSignOut}
                      className="mt-0.5 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-rose-300 transition hover:bg-rose-500/10 hover:text-rose-200"
                    >
                      <LogOut className="h-4 w-4" />
                      Выйти
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className="inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
            >
              Войти
            </Link>
          )}
          <AppearanceSettingsMenu />
        </div>
      </div>
    </header>
  );
}

/** Аватар пользователя: фото из профиля или инициалы на градиенте. */
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
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-gradient font-semibold text-white shadow-glow",
        size === "md" ? "h-9 w-9 text-xs" : "h-11 w-11 text-sm",
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
