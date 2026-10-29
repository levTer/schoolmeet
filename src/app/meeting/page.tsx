import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ArrowLeft, Video } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { LobbyScreen } from "@/components/Lobby/LobbyScreen";
import { authOptions } from "@/lib/auth";
import { findMeetingCodeById } from "@/lib/meetings";
import { isValidRoomCode } from "@/lib/realtime";
import { hasPermission } from "@/types";

export const metadata: Metadata = {
  title: "Урок",
  description: "Создание уроков и вход в видеокомнату Лицея Сингулярити по коду.",
};

export const dynamic = "force-dynamic";

interface MeetingPageProps {
  /** `room` — код комнаты, `lessonId` — id урока (cuid). Оба ведут в комнату сразу. */
  searchParams: { room?: string; lessonId?: string };
}

/**
 * Раздел «Урок»: учитель создаёт комнату и получает код, ученик вводит код.
 * Сама комната — `/meeting/[id]`.
 *
 * Вход «в один клик»: карточка кабинета ведёт на `/meeting?room=<код>`
 * (или `/meeting?lessonId=<id>`), и страница СРАЗУ редиректит в видеокомнату —
 * пароли, коды и ссылки вводить не нужно. Доступ по-прежнему проверяет
 * `/meeting/[code]` (сессия, школа, класс), поэтому «дыры» этот редирект
 * не создаёт.
 */
export default async function MeetingPage({ searchParams }: MeetingPageProps) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    const target = typeof searchParams?.room === "string" && searchParams.room.trim()
      ? `/meeting?room=${encodeURIComponent(searchParams.room.trim())}`
      : "/meeting";
    redirect(`/login?callbackUrl=${encodeURIComponent(target)}`);
  }

  const directRoom = typeof searchParams?.room === "string" ? searchParams.room.trim().toLowerCase() : "";
  if (directRoom && isValidRoomCode(directRoom)) {
    redirect(`/meeting/${directRoom}`);
  }

  const directLessonId = typeof searchParams?.lessonId === "string" ? searchParams.lessonId.trim() : "";
  if (directLessonId) {
    // Сначала пробуем id комнаты (cuid), затем — код комнаты: так работают
    // обе формы ссылки из карточки кабинета.
    const code =
      (await findMeetingCodeById(directLessonId)) ??
      (isValidRoomCode(directLessonId) ? directLessonId.toLowerCase() : null);
    if (code) redirect(`/meeting/${code}`);
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

        <h1 className="mt-4 flex items-center gap-3 text-lg font-semibold tracking-tight sm:text-xl">
          <Video className="h-7 w-7 text-accent-300" />
          Урок
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          {canHost
            ? `${name ?? "Учитель"}, создайте урок и отправьте ученикам его код.`
            : `${name ?? "Ученик"}, введите код урока, который дал учитель.`}
        </p>
      </header>

      <div className="mt-8">
        <LobbyScreen canHost={canHost} selfId={session.user.id} selfRole={role} />
      </div>
    </AppShell>
  );
}
