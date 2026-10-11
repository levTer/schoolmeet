import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ArrowLeft, KeyRound, ShieldCheck, Sparkles, Video } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { authOptions } from "@/lib/auth";
import { ROLE_LABELS, hasPermission } from "@/types";

export const metadata: Metadata = {
  title: "Урок",
  description: "Видеокомната SchoolMeet: доска, участники и шифрованный чат класса.",
};

export const dynamic = "force-dynamic";

/** Каркас раздела «Урок» — сама видеокомната подключается на этапе 3. */
export default async function MeetingPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login?callbackUrl=/meeting");
  }

  const { role, name } = session.user;
  const canHost = hasPermission(role, "meeting:create");

  return (
    <AppShell>
      <header className="animate-fade-up">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-xs text-slate-400 transition hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          В кабинет
        </Link>

        <h1 className="mt-4 flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          <Video className="h-7 w-7 text-brand-300" />
          Урок
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          {canHost
            ? `${name ?? "Учитель"}, вы можете создать комнату и передать ученикам её код.`
            : `${name ?? "Ученик"}, введите код комнаты, который дал учитель.`}
        </p>
      </header>

      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <section className="ring-gradient animate-fade-up h-fit rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-2xl">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
            <KeyRound className="h-4 w-4" />
            {canHost ? "Создание комнаты" : "Вход по коду"}
          </h2>

          <label className="mt-5 block text-xs font-medium uppercase tracking-wider text-slate-400">
            Код урока
          </label>
          <input
            disabled
            placeholder="ABC-1234"
            className="mt-2 w-full cursor-not-allowed rounded-xl border border-white/10 bg-ink-900/70 px-4 py-3 font-mono text-lg tracking-[0.25em] text-slate-500 placeholder:text-slate-700"
          />

          <button
            type="button"
            disabled
            className="mt-4 w-full cursor-not-allowed rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white opacity-60"
          >
            {canHost ? "Создать урок" : "Подключиться к уроку"}
          </button>

          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Комната станет активной, когда включим видеосвязь на PeerJS/WebRTC — этап 3.
          </p>
        </section>

        <div className="space-y-5">
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-xl">
            <h2 className="text-lg font-semibold text-white">Что будет в комнате</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                { title: "HD-видео", text: "P2P-соединение через PeerJS, аудио и видео участников." },
                { title: "ИИ-доска", text: "Fabric.js + GPT-4o Vision: разбор формул и задач." },
                { title: "Чат класса", text: "Socket.IO с AES-256 шифрованием сообщений." },
                { title: "Поднятая рука", text: "Запрос слова с подсветкой у учителя." },
              ].map(({ title, text }) => (
                <li key={title} className="rounded-2xl border border-white/10 bg-ink-900/40 p-4">
                  <p className="text-sm font-medium text-white">{title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{text}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex items-start gap-4 rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.06] p-6 backdrop-blur-xl">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            <div>
              <h2 className="text-base font-semibold text-white">Доступ проверен</h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-300">
                Роль {ROLE_LABELS[role]} допущена к разделу «Урок»: маршрут защищён middleware, а
                сессия подписана серверным секретом.
              </p>
            </div>
            <Sparkles className="hidden h-5 w-5 shrink-0 text-emerald-300 sm:block" />
          </section>
        </div>
      </div>
    </AppShell>
  );
}
