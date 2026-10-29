import type { CallEndedPayload } from "@/lib/realtime";

/**
 * In-process bridge from the active Socket.IO room to the root listener.
 * Keeping one socket avoids a second authenticated connection just to receive
 * CALL_ENDED. Every useWebRTC instance registers its cleanup here.
 */
type Listener = (payload: CallEndedPayload) => void;
type Cleanup = () => void;
const listeners = new Set<Listener>();
const cleanups = new Map<Cleanup, number>();

export function subscribeCallEnded(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function publishCallEnded(payload: CallEndedPayload): void {
  listeners.forEach((listener) => listener(payload));
}

/** Higher priority runs first (stop/save a recording before stopping tracks). */
export function registerCallCleanup(cleanup: Cleanup, priority = 0): () => void {
  cleanups.set(cleanup, priority);
  return () => { cleanups.delete(cleanup); };
}

export function cleanupAllCalls(): void {
  Array.from(cleanups.entries()).sort((a, b) => b[1] - a[1]).forEach(([cleanup]) => {
    try { cleanup(); } catch (error) { console.error("[calls] cleanup failed", error); }
  });
}
