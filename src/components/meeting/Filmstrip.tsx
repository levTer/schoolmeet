"use client";

/**
 * Компактная полоска участников (Filmstrip) для режима доски и
 * демонстрации экрана.
 *
 * Когда открыта интерактивная доска ИЛИ кто-то делится экраном, основная
 * сцена занята холстом/экраном, и сетка видео становится вторичной:
 *  - десктоп (`md` и выше) — правая колонка ~240–300px с вертикальной
 *    прокруткой («плитка шоколада»): камеры участников столбиком;
 *  - мобильные — горизонтальная лента в ОБЫЧНОМ потоке документа
 *    (`flex-row overflow-x-auto`), а не `absolute` поверх сцены: она не
 *    перекрывает ни тулбар доски, ни нижнюю панель управления.
 *
 * Каждая плитка кликабельна (закрепить/открепить участника — можно несколько
 * сразу) и показывает состояние микрофона/камеры/экрана.
 *
 * ВАЖНО: полоска НЕ отключает треки — она лишь дополнительный слой поверх
 * тех же потоков (muted-видео, чтобы не было двойного звука; основной звук
 * идёт из полной сетки, которая остаётся смонтированной).
 */

import { useEffect, useRef } from "react";
import { Hand, MicOff, MonitorUp, Pin, PinOff } from "lucide-react";

import { cn, getInitials } from "@/lib/utils";
import { orderTilesByPinned, tileHasVideo, type GridTile } from "@/components/meeting/VideoGrid";

export interface FilmstripProps {
  tiles: GridTile[];
  /** Закреплённые участники — их плитки подсвечены, расширены и идут первыми. */
  pinnedIds?: readonly string[];
  /** Клик по плитке / кнопке — закрепить (открепить) участника. */
  onPin?: (tileId: string) => void;
  /** Высота полосы. По умолчанию 96px (md: 112px). */
  className?: string;
  /**
   * Раскладка полосы:
   *  - `horizontal` — лента слева-направо с горизонтальной прокруткой (мобильные);
   *  - `vertical`   — «плитка шоколада» столбиком с вертикальной прокруткой
   *                   (правая колонка на десктопе).
   */
  layout?: "horizontal" | "vertical";
}

/** Плитка горизонтальной ленты: фиксированная высота, ширина 128px (md: 160px). */
const TILE_HORIZONTAL_SIZE =
  "h-20 w-32 shrink-0 overflow-hidden rounded-xl border bg-ink-900/80 text-left transition-[width,box-shadow] duration-200 md:h-24 md:w-40";
/** Плитка вертикальной колонки: тянется по ширине, соотношение 16:9. */
const TILE_VERTICAL_SIZE =
  "w-full shrink-0 overflow-hidden rounded-xl border bg-ink-900/80 text-left transition-[box-shadow] duration-200";

/**
 * Полоска участников: горизонтальный скролл на мобильных, вертикальная
 * «плитка шоколада» в правой колонке на десктопе. Клик по плитке = pin.
 */
export function Filmstrip({ tiles, pinnedIds = [], onPin, className, layout = "horizontal" }: FilmstripProps) {
  if (tiles.length === 0) return null;

  const orderedTiles = orderTilesByPinned(tiles, pinnedIds);

  return (
    <div
      className={cn(
        layout === "vertical"
          ? "flex min-h-0 w-full flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden p-2"
          : "flex shrink-0 items-stretch gap-2 overflow-x-auto overflow-y-hidden border-b border-white/10 bg-ink-950/85 px-2 py-1.5 backdrop-blur-xl",
        className,
      )}
      role="region"
      aria-label="Участники урока (компактная полоска)"
    >
      {orderedTiles.map((tile) => (
        <FilmstripTile
          key={tile.id}
          tile={tile}
          layout={layout}
          pinned={pinnedIds.includes(tile.id)}
          onPin={onPin ? () => onPin(tile.id) : undefined}
        />
      ))}
    </div>
  );
}

interface FilmstripTileProps {
  tile: GridTile;
  layout: "horizontal" | "vertical";
  pinned: boolean;
  onPin?: () => void;
}

function FilmstripTile({ tile, layout, pinned, onPin }: FilmstripTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Общее правило с сеткой камер: чужой экран в полосе — дубль сцены, поэтому
  // показываем аватар; свой поток подменён на камеру в MeetingRoom.
  const hasVideo = tileHasVideo(tile);

  // Привязываем поток, если он поменялся (как в основной сетке).
  useEffect(() => {
    const element = videoRef.current;
    if (element && element.srcObject !== tile.stream) {
      element.srcObject = tile.stream;
    }
  }, [tile.stream, hasVideo]);

  const showPin = Boolean(onPin);
  const vertical = layout === "vertical";

  return (
    <button
      type="button"
      onClick={onPin}
      disabled={!showPin}
      aria-pressed={pinned}
      aria-label={
        pinned
          ? `Открепить спикера: ${tile.name}`
          : `Закрепить спикера: ${tile.name}${tile.audioOn ? "" : " (микрофон выключен)"}`
      }
      title={pinned ? "Открепить спикера" : "Закрепить спикера"}
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-ink-900/80 text-left",
        vertical
          ? cn(TILE_VERTICAL_SIZE, "aspect-video")
          : TILE_HORIZONTAL_SIZE,
        // В горизонтальной ленте закреплённый спикер шире; в вертикальной
        // колонке все плитки одной ширины — там хватает визуальной рамки.
        !vertical && (pinned ? "w-40 border-brand-400/70 shadow-glow md:w-48" : "border-white/10 hover:border-white/25"),
        vertical && (pinned ? "border-brand-400/70 shadow-glow" : "border-white/10 hover:border-white/25"),
        tile.speaking && "speaking-ring",
        !showPin && "cursor-default",
      )}
    >
      {/*
        Аудио: когда полоска активна (доска/экран), звук участников играет
        ОТСЮДА — в это время полная сетка «молчит» (silent) или сцены
        демонстрации экрана muted, поэтому двойного звука нет. Свой локальный
        поток muted, чтобы не было эха. Треки при этом НИКОГДА не
        отключаем (`track.enabled` не трогаем).
      */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={tile.isLocal}
        className={cn(
          "h-full w-full bg-black object-cover",
          !hasVideo && "invisible",
          tile.isLocal && !tile.screenOn && "scale-x-[-1]",
        )}
      />

      {/* Аватар, когда видео выключено. */}
      {!hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-ink-800 to-ink-950">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-white shadow-glow">
            {getInitials(tile.name) || (tile.isLocal ? "Вы" : "?")}
          </div>
        </div>
      )}

      {/* Кнопка pin (визуально — значок в углу). */}
      {showPin && (
        <span
          className={cn(
            "absolute right-1.5 top-1.5 z-10 inline-flex items-center justify-center rounded-lg border backdrop-blur transition",
            "h-6 w-6",
            pinned
              ? "border-brand-400/60 bg-brand-500/30 text-white"
              : "border-white/10 bg-black/45 text-slate-200 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
        >
          {pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
        </span>
      )}

      {/* Подпись: имя + индикаторы (экран / рука / микрофон выкл). */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1 pt-5">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-white">
          {tile.name}
          {tile.isLocal && <span className="ml-1 text-slate-300">(вы)</span>}
        </span>

        {pinned && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/30 px-1.5 py-0.5 text-[10px] font-medium text-brand-100">
            <Pin className="h-2.5 w-2.5" />
            Закреплён
          </span>
        )}

        {tile.screenOn && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-500/25 px-1.5 py-0.5 text-[10px] font-medium text-accent-300">
            <MonitorUp className="h-3 w-3" />
            Экран
          </span>
        )}
        {tile.handRaised && (
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-400/25 text-amber-300">
            <Hand className="h-2.5 w-2.5" />
          </span>
        )}
        {!tile.audioOn && (
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-rose-500/25 text-rose-300">
            <MicOff className="h-2.5 w-2.5" />
          </span>
        )}
      </div>
    </button>
  );
}
