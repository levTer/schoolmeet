"use client";

/**
 * Профессиональная интерактивная доска SchoolMeet (этап 4).
 *
 * Хук владеет экземпляром Fabric.js-канвы и всей логикой доски:
 * инструменты (карандаш, линия, прямоугольник, круг, стрелка, текст, стикер,
 * ластик, лассо, «распознать формулу»), палитра и толщина, Undo/Redo
 * (стек на 50 шагов), страницы, экспорт в PNG, курсоры участников и
 * синхронизация через Socket.IO (события whiteboard-*).
 *
 * Ключевые решения:
 *  - фиксированный логический размер канвы 1600×900 — объекты и курсоры
 *    одинаково выглядят на всех экранах (CSS масштабирует канву);
 *  - история — стек локальных операций (add/remove/modify): Undo не ломает
 *    чужие правки и всегда синхронизируется с остальными;
 *  - удаление объектов (ластик и «распознать формулу») тоже попадает в
 *    историю, поэтому его можно отменить.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  ActiveSelection,
  Canvas,
  Circle,
  FabricObject,
  IText,
  Line,
  PencilBrush,
  Rect,
  Textbox,
  util,
} from "fabric";

import {
  buildObjectsFromInstructions,
  createArrow,
} from "@/lib/drawing-engine";
import type { DrawingInstruction } from "@/lib/ai-provider";
import {
  WHITEBOARD_CURSOR_TTL_MS,
  type WhiteboardClearPayload,
  type WhiteboardCursor,
  type WhiteboardCursorPayload,
  type WhiteboardDeletePayload,
  type WhiteboardDrawPolicy,
  type WhiteboardObjectPayload,
  type WhiteboardServerEvent,
  type WhiteboardState,
} from "@/lib/realtime";

/* -------------------------------------------------------------------------- */
/* Константы и типы                                                            */
/* -------------------------------------------------------------------------- */

/** Логический размер канвы (внутри браузера он масштабируется CSS-ом). */
export const WHITEBOARD_WIDTH = 1600;
export const WHITEBOARD_HEIGHT = 900;

/** Предел страниц в доске (зеркалит `WHITEBOARD_MAX_PAGES` из realtime). */
const WHITEBOARD_MAX_PAGES_LOCAL = 20;

/** Глубина стека Undo/Redo. */
export const HISTORY_LIMIT = 50;

export type WhiteboardTool =
  | "select"
  | "pencil"
  | "line"
  | "rect"
  | "circle"
  | "arrow"
  | "text"
  | "sticky"
  | "eraser"
  | "lasso"
  | "formula";

export interface FormulaRegionPayload {
  /** PNG выделенной области (data URL) — уходит в /api/ai. */
  imageDataUrl: string;
  /** Область в координатах канвы. */
  region: { left: number; top: number; width: number; height: number };
  /** Объекты, попавшие в область (будут удалены после распознавания). */
  objectIds: string[];
}

export interface FormulaResultPayload {
  /** Печатный текст формулы (Unicode-представление LaTeX). */
  text: string;
  /** Исходный LaTeX — сохраняется в объекте доски. */
  latex?: string;
  region: FormulaRegionPayload["region"];
  objectIds: string[];
}

/** Подключение доски к Socket.IO (реализуется в MeetingRoom поверх useSocket). */
export interface WhiteboardSync {
  sendAdd(payload: WhiteboardObjectPayload): Promise<boolean>;
  sendModify(payload: WhiteboardObjectPayload): Promise<boolean>;
  sendDelete(payload: WhiteboardDeletePayload): Promise<boolean>;
  sendClear(payload: WhiteboardClearPayload): Promise<boolean>;
  sendCursor(payload: WhiteboardCursorPayload): void;
  sendAccess(payload: { drawPolicy: WhiteboardDrawPolicy }): Promise<boolean>;
  sendPage(payload: { page: number }): Promise<boolean>;
  requestState(): Promise<WhiteboardState | null>;
  subscribe(handler: (event: WhiteboardServerEvent) => void): () => void;
}

export interface UseWhiteboardOptions {
  /** TEACHER / ADMIN — всегда рисует и управляет политикой. */
  isModerator: boolean;
  sync: WhiteboardSync | null;
  /** Учитель выделил область на доске для распознавания формулы. */
  onFormulaRegion?: (payload: FormulaRegionPayload) => void;
}

export interface SelectionPreview {
  type: "lasso";
  points: number[];
}

export interface FormulaPreview {
  type: "formula";
  left: number;
  top: number;
  width: number;
  height: number;
}

type ObjectJson = Record<string, unknown>;
type Point = { x: number; y: number };

type HistoryOp =
  | { kind: "add"; page: number; json: ObjectJson }
  | { kind: "remove"; page: number; items: ObjectJson[] }
  | { kind: "modify"; page: number; before: ObjectJson; after: ObjectJson }
  | { kind: "batch"; ops: HistoryOp[] };

interface DraftShape {
  tool: "line" | "rect" | "circle" | "arrow";
  start: Point;
  preview: FabricObject;
}

/** Публичный API хука доски. */
export interface WhiteboardApi {
  isReady: boolean;
  tool: WhiteboardTool;
  setTool: (tool: WhiteboardTool) => void;
  color: string;
  setColor: (color: string) => void;
  strokeWidth: number;
  setStrokeWidth: (width: number) => void;
  /** Может ли текущий пользователь рисовать (роль + политика комнаты). */
  canDraw: boolean;
  drawPolicy: WhiteboardDrawPolicy;
  setDrawPolicy: (policy: WhiteboardDrawPolicy) => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  pageCount: number;
  currentPage: number;
  addPage: () => void;
  setPage: (page: number) => void;
  clearPage: () => void;
  exportPNG: () => void;
  /**
   * PNG-снимок текущей страницы (data URL) для ИИ-панели («Передать доску»):
   * уезжает на сервер и передаётся в Gemini Vision. `null`, если доска ещё не готова.
   */
  captureBoard: (maxWidth?: number) => string | null;
  /** Заменить выделенный рисунок печатной формулой (после /api/ai). */
  applyFormulaResult: (payload: FormulaResultPayload) => void;
  /** Нарисовать фигуры из JSON-инструкций ИИ. */
  applyDrawing: (instructions: DrawingInstruction[]) => void;
  /** Курсоры участников на текущей странице. */
  cursors: WhiteboardCursor[];
  selectionPreview: SelectionPreview | null;
  formulaPreview: FormulaPreview | null;
  canvasRef: RefObject<HTMLCanvasElement>;
}

/* -------------------------------------------------------------------------- */
/* Вспомогательные функции                                                     */
/* -------------------------------------------------------------------------- */

function uid(): string {
  return `o_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getObjectId(object: FabricObject): string | undefined {
  return (object as unknown as { id?: unknown }).id as string | undefined;
}

function assignId(object: FabricObject): string {
  const existing = getObjectId(object);
  if (existing) return existing;
  const id = uid();
  (object as unknown as { id: string }).id = id;
  return id;
}

function serialize(object: FabricObject): ObjectJson {
  return object.toObject() as ObjectJson;
}

/** Убирает служебную отметку времени из курсора перед рендером. */
function toCursorView(cursor: WhiteboardCursor & { at: number }): WhiteboardCursor {
  return { socketId: cursor.socketId, name: cursor.name, page: cursor.page, x: cursor.x, y: cursor.y };
}

function objectCenterIn(object: FabricObject, region: { left: number; top: number; width: number; height: number }) {
  const center = object.getCenterPoint();
  return (
    center.x >= region.left &&
    center.x <= region.left + region.width &&
    center.y >= region.top &&
    center.y <= region.top + region.height
  );
}

/** Точка внутри многоугольника (лассо). */
function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

const TOOL_CURSORS: Record<WhiteboardTool, string> = {
  select: "default",
  pencil: "crosshair",
  line: "crosshair",
  rect: "crosshair",
  circle: "crosshair",
  arrow: "crosshair",
  text: "text",
  sticky: "text",
  eraser: "cell",
  lasso: "crosshair",
  formula: "crosshair",
};

/* -------------------------------------------------------------------------- */
/* Хук                                                                        */
/* -------------------------------------------------------------------------- */

export function useWhiteboard(options: UseWhiteboardOptions): WhiteboardApi {
  const { isModerator, sync } = options;

  const [isReady, setIsReady] = useState(false);
  const [tool, setToolState] = useState<WhiteboardTool>("select");
  const [color, setColor] = useState("#111827");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [drawPolicy, setDrawPolicyState] = useState<WhiteboardDrawPolicy>("moderators");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [cursors, setCursors] = useState<WhiteboardCursor[]>([]);
  const [selectionPreview, setSelectionPreview] = useState<SelectionPreview | null>(null);
  const [formulaPreview, setFormulaPreview] = useState<FormulaPreview | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<Canvas | null>(null);

  /** pages[i] — Map<objectId, json>; текущая страница всегда зеркалится канвой. */
  const pagesRef = useRef<Map<string, ObjectJson>[]>([new Map()]);
  const currentPageRef = useRef(0);
  const historyRef = useRef<{ undo: HistoryOp[]; redo: HistoryOp[] }>({ undo: [], redo: [] });

  const optionsRef = useRef(options);
  const syncRef = useRef(sync);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const strokeWidthRef = useRef(strokeWidth);
  const canDrawRef = useRef(false);

  /** Очередь применения удалённых событий — сохраняет порядок. */
  const applyQueueRef = useRef<Promise<void>>(Promise.resolve());
  /** Текстовые объекты, ещё не «закоммиченные» (пользователь печатает). */
  const pendingTextRef = useRef<Set<string>>(new Set());
  const draftRef = useRef<DraftShape | null>(null);
  const lassoRef = useRef<{ points: Point[]; pointerDown: boolean } | null>(null);
  const formulaRef = useRef<{ start: Point; pointerDown: boolean } | null>(null);
  const pointerDownRef = useRef(false);
  const lastCursorSentRef = useRef(0);
  const resyncTimerRef = useRef<number | null>(null);
  const cursorsRef = useRef<Map<string, WhiteboardCursor & { at: number }>>(new Map());
  const lastCursorsRenderRef = useRef(0);

  const canDraw = isModerator || drawPolicy === "everyone";

  useEffect(() => {
    optionsRef.current = options;
  });
  useEffect(() => {
    syncRef.current = sync;
  });
  useEffect(() => {
    toolRef.current = tool;
  });
  useEffect(() => {
    colorRef.current = color;
  });
  useEffect(() => {
    strokeWidthRef.current = strokeWidth;
  });
  useEffect(() => {
    canDrawRef.current = canDraw;
  });

  /* ----------------------------- Низкоуровневые операции ------------------ */

  const ensurePage = useCallback((index: number) => {
    while (pagesRef.current.length <= index) pagesRef.current.push(new Map());
    setPageCount(pagesRef.current.length);
  }, []);

  const findOnCanvas = useCallback((id: string): FabricObject | undefined => {
    const canvas = fabricRef.current;
    if (!canvas) return undefined;
    return canvas.getObjects().find((object) => getObjectId(object) === id);
  }, []);

  const renderObjectFromJson = useCallback(
    async (json: ObjectJson): Promise<FabricObject | null> => {
      const [object] = await util.enlivenObjects([json]);
      return (object as FabricObject | undefined) ?? null;
    },
    [],
  );

  /** Отправляет изменение; при отказе сервера (гонка с политикой) — ресинк. */
  const sendOrResync = useCallback((send: () => Promise<boolean>) => {
    void send().then((ok) => {
      if (ok === false) scheduleResync();
    });
    // scheduleResync объявляется ниже и вызывается только асинхронно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Добавить объект (store + канва + синхронизация), без записи в историю. */
  const lowAdd = useCallback(
    async (page: number, json: ObjectJson, broadcast = true): Promise<void> => {
      const id = typeof json.id === "string" ? json.id : "";
      if (!id) return;
      ensurePage(page);
      pagesRef.current[page].set(id, json);

      if (page === currentPageRef.current) {
        const object = await renderObjectFromJson(json);
        if (object && fabricRef.current) {
          fabricRef.current.add(object);
          fabricRef.current.requestRenderAll();
        }
      }
      if (broadcast) sendOrResync(() => syncRef.current?.sendAdd({ id, page, json }) ?? Promise.resolve(false));
    },
    [ensurePage, renderObjectFromJson, sendOrResync],
  );

  /** Изменить объект (store + канва + синхронизация). */
  const lowModify = useCallback(
    (page: number, json: ObjectJson, broadcast = true) => {
      const id = typeof json.id === "string" ? json.id : "";
      if (!id) return;
      ensurePage(page);
      pagesRef.current[page].set(id, json);

      if (page === currentPageRef.current) {
        const object = findOnCanvas(id);
        if (object) {
          object.set(json as never);
          object.setCoords();
          fabricRef.current?.requestRenderAll();
        }
      }
      if (broadcast) sendOrResync(() => syncRef.current?.sendModify({ id, page, json }) ?? Promise.resolve(false));
    },
    [ensurePage, findOnCanvas, sendOrResync],
  );

  /** Удалить объекты (store + канва + синхронизация). */
  const lowDelete = useCallback(
    (page: number, objectIds: string[], broadcast = true) => {
      if (objectIds.length === 0) return;
      ensurePage(page);
      const store = pagesRef.current[page];
      for (const id of objectIds) store.delete(id);

      if (page === currentPageRef.current) {
        const canvas = fabricRef.current;
        if (canvas) {
          for (const id of objectIds) {
            const object = findOnCanvas(id);
            if (object) canvas.remove(object);
          }
          canvas.discardActiveObject();
          canvas.requestRenderAll();
        }
      }
      if (broadcast) sendOrResync(() => syncRef.current?.sendDelete({ page, objectIds }) ?? Promise.resolve(false));
    },
    [ensurePage, findOnCanvas, sendOrResync],
  );

  const pushHistory = useCallback((op: HistoryOp) => {
    const history = historyRef.current;
    history.undo.push(op);
    if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
    history.redo = [];
    setCanUndo(history.undo.length > 0);
    setCanRedo(false);
  }, []);

  /* ----------------------------- Инициализация канвы ---------------------- */

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;

    FabricObject.customProperties = ["id", "customType", "latex"];

    const canvas = new Canvas(element, {
      width: WHITEBOARD_WIDTH,
      height: WHITEBOARD_HEIGHT,
      backgroundColor: "#ffffff",
      preserveObjectStacking: true,
      selection: true,
      stopContextMenu: true,
      fireRightClick: false,
      renderOnAddRemove: true,
    });
    fabricRef.current = canvas;

    // Канва масштабируется CSS-ом под контейнер — фиксируем это явно.
    if (canvas.wrapperEl) {
      canvas.wrapperEl.classList.add("whiteboard-stage");
      canvas.wrapperEl.style.width = "100%";
      canvas.wrapperEl.style.height = "100%";
    }

    const onMouseDown = (opt: { e: Event; pointer: Point; target?: FabricObject }) => {
      if (!canDrawRef.current) return;
      pointerDownRef.current = true;
      const { pointer } = opt;
      const activeTool = toolRef.current;

      if (activeTool === "select") {
        // Снимок «до» не нужен: историю строим по store, где лежит последнее
        // зафиксированное состояние объекта.
        return;
      }

      switch (activeTool) {
        case "line":
        case "rect":
        case "circle":
        case "arrow":
          startDraft(activeTool, pointer);
          break;
        case "text":
          createTextObject(pointer, "text");
          break;
        case "sticky":
          createTextObject(pointer, "sticky");
          break;
        case "eraser":
          eraseAt(opt);
          break;
        case "lasso":
          lassoRef.current = { points: [pointer], pointerDown: true };
          setSelectionPreview({ type: "lasso", points: [pointer.x, pointer.y] });
          break;
        case "formula":
          formulaRef.current = { start: pointer, pointerDown: true };
          setFormulaPreview({ type: "formula", left: pointer.x, top: pointer.y, width: 0, height: 0 });
          break;
        default:
          break;
      }
    };

    const onMouseMove = (opt: { e: Event; pointer: Point }) => {
      const { pointer } = opt;

      // Курсор участника — всегда, даже для зрителей.
      const now = Date.now();
      if (now - lastCursorSentRef.current > 50) {
        lastCursorSentRef.current = now;
        syncRef.current?.sendCursor({
          page: currentPageRef.current,
          x: Math.min(1, Math.max(0, pointer.x / WHITEBOARD_WIDTH)),
          y: Math.min(1, Math.max(0, pointer.y / WHITEBOARD_HEIGHT)),
        });
      }

      if (!canDrawRef.current) return;

      if (draftRef.current) {
        updateDraft(pointer);
        return;
      }
      if (pointerDownRef.current && toolRef.current === "eraser") {
        eraseAt(opt);
        return;
      }
      if (lassoRef.current?.pointerDown) {
        const points = lassoRef.current.points;
        const last = points[points.length - 1];
        if (Math.hypot(pointer.x - last.x, pointer.y - last.y) > 6) {
          points.push(pointer);
          setSelectionPreview({
            type: "lasso",
            points: points.flatMap((point) => [point.x, point.y]),
          });
        }
        return;
      }
      if (formulaRef.current?.pointerDown) {
        const { start } = formulaRef.current;
        setFormulaPreview({
          type: "formula",
          left: Math.min(start.x, pointer.x),
          top: Math.min(start.y, pointer.y),
          width: Math.abs(pointer.x - start.x),
          height: Math.abs(pointer.y - start.y),
        });
      }
    };

    const onMouseUp = (opt: { e: Event; pointer: Point }) => {
      pointerDownRef.current = false;

      if (draftRef.current) {
        finishDraft(opt.pointer);
        return;
      }

      if (lassoRef.current?.pointerDown) {
        lassoRef.current.pointerDown = false;
        const polygon = lassoRef.current.points;
        lassoRef.current = null;
        setSelectionPreview(null);
        if (polygon.length >= 3) applyLassoSelection(polygon);
        return;
      }

      if (formulaRef.current?.pointerDown) {
        const { start } = formulaRef.current;
        formulaRef.current = null;
        const region = {
          left: Math.min(start.x, opt.pointer.x),
          top: Math.min(start.y, opt.pointer.y),
          width: Math.abs(opt.pointer.x - start.x),
          height: Math.abs(opt.pointer.y - start.y),
        };
        setFormulaPreview(null);
        if (region.width > 12 && region.height > 12) captureFormulaRegion(region);
      }
    };

    /* ---- Черновики фигур (линия, прямоугольник, круг, стрелка) ---- */

    const startDraft = (activeTool: DraftShape["tool"], pointer: Point) => {
      const common = {
        stroke: colorRef.current,
        strokeWidth: strokeWidthRef.current,
        fill: "transparent",
        selectable: false,
        evented: false,
        objectCaching: false,
      };
      let preview: FabricObject;
      switch (activeTool) {
        case "rect":
          preview = new Rect({ ...common, left: pointer.x, top: pointer.y, width: 1, height: 1 });
          break;
        case "circle":
          preview = new Circle({
            ...common,
            left: pointer.x,
            top: pointer.y,
            radius: 1,
            originX: "center",
            originY: "center",
          });
          break;
        default:
          preview = new Line([pointer.x, pointer.y, pointer.x, pointer.y], {
            ...common,
            strokeLineCap: "round",
          });
          break;
      }
      fabricRef.current?.add(preview);
      draftRef.current = { tool: activeTool, start: pointer, preview };
    };

    const updateDraft = (pointer: Point) => {
      const draft = draftRef.current;
      if (!draft) return;
      const { start, preview, tool: draftTool } = draft;

      if (draftTool === "rect") {
        (preview as Rect).set({
          left: Math.min(start.x, pointer.x),
          top: Math.min(start.y, pointer.y),
          width: Math.abs(pointer.x - start.x),
          height: Math.abs(pointer.y - start.y),
        });
      } else if (draftTool === "circle") {
        (preview as Circle).set({ radius: Math.max(1, Math.hypot(pointer.x - start.x, pointer.y - start.y)) });
      } else {
        (preview as Line).set({ x2: pointer.x, y2: pointer.y });
      }
      fabricRef.current?.requestRenderAll();
    };

    const finishDraft = (pointer: Point) => {
      const draft = draftRef.current;
      if (!draft) return;
      draftRef.current = null;
      const canvas = fabricRef.current;
      if (!canvas) return;

      canvas.remove(draft.preview);

      const { tool: draftTool, start } = draft;
      const distance = Math.hypot(pointer.x - start.x, pointer.y - start.y);
      // Короткий клик без протяжки — фигура стандартного размера.
      const end: Point = distance < 6 ? defaultEndFor(draftTool, start) : pointer;
      const color = colorRef.current;
      const width = strokeWidthRef.current;

      let object: FabricObject;
      switch (draftTool) {
        case "rect":
          object = new Rect({
            left: Math.min(start.x, end.x),
            top: Math.min(start.y, end.y),
            width: Math.abs(end.x - start.x),
            height: Math.abs(end.y - start.y),
            fill: "transparent",
            stroke: color,
            strokeWidth: width,
            objectCaching: false,
          });
          break;
        case "circle":
          object = new Circle({
            left: start.x,
            top: start.y,
            radius: Math.max(1, Math.hypot(end.x - start.x, end.y - start.y)),
            originX: "center",
            originY: "center",
            fill: "transparent",
            stroke: color,
            strokeWidth: width,
            objectCaching: false,
          });
          break;
        case "arrow":
          object = createArrow([start.x, start.y], [end.x, end.y], color, width);
          break;
        default:
          object = new Line([start.x, start.y, end.x, end.y], {
            stroke: color,
            strokeWidth: width,
            strokeLineCap: "round",
            objectCaching: false,
          });
          break;
      }

      commitNewObject(object);
    };

    const defaultEndFor = (draftTool: DraftShape["tool"], start: Point): Point => {
      switch (draftTool) {
        case "rect":
          return { x: start.x + 160, y: start.y + 100 };
        case "circle":
          return { x: start.x + 80, y: start.y };
        default:
          return { x: start.x + 180, y: start.y };
      }
    };

    /* ---- Текст и стикеры ---- */

    const createTextObject = (pointer: Point, kind: "text" | "sticky") => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      const id = uid();
      let object: IText | Textbox;
      if (kind === "sticky") {
        object = new Textbox("Заметка", {
          left: pointer.x,
          top: pointer.y,
          width: 240,
          fontSize: 20,
          fill: "#1f2937",
          backgroundColor: colorRef.current,
          fontFamily: "sans-serif",
          editable: true,
        });
      } else {
        object = new IText("Текст", {
          left: pointer.x,
          top: pointer.y,
          fontSize: 24,
          fill: colorRef.current,
          fontFamily: "sans-serif",
          editable: true,
        });
      }
      (object as unknown as { id: string }).id = id;
      pendingTextRef.current.add(id);
      canvas.add(object);
      canvas.setActiveObject(object);
      object.enterEditing();
      object.selectAll();
      canvas.requestRenderAll();
    };

    const onTextEditingExited = (opt: { target?: FabricObject }) => {
      const target = opt.target as (IText | Textbox) | undefined;
      if (!target) return;
      const id = getObjectId(target);
      if (!id) return;

      const text = (target.text ?? "").trim();
      const store = pagesRef.current[currentPageRef.current];

      if (!text) {
        if (pendingTextRef.current.has(id)) {
          pendingTextRef.current.delete(id);
          fabricRef.current?.remove(target);
        } else if (store.has(id)) {
          const json = store.get(id)!;
          lowDelete(currentPageRef.current, [id]);
          pushHistory({ kind: "remove", page: currentPageRef.current, items: [json] });
        }
        return;
      }

      if (pendingTextRef.current.has(id)) {
        // Первый коммит нового текста.
        pendingTextRef.current.delete(id);
        const json = serialize(target);
        store.set(id, json);
        pushHistory({ kind: "add", page: currentPageRef.current, json });
        sendOrResync(() => syncRef.current?.sendAdd({ id, page: currentPageRef.current, json }) ?? Promise.resolve(false));
        fabricRef.current?.requestRenderAll();
        return;
      }

      const before = store.get(id);
      const after = serialize(target);
      if (before && JSON.stringify(before) !== JSON.stringify(after)) {
        lowModify(currentPageRef.current, after);
        pushHistory({
          kind: "modify",
          page: currentPageRef.current,
          before,
          after,
        });
      }
    };

    /* ---- Ластик ---- */

    const eraseAt = (opt: { e: Event; target?: FabricObject }) => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const target = opt.target;
      if (!target) return;
      const id = getObjectId(target);
      if (!id || pendingTextRef.current.has(id)) return;

      const json = pagesRef.current[currentPageRef.current].get(id) ?? serialize(target);
      lowDelete(currentPageRef.current, [id]);
      pushHistory({ kind: "remove", page: currentPageRef.current, items: [json] });
    };

    /* ---- Лассо ---- */

    const applyLassoSelection = (polygon: Point[]) => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const targets = canvas
        .getObjects()
        .filter((object) => getObjectId(object) && pointInPolygon(object.getCenterPoint(), polygon));

      if (targets.length === 0) {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        return;
      }
      if (targets.length === 1) {
        canvas.setActiveObject(targets[0]);
      } else {
        canvas.setActiveObject(new ActiveSelection(targets, { canvas }));
      }
      canvas.requestRenderAll();
    };

    /* ---- Распознавание формулы ---- */

    const captureFormulaRegion = (region: { left: number; top: number; width: number; height: number }) => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      const objectIds = canvas
        .getObjects()
        .filter((object) => getObjectId(object) && objectCenterIn(object, region))
        .map((object) => getObjectId(object)!);

      const crop = canvas.toCanvasElement(1, region);
      const imageDataUrl = crop.toDataURL("image/png");
      optionsRef.current.onFormulaRegion?.({ imageDataUrl, region, objectIds });
    };

    /* ---- Общие операции ---- */

    const commitNewObject = (object: FabricObject) => {
      const id = assignId(object);
      const json = serialize(object);
      const page = currentPageRef.current;
      pagesRef.current[page].set(id, json);
      const canvas = fabricRef.current;
      if (canvas && !canvas.getObjects().includes(object)) {
        canvas.add(object);
        canvas.requestRenderAll();
      }
      pushHistory({ kind: "add", page, json });
      sendOrResync(() => syncRef.current?.sendAdd({ id, page, json }) ?? Promise.resolve(false));
    };

    const onPathCreated = (opt: { path?: FabricObject }) => {
      const path = opt.path;
      if (!path || !canDrawRef.current) return;
      commitNewObject(path);
    };

    /** Фиксирует изменение одного объекта (store хранит «до»). */
    const commitModify = (object: FabricObject): HistoryOp | null => {
      const id = getObjectId(object);
      if (!id || pendingTextRef.current.has(id)) return null;

      const page = currentPageRef.current;
      const before = pagesRef.current[page].get(id);
      const after = serialize(object);
      if (!before || JSON.stringify(before) === JSON.stringify(after)) return null;

      pagesRef.current[page].set(id, after);
      sendOrResync(() => syncRef.current?.sendModify({ id, page, json: after }) ?? Promise.resolve(false));
      return { kind: "modify", page, before, after };
    };

    const onObjectModified = (opt: { target?: FabricObject }) => {
      const target = opt.target;
      if (!target || !canDrawRef.current) return;

      // Групповое выделение — фиксируем изменение каждого объекта одной записью.
      const targets = target instanceof ActiveSelection ? target.getObjects() : [target];
      const ops = targets.map(commitModify).filter((op): op is HistoryOp => op !== null);
      if (ops.length === 1) pushHistory(ops[0]);
      else if (ops.length > 1) pushHistory({ kind: "batch", ops });
    };

    canvas.on("mouse:down", onMouseDown as never);
    canvas.on("mouse:move", onMouseMove as never);
    canvas.on("mouse:up", onMouseUp as never);
    canvas.on("path:created", onPathCreated as never);
    canvas.on("object:modified", onObjectModified as never);
    canvas.on("text:editing:exited", onTextEditingExited as never);

    setIsReady(true);

    return () => {
      setIsReady(false);
      fabricRef.current = null;
      void canvas.dispose();
    };
    // Хук монтируется один раз на время жизни доски.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----------------------------- Инструменты ----------------------------- */

  const applyInteractivity = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const activeTool = toolRef.current;
    const drawable = canDrawRef.current;

    canvas.isDrawingMode = drawable && activeTool === "pencil";
    if (canvas.isDrawingMode) {
      const brush = new PencilBrush(canvas);
      brush.color = colorRef.current;
      brush.width = strokeWidthRef.current;
      canvas.freeDrawingBrush = brush;
    }
    canvas.selection = drawable && activeTool === "select";
    canvas.defaultCursor = TOOL_CURSORS[activeTool] ?? "default";

    for (const object of canvas.getObjects()) {
      if (pendingTextRef.current.has(getObjectId(object) ?? "")) continue;
      object.selectable = drawable && (activeTool === "select" || activeTool === "lasso");
      object.evented = true;
      object.hoverCursor = object.selectable ? "move" : TOOL_CURSORS[activeTool] ?? "default";
    }
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }, []);

  useEffect(() => {
    applyInteractivity();
  }, [tool, canDraw, color, strokeWidth, applyInteractivity]);

  const setTool = useCallback(
    (next: WhiteboardTool) => {
      // Инструмент «формула» доступен только учителю/администратору.
      const resolved: WhiteboardTool = next === "formula" && !isModerator ? "select" : next;
      setToolState(resolved);
      toolRef.current = resolved;
    },
    [isModerator],
  );

  /* ----------------------------- История -------------------------------- */

  const applyHistoryOp = useCallback(
    async (op: HistoryOp, direction: "undo" | "redo"): Promise<void> => {
      switch (op.kind) {
        case "add": {
          if (direction === "undo") {
            const json = op.json;
            lowDelete(op.page, [String(json.id)]);
          } else {
            await lowAdd(op.page, op.json);
          }
          break;
        }
        case "remove": {
          if (direction === "undo") {
            for (const json of op.items) await lowAdd(op.page, json);
          } else {
            lowDelete(op.page, op.items.map((json) => String(json.id)));
          }
          break;
        }
        case "modify": {
          const json = direction === "undo" ? op.before : op.after;
          lowModify(op.page, json);
          break;
        }
        case "batch": {
          const ops = direction === "undo" ? [...op.ops].reverse() : op.ops;
          for (const inner of ops) await applyHistoryOp(inner, direction);
          break;
        }
      }
    },
    [lowAdd, lowModify, lowDelete],
  );

  const undo = useCallback(() => {
    const history = historyRef.current;
    const op = history.undo.pop();
    if (!op) return;
    history.redo.push(op);
    setCanUndo(history.undo.length > 0);
    setCanRedo(true);
    applyQueueRef.current = applyQueueRef.current.then(() => applyHistoryOp(op, "undo"));
  }, [applyHistoryOp]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    const op = history.redo.pop();
    if (!op) return;
    history.undo.push(op);
    setCanUndo(true);
    setCanRedo(history.redo.length > 0);
    applyQueueRef.current = applyQueueRef.current.then(() => applyHistoryOp(op, "redo"));
  }, [applyHistoryOp]);

  /* ----------------------------- Страницы -------------------------------- */

  const loadPageIntoCanvas = useCallback(
    async (page: number) => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      ensurePage(page);
      const objects = Array.from(pagesRef.current[page].values());
      await canvas.loadFromJSON({ objects, background: "#ffffff" });
      canvas.requestRenderAll();
      applyInteractivity();
    },
    [applyInteractivity, ensurePage],
  );

  const setPage = useCallback(
    (page: number) => {
      if (page < 0 || page >= WHITEBOARD_MAX_PAGES_LOCAL) return;
      ensurePage(page);
      currentPageRef.current = page;
      setCurrentPage(page);
      applyQueueRef.current = applyQueueRef.current.then(() => loadPageIntoCanvas(page));
      sendOrResync(() => syncRef.current?.sendPage({ page }) ?? Promise.resolve(false));
    },
    [ensurePage, loadPageIntoCanvas, sendOrResync],
  );

  const addPage = useCallback(() => {
    const next = pagesRef.current.length;
    if (next >= WHITEBOARD_MAX_PAGES_LOCAL) return;
    setPage(next);
  }, [setPage]);

  const clearPage = useCallback(() => {
    const page = currentPageRef.current;
    const items = Array.from(pagesRef.current[page].values());
    if (items.length === 0) return;
    lowDelete(page, items.map((json) => String(json.id)), false);
    sendOrResync(() => syncRef.current?.sendClear({ page }) ?? Promise.resolve(false));
    pushHistory({ kind: "remove", page, items });
  }, [lowDelete, pushHistory, sendOrResync]);

  /* ----------------------------- Экспорт -------------------------------- */

  const exportPNG = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL({ format: "png", multiplier: 2, enableRetinaScaling: false });
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `schoolmeet-board-page-${currentPageRef.current + 1}.png`;
    link.click();
  }, []);

  /**
   * Снимок доски для ИИ-панели (кнопка «Передать доску»).
   *
   * Ширину ограничиваем 1280 px: снимок остаётся читаемым для Gemini Vision,
   * но не раздувает запрос (лимит `/api/ai` — 6 МБ на data URL).
   */
  const captureBoard = useCallback((maxWidth = 1280): string | null => {
    const canvas = fabricRef.current;
    if (!canvas) return null;

    try {
      const width = canvas.getWidth() || WHITEBOARD_WIDTH;
      const multiplier = Math.min(1, maxWidth / width);
      return canvas.toDataURL({ format: "png", multiplier, enableRetinaScaling: false });
    } catch (error) {
      console.warn("[whiteboard] не удалось снять копию доски:", error);
      return null;
    }
  }, []);

  /* ----------------------------- ИИ-операции ----------------------------- */

  const applyFormulaResult = useCallback(
    (payload: FormulaResultPayload) => {
      const page = currentPageRef.current;

      if (payload.objectIds.length > 0) {
        const items = payload.objectIds
          .map((id) => pagesRef.current[page].get(id))
          .filter((json): json is ObjectJson => Boolean(json));
        lowDelete(page, payload.objectIds);
        if (items.length > 0) pushHistory({ kind: "remove", page, items });
      }

      const { region } = payload;
      const textbox = new Textbox(payload.text, {
        left: Math.round(region.left),
        top: Math.round(region.top),
        width: Math.max(180, Math.round(region.width)),
        fontSize: 26,
        fill: "#111827",
        fontFamily: "sans-serif",
        editable: true,
      });
      (textbox as unknown as { id: string; customType: string; latex?: string }).id = uid();
      (textbox as unknown as { customType: string }).customType = "formula";
      if (payload.latex) (textbox as unknown as { latex: string }).latex = payload.latex;

      const id = getObjectId(textbox)!;
      const json = serialize(textbox);
      pagesRef.current[page].set(id, json);
      fabricRef.current?.add(textbox);
      fabricRef.current?.requestRenderAll();
      pushHistory({ kind: "add", page, json });
      sendOrResync(() => syncRef.current?.sendAdd({ id, page, json }) ?? Promise.resolve(false));
    },
    [lowDelete, pushHistory, sendOrResync],
  );

  const applyDrawing = useCallback(
    (instructions: DrawingInstruction[]) => {
      if (instructions.length === 0) return;
      const page = currentPageRef.current;
      const objects = buildObjectsFromInstructions(instructions, { offset: { x: 120, y: 60 } });
      const ops: HistoryOp[] = [];

      for (const object of objects) {
        const id = assignId(object);
        const json = serialize(object);
        pagesRef.current[page].set(id, json);
        fabricRef.current?.add(object);
        ops.push({ kind: "add", page, json });
        sendOrResync(() => syncRef.current?.sendAdd({ id, page, json }) ?? Promise.resolve(false));
      }
      fabricRef.current?.requestRenderAll();
      pushHistory({ kind: "batch", ops });
    },
    [pushHistory, sendOrResync],
  );

  /* ----------------------------- Синхронизация --------------------------- */

  const applyRemoteEvent = useCallback(
    async (event: WhiteboardServerEvent): Promise<void> => {
      switch (event.type) {
        case "add":
          await lowAdd(event.payload.page, event.payload.json, false);
          break;
        case "modify":
          lowModify(event.payload.page, event.payload.json, false);
          break;
        case "delete":
          lowDelete(event.payload.page, event.payload.objectIds, false);
          break;
        case "clear": {
          const { page } = event.payload;
          if (page === "all") {
            pagesRef.current = [new Map()];
            currentPageRef.current = 0;
            setCurrentPage(0);
            setPageCount(1);
            await loadPageIntoCanvas(0);
          } else {
            pagesRef.current[page] = new Map();
            if (page === currentPageRef.current) await loadPageIntoCanvas(page);
          }
          break;
        }
        case "cursor": {
          cursorsRef.current.set(event.payload.socketId, { ...event.payload, at: Date.now() });
          break;
        }
        case "access":
          setDrawPolicyState(event.payload.drawPolicy);
          break;
        case "page": {
          const page = event.payload.page;
          ensurePage(page);
          currentPageRef.current = page;
          setCurrentPage(page);
          await loadPageIntoCanvas(page);
          break;
        }
      }
    },
    [ensurePage, loadPageIntoCanvas, lowAdd, lowDelete, lowModify],
  );

  const loadState = useCallback(
    async (state: WhiteboardState) => {
      pagesRef.current = state.pages.map((page) => new Map(Object.entries(page.objects)));
      if (pagesRef.current.length === 0) pagesRef.current.push(new Map());
      setDrawPolicyState(state.drawPolicy);
      setPageCount(pagesRef.current.length);

      const page = Math.min(Math.max(0, state.page), pagesRef.current.length - 1);
      currentPageRef.current = page;
      setCurrentPage(page);
      await loadPageIntoCanvas(page);

      historyRef.current = { undo: [], redo: [] };
      setCanUndo(false);
      setCanRedo(false);
    },
    [loadPageIntoCanvas],
  );

  /**
   * Сходимость при сбоях: если сервер отклонил локальное изменение (например,
   * учитель только что закрыл рисование), доска перечитывает состояние сервера.
   */
  const scheduleResync = useCallback(() => {
    if (resyncTimerRef.current !== null) return;
    resyncTimerRef.current = window.setTimeout(() => {
      resyncTimerRef.current = null;
      applyQueueRef.current = applyQueueRef.current.then(async () => {
        const state = await syncRef.current?.requestState();
        if (state) await loadState(state);
      });
    }, 600);
  }, [loadState]);

  // Подписка на входящие события доски + первичная синхронизация.
  useEffect(() => {
    const currentSync = syncRef.current;
    if (!currentSync) return;

    const unsubscribe = currentSync.subscribe((event) => {
      applyQueueRef.current = applyQueueRef.current.then(() => applyRemoteEvent(event));
    });

    applyQueueRef.current = applyQueueRef.current.then(async () => {
      const state = await currentSync.requestState();
      if (state) await loadState(state);
    });

    return unsubscribe;
  }, [applyRemoteEvent, loadState]);

  // Таймер ресинка при размонтировании больше не нужен.
  useEffect(() => {
    return () => {
      if (resyncTimerRef.current !== null) {
        window.clearTimeout(resyncTimerRef.current);
        resyncTimerRef.current = null;
      }
    };
  }, []);

  // Курсоры участников: периодически убираем «молчащие».
  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      let changed = false;
      cursorsRef.current.forEach((cursor, id) => {
        if (now - cursor.at > WHITEBOARD_CURSOR_TTL_MS) {
          cursorsRef.current.delete(id);
          changed = true;
        }
      });
      if (changed || cursorsRef.current.size !== cursors.length) {
        setCursors(Array.from(cursorsRef.current.values()).map(toCursorView));
      }
    }, 2000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursors.length]);

  // Мягкое обновление списка курсоров — не чаще 10 раз в секунду.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      if (now - lastCursorsRenderRef.current < 100) return;
      lastCursorsRenderRef.current = now;
      setCursors((prev) => {
        const next = Array.from(cursorsRef.current.values()).map(toCursorView);
        return next.length === prev.length && next.every((item, i) => item.socketId === prev[i]?.socketId && item.x === prev[i]?.x && item.y === prev[i]?.y)
          ? prev
          : next;
      });
    }, 100);
    return () => window.clearInterval(interval);
  }, []);

  const setDrawPolicy = useCallback(
    (policy: WhiteboardDrawPolicy) => {
      setDrawPolicyState(policy);
      sendOrResync(() => syncRef.current?.sendAccess({ drawPolicy: policy }) ?? Promise.resolve(false));
    },
    [sendOrResync],
  );

  return {
    isReady,
    tool,
    setTool,
    color,
    setColor,
    strokeWidth,
    setStrokeWidth,
    canDraw,
    drawPolicy,
    setDrawPolicy,
    canUndo,
    canRedo,
    undo,
    redo,
    pageCount,
    currentPage,
    addPage,
    setPage,
    clearPage,
    exportPNG,
    captureBoard,
    applyFormulaResult,
    applyDrawing,
    cursors,
    selectionPreview,
    formulaPreview,
    canvasRef,
  };
}
