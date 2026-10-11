"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Определяет, кто говорит прямо сейчас, по уровню звука в аудио-дорожках.
 *
 * Для каждого потока (ключ — id участника) строится AnalyserNode, раз в ~120 мс
 * считается RMS-уровень. Порог и «удержание» (hold) не дают индикатору мерцать
 * между словами. Никакого сетевого трафика — всё локально в браузере.
 */

const POLL_INTERVAL_MS = 120;
const SPEAKING_THRESHOLD = 0.02;
const HOLD_MS = 400;

interface Analyser {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buffer: Float32Array<ArrayBuffer>;
  lastActiveAt: number;
}

export function useSpeakingIndicator(streams: Record<string, MediaStream | null | undefined>): Set<string> {
  const [speaking, setSpeaking] = useState<Set<string>>(() => new Set());

  // Ключ зависит только от id потоков и аудио-дорожек: пересборка анализаторов
  // не нужна, когда просто меняется ссылка на объект.
  const signature = Object.entries(streams)
    .map(([id, stream]) => {
      const track = stream?.getAudioTracks()[0];
      return track ? `${id}:${track.id}` : "";
    })
    .filter(Boolean)
    .sort()
    .join("|");

  const streamsRef = useRef(streams);
  useEffect(() => {
    streamsRef.current = streams;
  });

  useEffect(() => {
    if (!signature) {
      setSpeaking((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }

    const AudioContextClass =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const analysers = new Map<string, Analyser>();

    const attach = () => {
      Object.entries(streamsRef.current).forEach(([id, stream]) => {
        const track = stream?.getAudioTracks()[0];
        if (!stream || !track) return;

        const existing = analysers.get(id);
        if (existing && existing.source.mediaStream.getAudioTracks()[0]?.id === track.id) return;
        existing?.source.disconnect();

        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        const source = context.createMediaStreamSource(new MediaStream([track]));
        source.connect(analyser);
        analysers.set(id, {
          source,
          analyser,
          buffer: new Float32Array(analyser.fftSize),
          lastActiveAt: 0,
        });
      });

      // Удаляем анализаторы участников, которых больше нет.
      Array.from(analysers.keys()).forEach((id) => {
        if (!streamsRef.current[id]) {
          analysers.get(id)?.source.disconnect();
          analysers.delete(id);
        }
      });
    };

    attach();

    const timer = window.setInterval(() => {
      attach();
      if (context.state === "suspended") void context.resume().catch(() => undefined);

      const now = performance.now();
      const next = new Set<string>();

      analysers.forEach((entry, id) => {
        entry.analyser.getFloatTimeDomainData(entry.buffer);
        let sum = 0;
        for (let i = 0; i < entry.buffer.length; i += 1) sum += entry.buffer[i] * entry.buffer[i];
        const rms = Math.sqrt(sum / entry.buffer.length);

        if (rms > SPEAKING_THRESHOLD) entry.lastActiveAt = now;
        if (now - entry.lastActiveAt < HOLD_MS) next.add(id);
      });

      setSpeaking((prev) => {
        if (prev.size === next.size && Array.from(next).every((id) => prev.has(id))) return prev;
        return next;
      });
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      analysers.forEach((entry) => entry.source.disconnect());
      analysers.clear();
      void context.close().catch(() => undefined);
    };
  }, [signature]);

  return speaking;
}
