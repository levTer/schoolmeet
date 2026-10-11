"use client";

import { create } from "zustand";

/**
 * Общее состояние модалки «Новое задание» на странице `/homework`.
 *
 * Нужно, чтобы независимые блоки страницы знали об открытой модалке: пустышка
 * «Вы ещё не выдали ни одного задания» автоматически скрывается, пока модалка
 * открыта, и не «просвечивает» сквозь затемняющий оверлей (см.
 * `homework-empty-state.tsx`).
 */
interface HomeworkCreateState {
  /** Открыта ли модалка создания ДЗ. */
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useHomeworkCreateModal = create<HomeworkCreateState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
