"use client";

import { useEffect, useState } from "react";

/**
 * Текущее время, которое обновляется раз в `intervalMs`.
 * До монтирования возвращает `null`: так серверная и клиентская разметка
 * не расходятся (гидратация не ломается из-за разницы в секундах).
 */
export function useNow(intervalMs = 30_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
