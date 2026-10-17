"use client";

/**
 * Глобальный ИИ-ассистент урока: плавающая кнопка (FAB) в углу экрана и
 * компактное окно чата, которое открывается поверх любой страницы урока
 * (сетка видео или интерактивная доска).
 *
 * Окно ресайзабельное: его можно тянуть за правый нижний угол
 * (`resize: both`), минимальный размер — 320×400 px.
 *
 * Панель доступна только учителю и администратору (сервер дополнительно
 * отдаёт 403 на `/api/ai`).
 */

import { Sparkles } from "lucide-react";

import { AIAssistant } from "@/components/meeting/AIAssistant";
import type { DrawingInstruction } from "@/lib/ai-provider";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

export interface AIWidgetProps {
  /** Роль пользователя: виджет показывается только учителю и администратору. */
  role: Role;
  /** Название урока — попадает в контекст запросов. */
  meetingTitle: string;
  /** Открыт ли виджет. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ИИ вернул инструкции для доски. */
  onApplyDrawing: (instructions: DrawingInstruction[]) => void;
  /** Снимок доски (если доска открыта) — для мультимодального запроса. */
  captureBoard?: () => string | null;
}

export function AIWidget({
  role,
  meetingTitle,
  open,
  onOpenChange,
  onApplyDrawing,
  captureBoard,
}: AIWidgetProps) {
  const isModerator = role === "TEACHER" || role === "ADMIN";
  if (!isModerator) return null;

  return (
    <>
      {/* Плавающая кнопка — доступна с любой страницы урока */}
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-label={open ? "Скрыть ИИ-помощника" : "Открыть ИИ-помощника"}
        title="ИИ-помощник"
        className={cn(
          "fixed bottom-24 right-4 z-[70] inline-flex h-12 w-12 items-center justify-center rounded-2xl border shadow-glow transition md:bottom-6 md:right-6",
          "focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40",
          open
            ? "hidden border-brand-400/50 bg-brand-500/25 text-white md:inline-flex"
            : "border-white/10 bg-ink-900/90 text-brand-200 hover:border-brand-400/40 hover:bg-brand-500/20 hover:text-white",
        )}
      >
        <Sparkles className="h-5 w-5" />
      </button>

      {/* Окно ИИ: ресайзабельное, минималистичное, поверх всей страницы урока */}
      {open && (
        <div
          className="fixed bottom-24 right-4 z-[60] h-[min(70vh,600px)] w-[min(92vw,420px)] md:bottom-6 md:right-24"
          style={{
            resize: "both",
            overflow: "hidden",
            minWidth: 320,
            minHeight: 400,
          }}
        >
          <AIAssistant
            role={role}
            meetingTitle={meetingTitle}
            onApplyDrawing={onApplyDrawing}
            captureBoard={captureBoard}
            onClose={() => onOpenChange(false)}
            floating
          />
        </div>
      )}
    </>
  );
}
