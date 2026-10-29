"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { ChevronDown, GraduationCap, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

/**
 * Быстрое переключение класса ученика (Navbar).
 *
 * Гибкая школа (`strictClassIsolation = false`) — выпадающий список (Select)
 * всех классов школы: ученик сам выбирает класс, в уроки которого заходит
 * (в гибкой школе открыты ВСЕ уроки школы, класс задаёт контекст ДЗ и
 * расписания). Строгая школа — только бейдж текущего класса: переключение
 * делает администратор (вход в чужой класс — через код класса,
 * `ClassCodeGate`).
 *
 * Смена класса: `POST /api/classes/membership` (сервер проверяет, что класс
 * принадлежит школе ученика) → `session.update()` перечитывает JWT из БД.
 * Версию сессии НЕ поднимает: класс — не привилегия (доступ к урокам
 * всё равно проверяется по «живой» записи из БД), а вот bump версии
 * аннулировал бы активный токен (SESSION_EXPIRED).
 */
interface ClassOption {
  id: string;
  name: string;
  grade: string | null;
}

interface ClassesResponse {
  classes: ClassOption[];
  currentClassId: string | null;
  strictClassIsolation: boolean;
}

interface MembershipResponse {
  ok: boolean;
  error?: string;
  data?: { classId: string; className: string };
}

export function ClassSwitcher({ className }: { className?: string }) {
  const { data: session, update } = useSession();
  const role = session?.user?.role;
  const schoolId = session?.user?.schoolId;
  const currentClassId = session?.user?.classId ?? null;

  const [data, setData] = useState<ClassesResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;

    fetch("/api/classes", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        if (cancelled) return;
        const body = payload as { ok: boolean; data?: ClassesResponse } | null;
        if (!body?.ok || !body.data) {
          setFailed(true);
          return;
        }
        setData(body.data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  // Только ученики переключают класс; остальным компонент ничего не показывает.
  if (role !== "STUDENT" || !schoolId) return null;
  if (failed || !data) return null;

  const current = data.classes.find((item) => item.id === currentClassId) ?? null;

  /** Класс не переключается — показываем бейдж вместо пустого списка. */
  const badge = (title: string) => (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-300",
        className,
      )}
    >
      <GraduationCap className="h-4 w-4 text-accent-300" />
      {current?.name ?? "Без класса"}
    </span>
  );

  /** Строгая школа: класс задаёт администрация, показываем бейдж. */
  if (data.strictClassIsolation) {
    return badge("Строгая школа: класс назначается администратором. Вход в чужой класс — по коду класса.");
  }

  /**
   * Одноклассная школа («Общий» класс, «Школа Душа»): переключать нечего —
   * селект с единственным вариантом только путает.
   */
  if (data.classes.length <= 1) {
    return badge("В школе один общий класс — выбирать нечего.");
  }

  const handleChange = async (nextClassId: string) => {
    if (!nextClassId || nextClassId === currentClassId || busy) return;

    setBusy(true);
    try {
      const response = await fetch("/api/classes/membership", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId: nextClassId }),
      });
      const payload = (await response.json().catch(() => null)) as MembershipResponse | null;

      if (!response.ok || !payload?.ok) {
        toast.error(payload?.error ?? "Не удалось сменить класс");
        return;
      }

      toast.success(`Класс: ${payload.data?.className ?? "обновлён"}`);
      // Перечитать JWT из БД (новый classId) — без аннулирования сессии.
      try {
        await update();
      } catch {
        /* токен всё равно обновится при следующей сверке (≤ 60 c) */
      }
    } catch {
      toast.error("Нет связи с сервером. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <label
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] py-1.5 pl-3 pr-2 transition hover:border-white/20",
        className,
      )}
      title="Сменить класс (гибкая школа: открыты все уроки школы)"
    >
      <GraduationCap className="h-4 w-4 shrink-0 text-accent-300" />
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      ) : (
        <span className="relative inline-flex items-center">
          <select
            value={currentClassId ?? ""}
            onChange={(event) => void handleChange(event.target.value)}
            aria-label="Мой класс"
            className="max-w-[7.5rem] cursor-pointer appearance-none bg-transparent pr-5 text-xs font-medium text-slate-200 outline-none"
          >
            {!currentClassId && <option value="">Класс не выбран</option>}
            {data.classes.map((item) => (
              <option key={item.id} value={item.id} className="bg-ink-900 text-slate-200">
                {item.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-0 h-3.5 w-3.5 text-slate-500 transition group-hover:text-slate-300" />
        </span>
      )}
    </label>
  );
}
