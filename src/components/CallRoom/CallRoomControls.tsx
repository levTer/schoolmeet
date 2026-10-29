"use client";

import { useState } from "react";
import { LogOut, PhoneOff } from "lucide-react";

import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

export interface CallRoomControlsProps {
  isHost: boolean;
  participantCount: number;
  ending: boolean;
  onEndForAll: () => void;
  onLeave: () => void;
}

/** Host-only “end for all” plus a personal “leave”, with confirmation. */
export function CallRoomControls({ isHost, participantCount, ending, onEndForAll, onLeave }: CallRoomControlsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onLeave}
          disabled={ending}
          className="inline-flex h-11 items-center gap-2 rounded-2xl border border-white/15 bg-white/[0.06] px-4 text-sm font-semibold text-slate-100 transition hover:bg-white/10 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Покинуть</span>
        </button>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={!isHost || ending}
          aria-label="Завершить для всех"
          title={isHost ? "Завершить звонок для всех участников" : "Только организатор может завершить звонок для всех"}
          className={cn(
            "inline-flex h-11 items-center gap-2 rounded-2xl px-4 text-sm font-semibold text-white transition focus:outline-none focus-visible:ring-4 focus-visible:ring-rose-500/40",
            "bg-rose-600 shadow-[0_0_30px_-8px_rgba(244,63,94,0.8)] hover:bg-rose-500",
            "disabled:cursor-not-allowed disabled:bg-rose-900/50 disabled:text-rose-200/50 disabled:shadow-none",
          )}
        >
          <PhoneOff className="h-4 w-4" />
          <span className="hidden sm:inline">{ending ? "Завершаем…" : "Завершить для всех"}</span>
        </button>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => { if (!ending) setConfirmOpen(false); }}
        disableClose={ending}
        labelledBy="end-call-title"
        describedBy="end-call-description"
        portal
        className="sm:max-w-md"
      >
        <div className="space-y-5 p-6">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-300">
              <PhoneOff className="h-5 w-5" />
            </span>
            <h2 id="end-call-title" className="text-lg font-semibold text-white">Завершить звонок для всех?</h2>
          </div>
          <p id="end-call-description" className="text-sm leading-relaxed text-slate-300">
            Звонок будет остановлен для всех участников ({participantCount}). Камеры и микрофоны отключатся,
            комната будет закрыта. Это действие нельзя отменить.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={ending}
              className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => { setConfirmOpen(false); onEndForAll(); }}
              disabled={ending}
              className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
            >
              {ending ? "Завершаем…" : "Завершить для всех"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
