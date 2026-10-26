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

/** Нижняя навигация для телефонов; раздел администрирования видит только ADMIN. */
export function BottomNav({ role }: { role: Role | null }) {
  const pathname = usePathname();
  const [hash, setHash] = useState("");

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [pathname]);

  if (!role || pathname === "/" || ["/login", "/register", "/auth", "/banned"].some((path) => pathname.startsWith(path))) {
    return null;
  }

  const items = role === "ADMIN"
    ? [...BASE_ITEMS, { id: "admin" as const, href: "/admin", label: "Админка", icon: ShieldCheck, matchPrefix: "/admin" }]
    : BASE_ITEMS;

  return (
    <nav
      aria-label="Нижняя навигация EduFlow"
      className="safe-pb fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-950/90 pb-[calc(1.25rem+env(safe-area-inset-bottom))] backdrop-blur-2xl md:hidden safe-bottom"
    >
      <div className="mx-auto flex h-16 max-w-2xl items-stretch justify-around px-1.5">
        {items.map((item) => {
          const isProfileActive = item.id === "profile" && pathname === "/dashboard" && hash === "#profile";
          const isDashboardActive = item.id === "dashboard" && pathname === "/dashboard" && hash !== "#profile";
          const isActive = item.id === "profile"
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
                "relative flex min-h-14 min-w-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-center transition-colors active:scale-95",
                isActive ? "text-brand-200" : "text-slate-500 hover:text-slate-300",
              )}
            >
              {isActive && <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-brand-gradient" />}
              <span
                className={cn(
                  "flex h-7 w-8 items-center justify-center rounded-lg transition-colors",
                  isActive && "bg-brand-500/15",
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
              </span>
              <span className="text-[10px] font-medium leading-tight">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
