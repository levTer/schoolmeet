"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Loader2, LogOut } from "lucide-react";

import { cn } from "@/lib/utils";

interface SignOutButtonProps {
  label?: string;
  className?: string;
}

/** Кнопка выхода из аккаунта (используется на страницах блокировки и ошибок). */
export function SignOutButton({ label = "Выйти из аккаунта", className }: SignOutButtonProps) {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signOut({ callbackUrl: "/" });
      }}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-5 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:opacity-60",
        className,
      )}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
      {label}
    </button>
  );
}
