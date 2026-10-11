import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ScrollText } from "lucide-react";

import { FormAlert } from "@/components/ui/form-alert";
import { auditActionLabel, auditActionTone, formatAuditDetails, listAuditLogs, type AuditLogEntry } from "@/lib/audit";
import { isAdmin } from "@/lib/admin-permissions";
import { authOptions, canAccessAdminArea } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Журнал действий",
  description: "Аудит админ-панели SchoolMeet: смена ролей, блокировки, завершение уроков и объявления.",
};

export const dynamic = "force-dynamic";

const TONE_BADGES = {
  danger: "border-rose-400/25 bg-rose-500/10 text-rose-200",
  success: "border-emerald-400/25 bg-emerald-500/10 text-emerald-200",
  brand: "border-brand-400/25 bg-brand-500/10 text-brand-100",
  neutral: "border-white/10 bg-white/[0.04] text-slate-300",
} as const;

/**
 * `/admin/audit` — журнал действий администрации.
 *
 * Доступен только роли ADMIN: в журнале видно, кто и когда менял роли,
 * блокировал пользователей и завершал уроки.
 */
export default async function AdminAuditPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/admin/audit");
  if (!canAccessAdminArea(session.user.role)) redirect("/dashboard?denied=/admin/audit");
  if (!isAdmin(session.user.role)) redirect("/admin");

  let logs: { items: AuditLogEntry[]; total: number } | null = null;
  try {
    logs = await listAuditLogs({ take: 60 });
  } catch (error) {
    console.error("[admin/audit] Не удалось загрузить журнал:", error);
  }

  if (!logs) {
    return <FormAlert variant="error">Не удалось загрузить журнал действий. Проверьте базу данных.</FormAlert>;
  }

  return (
    <section className="glass-card overflow-hidden">
      <header className="flex items-center gap-3 border-b border-white/5 px-6 py-4">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-brand-400/25 bg-brand-500/10 text-brand-300">
          <ScrollText className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Журнал действий</h2>
          <p className="text-xs text-slate-500">
            Всего записей: {logs.total} · действия админов и учителей фиксируются автоматически
          </p>
        </div>
      </header>

      {logs.items.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-slate-400">
          Журнал пуст: как только админ изменит роль, заблокирует пользователя или завершит урок, запись
          появится здесь.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-slate-500">
              <tr className="border-b border-white/5">
                <th className="px-6 py-3 font-medium">Действие</th>
                <th className="px-4 py-3 font-medium">Кто</th>
                <th className="px-4 py-3 font-medium">Детали</th>
                <th className="px-4 py-3 font-medium">IP</th>
                <th className="px-6 py-3 font-medium">Когда</th>
              </tr>
            </thead>
            <tbody>
              {logs.items.map((entry) => (
                <tr key={entry.id} className="border-b border-white/5 transition last:border-0 hover:bg-white/[0.03]">
                  <td className="px-6 py-3">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                        TONE_BADGES[auditActionTone(entry.action)],
                      )}
                    >
                      {auditActionLabel(entry.action)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {entry.actor ? (
                      <>
                        <span className="block">{entry.actor.name}</span>
                        <span className="block text-[11px] text-slate-500">{entry.actor.role}</span>
                      </>
                    ) : (
                      <span className="text-slate-500">Система</span>
                    )}
                  </td>
                  <td className="max-w-[24rem] px-4 py-3 text-xs text-slate-400">
                    {formatAuditDetails(entry.details) || "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{entry.ip ?? "—"}</td>
                  <td className="px-6 py-3 text-slate-400">
                    {new Date(entry.createdAt).toLocaleString("ru-RU", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
