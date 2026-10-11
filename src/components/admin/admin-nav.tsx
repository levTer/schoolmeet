"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarClock, Megaphone, ScrollText, Users, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Role } from "@/types";

interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Кому виден раздел. `null` — всей админ-панели (ADMIN и TEACHER). */
  roles: readonly Role[] | null;
}

const TABS: readonly Tab[] = [
  { href: "/admin", label: "Обзор", icon: BarChart3, roles: null },
  { href: "/admin/users", label: "Пользователи", icon: Users, roles: null },
  { href: "/admin/meetings", label: "Уроки и посещаемость", icon: CalendarClock, roles: null },
  { href: "/admin/announcements", label: "Объявления", icon: Megaphone, roles: null },
  { href: "/admin/audit", label: "Журнал действий", icon: ScrollText, roles: ["ADMIN"] },
];

/** Подменю админ-панели: активная вкладка подсвечивается градиентом. */
export function AdminNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const tabs = TABS.filter((tab) => !tab.roles || tab.roles.includes(role));

  return (
    <nav aria-label="Разделы админ-панели" className="glass-card flex flex-wrap gap-1 p-1.5">
      {tabs.map((tab) => {
        const isActive = tab.href === "/admin" ? pathname === "/admin" : pathname.startsWith(tab.href);
        const Icon = tab.icon;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-sm transition",
              isActive
                ? "bg-brand-gradient text-white shadow-glow"
                : "text-slate-400 hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="whitespace-nowrap">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
