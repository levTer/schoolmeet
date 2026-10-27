"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/** Z-индекс оверлея модалок: выше шапки (z-50) и панелей админки (z-[100]). */
export const MODAL_OVERLAY_Z_INDEX = "z-[999]";

/** Базовые классы подложки — затемнение + блюр + собственный скролл. */
export const MODAL_OVERLAY_CLASS = cn(
  "fixed inset-0 overflow-y-auto bg-black/80 backdrop-blur-sm",
  MODAL_OVERLAY_Z_INDEX,
);

/** Базовые классы центрирующей обёртки. */
export const MODAL_CONTAINER_CLASS = "flex min-h-full items-center justify-center p-4 text-center sm:p-0";

/** Базовые классы карточки модалки. */
export const MODAL_CARD_CLASS = cn(
  "relative transform overflow-hidden rounded-2xl border border-slate-800 bg-slate-900",
  "text-left shadow-xl transition-all outline-none sm:my-8 sm:w-full sm:max-w-2xl",
);

export interface ModalProps {
  /** Открыта ли модалка. При `false` компонент ничего не рендерит. */
  open: boolean;
  /** Закрытие: клик по подложке или Escape. */
  onClose: () => void;
  /** Контент модалки. Отступы задаются здесь же (например `className="p-6"`). */
  children: ReactNode;
  /** `id` заголовка для `aria-labelledby`. */
  labelledBy?: string;
  /** `id` описания для `aria-describedby`. */
  describedBy?: string;
  /** Подпись для скринридеров, если видимого заголовка нет. */
  label?: string;
  /** Запретить закрытие — например, пока идёт отправка формы. */
  disableClose?: boolean;
  /** Дополнительные классы карточки. */
  className?: string;
  /** Дополнительные классы подложки. */
  overlayClassName?: string;
  /** Дополнительные классы центрирующей обёртки. */
  containerClassName?: string;
  /** Отрисовать оверлей в body, чтобы transform и backdrop-filter родителей его не обрезали. */
  portal?: boolean;
}

/**
 * Каркас модального окна — единый «железобетонный» паттерн для всех модалок.
 *
 * Структура ровно та, что зафиксирована в гайдлайне:
 * 1. подложка `fixed inset-0` с собственным `overflow-y-auto` — длинный контент
 *    скроллится вместе с окном и не обрезается;
 * 2. центрирующая обёртка `flex min-h-full items-center justify-center p-4 sm:p-0` —
 *    карточка не растягивается на всю ширину экрана и не прижимается к краям;
 * 3. карточка `relative … sm:w-full sm:max-w-2xl` с `text-left`, потому что
 *    центрирующая обёртка задаёт `text-center`.
 *
 * Дополнительно: Escape, клик по подложке, блокировка скролла страницы и возврат
 * фокуса на элемент, с которого модалку открыли.
 */
export function Modal({
  open,
  onClose,
  children,
  labelledBy,
  describedBy,
  label,
  disableClose = false,
  className,
  overlayClassName,
  containerClassName,
  portal = false,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Элемент, на котором был фокус до открытия: возвращаем его при закрытии.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || disableClose) return;
      event.stopPropagation();
      onClose();
    };

    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Страница под модалкой не должна прокручиваться.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    cardRef.current?.focus();

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [open, onClose, disableClose]);

  if (!open) return null;

  // Закрываем только по клику на подложку/центрирующую обёртку, не по карточке.
  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (disableClose) return;
    if (event.target === event.currentTarget) onClose();
  };

  const content = (
    <div className={cn("animate-fade-in", MODAL_OVERLAY_CLASS, overlayClassName)} onClick={handleBackdropClick}>
      <div className={cn(MODAL_CONTAINER_CLASS, containerClassName)} onClick={handleBackdropClick}>
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          aria-label={label}
          tabIndex={-1}
          className={cn("animate-fade-up", MODAL_CARD_CLASS, className)}
        >
          {children}
        </div>
      </div>
    </div>
  );

  if (portal) return typeof document === "undefined" ? null : createPortal(content, document.body);
  return content;
}
