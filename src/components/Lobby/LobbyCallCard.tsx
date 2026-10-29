"use client";

import Link from "next/link";
import { Clock3, PhoneOff, Users, Video } from "lucide-react";

import { formatDuration, useElapsedSeconds } from "@/hooks/useElapsed";
import type { ActiveCall } from "@/lib/realtime";

export interface LobbyCallCardProps {
  call: ActiveCall;
  isHost: boolean;
  ending: boolean;
  onEnd: (call: ActiveCall) => void;
}

/** Live call card: status, elapsed time, participant count, join/end actions. */
export function LobbyCallCard({ call, isHost, ending, onEnd }: LobbyCallCardProps) {
  const elapsed = useElapsedSeconds(Date.parse(call.startedAt));

  return (
    <article className="glass-card flex flex-col gap-4 rounded-3xl border border-rose-400/20 p-5 shadow-glow">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-200">
          <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
          🔴 Идёт звонок
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-sm tabular-nums text-slate-200">
          <Clock3 className="h-3.5 w-3.5 text-accent-300" />
          {formatDuration(elapsed)}
        </span>
      </div>

      <div>
        <h3 className="text-base font-semibold text-white">{call.title}</h3>
        <p className="mt-1 text-xs text-slate-400">Организатор: {call.hostName}</p>
      </div>

      <div className="flex items-center gap-2 text-sm text-slate-300">
        <Users className="h-4 w-4 text-accent-300" />
        <span>{call.participantCount} {pluralParticipants(call.participantCount)}</span>
      </div>

      <div className="mt-auto flex flex-wrap gap-2">
        <Link
          href={`/meeting/${encodeURIComponent(call.meetingCode)}`}
          prefetch={false}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40"
        >
          <Video className="h-4 w-4" />
          Подключиться
        </Link>
        {isHost && (
          <button
            type="button"
            onClick={() => onEnd(call)}
            disabled={ending}
            aria-label="Завершить урок"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PhoneOff className="h-4 w-4" />
            {ending ? "Завершаем…" : "Завершить урок"}
          </button>
        )}
      </div>
    </article>
  );
}

function pluralParticipants(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "участник";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "участника";
  return "участников";
}
