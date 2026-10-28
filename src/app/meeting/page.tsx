import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ArrowLeft, Video } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { MeetingLobby } from "@/components/meeting/MeetingLobby";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/types";

export const metadata: Metadata = {
  title: "Урок",
  description: "Создание уроков и вход в видеокомнату Лицея Сингулярити по коду.",
};

export const dynamic = "force-dynamic";

/**
 * Раздел «Урок»: учитель создаёт комнату и получает код, ученик вводит код.
 * Сама комната — `/meeting/[id]`.
 */
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
        <MeetingLobby canHost={canHost} />
      </div>
    </AppShell>
  );
}
