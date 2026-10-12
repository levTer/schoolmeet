import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ArrowLeft, SearchX } from "lucide-react";

import { MeetingRoom } from "@/components/meeting/MeetingRoom";
import { authOptions } from "@/lib/auth";
import { findMeetingByCodeInSchool } from "@/lib/meetings";
import { getSchoolViewer } from "@/lib/school-viewer";
import { isValidRoomCode } from "@/lib/realtime";

export const metadata: Metadata = {
  title: "Урок",
  description: "Видеокомната SchoolMeet: видео участников, шифрованный чат и управление звонком.",
};

export const dynamic = "force-dynamic";

interface MeetingRoomPageProps {
  params: { id: string };
}

/**
 * Страница урока по коду комнаты (`/meeting/math-101-class`).
 * Доступ — только с действующей сессией (middleware + проверка здесь). Сама видеосвязь
 * идёт в клиентском компоненте MeetingRoom.
 */
export default async function MeetingRoomPage({ params }: MeetingRoomPageProps) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/meeting/${params.id}`)}`);
  }

  if (!isValidRoomCode(params.id)) {
    notFound();
  }

  const viewer = await getSchoolViewer(session.user.id);
  const meeting = viewer?.schoolId
    ? await findMeetingByCodeInSchool(params.id, viewer.schoolId)
    : null;
  if (!meeting) {
    return <MeetingNotFound code={params.id} />;
  }

  return (
    <MeetingRoom
      meetingCode={meeting.meetingCode}
      title={meeting.title}
      hostName={meeting.host.name}
      encryptionKey={meeting.encryptionKey}
      self={{
        id: session.user.id,
        name: session.user.name ?? "Участник",
        role: session.user.role,
      }}
    />
  );
}

function MeetingNotFound({ code }: { code: string }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-5 py-16">
      <div className="glass-strong animate-fade-up max-w-md rounded-3xl p-8 text-center shadow-glow">
        <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow">
          <SearchX className="h-6 w-6 text-white" />
        </span>
        <h1 className="mt-5 text-xl font-semibold text-white">Урок не найден</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Комната с кодом <span className="font-mono text-slate-200">{code}</span> не существует или была удалена.
          Проверьте код у учителя.
        </p>
        <Link
          href="/meeting"
          className="mt-6 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4" />
          К урокам
        </Link>
      </div>
    </main>
  );
}
