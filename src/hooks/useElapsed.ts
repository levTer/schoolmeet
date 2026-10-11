"use client";

import { useEffect, useState } from "react";

/**
 * Секунды с момента `startedAt` (мс с эпохи). Пока `startedAt` = null — 0.
 * Таймер работает на клиенте: сервер не рассылает тики.
 */
export function useElapsedSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  if (startedAt === null) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

/** 75 → «01:15», 3725 → «1:02:05». */
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, "0");

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
