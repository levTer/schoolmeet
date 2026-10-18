"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, KeyRound, ShieldAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { MeetingRoom } from "@/components/meeting/MeetingRoom";
import { FormAlert } from "@/components/ui/form-alert";
import { GradientButton } from "@/components/ui/gradient-button";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/field";
import type { Role } from "@/types";

/**
 * Ввод в урок чужого класса строгой школы по КОДУ КЛАССА (H-02).
 *
 * Страница `/meeting/[id]` рендерит этот компонент, когда `checkMeetingAccess`
 * отдал `CLASS_FORBIDDEN` и школа строгая (`strictClassIsolation = true`).
 * Учителя и администраторы (включая тестовых `admin@schoolmeet.ru` /
 * `fullhouse@schoolmeet.ru`) сюда не попадают — им доступ открыт всегда.
 *
 * Сценарий:
 *  1. ученик вводит код класса, который дал учитель (`Class.code`);
 *  2. `POST /api/meetings/[code]/class-access` сверяет код и выдаёт
 *     подписанный ОДНОРАЗОВЫЙ допуск (HMAC, час жизни, привязан к
 *     пользователю, классу и комнате — `src/lib/class-code.ts`);
 *  3. допуск сохраняется в `sessionStorage` (переживает F5) и вместе с ним
 *     комната запрашивает ключ чата (`GET /api/meetings/[code]?grant=…`);
 *  4. комната монтируется, допуск повторно отправляется при входе в сокет
 *     (`join-room`), в том числе при переподключении.
 */
export interface ClassCodeGateProps {
  meetingCode: string;
  title: string;
  hostName: string;
  self: { id: string; name: string; role: Role };
}

interface GateMeetingData {
  id: string;
  title: string;
  meetingCode: string;
  hostName: string;
  encryptionKey: string;
}

const grantStorageKey = (meetingCode: string) => `schoolmeet:class-grant:${meetingCode}`;

export function ClassCodeGate({ meetingCode, title, hostName, self }: ClassCodeGateProps) {
  const [entered, setEntered] = useState<GateMeetingData | null>(null);
  const [grant, setGrant] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"idle" | "checking" | "submitting">("idle");

  /** Запрашивает данные комнаты с разовым допуском и монтирует MeetingRoom. */
  const enterWithGrant = useCallback(
    async (token: string): Promise<boolean> => {
      const response = await fetch(
        `/api/meetings/${encodeURIComponent(meetingCode)}?grant=${encodeURIComponent(token)}`,
        { credentials: "same-origin" },
      );
      const payload = (await response.json().catch(() => null)) as {
        ok: boolean;
        error?: string;
        data?: { meeting: GateMeetingData };
      } | null;

      if (response.ok && payload?.ok && payload.data?.meeting) {
        setEntered(payload.data.meeting);
        return true;
      }

      // Допуск истёк или отозван — чистим сохранённый токен, просим код снова.
      try {
        sessionStorage.removeItem(grantStorageKey(meetingCode));
      } catch {
        /* приватный режим — не критично */
      }
      setGrant(null);
      setError(payload?.error ?? "Допуск по коду класса больше не действителен.");
      return false;
    },
    [meetingCode],
  );

  // При загрузке страницы: если допуск ещё жив в sessionStorage — входим сразу.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let saved: string | null = null;
      try {
        saved = sessionStorage.getItem(grantStorageKey(meetingCode));
      } catch {
        saved = null;
      }
      if (!saved) return;
      setBusy("checking");
      const ok = await enterWithGrant(saved);
      if (!cancelled) {
        if (ok) setGrant(saved);
        setBusy("idle");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enterWithGrant, meetingCode]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!normalized) {
      setError("Введите код класса, который дал учитель.");
      return;
    }

    setBusy("submitting");
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${encodeURIComponent(meetingCode)}/class-access`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classCode: normalized }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok: boolean;
        error?: string;
        data?: { grant: string | null; reason: string; className?: string | null };
      } | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Не удалось проверить код класса. Попробуйте позже.");
        return;
      }

      // Доступ уже был (свой класс / учитель / админ) — допуск не нужен.
      if (!payload.data || !payload.data.grant) {
        const className = payload.data?.className ?? null;
        toast.success(className ? `Класс: ${className}` : "Доступ открыт");
        // Без grant данные комнаты отдаёт обычный GET доступа.
        const plain = await fetch(`/api/meetings/${encodeURIComponent(meetingCode)}`, {
          credentials: "same-origin",
        });
        const plainPayload = (await plain.json().catch(() => null)) as {
          ok: boolean;
          data?: { meeting: GateMeetingData };
        } | null;
        if (plain?.ok && plainPayload?.data?.meeting) {
          setEntered(plainPayload.data.meeting);
        } else {
          setError("Не удалось открыть комнату. Обновите страницу.");
        }
        return;
      }

      const issued = payload.data.grant;
      setGrant(issued);
      try {
        sessionStorage.setItem(grantStorageKey(meetingCode), issued);
      } catch {
        /* приватный режим — допуск работает до размонтирования */
      }
      if (payload.data.className) {
        toast.success(`Класс подтверждён: ${payload.data.className}`);
      }
      await enterWithGrant(issued);
    } catch {
      setError("Нет связи с сервером. Проверьте интернет.");
    } finally {
      setBusy("idle");
    }
  };

  if (entered) {
    return (
      <MeetingRoom
        meetingCode={entered.meetingCode}
        title={entered.title}
        hostName={entered.hostName}
        encryptionKey={entered.encryptionKey}
        self={self}
        classCodeGrant={grant}
      />
    );
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-ink-950 px-5 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="absolute left-1/4 top-0 h-[28rem] w-[28rem] rounded-full bg-brand-600/20 blur-[150px]" />
      </div>

      <Modal
        open
        onClose={() => undefined} // закрытие — только через ссылки ниже
        disableClose
        labelledBy="class-code-gate-title"
        describedBy="class-code-gate-description"
      >
        <div className="space-y-5 p-6 text-left sm:p-8">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow">
            <ShieldAlert className="h-6 w-6 text-white" />
          </span>

          <div>
            <h1 id="class-code-gate-title" className="text-xl font-semibold text-white">
              Урок другого класса
            </h1>
            <p id="class-code-gate-description" className="mt-2 text-sm leading-relaxed text-slate-400">
              Комната <span className="font-mono text-slate-200">{meetingCode}</span> ({title},{" "}
              {hostName}) принадлежит другому классу вашей школы. Школа работает в строгом режиме:
              чтобы войти, введите код класса, который дал учитель.
            </p>
          </div>

          <form onSubmit={(event) => void submit(event)} noValidate className="space-y-4">
            {error && <FormAlert variant="error">{error}</FormAlert>}

            <TextField
              label="Код класса"
              name="classCode"
              placeholder="5B-K7QZM4"
              autoComplete="off"
              spellCheck={false}
              className="font-mono tracking-wide"
              value={code}
              onChange={(event) => {
                setCode(event.target.value.toUpperCase());
                setError(null);
              }}
            />

            <GradientButton
              type="submit"
              loading={busy !== "idle"}
              loadingText="Проверяем код…"
              icon={KeyRound}
            >
              Войти с кодом класса
            </GradientButton>
          </form>

          <div className="flex items-center gap-3 border-t border-white/10 pt-4">
            <Link
              href="/meeting"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4" />
              К урокам
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10"
            >
              <Sparkles className="h-4 w-4" />
              В кабинет
            </Link>
          </div>
        </div>
      </Modal>
    </main>
  );
}
