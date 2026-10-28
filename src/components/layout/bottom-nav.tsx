"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ClipboardList,
  Home,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { Role } from "@/types";

interface BottomNavItem {
  id: "dashboard" | "schedule" | "homework" | "profile" | "admin";
  href: string;
  label: string;
  icon: LucideIcon;
  matchPrefix: string;
}

const BASE_ITEMS: readonly BottomNavItem[] = [
  { id: "dashboard", href: "/dashboard", label: "Главная", icon: Home, matchPrefix: "/dashboard" },
  { id: "schedule", href: "/schedule", label: "Расписание", icon: CalendarDays, matchPrefix: "/schedule" },
  { id: "homework", href: "/homework", label: "ДЗ", icon: ClipboardList, matchPrefix: "/homework" },
  { id: "profile", href: "/dashboard#profile", label: "Профиль", icon: UserRound, matchPrefix: "/dashboard" },
];

/**
 * Нижняя навигация телефона в стиле Telegram.
 *
 * Панель прижата к низу, окантовка `border-white/10`, фон страницы со
 * затемнением; активный пункт подсвечивается акцентом темы. Нижний отступ
 * учитывает `env(safe-area-inset-bottom)` (жестовая полоса Android/iOS).
 */
export function BottomNav({ role }: { role: Role | null }) {
  const pathname = usePathname();
  const [hash, setHash] = useState("");

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [pathname]);

  if (
    !role ||
    pathname === "/" ||
    ["/login", "/register", "/auth", "/banned"].some((path) => pathname.startsWith(path))
  ) {
    return null;
  }

  const items =
    role === "ADMIN"
      ? [
          ...BASE_ITEMS,
          { id: "admin" as const, href: "/admin", label: "Админ", icon: ShieldCheck, matchPrefix: "/admin" },
        ]
      : BASE_ITEMS;

  return (
    <nav
      aria-label="Нижняя навигация EduFlow"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <div className="mx-auto flex h-14 max-w-2xl items-stretch justify-around px-1">
        {items.map((item) => {
          const isProfileActive =
            item.id === "profile" && pathname === "/dashboard" && hash === "#profile";
          const isDashboardActive =
            item.id === "dashboard" && pathname === "/dashboard" && hash !== "#profile";
          const isActive =
            item.id === "profile"
              ? isProfileActive
              : item.id === "dashboard"
                ? isDashboardActive
                : pathname === item.href || pathname.startsWith(`${item.matchPrefix}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.id}
              href={item.href}
              onClick={() => setHash(item.id === "profile" ? "#profile" : "")}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-center transition-colors active:opacity-70",
                isActive ? "text-brand-300" : "text-slate-500 hover:text-slate-300",
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={isActive ? 2.4 : 2} />
              <span className={cn("truncate text-[10px] leading-tight", isActive && "font-medium")}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
