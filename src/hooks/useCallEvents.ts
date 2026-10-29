"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { cleanupAllCalls, subscribeCallEnded } from "@/lib/call-events";
import type { CallEndedPayload } from "@/lib/realtime";

export const CALL_ENDED_REDIRECT_MS = 2_500;

/**
 * Root-level CALL_ENDED listener. The active room socket publishes into the
 * call-events bridge; this hook performs global cleanup exactly once per end
 * event, shows the organizer toast, then redirects participants to the dashboard.
 */
export function useCallEvents(): void {
  const router = useRouter();
  const handledRef = useRef(new Set<string>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeCallEnded((payload: CallEndedPayload) => {
      const key = `${payload.meetingId}:${payload.endedAt}`;
      if (handledRef.current.has(key)) return;
      handledRef.current.add(key);
      // Stop/save recorders before WebRTC tracks are stopped (priority order).
      cleanupAllCalls();
      toast.info("Урок завершён организатором", {
        id: `call-ended-${payload.meetingId}`,
        description: payload.endedBy?.name
          ? `Организатор: ${payload.endedBy.name}. Возвращаемся в кабинет…`
          : "Возвращаемся в кабинет…",
      });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        router.replace("/dashboard");
        router.refresh();
      }, CALL_ENDED_REDIRECT_MS);
    });
    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [router]);
}
