"use client";

/**
 * Интерактивная доска Лицея Сингулярити (этап 4) — полноэкранная панель урока.
 *
 * Fabric.js-инструменты: карандаш, линия, прямоугольник, круг, стрелка, текст,
 * стикер, ластик, лассо-выделение и «Распознать формулу» (∑, только учитель).
 * Палитра, толщина, Undo/Redo, очистка, экспорт в PNG, несколько страниц.
 * Курсоры участников с именами; синхронизация через Socket.IO (whiteboard-*).
 * Разрешения: учитель решает, кто рисует («Все участники» / «Только учителя»).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Circle as CircleIcon,
  Download,
  Eraser,
  Lasso,
  Loader2,
  Minus,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Plus,
  Redo2,
  Sigma,
  Sparkles,
  Square,
  StickyNote,
  Trash2,
  Triangle as TriangleIcon,
  Type,
  Undo2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import { useIsDesktopLayout } from "@/hooks/useMediaQuery";
import {
  useWhiteboard,
  type FormulaRegionPayload,
  type WhiteboardSync,
  type WhiteboardTool,
} from "@/hooks/useWhiteboard";
import { latexToReadableText, type DrawingInstruction } from "@/lib/ai-provider";
import { cn } from "@/lib/utils";
import { registerWhiteboardBridge, type WhiteboardBridge } from "@/lib/whiteboard-bridge";
import type { Role } from "@/types";

/* -------------------------------------------------------------------------- */
/* Конфигурация UI                                                             */
/* -------------------------------------------------------------------------- */

export interface WhiteboardProps {
  self: { id: string; name: string; role: Role };
  meetingTitle: string;
  sync: WhiteboardSync;
  onClose: () => void;
  /** Открыт ли глобальный ИИ-виджет (состоянием управляет страница урока). */
  aiOpen?: boolean;
  /** Уведомить страницу урока об открытии/закрытии глобального ИИ. */
  onAiOpenChange?: (open: boolean) => void;
  /** Мост «доска → глобальный ИИ»: снимок доски и рисование по инструкции. */
  onAiBridge?: (bridge: WhiteboardAiBridge | null) => void;
  /**
   * Компактная полоска участников (Filmstrip) — рендерится СВЕРХУ, сразу
   * над тулбаром инструментов. Треки видео при этом не отключаются: полоска
   * лишь дополнительный слой поверх тех же потоков.
   */
  topStrip?: ReactNode;
}

/**
 * Высота зоны «шапка + filmstrip + тулбар» доски в px — столько сверху экрана
 * занято служебными панелями. Глобальный ИИ-виджет (AIWidget) при открытой
 * доске не должен перекрывать эту зону, поэтому использует константу для
 * clamp-а позиции (не уезжает за верхний край под тулбар).
 */
export const WHITEBOARD_TOP_RESERVED_PX = 224;

/**
 * Что глобальный ИИ-виджет умеет делать с доской. Единый тип моста живёт в
 * `src/lib/whiteboard-bridge.ts` (`getCanvasSnapshot` / `drawCommand`);
 * этот алиас сохранён для совместимости пропса `onAiBridge`.
 */
export type WhiteboardAiBridge = WhiteboardBridge;

interface ToolButton {
  tool: WhiteboardTool;
  icon: LucideIcon;
  label: string;
  /** Показывать только учителю/администратору. */
  moderatorOnly?: boolean;
}

const TOOLS: ToolButton[] = [
  { tool: "select", icon: MousePointer2, label: "Выделение (V)" },
  { tool: "lasso", icon: Lasso, label: "Лассо (L)" },
  { tool: "pencil", icon: Pencil, label: "Карандаш (P)" },
  { tool: "line", icon: Minus, label: "Прямая линия (N)" },
  { tool: "rect", icon: Square, label: "Квадрат / прямоугольник (R)" },
  { tool: "circle", icon: CircleIcon, label: "Круг (C)" },
  { tool: "triangle", icon: TriangleIcon, label: "Треугольник (G)" },
  { tool: "arrow", icon: MoveUpRight, label: "Стрелка (A)" },
  { tool: "text", icon: Type, label: "Текст (T)" },
  { tool: "sticky", icon: StickyNote, label: "Стикер (S)" },
  { tool: "eraser", icon: Eraser, label: "Ластик (E)" },
  { tool: "formula", icon: Sigma, label: "Распознать формулу (∑)", moderatorOnly: true },
];

/** Первые пять цветов — обязательный базовый набор кисти: чёрный, белый, красный, синий, зелёный. */
const PALETTE = [
  "#000000",
  "#ffffff",
  "#ef4444",
  "#3b82f6",
  "#22c55e",
  "#f97316",
  "#eab308",
  "#06b6d4",
  "#8b5cf6",
  "#ec4899",
];

/* -------------------------------------------------------------------------- */
/* Компонент                                                                   */
/* -------------------------------------------------------------------------- */

export function Whiteboard({
  self,
  meetingTitle,
  sync,
  onClose,
  aiOpen: aiOpenProp,
  onAiOpenChange,
  onAiBridge,
  topStrip,
}: WhiteboardProps) {
  // UI Role Guard: ИИ и модерация только для TEACHER/ADMIN
  // Проверка по сессии: session?.user?.role === 'TEACHER' || session?.user?.role === 'ADMIN'
  const session = { user: { role: self.role } } as { user: { role: Role } };
  const isTeacherOrAdmin = session?.user?.role === 'TEACHER' || session?.user?.role === 'ADMIN';
  const isModerator = isTeacherOrAdmin;
  const [aiOpenLocal, setAiOpenLocal] = useState(false);
  const [formulaBusy, setFormulaBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  /** Глобальный ИИ-виджет: состояние живёт на странице урока. */
  const aiOpen = aiOpenProp ?? aiOpenLocal;
  const setAiOpen = useCallback(
    (open: boolean) => {
      setAiOpenLocal(open);
      onAiOpenChange?.(open);
    },
    [onAiOpenChange],
  );

  /** Актуальный обработчик формулы (чтобы не зависеть от порядка объявлений). */
  const formulaHandlerRef = useRef<(payload: FormulaRegionPayload) => void>(() => undefined);

  /* ----------------------------- Хук доски ------------------------------- */

  const wb = useWhiteboard({
    isModerator,
    sync,
    onFormulaRegion: (payload) => formulaHandlerRef.current(payload),
  });

  /* ---------------- Распознавание формулы (Groq Vision) ----------------- */

  const handleFormulaRegion = useCallback(
    async (payload: FormulaRegionPayload) => {
      setFormulaBusy(true);
      setStatus("Распознаю формулу…");
      try {
        const response = await fetch("/api/ai", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "formula",
            prompt: "Распознай формулу с доски",
            imageDataUrl: payload.imageDataUrl,
            context: { meetingTitle },
          }),
        });

        if (response.status === 403) {
          setStatus("Распознавание формул доступно только учителям и администраторам.");
          return;
        }
        if (!response.ok) {
          setStatus("Не удалось распознать формулу. Попробуйте ещё раз.");
          return;
        }

        const result = (await response.json()) as {
          ok: boolean;
          data?: { latex?: string; text?: string };
        };
        const latex = result.data?.latex;
        if (!result.ok || !latex) {
          setStatus("Формула не распознана. Попробуйте выделить область точнее.");
          return;
        }

        wb.applyFormulaResult({
          text: latexToReadableText(latex),
          latex,
          region: payload.region,
          objectIds: payload.objectIds,
        });
        setStatus(`Формула распознана: ${latexToReadableText(latex)}`);
      } catch {
        setStatus("Нет соединения с сервером — формула не распознана.");
      } finally {
        setFormulaBusy(false);
      }
    },
    [meetingTitle, wb],
  );

  useEffect(() => {
    formulaHandlerRef.current = handleFormulaRegion;
  });

  const { applyDrawing } = wb;

  const handleApplyDrawing = useCallback(
    (instructions: DrawingInstruction[]) => {
      applyDrawing(instructions);
    },
    [applyDrawing],
  );

  /*
   * Двусторонний мост «ИИ ↔ доска» (src/lib/whiteboard-bridge.ts): пока доска
   * открыта, она зарегистрирована в глобальном реестре — ИИ-виджет в любой
   * ветке дерева урока может снять снимок (`getCanvasSnapshot()`) и нарисовать
   * по команде (`drawCommand()`), а также реактивно узнать, что доска открыта.
   * Пропс `onAiBridge` сохранён для совместимости со страницей урока.
   */
  useEffect(() => {
    const bridge: WhiteboardBridge = { captureBoard: wb.captureBoard, applyDrawing: handleApplyDrawing };
    const unregister = registerWhiteboardBridge(bridge);
    onAiBridge?.(bridge);
    return () => {
      unregister();
      onAiBridge?.(null);
    };
  }, [handleApplyDrawing, onAiBridge, wb.captureBoard]);

  const visibleTools = useMemo(() => TOOLS.filter((tool) => !tool.moderatorOnly || isModerator), [isModerator]);

  /**
   * Десктоп (md+) — доска занимает левую колонку, камеры участников живут в
   * правой колонке «плитка шоколада» (~240–300px) с вертикальной прокруткой.
   * Мобильные — горизонтальная лента в обычном потоке над тулбаром.
   */
  const desktopLayout = useIsDesktopLayout();

  /* ----------------------------- Разметка -------------------------------- */

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink-950/97 backdrop-blur-xl md:flex-row">
      {/* Левая колонка: шапка, тулбар и сама доска (на мобильных — вся ширина) */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Шапка — всегда поверх холста (z-30), не сжимается */}
      <header className="relative z-30 flex shrink-0 items-center gap-3 border-b border-white/10 bg-ink-950/90 px-4 py-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow">
          <Sparkles className="h-4.5 w-4.5 text-white" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">Доска урока</p>
          <p className="truncate text-[11px] text-slate-400">
            {meetingTitle} · {self.name}
          </p>
        </div>

        {/* Страницы */}
        <div className="flex items-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.04] px-1.5 py-1">
          <button
            type="button"
            aria-label="Предыдущая страница"
            disabled={wb.currentPage === 0}
            onClick={() => wb.setPage(Math.max(0, wb.currentPage - 1))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-200 transition hover:bg-white/10 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[4.5rem] text-center text-xs tabular-nums text-slate-200">
            Стр. {wb.currentPage + 1} / {wb.pageCount}
          </span>
          <button
            type="button"
            aria-label="Следующая страница"
            disabled={wb.currentPage >= wb.pageCount - 1}
            onClick={() => wb.setPage(Math.min(wb.pageCount - 1, wb.currentPage + 1))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-200 transition hover:bg-white/10 disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Добавить страницу"
            disabled={!wb.canDraw}
            onClick={wb.addPage}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-200 transition hover:bg-white/10 disabled:opacity-30"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть доску"
          className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-slate-200 transition hover:bg-white/10"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      {/*
        Мобильные (< md): компактная полоска участников (Filmstrip) идёт в
        ОБЫЧНОМ потоке документа сразу над тулбаром — не absolute и не поверх
        сцены. Она не перекрывает тулбар доски (shrink-0 у обоих элементов,
        холст сжимается), а на десктопе уступает место правой колонке.
      */}
      {topStrip && !desktopLayout && (
        <div className="relative z-30 shrink-0 border-b border-white/10 bg-ink-950/90 md:hidden">{topStrip}</div>
      )}

      {/*
        Тулбар инструментов: карандаш/маркер, фигуры (треугольник, круг,
        квадрат), текст, ластик, палитра, размер кисти и очистка доски.
        `relative z-30` + непрозрачный фон гарантируют, что белый холст никогда
        не накроет панель (ранее канва 16:9 на широких экранах вылезала за
        пределы области и «съедала» тулбар), `shrink-0` у групп — что кнопки
        не сжимаются, а панель прокручивается по горизонтали.
      */}
      <div
        role="toolbar"
        aria-label="Инструменты доски"
        className="whiteboard-toolbar relative z-30 flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-white/10 bg-ink-950/95 px-3 py-2 shadow-[0_12px_32px_-16px_rgba(0,0,0,0.85)] sm:gap-2 sm:px-4"
      >
        {/* Инструменты */}
        <div className="flex shrink-0 items-center gap-1">
          {visibleTools.map((item) => (
            <button
              key={item.tool}
              type="button"
              title={item.label}
              aria-label={item.label}
              aria-pressed={wb.tool === item.tool}
              disabled={!wb.canDraw}
              onClick={() => wb.setTool(item.tool)}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-xl border transition",
                wb.tool === item.tool
                  ? "border-brand-400/50 bg-brand-500/20 text-white shadow-glow"
                  : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10",
                "disabled:cursor-not-allowed disabled:opacity-40",
              )}
            >
              <item.icon className="h-4 w-4" />
            </button>
          ))}
        </div>

        <div className="mx-1 h-8 w-px shrink-0 bg-white/10" />

        {/* Палитра */}
        <div className="flex shrink-0 items-center gap-1">
          {PALETTE.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Цвет ${swatch}`}
              disabled={!wb.canDraw}
              onClick={() => wb.setColor(swatch)}
              className={cn(
                "h-7 w-7 rounded-full border-2 transition",
                wb.color === swatch ? "border-accent-400 shadow-neon-ring" : "border-white/20 hover:border-white/50",
                "disabled:cursor-not-allowed disabled:opacity-40",
              )}
              style={{ backgroundColor: swatch }}
            />
          ))}
        </div>

        {/* Толщина */}
        <label className="flex shrink-0 items-center gap-2 text-[11px] text-slate-300">
          <span className="whitespace-nowrap">Толщина</span>
          <input
            type="range"
            min={1}
            max={24}
            value={wb.strokeWidth}
            disabled={!wb.canDraw}
            onChange={(event) => wb.setStrokeWidth(Number(event.target.value))}
            className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-white/15 accent-brand-500"
          />
          <span className="w-5 text-right tabular-nums">{wb.strokeWidth}</span>
        </label>

        <div className="mx-1 h-8 w-px shrink-0 bg-white/10" />

        {/* История и действия */}
        <ActionButton label="Отменить (Undo)" disabled={!wb.canUndo || !wb.canDraw} onClick={wb.undo}>
          <Undo2 className="h-4 w-4" />
        </ActionButton>
        <ActionButton label="Вернуть (Redo)" disabled={!wb.canRedo || !wb.canDraw} onClick={wb.redo}>
          <Redo2 className="h-4 w-4" />
        </ActionButton>
        <ActionButton
          label="Очистить страницу"
          disabled={!wb.canDraw}
          onClick={() => {
            if (window.confirm("Очистить текущую страницу доски? (можно отменить через Undo)")) wb.clearPage();
          }}
        >
          <Trash2 className="h-4 w-4" />
        </ActionButton>
        <ActionButton label="Экспорт в PNG" onClick={wb.exportPNG}>
          <Download className="h-4 w-4" />
        </ActionButton>

        <div className="mx-1 h-8 w-px shrink-0 bg-white/10" />

        {/* Разрешения: кто рисует (учитель) */}
        {isModerator ? (
          <button
            type="button"
            onClick={() => wb.setDrawPolicy(wb.drawPolicy === "everyone" ? "moderators" : "everyone")}
            className={cn(
              "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-xs font-medium transition",
              wb.drawPolicy === "everyone"
                ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-200"
                : "border-amber-400/30 bg-amber-500/15 text-amber-200",
            )}
          >
            <Users className="h-4 w-4" />
            {wb.drawPolicy === "everyone" ? "Рисуют все" : "Рисует учитель"}
          </button>
        ) : (
          <span
            className={cn(
              "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-xs font-medium",
              wb.canDraw
                ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-200"
                : "border-white/10 bg-white/[0.04] text-slate-400",
            )}
          >
            <Users className="h-4 w-4" />
            {wb.canDraw ? "Можно рисовать" : "Только просмотр"}
          </span>
        )}

        {/* ИИ-панель (только учитель/админ) */}
        {isModerator && (
          <button
            type="button"
            onClick={() => setAiOpen(!aiOpen)}
            aria-pressed={aiOpen}
            className={cn(
              "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-xs font-medium transition",
              aiOpen
                ? "border-brand-400/50 bg-brand-500/20 text-white shadow-glow"
                : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10",
            )}
          >
            <Sparkles className="h-4 w-4" />
            ИИ-помощник
          </button>
        )}
      </div>

      {/* Основная область — ниже тулбара по z и обрезает всё, что вылезает за края */}
      <main className="relative z-0 flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
        {/*
          Канва вписывается в область по ОБЕИМ осям: ширина контейнера доски —
          min(100cqw, 177.778cqh), то есть высота 16:9 никогда не превысит
          доступную высоту между тулбаром и статус-строкой.
        */}
        <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center [container-type:size]">
          <div
            className="relative aspect-[16/9] max-h-full w-full max-w-full overflow-hidden rounded-2xl border border-white/10 bg-white shadow-glow sm:rounded-3xl"
            style={{ touchAction: "none", width: "min(100cqw, 177.778cqh)" }}
          >
            <canvas ref={wb.canvasRef} className="block" />

            {/* SVG-превью лассо и выделения формулы (координаты канвы 1600x900) */}
            {(wb.selectionPreview || wb.formulaPreview) && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox="0 0 1600 900"
                preserveAspectRatio="none"
              >
                {wb.selectionPreview && (
                  <polygon
                    points={polyPoints(wb.selectionPreview.points)}
                    fill="rgb(var(--accent-rgb) / 0.12)"
                    stroke="var(--accent-color)"
                    strokeWidth={4}
                    strokeDasharray="10 8"
                  />
                )}
                {wb.formulaPreview && (
                  <>
                    <rect
                      x={wb.formulaPreview.left}
                      y={wb.formulaPreview.top}
                      width={wb.formulaPreview.width}
                      height={wb.formulaPreview.height}
                      fill="rgb(var(--accent-rgb) / 0.10)"
                      stroke="var(--accent-color)"
                      strokeWidth={4}
                      strokeDasharray="14 10"
                    />
                    <text
                      x={wb.formulaPreview.left + 12}
                      y={Math.max(24, wb.formulaPreview.top - 10)}
                      fill="rgb(var(--accent-light-rgb))"
                      fontSize={26}
                      fontFamily="sans-serif"
                    >
                      Формула → ∑
                    </text>
                  </>
                )}
              </svg>
            )}

            {/* Курсоры участников */}
            {wb.cursors.map((cursor) => (
              <div
                key={cursor.socketId}
                className="pointer-events-none absolute z-10 flex items-start gap-1 transition-transform duration-75"
                style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" className="drop-shadow">
                  <path
                    d="M4 2l14 10-6 1 3 7-3 1-3-7-5 4z"
                    fill="var(--accent-color)"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="rounded-full bg-brand-500/90 px-2 py-0.5 text-[10px] font-medium text-white shadow">
                  {cursor.name}
                </span>
              </div>
            ))}

            {/* Индикатор распознавания формулы */}
            {formulaBusy && (
              <div className="absolute inset-x-0 top-4 mx-auto flex w-fit items-center gap-2 rounded-full border border-accent-400/30 bg-ink-900/90 px-4 py-2 text-xs text-accent-200">
                <Loader2 className="h-4 w-4 animate-spin" />
                Распознаю формулу…
              </div>
            )}

            {!wb.canDraw && (
              <div className="absolute inset-x-0 bottom-4 mx-auto w-fit rounded-full border border-white/15 bg-ink-900/85 px-4 py-2 text-xs text-slate-300">
                Учитель ограничил рисование — вы можете смотреть на доску и двигать курсор.
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Статусная строка */}
      <footer className="safe-pb relative z-30 flex shrink-0 items-center justify-between gap-3 border-t border-white/10 bg-ink-950/90 px-4 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] text-[11px] text-slate-400 md:pb-2">
        <p className="truncate">
          {status ??
            (isModerator
              ? "Вы управляете доской: выберите инструмент и рисуйте. Undo/Redo — до 50 шагов."
              : wb.canDraw
                ? "Учитель разрешил рисование всем участникам."
                : "Просмотр доски. Рисование доступно, когда учитель разрешит.")}
        </p>
        <p className="hidden shrink-0 sm:block">
          {TOOLS.find((item) => item.tool === wb.tool)?.label ?? ""} · {wb.strokeWidth}px
        </p>
      </footer>
      </div>

      {/*
        Десктоп (md+): правая колонка «плитка шоколада» — камеры участников
        столбиком с вертикальной прокруткой (~240–300px), пока сцена занята
        доской. Полоса живёт в обычном потоке (не поверх тулбара), треки при
        этом не отключаются.
      */}
      {topStrip && desktopLayout && (
        <aside
          className="relative z-30 hidden min-h-0 w-60 shrink-0 flex-col overflow-hidden border-l border-white/10 bg-ink-950/90 md:flex lg:w-72"
          aria-label="Камеры участников"
        >
          {topStrip}
        </aside>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Мелкие компоненты                                                           */
/* -------------------------------------------------------------------------- */

function ActionButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-200 transition hover:bg-white/10",
        "disabled:cursor-not-allowed disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}

function polyPoints(flat: number[]): string {
  const pairs: string[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pairs.push(`${flat[i]},${flat[i + 1]}`);
  return pairs.join(" ");
}
