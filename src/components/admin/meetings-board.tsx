"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, LogIn, LogOut, PhoneOff, RefreshCw, Signal, Timer, Users } from "lucide-react";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";
import type { ActiveMeetingsSummary } from "@/lib/admin-meetings";
import type { AttendanceRow } from "@/lib/attendance";
import { canEndMeeting, meetingEndDenyReason, type AdminActor } from "@/lib/admin-permissions";
import { apiRequest } from "@/lib/client-api";
import { GRADE_LABELS } from "@/lib/schedule-rules";
import { cn, getInitials } from "@/lib/utils";
import { ROLE_LABELS } from "@/types";

interface MeetingsBoardProps {
  initialMeetings: ActiveMeetingsSummary;
  initialAttendance: { items: AttendanceRow[]; total: number };
  actor: AdminActor;
  /** Доступен ли просмотр посещаемости. */
  canViewAttendance: boolean;
}

const POLL_INTERVAL_MS = 10_000;
const ATTENDANCE_PAGE_SIZE = 25;

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return "меньше минуты";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} мин`;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

/**
 * Раздел «Активные звонки и посещаемость».
 *
 * Список уроков обновляется каждые 10 секунд (участники в комнате берутся из
 * живого Socket.IO-реестра), кнопка «Завершить урок» шлёт всем участникам
 * событие `room-closed` и закрывает записи посещаемости.
 */
export function MeetingsBoard({
  initialMeetings,
  initialAttendance,
  actor,
  canViewAttendance,
}: MeetingsBoardProps) {
  const router = useRouter();

  const [meetings, setMeetings] = useState(initialMeetings);
  const [attendance, setAttendance] = useState(initialAttendance);
  const [attendanceMeetingId, setAttendanceMeetingId] = useState<string | "ALL">("ALL");
  const [refreshing, setRefreshing] = useState(false);
  const [pendingEndId, setPendingEndId] = useState<string | null>(null);
  const [confirmEndId, setConfirmEndId] = useState<string | null>(null);

  const loadMeetings = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    const result = await apiRequest<ActiveMeetingsSummary>("/api/admin/meetings");
    if (showSpinner) setRefreshing(false);

    if (!result.ok) {
      if (showSpinner) toast.error(result.error);
      return;
    }
    setMeetings(result.data);
  }, []);

  const loadAttendance = useCallback(async (meetingId: string | "ALL") => {
    const params = new URLSearchParams({ limit: String(ATTENDANCE_PAGE_SIZE) });
    if (meetingId !== "ALL") params.set("meetingId", meetingId);

    const result = await apiRequest<{ items: AttendanceRow[]; total: number }>(
      `/api/admin/attendance?${params.toString()}`,
    );
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setAttendance({ items: result.data.items, total: result.data.total });
  }, []);

  /* Автообновление: список уроков и открытые записи посещаемости. */
  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadMeetings();
      void loadAttendance(attendanceMeetingId);
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [attendanceMeetingId, loadAttendance, loadMeetings]);

  const endMeeting = async (meetingId: string, title: string) => {
    setPendingEndId(meetingId);
    const result = await apiRequest<{ result: { closedSockets: number; closedAttendance: number } }>(
      `/api/admin/meetings/${meetingId}/end`,
      { method: "POST" },
    );
    setPendingEndId(null);
    setConfirmEndId(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    const { closedSockets, closedAttendance } = result.data.result;
    toast.success(
      `Урок «${title}» завершён: отключено участников — ${closedSockets}, закрыто записей — ${closedAttendance}`,
    );

    await Promise.all([loadMeetings(), loadAttendance(attendanceMeetingId)]);
    router.refresh();
  };

  return (
    <div className="space-y-6">
      {/* Текущие уроки */}
      <section className="glass-card overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-accent-400/25 bg-accent-500/10 text-accent-300">
              <Signal className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Активные звонки</h2>
              <p className="text-xs text-slate-500">
                Идёт сейчас: {meetings.totals.liveMeetings} · учеников в комнатах: {meetings.totals.students}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadMeetings(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs text-slate-300 transition hover:bg-white/10"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Обновить
          </button>
        </header>

        {meetings.items.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-slate-400">
            Сейчас нет активных уроков. Как только учитель начнёт занятие, оно появится здесь.
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {meetings.items.map((meeting) => {
              const denyReason = meetingEndDenyReason(actor, { hostId: meeting.host.id });
              const canEnd = canEndMeeting(actor, { hostId: meeting.host.id });
              const confirming = confirmEndId === meeting.id;

              return (
                <li key={meeting.id} className="flex flex-wrap items-center gap-4 px-6 py-4 transition hover:bg-white/[0.02]">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                          meeting.isLive
                            ? "border-rose-400/30 bg-rose-500/15 text-rose-200"
                            : "border-amber-400/25 bg-amber-500/10 text-amber-200",
                        )}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full", meeting.isLive ? "animate-pulse bg-rose-400" : "bg-amber-400")} />
                        {meeting.isLive ? "Идёт сейчас" : "Ожидает участников"}
                      </span>

                      <span className="font-mono text-[11px] text-slate-400">{meeting.meetingCode}</span>
                    </div>

                    <p className="mt-2 truncate text-sm font-medium text-white">{meeting.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>{meeting.host.name} · {ROLE_LABELS[meeting.host.role]}</span>
                      <span>{meeting.subject ?? "предмет не указан"}</span>
                      <span>{meeting.gradeLabel ?? "класс не определён"}</span>
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" />
                        с {formatDateTime(meeting.startedAt)}
                      </span>
                    </p>
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="text-center">
                      <p className="text-xl font-semibold tabular-nums text-white">{meeting.participants.students}</p>
                      <p className="text-[11px] uppercase tracking-wider text-slate-500">учеников</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-semibold tabular-nums text-white">{meeting.participants.total}</p>
                      <p className="text-[11px] uppercase tracking-wider text-slate-500">в комнате</p>
                    </div>
                    <div className="hidden text-center sm:block">
                      <p className="text-xl font-semibold tabular-nums text-white">{meeting.attendanceTotal}</p>
                      <p className="text-[11px] uppercase tracking-wider text-slate-500">входов всего</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {canEnd ? (
                      <button
                        type="button"
                        disabled={pendingEndId === meeting.id}
                        onClick={() => {
                          if (confirming) {
                            void endMeeting(meeting.id, meeting.title);
                            return;
                          }
                          setConfirmEndId(meeting.id);
                          window.setTimeout(
                            () => setConfirmEndId((current) => (current === meeting.id ? null : current)),
                            5000,
                          );
                        }}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition disabled:opacity-50",
                          confirming
                            ? "border-rose-400/60 bg-rose-500/30 text-white"
                            : "border-rose-400/25 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20",
                        )}
                      >
                        <PhoneOff className="h-3.5 w-3.5" />
                        {confirming ? "Подтвердить" : "Завершить урок"}
                      </button>
                    ) : (
                      <span className="rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-2.5 text-xs text-slate-500">
                        {denyReason ?? "Нет прав"}
                      </span>
                    )}

                    {canViewAttendance && (
                      <button
                        type="button"
                        onClick={() => {
                          setAttendanceMeetingId(meeting.id);
                          void loadAttendance(meeting.id);
                        }}
                        className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-xs text-slate-300 transition hover:bg-white/10"
                      >
                        <Users className="h-3.5 w-3.5" />
                        Посещаемость
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Посещаемость */}
      {canViewAttendance && (
        <section className="glass-card overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-6 py-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-brand-400/25 bg-brand-500/10 text-brand-300">
                <Timer className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Посещаемость</h2>
                <p className="text-xs text-slate-500">
                  Кто вошёл в урок, во сколько вышел и сколько минут пробыл
                  {attendanceMeetingId !== "ALL" && " (фильтр по уроку)"}
                </p>
              </div>
            </div>

            {attendanceMeetingId !== "ALL" && (
              <button
                type="button"
                onClick={() => {
                  setAttendanceMeetingId("ALL");
                  void loadAttendance("ALL");
                }}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs text-slate-300 transition hover:bg-white/10"
              >
                Показать все уроки
              </button>
            )}
          </header>

          {refreshing && attendance.items.length === 0 ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          ) : attendance.items.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-400">
              Записей пока нет: посещаемость появляется, когда участники заходят в урок.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-slate-500">
                  <tr className="border-b border-white/5">
                    <th className="px-6 py-3 font-medium">Ученик</th>
                    <th className="px-4 py-3 font-medium">Класс</th>
                    <th className="px-4 py-3 font-medium">Урок</th>
                    <th className="px-4 py-3 font-medium">Вошёл</th>
                    <th className="px-4 py-3 font-medium">Вышел</th>
                    <th className="px-6 py-3 font-medium">Длительность</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.items.map((row) => (
                    <tr key={row.id} className="border-b border-white/5 transition last:border-0 hover:bg-white/[0.03]">
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-[10px] font-semibold text-brand-contrast">
                            {getInitials(row.user.name) || "SM"}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-white">{row.user.name}</span>
                            <span className="block text-[11px] text-slate-500">{ROLE_LABELS[row.user.role]}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {row.user.grade ? GRADE_LABELS[row.user.grade] : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="block truncate text-slate-300">{row.meeting.title}</span>
                        <span className="block font-mono text-[11px] text-slate-500">{row.meeting.meetingCode}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        <span className="inline-flex items-center gap-1.5">
                          <LogIn className="h-3 w-3 text-emerald-400/70" />
                          {formatTime(row.joinedAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {row.isLive ? (
                          <span className="inline-flex items-center gap-1.5 text-accent-300">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-400" />в уроке
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            <LogOut className="h-3 w-3 text-rose-400/70" />
                            {formatTime(row.leftAt)}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                            row.isLive
                              ? "border-accent-400/30 bg-accent-500/10 text-accent-200"
                              : "border-white/10 bg-white/[0.04] text-slate-300",
                          )}
                        >
                          {row.isLive ? "идёт" : formatDuration(row.durationMinutes)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 px-6 py-4">
            <span className="text-xs text-slate-500">
              Всего записей: {attendance.total} · показаны последние {attendance.items.length}
            </span>
            <button
              type="button"
              onClick={() => void loadAttendance(attendanceMeetingId)}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Обновить посещаемость
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
