"use client";

import { useMemo } from "react";

import { getSchoolClock, type SchoolClock } from "@/lib/schedule-rules";

import { useNow } from "./useNow";

export interface SchoolNow {
  now: Date;
  clock: SchoolClock;
}

/** Текущий момент и его день недели / минуты во времени школы. `null` до монтирования. */
export function useSchoolClock(intervalMs = 30_000): SchoolNow | null {
  const now = useNow(intervalMs);
  return useMemo(() => (now ? { now, clock: getSchoolClock(now) } : null), [now]);
}
