"use client";

import { useEffect, useRef } from "react";
import { Hand, MicOff, MonitorUp, Pin, PinOff } from "lucide-react";

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

export interface VideoGridProps {
  tiles: GridTile[];
  /** Закреплённый участник — он показывается поверх демонстрации экрана. */
  pinnedId?: string | null;
  /** Клик по кнопке «Закрепить спикера» на карточке участника. */
  onPin?: (tileId: string) => void;
  /**
   * «Молчаливый» режим: аудио из этой сетки не проигрывается (видео-элементы
   * muted), но ТРЕКИ НЕ отключаются — звук в этот момент играет из Filmstrip
   * (когда открыта доска, полоска живёт внутри оверлея доски). Без этого
   * одного и того же участника было бы слышно дважды.
   */
  silent?: boolean;
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

/**
 * Кто показывается в «картинке в углу» поверх демонстрации экрана:
 * 1) закреплённый учителем спикер, 2) участник, который сейчас говорит,
 * 3) учитель/администратор, 4) первый доступный.
 */
export function pickSpotlightTile(
  tiles: GridTile[],
  pinnedId: string | null | undefined,
  screenTileId: string,
): GridTile | null {
  const candidates = tiles.filter((tile) => tile.id !== screenTileId);
  if (candidates.length === 0) return null;

  if (pinnedId) {
    const pinned = candidates.find((tile) => tile.id === pinnedId);
    if (pinned) return pinned;
  }

  const speaking = candidates.find((tile) => tile.speaking);
  if (speaking) return speaking;

  const staff = candidates.find((tile) => tile.role === "TEACHER" || tile.role === "ADMIN");
  if (staff) return staff;

  return candidates[0];
}

export function VideoGrid({ tiles, pinnedId, onPin, silent = false }: VideoGridProps) {
  const count = tiles.length;

  /**
   * Режим демонстрации экрана: экран занимает всю сцену, а камеры участников
   * (в том числе своя) — компактной полоской Filmstrip СВЕРХУ (рендерит
   * страница урока). Сцена при этом muted: тот же поток (звук экрана)
   * проигрывается плиткой владельца в Filmstrip — без этого было бы дважды.
   */
  const screenTile = tiles.find((tile) => tile.screenOn) ?? null;

  if (screenTile) {
    return (
      <div className="relative h-full w-full overflow-hidden">
        {/* Сцена: демонстрация экрана (audio — в Filmstrip, поэтому muted) */}
        <VideoTileView tile={screenTile} stage muted={true} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid h-full w-full gap-2 overflow-y-auto p-2 sm:gap-3 sm:p-3",
        gridLayoutClass(count),
        count > 9 && "content-start",
      )}
    >
      {tiles.map((tile) => (
        <VideoTileView
          key={tile.id}
          tile={tile}
          single={count === 1}
          pinned={pinnedId === tile.id}
          onPin={onPin}
          muted={silent ? true : undefined}
        />
      ))}
    </div>
  );
}

interface VideoTileViewProps {
  tile: GridTile;
  /** Тайл во всю сцену (демонстрация экрана). */
  stage?: boolean;
  /** Маленький тайл (картинка в углу, лента участников). */
  compact?: boolean;
  single?: boolean;
  /** Закреплён ли участник. */
  pinned?: boolean;
  onPin?: (tileId: string) => void;
  /**
   * Явное override аудио: `undefined` — по умолчанию (свой muted, чужой
   * играет), `true` — заглушить (аудио играет в другом месте: Filmstrip).
   * Трек при этом НЕ отключается (`track.enabled` не трогаем).
   */
  muted?: boolean;
}

function VideoTileView({ tile, stage, compact, single, pinned, onPin, muted }: VideoTileViewProps) {
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
        "glass-tile group relative min-h-0 overflow-hidden rounded-2xl bg-ink-900/80 transition-[box-shadow,transform] duration-300",
        stage ? "h-full w-full" : compact ? "aspect-video w-full" : single ? "h-full" : "aspect-video w-full",
        tile.speaking && "speaking-ring",
        pinned && "ring-2 ring-brand-400/70",
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted ?? tile.isLocal}
        className={cn(
          "h-full w-full bg-black object-cover transition-opacity duration-300",
          !hasVideo && "invisible",
          tile.isLocal && !tile.screenOn && "scale-x-[-1]",
        )}
      />

      {/* Аватар, когда камера (или экран) выключены */}
      {!hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-ink-800 to-ink-950">
          <div
            className={cn(
              "flex items-center justify-center rounded-full bg-brand-gradient font-semibold text-white shadow-glow",
              compact ? "h-9 w-9 text-xs" : "h-20 w-20 text-2xl sm:h-24 sm:w-24",
            )}
          >
            {getInitials(tile.name) || "?"}
          </div>
        </div>
      )}

      {/* Закрепить спикера */}
      {onPin && !stage && (
        <button
          type="button"
          onClick={() => onPin(tile.id)}
          aria-pressed={pinned}
          aria-label={pinned ? `Открепить спикера: ${tile.name}` : `Закрепить спикера: ${tile.name}`}
          title={pinned ? "Открепить спикера" : "Закрепить спикера"}
          className={cn(
            "absolute right-2 top-2 z-10 inline-flex items-center justify-center rounded-lg border backdrop-blur transition",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70",
            compact ? "h-6 w-6" : "h-8 w-8",
            pinned
              ? "border-brand-400/60 bg-brand-500/30 text-white"
              : "border-white/10 bg-black/45 text-slate-200 hover:bg-black/70 hover:text-white",
          )}
        >
          {pinned ? (
            <PinOff className={compact ? "h-3 w-3" : "h-4 w-4"} />
          ) : (
            <Pin className={compact ? "h-3 w-3" : "h-4 w-4"} />
          )}
        </button>
      )}

      {/* Подпись и индикаторы */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/75 to-transparent",
          compact ? "px-2 pb-1.5 pt-6" : "px-3 pb-2.5 pt-8",
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate font-medium text-white", compact ? "text-[11px]" : "text-sm")}>
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
          <span
            className={cn(
              "inline-flex items-center justify-center rounded-full bg-amber-400/20 text-amber-300",
              compact ? "h-4 w-4" : "h-6 w-6",
            )}
          >
            <Hand className={compact ? "h-2.5 w-2.5" : "h-3.5 w-3.5"} />
          </span>
        )}
        {!tile.audioOn && (
          <span
            className={cn(
              "inline-flex items-center justify-center rounded-full bg-rose-500/20 text-rose-300",
              compact ? "h-4 w-4" : "h-6 w-6",
            )}
          >
            <MicOff className={compact ? "h-2.5 w-2.5" : "h-3.5 w-3.5"} />
          </span>
        )}
      </div>

      {isConnecting && (
        <div
          className={cn(
            "absolute left-3 top-3 rounded-full border bg-black/50 px-2.5 py-1 text-[11px] backdrop-blur",
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
