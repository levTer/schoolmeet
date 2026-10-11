"use client";

/**
 * Интерактивная доска SchoolMeet (этап 4) — полноэкранная панель урока.
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
  Type,
  Undo2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import { AIAssistant } from "@/components/meeting/AIAssistant";
import {
  useWhiteboard,
  type FormulaRegionPayload,
  type WhiteboardSync,
  type WhiteboardTool,
} from "@/hooks/useWhiteboard";
import { latexToReadableText, type DrawingInstruction } from "@/lib/ai-provider";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

/* -------------------------------------------------------------------------- */
/* Конфигурация UI                                                             */
/* -------------------------------------------------------------------------- */

export interface WhiteboardProps {
  self: { id: string; name: string; role: Role };
  meetingTitle: string;
  sync: WhiteboardSync;
  onClose: () => void;
}

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
  { tool: "rect", icon: Square, label: "Прямоугольник (R)" },
  { tool: "circle", icon: CircleIcon, label: "Круг (C)" },
  { tool: "arrow", icon: MoveUpRight, label: "Стрелка (A)" },
  { tool: "text", icon: Type, label: "Текст (T)" },
  { tool: "sticky", icon: StickyNote, label: "Стикер (S)" },
  { tool: "eraser", icon: Eraser, label: "Ластик (E)" },
  { tool: "formula", icon: Sigma, label: "Распознать формулу (∑)", moderatorOnly: true },
];

const PALETTE = [
  "#111827",
  "#ffffff",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

/* -------------------------------------------------------------------------- */
/* Компонент                                                                   */
/* -------------------------------------------------------------------------- */

export function Whiteboard({ self, meetingTitle, sync, onClose }: WhiteboardProps) {
  const isModerator = self.role === "TEACHER" || self.role === "ADMIN";
  const [aiOpen, setAiOpen] = useState(isModerator);
  const [formulaBusy, setFormulaBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  /** Актуальный обработчик формулы (чтобы не зависеть от порядка объявлений). */
  const formulaHandlerRef = useRef<(payload: FormulaRegionPayload) => void>(() => undefined);

  /* ----------------------------- Хук доски ------------------------------- */

  const wb = useWhiteboard({
    isModerator,
    sync,
    onFormulaRegion: (payload) => formulaHandlerRef.current(payload),
  });

  /* ---------------- Распознавание формулы (Gemini Vision) ----------------- */

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

  const handleApplyDrawing = useCallback(
    (instructions: DrawingInstruction[]) => {
      wb.applyDrawing(instructions);
    },
    [wb],
  );

  const visibleTools = useMemo(() => TOOLS.filter((tool) => !tool.moderatorOnly || isModerator), [isModerator]);

  /* ----------------------------- Разметка -------------------------------- */

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink-950/97 backdrop-blur-xl">
      {/* Шапка */}
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
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

      {/* Тулбар */}
      <div className="whiteboard-toolbar flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-white/10 px-3 py-2 sm:gap-2 sm:px-4">
        {/* Инструменты */}
        <div className="flex items-center gap-1">
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
        <div className="flex items-center gap-1">
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
        <label className="flex items-center gap-2 text-[11px] text-slate-300">
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
            onClick={() => setAiOpen((open) => !open)}
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

      {/* Основная область */}
      <main className="flex min-h-0 flex-1 gap-3 p-3">
        {/* Канва */}
        <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
          <div className="relative aspect-[16/9] w-full max-w-full overflow-hidden rounded-2xl sm:rounded-3xl border border-white/10 bg-white shadow-glow" style={{ touchAction: "none" }}>
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
                    fill="rgba(168, 85, 247, 0.12)"
                    stroke="#a855f7"
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
                      fill="rgba(0, 217, 255, 0.10)"
                      stroke="#00d9ff"
                      strokeWidth={4}
                      strokeDasharray="14 10"
                    />
                    <text
                      x={wb.formulaPreview.left + 12}
                      y={Math.max(24, wb.formulaPreview.top - 10)}
                      fill="#00b4ff"
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
                    fill="#a855f7"
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

        {/* ИИ-панель (только TEACHER / ADMIN) */}
        {aiOpen && isModerator && (
          <div className="hidden min-h-0 md:block">
            <AIAssistant
              role={self.role}
              meetingTitle={meetingTitle}
              onApplyDrawing={handleApplyDrawing}
              captureBoard={wb.captureBoard}
              onClose={() => setAiOpen(false)}
            />
          </div>
        )}
      </main>

      {/* Статусная строка */}
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-white/10 px-4 py-2 text-[11px] text-slate-400">
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
