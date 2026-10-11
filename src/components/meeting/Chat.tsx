"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Lock, Send, ShieldAlert, X } from "lucide-react";

import { cn, getInitials } from "@/lib/utils";
import { ROLE_LABELS, type Role } from "@/types";

export const CHAT_MAX_MESSAGE_LENGTH = 1000;

/** Сообщение, уже расшифрованное на клиенте. `text = null` — расшифровать не удалось. */
export interface ChatViewMessage {
  id: string;
  text: string | null;
  createdAt: string;
  author: { userId: string; name: string; role: Role };
}

interface ChatProps {
  messages: ChatViewMessage[];
  selfUserId: string;
  onSend: (text: string) => Promise<boolean>;
  onClose: () => void;
}

/**
 * Боковая панель чата урока. Сообщение шифруется AES-256 до отправки и
 * расшифровывается здесь же; сервер хранит и пересылает только шифротекст.
 */
export function Chat({ messages, selfUserId, onSend, onClose }: ChatProps) {
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Прокручиваем вниз при каждом новом сообщении.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || isSending) return;

    setIsSending(true);
    setError(null);
    const ok = await onSend(text);
    setIsSending(false);

    if (ok) {
      setDraft("");
    } else {
      setError("Не удалось отправить. Проверьте соединение и попробуйте снова.");
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <aside className="glass-strong flex h-full min-h-0 w-full flex-col overflow-hidden rounded-3xl shadow-glow sm:w-80 lg:w-96">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-white">Чат урока</h2>
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-emerald-300/90">
            <Lock className="h-3 w-3" />
            AES-256 · шифрование на клиенте
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть чат"
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="mt-10 text-center text-xs leading-relaxed text-slate-500">
            Сообщений пока нет. Напишите первым — текст будет зашифрован до отправки.
          </p>
        )}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} mine={message.author.userId === selfUserId} />
        ))}
      </div>

      <form onSubmit={submit} className="border-t border-white/10 p-3">
        {error && <p className="mb-2 text-xs text-rose-300">{error}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, CHAT_MAX_MESSAGE_LENGTH))}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Написать сообщение…"
            aria-label="Текст сообщения"
            className="max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none transition focus:border-accent-400/60 focus:ring-4 focus:ring-accent-500/15"
          />
          <button
            type="submit"
            disabled={!draft.trim() || isSending}
            aria-label="Отправить"
            className={cn(
              "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-glow transition",
              "hover:scale-[1.04] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100",
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </aside>
  );
}

function MessageBubble({ message, mine }: { message: ChatViewMessage; mine: boolean }) {
  const time = new Date(message.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={cn("flex gap-2.5", mine && "flex-row-reverse")}>
      {!mine && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold text-white">
          {getInitials(message.author.name) || "?"}
        </div>
      )}

      <div className={cn("min-w-0 max-w-[80%]", mine && "text-right")}>
        <p className={cn("mb-1 flex items-center gap-1.5 text-[11px] text-slate-500", mine && "justify-end")}>
          <span className="truncate font-medium text-slate-300">{mine ? "Вы" : message.author.name}</span>
          <span>{ROLE_LABELS[message.author.role]}</span>
          <span>{time}</span>
        </p>

        {message.text === null ? (
          <p className="inline-flex items-center gap-1.5 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            <ShieldAlert className="h-3.5 w-3.5" />
            Не удалось расшифровать сообщение
          </p>
        ) : (
          <p
            className={cn(
              "inline-block whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-left text-sm leading-relaxed",
              mine
                ? "rounded-tr-md bg-brand-gradient text-white shadow-glow"
                : "rounded-tl-md border border-white/10 bg-white/[0.05] text-slate-100 backdrop-blur-xl",
            )}
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
