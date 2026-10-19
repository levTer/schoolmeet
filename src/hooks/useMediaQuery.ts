"use client";

import { useEffect, useState } from "react";

/**
 * SSR-безопасная проверка медиазапроса.
 *
 * Первый рендер всегда `false` (мобильная раскладка): сервер не знает ширины
 * окна, а расхождение с клиентом сломало бы гидрацию. После монтирования
 * эффект подтягивает реальное значение и подписывается на изменения.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();

    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/**
 * Десктопная раскладка урока (`md` и выше): сцена + правая колонка
 * «плитка шоколада» с камерами участников. Ниже `md` лента участников
 * становится горизонтальной полоской в обычном потоке документа.
 */
export function useIsDesktopLayout(): boolean {
  return useMediaQuery("(min-width: 768px)");
}
