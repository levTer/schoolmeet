"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Lock, Send, ShieldAlert, UserRound, X } from "lucide-react";

import { CHAT_RECIPIENT_EVERYONE, describePrivateMessage } from "@/lib/chat-rules";
import { cn, getInitials } from "@/lib/utils";
import { ROLE_LABELS, type Role } from "@/types";

export const CHAT_MAX_MESSAGE_LENGTH = 1000;

/** Адресат приватного сообщения — участник текущего урока. */
export interface ChatRecipientOption {
  userId: string;
  name: string;
}

/** Сообщение, уже расшифрованное на клиенте. `text = null` — расшифровать не удалось. */
export interface ChatViewMessage {
  id: string;
  text: string | null;
  createdAt: string;
  author: { userId: string; name: string; role: Role };
  /** `null` — публичное сообщение для всей комнаты. */
  recipient: ChatRecipientOption | null;
}

interface ChatProps {
  messages: ChatViewMessage[];
  selfUserId: string;
  /** Участники урока, которым можно написать приватно (без самого автора). */
  recipients: ChatRecipientOption[];
  onSend: (text: string, recipientId: string | null) => Promise<boolean>;
  onTyping?: () => void;
  typingNames?: string[];
  onClose: () => void;
}

/**
 * Боковая панель чата урока. Сообщение шифруется AES-256 до отправки и
 * расшифровывается здесь же; сервер хранит и пересылает только шифротекст.
 */
export function Chat({ messages, selfUserId, recipients, onSend, onTyping, typingNames = [], onClose }: ChatProps) {
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** `null` — «Всем» (публичное сообщение), иначе id участника урока. */
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastTypingAtRef = useRef(0);

  const recipient = useMemo(
    () => recipients.find((item) => item.userId === recipientId) ?? null,
    [recipients, recipientId],
  );

  // Адресат вышел из урока — возвращаемся к «Всем», чтобы не отправить в пустоту.
  useEffect(() => {
    if (recipientId === null) return;
    if (!recipients.some((item) => item.userId === recipientId)) setRecipientId(null);
  }, [recipients, recipientId]);

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
    const ok = await onSend(text, recipientId);
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
        {typingNames.length > 0 && (
          <p className="text-[11px] text-slate-500" aria-live="polite">
            {typingNames.join(", ")} {typingNames.length === 1 ? "печатает…" : "печатают…"}
          </p>
        )}
      </div>

      <form onSubmit={submit} className="border-t border-white/10 p-3">
        {error && <p className="mb-2 text-xs text-rose-300">{error}</p>}

        {/* Кому пишем: «Всем» или конкретному участнику урока. */}
        <div className="mb-2 flex items-center gap-2">
          <label
            htmlFor="chat-recipient"
            className="inline-flex shrink-0 items-center gap-1 text-[11px] text-slate-500"
          >
            {recipient ? <Lock className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}
            Кому
          </label>
          <select
            id="chat-recipient"
            value={recipientId ?? CHAT_RECIPIENT_EVERYONE}
            onChange={(event) =>
              setRecipientId(event.target.value === CHAT_RECIPIENT_EVERYONE ? null : event.target.value)
            }
            disabled={recipients.length === 0}
            aria-label="Адресат сообщения"
            className={cn(
              "min-w-0 flex-1 rounded-xl border bg-white/[0.04] px-2.5 py-1.5 text-[11px] outline-none transition",
              "disabled:cursor-not-allowed disabled:opacity-50",
              recipient
                ? "border-indigo-400/40 text-indigo-100 focus:border-indigo-300/70 focus:ring-4 focus:ring-indigo-500/15"
                : "border-white/10 text-slate-300 focus:border-accent-400/60 focus:ring-4 focus:ring-accent-500/15",
            )}
          >
            <option value={CHAT_RECIPIENT_EVERYONE} className="bg-ink-900">
              Всем
            </option>
            {recipients.map((item) => (
              <option key={item.userId} value={item.userId} className="bg-ink-900">
                🔒 {item.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => {
              const nextDraft = event.target.value.slice(0, CHAT_MAX_MESSAGE_LENGTH);
              setDraft(nextDraft);
              const now = Date.now();
              if (nextDraft.trim() && now - lastTypingAtRef.current >= 3000) {
                lastTypingAtRef.current = now;
                onTyping?.();
              }
            }}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={recipient ? `Приватно для ${recipient.name}…` : "Написать сообщение…"}
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
  const recipient = message.recipient;
  const isPrivate = recipient !== null;
  /* Своё приватное — «Приватно для [адресат]», чужое — «Приватно от [автор]». */
  const privateCaption = recipient
    ? describePrivateMessage({
        isMine: mine,
        counterpartName: mine ? recipient.name : message.author.name,
      })
    : null;

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

        {isPrivate && (
          <p
            className={cn(
              "mb-1 flex items-center gap-1 text-[10px] font-medium text-indigo-300",
              mine && "justify-end",
            )}
          >
            <span aria-hidden>🔒</span>
            {privateCaption}
          </p>
        )}

        {message.text === null ? (
          <p className="inline-flex items-center gap-1.5 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            <ShieldAlert className="h-3.5 w-3.5" />
            Не удалось расшифровать сообщение
          </p>
        ) : (
          <p
            className={cn(
              "inline-block whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-left text-sm leading-relaxed",
              mine && "rounded-tr-md",
              !mine && "rounded-tl-md",
              // Приватное сообщение визуально отличается от общего чата.
              isPrivate
                ? "border border-indigo-400/30 bg-indigo-900/40 text-indigo-50"
                : mine
                  ? "bg-brand-gradient text-white shadow-glow"
                  : "border border-white/10 bg-white/[0.05] text-slate-100 backdrop-blur-xl",
            )}
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
