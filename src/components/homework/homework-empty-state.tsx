"use client";

import { useHomeworkCreateModal } from "@/components/homework/homework-create-store";

/**
 * Пустышка списка заданий («Здесь появятся работы…», «Вы ещё не выдали ни одного
 * задания»). Держится на нижнем слое (`z-0`), а пока открыта модалка создания ДЗ —
 * полностью скрывается, чтобы фон не конфликтовал с диалогом (z-[100]).
 */
export function HomeworkEmptyState({ text }: { text: string }) {
  const isCreateModalOpen = useHomeworkCreateModal((state) => state.open);

  if (isCreateModalOpen) return null;

  return (
    <div className="glass-card relative z-0 p-8 text-center text-sm text-slate-400">{text}</div>
  );
}
