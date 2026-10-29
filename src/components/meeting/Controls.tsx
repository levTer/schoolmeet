"use client";

import type { ReactNode } from "react";
import {
  Hand,
  LayoutPanelTop,
  Mic,
  MicOff,
  MessageSquare,
  MonitorOff,
  MonitorUp,
  Video,
  VideoOff,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { CallRoomControls } from "@/components/CallRoom/CallRoomControls";

export interface ControlsProps {
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  hasMic: boolean;
  hasCamera: boolean;
  chatOpen: boolean;
  unreadCount: number;
  boardOpen: boolean;
  handRaised: boolean;
  raisedHandsCount: number;
  /** Идёт ли локальная запись урока. */
  recording: boolean;
  /** Поддерживает ли браузер запись (MediaRecorder). */
  recordingSupported: boolean;
  /** Сколько секунд идёт запись — для таймера на кнопке. */
  recordingSeconds: number;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreen: () => void;
  onToggleChat: () => void;
  onToggleBoard: () => void;
  onToggleHand: () => void;
  onToggleRecording: () => void;
  onLeave: () => void;
  isHost: boolean;
  isAdmin?: boolean;
  participantCount: number;
  endingCall: boolean;
  onEndForAll: () => void;
}

/** Таймер записи: «12:05» (минуты:секунды). */
function formatRecordingTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/**
 * Нижняя панель звонка: микрофон, камера, демонстрация экрана, чат, доска,
 * поднятая рука и красная кнопка выхода. Подсказки — по наведению и фокусу.
 */
export function Controls(props: ControlsProps) {
  const {
    micOn,
    camOn,
    screenOn,
    hasMic,
    hasCamera,
    chatOpen,
    unreadCount,
    boardOpen,
    handRaised,
    raisedHandsCount,
    recording,
    recordingSupported,
    recordingSeconds,
    onToggleMic,
    onToggleCamera,
    onToggleScreen,
    onToggleChat,
    onToggleBoard,
    onToggleHand,
    onToggleRecording,
    onLeave,
    isHost,
    isAdmin,
    participantCount,
    endingCall,
    onEndForAll,
  } = props;

  return (
    <div className="meeting-controls glass-strong flex flex-wrap items-center justify-center gap-1.5 rounded-3xl px-2 py-2 sm:gap-3 sm:px-4 sm:py-2.5 shadow-glow">
      <ControlButton
        label={!hasMic ? "Микрофон недоступен" : micOn ? "Выключить микрофон" : "Включить микрофон"}
        active={micOn && hasMic}
        onClick={onToggleMic}
        icon={micOn && hasMic ? Mic : MicOff}
        danger={!micOn || !hasMic}
      />

      <ControlButton
        label={!hasCamera && !camOn ? "Камера недоступна" : camOn ? "Выключить камеру" : "Включить камеру"}
        active={camOn}
        onClick={onToggleCamera}
        icon={camOn ? Video : VideoOff}
        danger={!camOn}
      />

      <ControlButton
        label={screenOn ? "Остановить демонстрацию" : "Демонстрация экрана"}
        active={screenOn}
        highlight
        onClick={onToggleScreen}
        icon={screenOn ? MonitorOff : MonitorUp}
      />

      {/* Локальная запись урока: красная точка + таймер */}
      <button
        type="button"
        onClick={onToggleRecording}
        disabled={!recordingSupported}
        aria-pressed={recording}
        aria-label={recording ? "Остановить запись урока" : "Записать урок на компьютер"}
        className={cn(
          "group relative inline-flex h-11 items-center gap-2 rounded-2xl border px-3 transition duration-200",
          "focus:outline-none focus-visible:ring-4 focus-visible:ring-rose-500/30",
          "disabled:cursor-not-allowed disabled:opacity-40",
          recording
            ? "border-rose-400/50 bg-rose-500/20 text-rose-100"
            : "border-white/10 bg-white/[0.05] text-slate-200 hover:border-white/20 hover:bg-white/10 hover:text-white",
        )}
      >
        <span
          aria-hidden
          className={cn("h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500", recording && "animate-pulse")}
        />
        <span className="hidden whitespace-nowrap text-xs font-medium sm:inline">
          {recording ? `Запись ${formatRecordingTime(recordingSeconds)}` : "Запись"}
        </span>
        <Tooltip>
          {recording
            ? "Остановить запись — файл скачается на компьютер"
            : "Записать урок на компьютер (WebM)"}
        </Tooltip>
      </button>

      <div className="mx-0.5 hidden h-8 w-px bg-white/10 sm:block" />

      <ControlButton
        label={chatOpen ? "Скрыть чат" : "Открыть чат"}
        active={chatOpen}
        onClick={onToggleChat}
        icon={MessageSquare}
        badge={!chatOpen && unreadCount > 0 ? unreadCount : undefined}
      />

      <ControlButton
        label={boardOpen ? "Скрыть доску" : "Открыть доску"}
        active={boardOpen}
        highlight={boardOpen}
        onClick={onToggleBoard}
        icon={LayoutPanelTop}
      />

      <ControlButton
        label={handRaised ? "Опустить руку" : "Поднять руку"}
        active={handRaised}
        highlight={handRaised}
        onClick={onToggleHand}
        icon={Hand}
        badge={raisedHandsCount > 0 ? raisedHandsCount : undefined}
        badgeTone="amber"
      />

      <div className="mx-0.5 hidden h-8 w-px bg-white/10 sm:block" />

      <CallRoomControls
        isHost={isHost}
        isAdmin={isAdmin}
        participantCount={participantCount}
        ending={endingCall}
        onEndForAll={onEndForAll}
        onLeave={onLeave}
      />
    </div>
  );
}

interface ControlButtonProps {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  active?: boolean;
  /** Подсветка фиолетово-синим (демонстрация экрана, поднятая рука). */
  highlight?: boolean;
  /** Красный фон — выключенный микрофон или камера. */
  danger?: boolean;
  disabled?: boolean;
  badge?: number;
  badgeTone?: "rose" | "amber";
}

function ControlButton({
  label,
  icon: Icon,
  onClick,
  active,
  highlight,
  danger,
  disabled,
  badge,
  badgeTone = "rose",
}: ControlButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "group relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border transition duration-200",
        "focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40",
        "disabled:cursor-not-allowed disabled:opacity-40",
        highlight && active
          ? "border-accent-400/50 bg-brand-gradient text-white shadow-glow"
          : danger
            ? "border-rose-400/25 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
            : active
              ? "border-white/15 bg-white/15 text-white hover:bg-white/20"
              : "border-white/10 bg-white/[0.05] text-slate-200 hover:border-white/20 hover:bg-white/10 hover:text-white",
      )}
    >
      <Icon className="h-5 w-5" />
      <Tooltip>{label}</Tooltip>

      {badge !== undefined && (
        <span
          className={cn(
            "absolute -right-1 -top-1 flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow-lg",
            badgeTone === "amber" ? "bg-amber-400 text-ink-950" : "bg-accent-600",
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function Tooltip({ children }: { children: ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 mb-3 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-ink-900/95 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-glow backdrop-blur-xl transition duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {children}
    </span>
  );
}
