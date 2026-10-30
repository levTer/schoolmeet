"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Crown, KeyRound, School } from "lucide-react";

import { copyToClipboard } from "@/lib/clipboard";

interface InviteLinksPanelProps {
  school: {
    name: string;
    code: string;
    /**
     * Токены приглашений в БД nullable (`String? @unique`), поэтому здесь
     * `string | null`: `null` — токен ещё не выпущен (сервер досоздаёт его сам,
     * см. `backfillSchoolInviteTokens`), ссылку показывать нельзя.
     */
    teacherInviteToken: string | null;
    adminInviteToken: string | null;
  };
}

type CopyKind = "teacher" | "admin" | null;

/** Текст вместо ссылки, если токен в БД отсутствует (nullable-колонка). */
const NO_TOKEN_HINT = "Токен не выпущен — обновите страницу: сервер создаёт его автоматически.";

/**
 * Раздел «Управление доступом и Ссылки-приглашения» админ-панели.
 *
 * Две секретные ссылки школы: регистрация учителей (`teacherInviteToken`)
 * и назначение администраторов (`adminInviteToken`). Токены не попадают в
 * серверный HTML-рендер как абсолютные URL — origin берётся в браузере.
 * Если токена в базе нет (колонки nullable), вместо ссылки показывается
 * подсказка, а копирование недоступно.
 */
export function InviteLinksPanel({ school }: InviteLinksPanelProps) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<CopyKind>(null);
  // Автоматическое копирование может отказать (старый WebView, запрет прав) —
  // тогда просим перенести ссылку вручную: она видна рядом.
  const [copyFailed, setCopyFailed] = useState<CopyKind>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const links = useMemo(() => {
    const base = `${origin}/auth/register?code=${encodeURIComponent(school.code)}&invite=`;
    return {
      teacher: school.teacherInviteToken ? `${base}${encodeURIComponent(school.teacherInviteToken)}` : null,
      admin: school.adminInviteToken ? `${base}${encodeURIComponent(school.adminInviteToken)}` : null,
    };
  }, [origin, school.code, school.teacherInviteToken, school.adminInviteToken]);

  async function handleCopy(kind: Exclude<CopyKind, null>) {
    const link = links[kind];
    if (!link) return;
    const done = await copyToClipboard(link);
    setCopyFailed(done ? null : kind);
    setCopied(done ? kind : null);
    if (done) window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <section className="animate-fade-up glass-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
            Управление доступом и Ссылки-приглашения
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Секретные ссылки школы «{school.name}»: без них публичная регистрация всегда даёт только
            роль ученика.
          </p>
        </div>
        <KeyRound className="h-4 w-4 text-brand-300" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Карточка 1: ссылка для учителей */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient shadow-glow">
              <School className="h-4 w-4 text-white" />
            </span>
            <h3 className="text-sm font-semibold text-white">🏫 Ссылка для Учителей</h3>
          </div>

          {links.teacher ? (
            <p className="mt-3 break-all rounded-xl border border-white/10 bg-ink-900/60 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-slate-300">
              {links.teacher}
            </p>
          ) : (
            <p className="mt-3 rounded-xl border border-white/10 bg-ink-900/60 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
              {NO_TOKEN_HINT}
            </p>
          )}

          <button
            type="button"
            onClick={() => void handleCopy("teacher")}
            disabled={!links.teacher}
            className="mt-3 inline-flex items-center gap-2 rounded-xl border border-brand-400/25 bg-brand-500/10 px-4 py-2.5 text-sm font-medium text-brand-100 transition hover:bg-brand-500/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-500/10"
          >
            {copied === "teacher" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied === "teacher" ? "Скопировано!" : "📋 Скопировать ссылку Учителя"}
          </button>

          {copyFailed === "teacher" && (
            <p className="mt-2 text-xs leading-relaxed text-rose-300">
              Скопировать автоматически не удалось — выделите ссылку выше и скопируйте вручную.
            </p>
          )}

          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Отправьте её учителю: при регистрации по этой ссылке становится доступна роль «Учитель».
          </p>
        </div>

        {/* Карточка 2: ссылка для администраторов */}
        <div className="rounded-2xl border border-amber-400/20 bg-amber-500/[0.06] p-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient shadow-glow">
              <Crown className="h-4 w-4 text-white" />
            </span>
            <h3 className="text-sm font-semibold text-white">👑 Ссылка для Администраторов</h3>
          </div>

          {links.admin ? (
            <p className="mt-3 break-all rounded-xl border border-white/10 bg-ink-900/60 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-slate-300">
              {links.admin}
            </p>
          ) : (
            <p className="mt-3 rounded-xl border border-white/10 bg-ink-900/60 px-3 py-2.5 text-[11px] leading-relaxed text-amber-200/60">
              {NO_TOKEN_HINT}
            </p>
          )}

          <button
            type="button"
            onClick={() => void handleCopy("admin")}
            disabled={!links.admin}
            className="mt-3 inline-flex items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-2.5 text-sm font-medium text-amber-100 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-amber-500/10"
          >
            {copied === "admin" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied === "admin" ? "Скопировано!" : "📋 Скопировать ссылку Админа"}
          </button>

          {copyFailed === "admin" && (
            <p className="mt-2 text-xs leading-relaxed text-rose-300">
              Скопировать автоматически не удалось — выделите ссылку выше и скопируйте вручную.
            </p>
          )}

          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Отправьте эту ссылку учителю или новому сотруднику для получения прав ADMIN.
          </p>
        </div>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-slate-600">
        Ссылки секретны — не публикуйте их в открытом доступе. Ученики, перешедшие без приглашения,
        всегда получают роль STUDENT.
      </p>
    </section>
  );
}
