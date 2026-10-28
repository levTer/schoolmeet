import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  /** Размер «плитки» с иконкой. */
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  /**
   * Название школы для второй строки вордмарка (`session.user.schoolName`).
   * Без названия показывается только бренд платформы «EduFlow».
   */
  schoolName?: string | null;
}

const sizes = {
  sm: "h-8 w-8 rounded-lg",
  md: "h-9 w-9 rounded-xl",
  lg: "h-12 w-12 rounded-2xl",
} as const;

/**
 * Логотип EduFlow в стиле дизайн-системы.
 *
 * Слева — квадратная иконка с тонкой окантовкой (без свечения), справа —
 * спокойный вордмарк `EduFlow` (text-sm font-semibold) и название школы
 * подписью `text-[11px] text-slate-400`. Никаких крупных зелёных надписей.
 */
export function Logo({ className, size = "md", showWordmark = true, schoolName }: LogoProps) {
  const brandName = schoolName || "EduFlow";
  const secondary = schoolName && schoolName !== "EduFlow" ? schoolName : null;

  return (
    <Link
      href="/"
      className={cn("group inline-flex min-w-0 items-center gap-2", className)}
      aria-label={`${brandName} — на главную`}
    >
      <span
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-white/10 bg-surface",
          sizes[size],
        )}
      >
        <Image src="/icon.svg" alt="" width={48} height={48} unoptimized className="h-full w-full" />
      </span>

      {showWordmark ? (
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-semibold tracking-tight text-white">
            EduFlow
          </span>
          {secondary ? (
            <span className="block max-w-[9rem] truncate text-[11px] text-slate-400">{secondary}</span>
          ) : null}
        </span>
      ) : null}
    </Link>
  );
}
