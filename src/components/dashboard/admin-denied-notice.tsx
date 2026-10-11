"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { FormAlert } from "@/components/ui/form-alert";

/** Значение `?denied=admin` — попытка войти в раздел суперадмина. */
const ADMIN_DENIED_KEY = "admin";
const ADMIN_DENIED_MESSAGE = "Доступ открыт только Администратору школы";

/**
 * Уведомление о закрытом разделе.
 *
 * Middleware и layout админ-панели возвращают нарушителя на
 * `/dashboard?denied=admin`. Здесь показываем это один раз: toast
 * «Доступ открыт только Администратору школы» + спокойный баннер в кабинете
 * (баннер остаётся после исчезновения toast — «след» попытки входа).
 */
export function AdminDeniedNotice({ denied }: { denied?: string }) {
  const notified = useRef(false);

  useEffect(() => {
    if (!denied || notified.current) return;
    notified.current = true;

    if (denied === ADMIN_DENIED_KEY) {
      toast.error(ADMIN_DENIED_MESSAGE, {
        description: "Раздел /admin доступен только роли ADMIN.",
        duration: 6000,
      });
      return;
    }

    toast.error("Недостаточно прав", { description: `Раздел ${denied} недоступен вашей роли.` });
  }, [denied]);

  if (!denied) return null;

  return (
    <FormAlert variant="info">
      {denied === ADMIN_DENIED_KEY ? (
        <>
          {ADMIN_DENIED_MESSAGE}: раздел <span className="font-mono text-xs">/admin</span> доступен
          только роли ADMIN.
        </>
      ) : (
        <>
          Раздел <span className="font-mono text-xs">{denied}</span> недоступен вашей роли.
        </>
      )}
    </FormAlert>
  );
}
