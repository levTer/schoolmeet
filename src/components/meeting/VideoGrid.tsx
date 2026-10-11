"use client";

import { useEffect, useRef } from "react";
import { Hand, MicOff, MonitorUp } from "lucide-react";

import { cn, getInitials } from "@/lib/utils";
import type { PeerConnectionState } from "@/hooks/useWebRTC";
import type { Role } from "@/types";

export interface GridTile {
  id: string;
  name: string;
  role?: Role;
  stream: MediaStream | null;
  isLocal?: boolean;
  /** Камера (или экран) включены — иначе показываем аватар. */
  videoOn: boolean;
  audioOn: boolean;
  screenOn: boolean;
  handRaised: boolean;
  speaking: boolean;
  connection?: PeerConnectionState;
}

/**
 * Адаптивная сетка: 1 участник — во весь экран, 2 — в ряд, 3–4 — 2×2,
 * 5–9 — 3×3, больше — 4 колонки с прокруткой.
 * На мобильных (< 640px) максимум 2 колонки для крупных видео.
 */
export function gridLayoutClass(count: number): string {
  if (count <= 1) return "grid-cols-1 grid-rows-1";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  if (count <= 4) return "grid-cols-1 sm:grid-cols-2 auto-rows-fr";
  if (count <= 6) return "grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr";
  if (count <= 9) return "grid-cols-2 lg:grid-cols-3 auto-rows-fr";
  return "grid-cols-2 lg:grid-cols-4 auto-rows-fr";
}

export function VideoGrid({ tiles }: { tiles: GridTile[] }) {
  const count = tiles.length;

  return (
    <div
      className={cn(
        "grid h-full w-full gap-2 overflow-y-auto p-2 sm:gap-3 sm:p-3",
        gridLayoutClass(count),
        count > 9 && "content-start",
      )}
    >
      {tiles.map((tile) => (
        <VideoTileView key={tile.id} tile={tile} single={count === 1} />
      ))}
    </div>
  );
}

function VideoTileView({ tile, single }: { tile: GridTile; single: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasVideo = Boolean(tile.stream && tile.videoOn && tile.stream.getVideoTracks().length > 0);

  // Элемент <video> рендерим всегда: именно он проигрывает аудио участника,
  // даже когда его камера выключена (тогда картинку прячем, а звук остаётся).
  useEffect(() => {
    const element = videoRef.current;
    if (element && element.srcObject !== tile.stream) {
      element.srcObject = tile.stream;
    }
  }, [tile.stream, hasVideo]);

  const isConnecting = !tile.isLocal && tile.connection !== "connected";

  return (
    <div
      data-speaking={tile.speaking || undefined}
      className={cn(
        "glass-tile relative min-h-0 overflow-hidden rounded-2xl bg-ink-900/80 transition-[box-shadow,transform] duration-300",
        single ? "h-full" : "aspect-video w-full",
        tile.speaking && "speaking-ring",
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={tile.isLocal}
        className={cn(
          "h-full w-full bg-black object-cover transition-opacity duration-300",
          !hasVideo && "invisible",
          tile.isLocal && !tile.screenOn && "scale-x-[-1]",
        )}
      />

      {/* Аватар, когда камера (или экран) выключены */}
      {!hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-ink-800 to-ink-950">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-gradient text-2xl font-semibold text-white shadow-glow sm:h-24 sm:w-24">
            {getInitials(tile.name) || "?"}
          </div>
        </div>
      )}

      {/* Подпись и индикаторы */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2.5 pt-8">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
          {tile.name}
          {tile.isLocal && <span className="ml-1.5 text-xs text-slate-300">(вы)</span>}
        </span>

        {tile.screenOn && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-500/20 px-2 py-0.5 text-[11px] font-medium text-accent-300">
            <MonitorUp className="h-3 w-3" />
            Экран
          </span>
        )}
        {tile.handRaised && (
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-400/20 text-amber-300">
            <Hand className="h-3.5 w-3.5" />
          </span>
        )}
        {!tile.audioOn && (
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-rose-500/20 text-rose-300">
            <MicOff className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      {isConnecting && (
        <div
          className={cn(
            "absolute right-3 top-3 rounded-full border bg-black/50 px-2.5 py-1 text-[11px] backdrop-blur",
            tile.connection === "failed"
              ? "border-rose-400/30 text-rose-200"
              : "border-white/10 text-slate-300",
          )}
        >
          {tile.connection === "failed" ? "Нет соединения" : "Подключение…"}
        </div>
      )}
    </div>
  );
}
