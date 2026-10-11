"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ClipboardList, Home, User, Video, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface BottomNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Сопоставление по префиксу пути для активных состояний. */
  matchPrefix: string;
}

const BOTTOM_NAV: BottomNavItem[] = [
  { href: "/dashboard", label: "Дашборд", icon: Home, matchPrefix: "/dashboard" },
  { href: "/schedule", label: "Расписание", icon: CalendarDays, matchPrefix: "/schedule" },
  { href: "/homework", label: "ДЗ", icon: ClipboardList, matchPrefix: "/homework" },
  { href: "/meeting", label: "Звонки", icon: Video, matchPrefix: "/meeting" },
  { href: "/dashboard#profile", label: "Профиль", icon: User, matchPrefix: "__profile__" },
];

/**
 * Нижняя навигационная панель для мобильных устройств.
 * Показывается только на экранах < md (768px).
 * На внутренних страницах авторизованной зоны.
 */
export function BottomNav() {
  const pathname = usePathname();

  /* Не показываем навбар на лендинге, в звонке или на страницах авторизации. */
  const hiddenPaths = ["/login", "/register", "/banned"];
  if (hiddenPaths.some((p) => pathname.startsWith(p))) return null;
  if (pathname === "/" || pathname.startsWith("/admin")) return null;

  return (
    <nav
      aria-label="Нижняя навигация"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-950/90 backdrop-blur-2xl md:hidden safe-bottom"
    >
      <div className="mx-auto flex h-16 max-w-md items-center justify-around px-2">
        {BOTTOM_NAV.map((item) => {
          const isActive =
            item.matchPrefix === "__profile__"
              ? false
              : pathname === item.href || pathname.startsWith(`${item.matchPrefix}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 transition-all duration-200",
                isActive
                  ? "text-brand-300 scale-110"
                  : "text-slate-500 hover:text-slate-300 active:scale-95",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
                  isActive && "bg-brand-500/15",
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
              </span>
              <span className="text-[10px] font-medium leading-tight">{item.label}</span>
              {isActive && (
                <span className="absolute -top-0 h-0.5 w-8 rounded-full bg-brand-gradient" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
