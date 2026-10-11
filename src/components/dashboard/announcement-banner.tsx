"use client";

import { useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";

import type { AnnouncementDto } from "@/lib/announcements";
import { GRADE_LABELS } from "@/lib/schedule-rules";
import { cn } from "@/lib/utils";

interface AnnouncementBannerProps {
  announcements: AnnouncementDto[];
}

const STORAGE_KEY = "schoolmeet.dismissed-announcements";

function readDismissed(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Плавающий баннер общешкольных объявлений в кабинете.
 *
 * Показывает до трёх активных объявлений (для ученика — только его класс и вся
 * школа), «прилипает» к верху при прокрутке и запоминает скрытые объявления
 * в localStorage, чтобы не раздражать пользователя.
 */
export function AnnouncementBanner({ announcements }: AnnouncementBannerProps) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDismissed(readDismissed());
    setMounted(true);
  }, []);

  const visible = announcements.filter((item) => !dismissed.includes(item.id));
  if (!mounted || visible.length === 0) return null;

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      // Храним только последние 50 id, чтобы запись не росла бесконечно.
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(-50)));
    } catch {
      /* приватный режим — просто не запоминаем */
    }
  };

  return (
    <div className="animate-fade-up sticky top-[4.25rem] z-30 -mt-2 mb-6 space-y-3">
      {visible.map((announcement) => (
        <article
          key={announcement.id}
          className="ring-gradient glass-strong relative flex items-start gap-4 overflow-hidden rounded-2xl px-4 py-3.5 shadow-glow sm:px-5"
        >
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-1 bg-brand-gradient"
          />

          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-400/30 bg-brand-500/15 text-brand-200">
            <Megaphone className="h-4 w-4" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-white">{announcement.title}</h2>
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                  announcement.targetGrade
                    ? "border-accent-400/30 bg-accent-500/10 text-accent-200"
                    : "border-brand-400/30 bg-brand-500/15 text-brand-100",
                )}
              >
                {announcement.targetGrade ? GRADE_LABELS[announcement.targetGrade] : "Вся школа"}
              </span>
            </div>

            <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-300">
              {announcement.content}
            </p>
            <p className="mt-1.5 text-[11px] text-slate-500">
              {announcement.author.name} ·{" "}
              {new Date(announcement.createdAt).toLocaleDateString("ru-RU", {
                day: "2-digit",
                month: "long",
              })}
            </p>
          </div>

          <button
            type="button"
            onClick={() => dismiss(announcement.id)}
            aria-label="Скрыть объявление"
            className="rounded-lg p-1 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </article>
      ))}
    </div>
  );
}
