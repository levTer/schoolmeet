import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  /** Размер «плитки» с иконкой. */
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  /**
   * Название школы для вордмарка (из сессии: `session.user.schoolName`).
   * Без названия показывается бренд платформы «EduFlow».
   */
  schoolName?: string | null;
}

const sizes = {
  sm: "h-8 w-8 rounded-lg",
  md: "h-10 w-10 rounded-xl",
  lg: "h-12 w-12 rounded-2xl",
} as const;

export function Logo({ className, size = "md", showWordmark = true, schoolName }: LogoProps) {
  const brandName = schoolName || "EduFlow";

  return (
    <Link
      href="/"
      className={cn("group inline-flex items-center gap-3", className)}
      aria-label={`${brandName} — на главную`}
    >
      <span className="relative inline-flex">
        <span className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-slate-500/40 via-transparent to-amber-500/40 opacity-40 blur-md transition group-hover:opacity-70" />
        <span
          className={cn(
            "relative inline-flex items-center justify-center overflow-hidden bg-[#0F172A] shadow-glow",
            sizes[size],
          )}
        >
          <Image
            src="/icon.svg"
            alt=""
            width={48}
            height={48}
            unoptimized
            className="h-full w-full"
          />
        </span>
      </span>

      {showWordmark && (
        <span className="text-lg font-semibold tracking-tight text-white">
          <span className="text-gradient-brand">{brandName}</span>
        </span>
      )}
    </Link>
  );
}
