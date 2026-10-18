"use client";

/**
 * Глобальный ИИ-ассистент урока: плавающая кнопка (FAB) в углу экрана и
 * окно чата, которое открывается поверх любой страницы урока
 * (сетка видео или интерактивная доска).
 *
 * ОКНО ПОЛНОСТЬЮ ГИБКОЕ (Drag & Resize на чистом JavaScript):
 *  - DRAG: `mousedown`/`touchstart` на ШАПКЕ окна → `mousemove`/`touchmove`
 *    двигает окно (`left/top` из стейта `frame`), окно НЕ уезжает за края
 *    viewport (clamp по обеим осям). Когда открыта доска, верхняя граница
 *    ограничена зоной «шапка + Filmstrip + тулбар» (`reservedTop`) — тулбар
 *    доски не перекрывается;
 *  - RESIZE: ручка в правом нижнем углу (`cursor-nwse-resize`) → меняет
 *    width/height в пределах min 320×380 … max 95vw/95vh;
 *  - Expand/Compress в шапке — toggle: полноэкранный режим ↔ последний
 *    размер/позиция (сохраняются в ref до сворачивания);
 *  - z-index окна `z-[200]`: НИЖЕ модалок (`z-[999]`, см. `ui/modal.tsx`) и
 *    ВЫШЕ доски урока (`z-50`) — окно плавает над доской, но под любыми
 *    диалогами.
 *
 * Панель доступна только учителю и администратору (сервер дополнительно
 * отдаёт 403 на `/api/ai`).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type TouchEvent,
} from "react";
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
  /**
   * Верхняя зона, которую окно не должно перекрывать (px от верхнего края
   * viewport): открыта доска — `WHITEBOARD_TOP_RESERVED_PX` (шапка +
   * Filmstrip + тулбар). `undefined` — clamp только по краям viewport.
   */
  reservedTop?: number;
}

/** Минимальный размер плавающего окна (px). */
const MIN_WIDTH = 320;
const MIN_HEIGHT = 380;
/** Максимальный размер плавающего окна — доля viewport. */
const MAX_VIEWPORT_FRACTION = 0.95;

/** Кадр окна: позиция левого верхнего угла + явный размер. */
interface WindowFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Стартовые данные текущего перетаскивания/ресайза указателем. */
interface PointerDragState {
  startX: number;
  startY: number;
  origin: WindowFrame;
}

/** Границы, в которых окно не должно выходить (верх — с учётом `reservedTop`). */
function frameBounds(w: number, h: number, reservedTop: number | undefined): {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
} {
  const xMax = Math.max(0, window.innerWidth - w);
  const yMax = Math.max(0, window.innerHeight - h);
  // Если viewport низкий даже для minHeight — приоритет у viewport,
  // иначе окно «спрячется» за верхним тулбаром навсегда.
  const yMin = Math.min(reservedTop ?? 0, yMax);
  return { xMin: 0, xMax, yMin, yMax };
}

export function AIWidget({
  role,
  meetingTitle,
  open,
  onOpenChange,
  onApplyDrawing,
  captureBoard,
  reservedTop,
}: AIWidgetProps) {
  const isModerator = role === "TEACHER" || role === "ADMIN";

  /* --------------------- Перетаскивание и размеры ----------------------- */

  const windowRef = useRef<HTMLDivElement | null>(null);
  /** Активная операция: drag (шапка) или resize (ручка в углу). */
  const dragRef = useRef<{ kind: "drag" | "resize"; pointer: PointerDragState } | null>(null);
  /**
   * Явный кадр окна. `null` — исходная «якорная» позиция (правый нижний
   * угол) с CSS-размером по умолчанию; заполняется при первом drag/resize.
   */
  const [frame, setFrame] = useState<WindowFrame | null>(null);
  const [dragging, setDragging] = useState(false);
  /** Полноэкранный режим (кнопка Expand / Compress в шапке). */
  const [maximized, setMaximized] = useState(false);
  /** Последний кадр до Expand — для возврата Compress на «как было». */
  const lastFrameRef = useRef<WindowFrame | null>(null);
  /** `reservedTop` — в ref, чтобы слушатели не пересоздавались. */
  const reservedTopRef = useRef<number | undefined>(reservedTop);
  reservedTopRef.current = reservedTop;

  /** Текущий кадр окна: из стейта или из реального rect (первый drag). */
  const currentFrame = useCallback((): WindowFrame | null => {
    if (frame) return frame;
    const el = windowRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  }, [frame]);

  /** Начинает перетаскивание (шапка) или ресайз (ручка). */
  const beginPointerOperation = useCallback(
    (kind: "drag" | "resize", clientX: number, clientY: number, target: EventTarget | null) => {
      if (maximized) return;
      if (kind === "drag" && target instanceof Element && target.closest("button")) return;
      const origin = currentFrame();
      if (!origin) return;
      // Окно переходит на явное позиционирование left/top.
      setFrame(origin);
      dragRef.current = { kind, pointer: { startX: clientX, startY: clientY, origin } };
      setDragging(true);
    },
    [currentFrame, maximized],
  );

  /** Перемещает/ресайзит окно, удерживая его в пределах (и под тулбаром доски). */
  const movePointer = useCallback((clientX: number, clientY: number) => {
    const operation = dragRef.current;
    if (!operation) return;
    const { startX, startY, origin } = operation.pointer;
    const dx = clientX - startX;
    const dy = clientY - startY;

    if (operation.kind === "drag") {
      const bounds = frameBounds(origin.w, origin.h, reservedTopRef.current);
      setFrame({
        ...origin,
        x: Math.min(bounds.xMax, Math.max(bounds.xMin, origin.x + dx)),
        y: Math.min(bounds.yMax, Math.max(bounds.yMin, origin.y + dy)),
      });
      return;
    }

    // resize: width/height в пределах [min…95vw / min…95vh],
    // угол прижат к правому нижнему, левый верхний не уходит за экран.
    const maxW = Math.max(MIN_WIDTH, window.innerWidth * MAX_VIEWPORT_FRACTION);
    const maxH = Math.max(MIN_HEIGHT, window.innerHeight * MAX_VIEWPORT_FRACTION);
    const w = Math.min(maxW, Math.max(MIN_WIDTH, origin.w + dx));
    const h = Math.min(maxH, Math.max(MIN_HEIGHT, origin.h + dy));
    const bounds = frameBounds(w, h, reservedTopRef.current);
    setFrame({
      w,
      h,
      x: Math.min(bounds.xMax, Math.max(bounds.xMin, origin.x)),
      y: Math.min(bounds.yMax, Math.max(bounds.yMin, origin.y)),
    });
  }, []);

  const endPointerOperation = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  // Глобальные слушатели движения указателя — пока окно тянут/ресайзят.
  useEffect(() => {
    if (!dragging) return;
    const onMouseMove = (event: globalThis.MouseEvent) => movePointer(event.clientX, event.clientY);
    const onTouchMove = (event: globalThis.TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      // Пока тянем окно — страница под ним не скроллится.
      event.preventDefault();
      movePointer(touch.clientX, touch.clientY);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endPointerOperation);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", endPointerOperation);
    window.addEventListener("touchcancel", endPointerOperation);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", endPointerOperation);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", endPointerOperation);
      window.removeEventListener("touchcancel", endPointerOperation);
    };
  }, [dragging, movePointer, endPointerOperation]);

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
      beginPointerOperation("drag", event.clientX, event.clientY, event.target);
    },
    [beginPointerOperation],
  );

  const onHeaderTouchStart = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      const touch = event.touches[0];
      if (!touch) return;
      beginPointerOperation("drag", touch.clientX, touch.clientY, event.target);
    },
    [beginPointerOperation],
  );

  const onResizeHandleMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      beginPointerOperation("resize", event.clientX, event.clientY, event.target);
    },
    [beginPointerOperation],
  );

  const onResizeHandleTouchStart = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const touch = event.touches[0];
      if (!touch) return;
      event.stopPropagation();
      beginPointerOperation("resize", touch.clientX, touch.clientY, event.target);
    },
    [beginPointerOperation],
  );

  /** Expand/Compress: полноэкранный режим ↔ последний размер/позиция. */
  const toggleMaximized = useCallback(() => {
    setMaximized((value) => {
      if (!value) {
        // Запоминаем кадр, чтобы Compress вернул «как было».
        lastFrameRef.current = currentFrame();
      } else {
        setFrame(lastFrameRef.current);
      }
      return !value;
    });
    endPointerOperation();
  }, [currentFrame, endPointerOperation]);

  if (!isModerator) return null;

  const windowStyle: CSSProperties | undefined = maximized
    ? {
        // При открытой доске полноэкранный режим тоже начинается под
        // зоной тулбара (inline top переопределяет inset-4/md:inset-8).
        ...(reservedTop ? { top: reservedTop } : {}),
      }
    : frame
      ? {
          left: frame.x,
          top: frame.y,
          width: frame.w,
          height: frame.h,
          minWidth: MIN_WIDTH,
          minHeight: MIN_HEIGHT,
          maxWidth: "95vw",
          maxHeight: "95vh",
        }
      : {
          minWidth: MIN_WIDTH,
          minHeight: MIN_HEIGHT,
          maxWidth: "95vw",
          maxHeight: "95vh",
        };

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

      {/* Окно ИИ: drag за шапку, JS-resize за угол, z-[200] — выше доски, ниже модалок */}
      {open && (
        <div
          ref={windowRef}
          className={cn(
            "fixed z-[200] overflow-hidden",
            maximized
              ? "inset-4 h-auto w-auto md:inset-8"
              : frame
                ? ""
                : "bottom-24 right-4 h-[min(70vh,600px)] w-[min(92vw,420px)] md:bottom-6 md:right-24",
            dragging && "shadow-2xl",
          )}
          style={windowStyle}
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

          {/* Ручка ресайза — правый нижний угол (только в плавающем режиме) */}
          {!maximized && (
            <div
              data-ai-resize-handle
              role="separator"
              aria-label="Изменить размер окна ИИ-помощника"
              onMouseDown={onResizeHandleMouseDown}
              onTouchStart={onResizeHandleTouchStart}
              className="absolute bottom-0 right-0 z-10 h-5 w-5 cursor-nwse-resize touch-none select-none"
            >
              <svg viewBox="0 0 24 24" className="h-full w-full text-slate-500" aria-hidden="true">
                <path
                  d="M19 13v6h-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M19 8v3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          )}
        </div>
      )}
    </>
  );
}
