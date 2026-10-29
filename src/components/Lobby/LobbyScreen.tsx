"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneOff, Radio } from "lucide-react";
import { toast } from "sonner";

import { LobbyCallCard } from "@/components/Lobby/LobbyCallCard";
import { MeetingLobby } from "@/components/meeting/MeetingLobby";
import { Modal } from "@/components/ui/modal";
import { useSocket } from "@/hooks/useSocket";
import { canManageLessonEnd } from "@/lib/call-rules";
import type { ActiveCall } from "@/lib/realtime";
import type { Role } from "@/types";

interface ActiveCallsResponse {
  ok: boolean;
  data?: { calls: ActiveCall[] };
  error?: string;
}

/** Lobby screen: live call cards plus create/join forms. */
export function LobbyScreen({
  canHost,
  selfId,
  selfRole,
}: {
  canHost: boolean;
  selfId: string;
  selfRole?: Role;
}) {
  const router = useRouter();
  const [calls, setCalls] = useState<ActiveCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmCall, setConfirmCall] = useState<ActiveCall | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/meetings/active", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as ActiveCallsResponse | null;
      if (!mountedRef.current) return;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Не удалось загрузить активные звонки");
        return;
      }
      setCalls(payload.data?.calls ?? []);
      setError(null);
    } catch {
      if (mountedRef.current) setError("Нет связи с сервером. Показываем последние данные.");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const socket = useSocket({ onActiveCallsChanged: () => void refresh() });

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    void socket.watchLobby().catch(() => undefined);
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
    // socket methods are stable; refresh once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const endCall = async () => {
    if (!confirmCall) return;
    setEndingId(confirmCall.meetingId);

    try {
      const response = await fetch(`/api/meetings/${encodeURIComponent(confirmCall.meetingId)}/end`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

      if (!response.ok || !payload?.ok) {
        const ack = await socket.endCallForAll(confirmCall.roomId);
        if (!mountedRef.current) return;
        setEndingId(null);
        setConfirmCall(null);
        if (!ack.ok) {
          toast.error(payload?.error ?? ack.error);
          return;
        }
      } else {
        if (!mountedRef.current) return;
        setEndingId(null);
        setConfirmCall(null);
      }

      setCalls((prev) => prev.filter((item) => item.meetingId !== confirmCall.meetingId));
      toast.success("Урок завершён для всех участников");
      router.refresh();
      void refresh();
    } catch {
      if (!mountedRef.current) return;
      setEndingId(null);
      toast.error("Не удалось завершить урок. Попробуйте ещё раз.");
    }
  };

  return (
    <div className="space-y-8">
      <section aria-labelledby="active-calls-title">
        <div className="mb-4 flex items-center gap-2">
          <Radio className="h-5 w-5 text-rose-300" />
          <h2 id="active-calls-title" className="text-lg font-semibold text-white">Активные звонки</h2>
        </div>
        {error && <p className="mb-3 text-sm text-amber-300">{error}</p>}
        {loading ? (
          <p className="text-sm text-slate-400">Загружаем звонки…</p>
        ) : calls.length === 0 ? (
          <div className="glass-card rounded-3xl p-6 text-sm text-slate-400">
            Сейчас нет активных звонков. Создайте урок или подключитесь по коду.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {calls.map((call) => {
              const canEnd = selfRole
                ? canManageLessonEnd({ id: selfId, role: selfRole }, { hostId: call.hostId })
                : call.hostId === selfId;
              return (
                <LobbyCallCard
                  key={call.meetingId}
                  call={call}
                  isHost={canEnd}
                  ending={endingId === call.meetingId}
                  onEnd={setConfirmCall}
                />
              );
            })}
          </div>
        )}
      </section>

      <MeetingLobby canHost={canHost} />

      <Modal
        open={confirmCall !== null}
        onClose={() => { if (!endingId) setConfirmCall(null); }}
        disableClose={Boolean(endingId)}
        labelledBy="lobby-end-call-title"
        describedBy="lobby-end-call-description"
        portal
        className="sm:max-w-md"
      >
        {confirmCall && (
          <div className="space-y-5 p-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-300">
                <PhoneOff className="h-5 w-5" />
              </span>
              <h2 id="lobby-end-call-title" className="text-lg font-semibold text-white">
                Завершить этот урок для всех участников?
              </h2>
            </div>
            <p id="lobby-end-call-description" className="text-sm leading-relaxed text-slate-300">
              «{confirmCall.title}» будет остановлен для всех участников ({confirmCall.participantCount}).
              Комната будет закрыта.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmCall(null)}
                disabled={Boolean(endingId)}
                className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void endCall()}
                disabled={Boolean(endingId)}
                className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
              >
                {endingId ? "Завершаем…" : "Завершить урок"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
