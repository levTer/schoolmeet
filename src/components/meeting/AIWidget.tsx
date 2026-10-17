"use client";

/**
 * Глобальный ИИ-ассистент урока: плавающая кнопка (FAB) в углу экрана и
 * окно чата, которое открывается поверх любой страницы урока
 * (сетка видео или интерактивная доска).
 *
 * ОКНО ПОЛНОСТЬЮ ГИБКОЕ:
 *  - перетаскивается за шапку («ИИ-помощник учителя») мышью и касанием —
 *    `onMouseDown`/`onTouchStart` → отслеживание `clientX/clientY` и
 *    обновление `top`/`left` в стейте; окно можно утащить в любой угол
 *    экрана, чтобы оно не перекрывало доску или важные элементы;
 *  - свободно ресайзится (`resize: both; overflow: hidden`) в пределах
 *    `min-width: 320px` … `max-width: 95vw`, `min-height: 380px` …
 *    `max-height: 95vh`; диалог с сообщениями заполняет всё свободное
 *    пространство (`flex-grow overflow-y-auto`);
 *  - кнопка «Развернуть на весь экран / Восстановить» (Expand / Compress)
 *    в шапке переключает окно между плавающим и полноэкранным режимом.
 *
 * Панель доступна только учителю и администратору (сервер дополнительно
 * отдаёт 403 на `/api/ai`).
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent, type TouchEvent } from "react";
import { Sparkles } from "lucide-react";

import { AIAssistant } from "@/components/meeting/AIAssistant";
import type { DrawingInstruction } from "@/lib/ai-provider";
import { drawCommand, getCanvasSnapshot } from "@/lib/whiteboard-bridge";
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
  /**
   * ИИ вернул инструкции для доски. По умолчанию — `drawCommand()` моста
   * `whiteboard-bridge`: фигуры рисуются на открытой доске без проводки
   * через родителя.
   */
  onApplyDrawing?: (instructions: DrawingInstruction[]) => void;
  /**
   * Снимок доски для мультимодального запроса. По умолчанию —
   * `getCanvasSnapshot()` моста (PNG base64 текущей страницы доски).
   */
  captureBoard?: () => string | null;
}

/** Позиция левого верхнего угла плавающего окна (после перетаскивания). */
interface WindowPosition {
  x: number;
  y: number;
}

/** Стартовые данные текущего перетаскивания указателем. */
interface DragState {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
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

  /* --------------------- Перетаскивание и размеры ----------------------- */

  const windowRef = useRef<HTMLDivElement | null>(null);
  /** Параметры текущего перетаскивания (`null` — окно не тянут). */
  const dragRef = useRef<DragState | null>(null);
  /** Позиция окна после перетаскивания (`null` — исходное «правый нижний угол»). */
  const [position, setPosition] = useState<WindowPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  /** Полноэкранный режим (кнопка Expand / Compress в шапке). */
  const [maximized, setMaximized] = useState(false);

  /** Начинает перетаскивание: запоминает `clientX/clientY` и угол окна. */
  const beginDrag = useCallback(
    (clientX: number, clientY: number, target: EventTarget | null) => {
      if (maximized) return;
      // Кнопки шапки (развернуть/закрыть) не перетаскивают окно.
      if (target instanceof Element && target.closest("button")) return;
      const el = windowRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      dragRef.current = { startX: clientX, startY: clientY, originX: rect.left, originY: rect.top };
      // Дальше окно позиционируется по left/top — переключаемся с right/bottom.
      setPosition({ x: rect.left, y: rect.top });
      setDragging(true);
    },
    [maximized],
  );

  /** Перемещает окно вслед за указателем; держит его внутри экрана. */
  const moveDrag = useCallback((clientX: number, clientY: number) => {
    const drag = dragRef.current;
    const el = windowRef.current;
    if (!drag || !el) return;
    const maxX = Math.max(0, window.innerWidth - el.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - el.offsetHeight);
    setPosition({
      x: Math.min(maxX, Math.max(0, drag.originX + clientX - drag.startX)),
      y: Math.min(maxY, Math.max(0, drag.originY + clientY - drag.startY)),
    });
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  // Глобальные слушатели движения указателя — пока окно тянут.
  useEffect(() => {
    if (!dragging) return;
    const onMouseMove = (event: globalThis.MouseEvent) => moveDrag(event.clientX, event.clientY);
    const onTouchMove = (event: globalThis.TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      // Пока тянем окно — страница под ним не скроллится.
      event.preventDefault();
      moveDrag(touch.clientX, touch.clientY);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", endDrag);
    window.addEventListener("touchcancel", endDrag);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", endDrag);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", endDrag);
      window.removeEventListener("touchcancel", endDrag);
    };
  }, [dragging, moveDrag, endDrag]);

  // На время перетаскивания текст не выделяется мышью.
  useEffect(() => {
    if (!dragging) return;
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = previous;
    };
  }, [dragging]);

  const onHeaderMouseDown = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      beginDrag(event.clientX, event.clientY, event.target);
    },
    [beginDrag],
  );

  const onHeaderTouchStart = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      const touch = event.touches[0];
      if (!touch) return;
      beginDrag(touch.clientX, touch.clientY, event.target);
    },
    [beginDrag],
  );

  const toggleMaximized = useCallback(() => {
    setMaximized((value) => !value);
    // С полноэкранного режима перетаскивание недоступно.
    endDrag();
  }, [endDrag]);

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

      {/* Окно ИИ: перетаскиваемое, ресайзабельное, с полноэкранным режимом */}
      {open && (
        <div
          ref={windowRef}
          className={cn(
            maximized
              ? "fixed inset-4 z-[1000] h-auto w-auto md:inset-8"
              : cn(
                  "fixed z-[60] h-[min(70vh,600px)] w-[min(92vw,420px)]",
                  position ? "" : "bottom-24 right-4 md:bottom-6 md:right-24",
                ),
            dragging && "shadow-2xl",
          )}
          style={
            maximized
              ? { overflow: "hidden", resize: "none", width: "auto", height: "auto" }
              : {
                  resize: "both",
                  overflow: "hidden",
                  minWidth: 320,
                  minHeight: 380,
                  maxWidth: "95vw",
                  maxHeight: "95vh",
                  ...(position ? { left: position.x, top: position.y } : {}),
                }
          }
        >
          <AIAssistant
            role={role}
            meetingTitle={meetingTitle}
            onApplyDrawing={onApplyDrawing ?? ((instructions) => void drawCommand(instructions))}
            captureBoard={captureBoard ?? (() => getCanvasSnapshot())}
            onClose={() => onOpenChange(false)}
            onHeaderMouseDown={onHeaderMouseDown}
            onHeaderTouchStart={onHeaderTouchStart}
            dragging={dragging}
            maximized={maximized}
            onToggleMaximized={toggleMaximized}
            floating
          />
        </div>
      )}
    </>
  );
}
