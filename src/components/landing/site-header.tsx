"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, ShieldCheck, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Logo } from "./logo";

const NAV_LINKS = [
  { href: "/#features", label: "Возможности" },
  { href: "/#schedule", label: "Расписание" },
  { href: "/#ai-board", label: "ИИ-Доска" },
] as const;

export function SiteHeader() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        isScrolled || isMenuOpen
          ? "border-b border-white/10 bg-ink-950/80 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Logo />

        {/* Десктопная навигация */}
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/login"
            className="rounded-full px-4 py-2 text-sm font-medium text-slate-300 transition hover:text-white"
          >
            Войти
          </Link>
          <Link
            href="/register"
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.03]"
          >
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            <span className="relative">Регистрация</span>
          </Link>
        </div>

        {/* Мобильный переключатель */}
        <button
          type="button"
          onClick={() => setIsMenuOpen((open) => !open)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 md:hidden"
          aria-label={isMenuOpen ? "Закрыть меню" : "Открыть меню"}
          aria-expanded={isMenuOpen}
        >
          {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Мобильное меню */}
      {isMenuOpen && (
        <div className="animate-fade-in border-t border-white/10 bg-ink-950/95 px-5 py-5 backdrop-blur-xl md:hidden">
          <nav className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setIsMenuOpen(false)}
                className="rounded-xl px-4 py-3 text-base text-slate-200 transition hover:bg-white/5 hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="mt-4 flex flex-col gap-2">
            <Link
              href="/login"
              onClick={() => setIsMenuOpen(false)}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm font-medium text-slate-200"
            >
              Войти
            </Link>
            <Link
              href="/register"
              onClick={() => setIsMenuOpen(false)}
              className="rounded-xl bg-brand-gradient px-4 py-3 text-center text-sm font-semibold text-white shadow-glow"
            >
              Регистрация
            </Link>
          </div>
        </div>
      )}

      {/* Полоска безопасности под шапкой */}
      <div className="hidden border-t border-white/5 bg-white/[0.02] md:block">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-8 py-1.5 text-[11px] text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
          Сквозное шифрование AES-256 · WebRTC / SRTP · Данные не передаются третьим лицам
        </div>
      </div>
    </header>
  );
}
