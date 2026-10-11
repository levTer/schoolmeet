"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Copy, KeyRound, Sparkles } from "lucide-react";

import { FormAlert } from "@/components/ui/form-alert";
import { GradientButton } from "@/components/ui/gradient-button";
import { TextField } from "@/components/ui/field";
import { isValidRoomCode } from "@/lib/realtime";

interface CreatedMeeting {
  title: string;
  meetingCode: string;
}

interface CreateMeetingResponse {
  ok: boolean;
  error?: string;
  fields?: { title?: string };
  data?: { meeting: { title: string; meetingCode: string } };
}

/**
 * Лобби раздела «Урок»: учитель создаёт урок и получает код, ученик вводит код.
 * Код: `isValidRoomCode` — тот же формат, что проверяет сервер.
 */
export function MeetingLobby({ canHost }: { canHost: boolean }) {
  const router = useRouter();

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_1fr]">
      <section className="ring-gradient animate-fade-up h-fit rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-glow backdrop-blur-2xl">
        {canHost ? <CreateLessonCard onOpen={(code) => router.push(`/meeting/${code}`)} /> : <JoinByCodeCard onJoin={(code) => router.push(`/meeting/${code}`)} />}
      </section>

      <div className="space-y-5">
        <section className="glass-card rounded-3xl p-6">
          <h2 className="text-lg font-semibold text-white">Что будет в комнате</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              { title: "HD-видео", text: "Прямое соединение WebRTC: камера, микрофон и демонстрация экрана." },
              { title: "Сетка участников", text: "Раскладка 1 / 2 / 4 / 9 участников и подсветка того, кто говорит." },
              { title: "Чат класса", text: "Сообщения шифруются AES-256 на устройстве до отправки." },
              { title: "Поднятая рука", text: "Запрос слова с отметкой на плитке участника." },
            ].map(({ title, text }) => (
              <li key={title} className="glass-tile rounded-2xl p-4">
                <p className="text-sm font-medium text-white">{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">{text}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function CreateLessonCard({ onOpen }: { onOpen: (code: string) => void }) {
  const [title, setTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [created, setCreated] = useState<CreatedMeeting | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setFieldError(undefined);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const payload = (await response.json().catch(() => null)) as CreateMeetingResponse | null;

      if (!response.ok || !payload?.ok || !payload.data) {
        setFieldError(payload?.fields?.title);
        setError(payload?.error ?? "Не удалось создать урок. Попробуйте позже.");
        return;
      }

      setCreated(payload.data.meeting);
    } catch {
      setError("Нет связи с сервером. Проверьте интернет.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyLink = async () => {
    if (!created) return;
    const url = `${window.location.origin}/meeting/${created.meetingCode}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Не удалось скопировать. Скопируйте код вручную.");
    }
  };

  if (created) {
    return (
      <div className="animate-fade-up space-y-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
          <Sparkles className="h-4 w-4 text-accent-300" />
          Урок создан
        </h2>
        <div className="rounded-2xl border border-accent-400/25 bg-accent-500/[0.07] p-5">
          <p className="text-xs uppercase tracking-wider text-slate-400">{created.title}</p>
          <p className="mt-2 break-all font-mono text-2xl font-semibold tracking-tight text-white">
            {created.meetingCode}
          </p>
        </div>
        <div className="grid gap-2">
          <GradientButton icon={ArrowRight} onClick={() => onOpen(created.meetingCode)}>
            Открыть урок
          </GradientButton>
          <button
            type="button"
            onClick={copyLink}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/10"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            {copied ? "Ссылка скопирована" : "Скопировать ссылку для учеников"}
          </button>
          <button
            type="button"
            onClick={() => {
              setCreated(null);
              setTitle("");
            }}
            className="text-xs text-slate-400 transition hover:text-white"
          >
            Создать ещё один урок
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
        <Sparkles className="h-4 w-4" />
        Создание урока
      </h2>

      {error && <FormAlert variant="error">{error}</FormAlert>}

      <TextField
        label="Название урока"
        name="title"
        placeholder="Математика 101"
        autoComplete="off"
        maxLength={80}
        value={title}
        error={fieldError}
        hint="Из названия появится короткий код, например matematika-101"
        onChange={(event) => {
          setTitle(event.target.value);
          setFieldError(undefined);
        }}
      />

      <GradientButton type="submit" loading={isSubmitting} loadingText="Создаём урок…" icon={Sparkles}>
        Создать урок
      </GradientButton>
    </form>
  );
}

function JoinByCodeCard({ onJoin }: { onJoin: (code: string) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = code.trim().toLowerCase();

    if (!isValidRoomCode(normalized)) {
      setError("Код урока состоит из латинских букв, цифр и дефисов, например math-101");
      return;
    }

    onJoin(normalized);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
        <KeyRound className="h-4 w-4" />
        Вход по коду
      </h2>

      {error && <FormAlert variant="error">{error}</FormAlert>}

      <TextField
        label="Код урока"
        name="code"
        placeholder="matematika-101"
        autoComplete="off"
        spellCheck={false}
        className="font-mono tracking-wide"
        value={code}
        onChange={(event) => {
          setCode(event.target.value);
          setError(null);
        }}
      />

      <GradientButton type="submit" icon={ArrowRight}>
        Подключиться к уроку
      </GradientButton>
    </form>
  );
}
