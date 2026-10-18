"use client";

/**
 * Компактная верхняя полоска участников (Filmstrip) для режима доски и
 * демонстрации экрана.
 *
 * Когда открыта интерактивная доска ИЛИ кто-то делится экраном, основная
 * сцена занята холстом/экраном, и сетка видео становится вторичной. Вместо
 * полной сетки показываем узкую горизонтальную полосу (≈96–120px) сверху:
 * ваше видео + участники, каждая плитка кликабельна (закрепить спикера) и
 * показывает состояние микрофона/камеры/экрana.
 *
 * ВАЖНО: полоска НЕ отключает треки — она лишь дополнительный слой поверх
 * тех же потоков (мuted-видео, чтобы не было двойного звука; основной звук
 * идёт из полной сетки, которая остаётся смонтированной).
 */

import { useEffect, useRef } from "react";
import { Hand, MicOff, MonitorUp, Pin, PinOff } from "lucide-react";

import { cn, getInitials } from "@/lib/utils";
import type { GridTile } from "@/components/meeting/VideoGrid";

export interface FilmstripProps {
  tiles: GridTile[];
  /** Закреплённый участник — его плитка подсвечена и расширена. */
  pinnedId?: string | null;
  /** Клик по плитке / кнопке — закрепить (открепить) спикера. */
  onPin?: (tileId: string) => void;
  /** Высота полосы. По умолчанию 96px (md: 112px). */
  className?: string;
}

/**
 * Полоска участников: горизонтальный скролл, плитки фиксированной высоты,
 * закреплённый спикер чуть крупнее. Клик по плитке = pin.
 */
export function Filmstrip({ tiles, pinnedId, onPin, className }: FilmstripProps) {
  if (tiles.length === 0) return null;

  return (
    <div
      className={cn(
        "flex shrink-0 items-stretch gap-2 overflow-x-auto overflow-y-hidden border-b border-white/10 bg-ink-950/85 px-2 py-1.5 backdrop-blur-xl",
        className,
      )}
      role="region"
      aria-label="Участники урока (компактная полоска)"
    >
      {tiles.map((tile) => (
        <FilmstripTile
          key={tile.id}
          tile={tile}
          pinned={pinnedId === tile.id}
          onPin={onPin ? () => onPin(tile.id) : undefined}
        />
      ))}
    </div>
  );
}

interface FilmstripTileProps {
  tile: GridTile;
  pinned: boolean;
  onPin?: () => void;
}

function FilmstripTile({ tile, pinned, onPin }: FilmstripTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const hasVideo = Boolean(
    tile.stream && tile.videoOn && tile.stream.getVideoTracks().length > 0,
  );

  // Привязываем поток, если он поменялся (как в основной сетке).
  useEffect(() => {
    const element = videoRef.current;
    if (element && element.srcObject !== tile.stream) {
      element.srcObject = tile.stream;
    }
  }, [tile.stream, hasVideo]);

  const showPin = Boolean(onPin);

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
        "group relative h-20 w-32 shrink-0 overflow-hidden rounded-xl border bg-ink-900/80 text-left transition-[width,box-shadow] duration-200 md:h-24 md:w-40",
        pinned
          ? "w-40 border-brand-400/70 shadow-glow md:w-48"
          : "border-white/10 hover:border-white/25",
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
