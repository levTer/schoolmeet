import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ArrowLeft, SearchX, ShieldAlert } from "lucide-react";

import { ClassCodeGate } from "@/components/meeting/ClassCodeGate";
import { MeetingRoom } from "@/components/meeting/MeetingRoom";
import { authOptions } from "@/lib/auth";
import { checkMeetingAccess, findMeetingByCode } from "@/lib/meetings";
import { getSchoolViewer } from "@/lib/school-viewer";
import { isValidRoomCode } from "@/lib/realtime";

export const metadata: Metadata = {
  title: "Урок",
  description: "Видеокомната Лицея Сингулярити: видео участников, шифрованный чат и управление звонком.",
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

  // Роль, школа и класс зрителя — только из БД: JWT мог быть выпущен до смены
  // класса или роли, а доступ к уроку зависит от класса расписания (H-02).
  const viewer = await getSchoolViewer(session.user.id);
  if (!viewer) redirect("/login?callbackUrl=" + encodeURIComponent(`/meeting/${params.id}`));

  const meeting = await findMeetingByCode(params.id);
  const decision = meeting
    ? checkMeetingAccess(meeting, {
        id: viewer.id,
        role: viewer.role,
        schoolId: viewer.schoolId,
        classId: viewer.classId,
      })
    : null;

  // Чужой урок (другая школа) не подтверждаем — показываем «не найден».
  if (!meeting || !decision || (!decision.ok && decision.code === "SCHOOL_MISMATCH")) {
    return <MeetingNotFound code={params.id} />;
  }

  // Урок другого класса (строгая школа): ученик может войти по КОДУ КЛАССА —
  // показываем модалку ввода кода, она сама запрашивает данные комнаты с
  // разовым допуском и монтирует комнату.
  if (decision.ok === false && meeting.school?.strictClassIsolation) {
    return (
      <ClassCodeGate
        meetingCode={meeting.meetingCode}
        title={meeting.title}
        hostName={meeting.host.name}
        self={{
          id: viewer.id,
          name: session.user.name ?? "Участник",
          role: viewer.role,
        }}
      />
    );
  }

  // Урок другого класса в гибкой школе или иной отказ: ученик не допускается,
  // даже если код комнаты известен.
  if (decision.ok === false) {
    return <MeetingForbidden code={params.id} message={decision.message} />;
  }

  return (
    <MeetingRoom
      meetingCode={meeting.meetingCode}
      title={meeting.title}
      hostName={meeting.host.name}
      encryptionKey={meeting.encryptionKey}
      self={{
        id: viewer.id,
        name: session.user.name ?? "Участник",
        role: viewer.role,
      }}
    />
  );
}

function MeetingForbidden({ code, message }: { code: string; message: string }) {
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center px-5 py-16">
      <div className="glass-strong animate-fade-up max-w-md rounded-3xl p-8 text-center shadow-glow">
        <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow">
          <ShieldAlert className="h-6 w-6 text-white" />
        </span>
        <h1 className="mt-5 text-xl font-semibold text-white">Вход в урок закрыт</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Комната <span className="font-mono text-slate-200">{code}</span>: {message}. Если это ваш
          урок — обратитесь к учителю или администратору школы.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4" />В кабинет
        </Link>
      </div>
    </main>
  );
}

function MeetingNotFound({ code }: { code: string }) {
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center px-5 py-16">
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
