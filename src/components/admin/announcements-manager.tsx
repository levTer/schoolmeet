"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Eye, EyeOff, Megaphone, School, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";

import { AnnouncementModalButton } from "@/components/admin/announcement-modal";
import type { AnnouncementDto } from "@/lib/announcements";
import { apiRequest } from "@/lib/client-api";
import { GRADE_LABELS } from "@/lib/schedule-rules";
import { cn } from "@/lib/utils";

interface AnnouncementsManagerProps {
  initial: AnnouncementDto[];
  /** Есть ли право управлять объявлениями (в текущей конфигурации — у всех в /admin). */
  canManage: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function targetLabel(target: AnnouncementDto["targetGrade"]): string {
  return target ? GRADE_LABELS[target] : "Вся школа";
}

/**
 * Список объявлений для `/admin/announcements`: публикация, снятие с показа,
 * редактирование и удаление. Все действия идут в API и дублируются
 * уведомлениями (sonner) + обновлением серверных данных.
 */
export function AnnouncementsManager({ initial, canManage }: AnnouncementsManagerProps) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    setItems(initial);
  }, [initial]);

  const toggleActive = async (announcement: AnnouncementDto) => {
    setPendingId(announcement.id);
    const result = await apiRequest<{ announcement: AnnouncementDto }>(
      `/api/admin/announcements/${announcement.id}`,
      { method: "PATCH", json: { isActive: !announcement.isActive } },
    );
    setPendingId(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    setItems((prev) => prev.map((item) => (item.id === announcement.id ? result.data.announcement : item)));
    toast.success(result.data.announcement.isActive ? "Объявление показано" : "Объявление скрыто");
    router.refresh();
  };

  const remove = async (announcement: AnnouncementDto) => {
    setPendingId(announcement.id);
    const result = await apiRequest<{ deleted: true }>(`/api/admin/announcements/${announcement.id}`, {
      method: "DELETE",
    });
    setPendingId(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    setItems((prev) => prev.filter((item) => item.id !== announcement.id));
    toast.success("Объявление удалено");
    router.refresh();
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Объявления школы</h2>
          <p className="mt-1 text-xs text-slate-400">
            Всего: {items.length} · активных: {items.filter((item) => item.isActive).length}
          </p>
        </div>

        {canManage && <AnnouncementModalButton />}
      </div>

      {items.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <Megaphone className="h-5 w-5 text-brand-300" />
          </span>
          <p className="mt-4 text-sm text-slate-300">Объявлений пока нет</p>
          <p className="mt-1 text-xs text-slate-500">
            Создайте первое — оно появится баннером в кабинетах учеников и учителей.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map((item, index) => (
            <li
              key={item.id}
              style={{ animationDelay: `${index * 40}ms` }}
              className={cn(
                "animate-fade-up glass-card p-5",
                !item.isActive && "opacity-70",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                        item.targetGrade
                          ? "border-accent-400/30 bg-accent-500/10 text-accent-200"
                          : "border-brand-400/30 bg-brand-500/15 text-brand-100",
                      )}
                    >
                      {item.targetGrade ? <School className="h-3 w-3" /> : <School className="h-3 w-3" />}
                      {targetLabel(item.targetGrade)}
                    </span>

                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                        item.isActive
                          ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                          : "border-white/10 bg-white/[0.04] text-slate-400",
                      )}
                    >
                      {item.isActive ? "Показывается" : "Скрыто"}
                    </span>
                  </div>

                  <h3 className="mt-3 text-base font-semibold text-white">{item.title}</h3>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-300">
                    {item.content}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <UserRound className="h-3 w-3" />
                      {item.author.name}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays className="h-3 w-3" />
                      {formatDate(item.createdAt)}
                    </span>
                  </div>
                </div>

                {canManage && (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={pendingId === item.id}
                      onClick={() => void toggleActive(item)}
                      title={item.isActive ? "Скрыть из кабинета" : "Показать в кабинете"}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition disabled:opacity-50",
                        item.isActive
                          ? "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10"
                          : "border-emerald-400/25 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20",
                      )}
                    >
                      {item.isActive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      {item.isActive ? "Скрыть" : "Показать"}
                    </button>

                    <AnnouncementModalButton
                      initial={item}
                      triggerLabel="Изменить"
                      triggerIcon="pencil"
                      triggerClassName="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10"
                    />

                    <button
                      type="button"
                      disabled={pendingId === item.id}
                      onClick={() => void remove(item)}
                      title="Удалить объявление"
                      className="inline-flex items-center gap-2 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Удалить
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
