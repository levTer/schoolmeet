import Link from "next/link";
import { GraduationCap } from "lucide-react";

import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  /** Размер «плитки» с иконкой. */
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  /**
   * Название школы для вордмарка (из сессии: `session.user.schoolName`).
   * Без названия показывается бренд платформы «SchoolMeet».
   */
  schoolName?: string | null;
}

const sizes = {
  sm: "h-8 w-8 rounded-lg",
  md: "h-10 w-10 rounded-xl",
  lg: "h-12 w-12 rounded-2xl",
} as const;

export function Logo({ className, size = "md", showWordmark = true, schoolName }: LogoProps) {
  const brandName = schoolName || "SchoolMeet";

  return (
    <Link
      href="/"
      className={cn("group inline-flex items-center gap-3", className)}
      aria-label={`${brandName} — на главную`}
    >
      <span className="relative inline-flex">
        <span className="absolute -inset-1 rounded-2xl bg-brand-gradient opacity-40 blur-md transition group-hover:opacity-70" />
        <span
          className={cn(
            "relative inline-flex items-center justify-center bg-brand-gradient shadow-glow",
            sizes[size],
          )}
        >
          <GraduationCap
            className={cn(
              "text-white",
              size === "sm" ? "h-4 w-4" : size === "md" ? "h-5 w-5" : "h-6 w-6",
            )}
            strokeWidth={2.2}
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
