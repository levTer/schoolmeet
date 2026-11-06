"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarClock, Megaphone, ScrollText, Users, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Разделы админ-панели. Вся панель доступна строго роли ADMIN (см.
 * `src/middleware.ts` и `src/app/admin/layout.tsx`), поэтому фильтровать вкладки
 * по ролям не нужно — учитель и ученик сюда не попадают вовсе.
 */
const TABS: readonly Tab[] = [
  { href: "/admin", label: "Обзор", icon: BarChart3 },
  { href: "/admin/users", label: "Пользователи", icon: Users },
  { href: "/admin/meetings", label: "Уроки и посещаемость", icon: CalendarClock },
  { href: "/admin/announcements", label: "Объявления", icon: Megaphone },
  { href: "/admin/audit", label: "Журнал действий", icon: ScrollText },
];

/** Подменю админ-панели: активная вкладка подсвечивается градиентом. */
export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Разделы админ-панели"
      className="glass-card grid w-full min-w-0 grid-cols-2 gap-1 p-1.5 sm:flex sm:flex-wrap"
    >
      {TABS.map((tab) => {
        const isActive = tab.href === "/admin" ? pathname === "/admin" : pathname.startsWith(tab.href);
        const Icon = tab.icon;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex w-full min-w-0 items-center gap-2 rounded-xl px-2.5 py-2.5 text-xs leading-tight transition sm:w-auto sm:rounded-2xl sm:px-3.5 sm:text-sm",
              isActive
                ? "bg-brand-gradient text-brand-contrast shadow-glow"
                : "text-slate-400 hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words sm:whitespace-nowrap">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
