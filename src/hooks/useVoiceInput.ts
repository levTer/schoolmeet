"use client";

/**
 * Бесплатный голосовой ввод Лицея Сингулярити (этап 4).
 *
 * Работает СТРОГО через нативный браузерный Web Speech API
 * (`SpeechRecognition` / `webkitSpeechRecognition`) — никаких серверов,
 * API-ключей и внешних сервисов. Речь превращается в текст, который учитель
 * видит и может отредактировать перед отправкой в ИИ-панель.
 *
 * Поддержка браузеров: Chrome / Edge / Safari (у Firefox и старых браузеров
 * API отсутствует — хук честно вернёт `supported: false`).
 */

import { useCallback, useEffect, useRef, useState } from "react";

/* Минимальные типы Web Speech API (в lib.dom их нет). */
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export interface UseVoiceInputOptions {
  /** Язык распознавания, по умолчанию русский. */
  lang?: string;
  /**
   * Распознанный фрагмент речи.
   * `isFinal === false` — промежуточный результат (ещё может измениться).
   */
  onTranscript?: (text: string, isFinal: boolean) => void;
}

export interface VoiceInput {
  /** Поддерживает ли браузер Web Speech API. */
  supported: boolean;
  /** Идёт ли сейчас распознавание. */
  listening: boolean;
  /** Последняя ошибка (уже человекочитаемая, по-русски) или null. */
  error: string | null;
  /** Начать запись (с запросом доступа к микрофону). */
  start: () => void;
  /** Остановить запись. */
  stop: () => void;
  /** Переключить запись. */
  toggle: () => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Микрофон запрещён. Разрешите доступ к микрофону в настройках браузера.",
  "service-not-allowed": "Браузер запретил распознавание речи на этой странице.",
  "no-speech": "Речь не распознана. Попробуйте говорить громче.",
  "audio-capture": "Микрофон не найден. Проверьте подключение устройства.",
  network: "Ошибка сети браузерного распознавания речи.",
  aborted: "",
};

/**
 * Голосовой ввод: 🎤 → речь → текст.
 *
 * Пример:
 * ```tsx
 * const voice = useVoiceInput({ onTranscript: (text) => setInput(prev => prev + text) });
 * <button onClick={voice.toggle}>{voice.listening ? "Стоп" : "🎤"}</button>
 * ```
 */
export function useVoiceInput(options: UseVoiceInputOptions = {}): VoiceInput {
  const lang = options.lang ?? "ru-RU";

  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  /** Пользователь хочет слушать — используем для автоперезапуска. */
  const wantListeningRef = useRef(false);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    setSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("Ваш браузер не поддерживает голосовой ввод. Откройте Chrome, Edge или Safari.");
      return;
    }

    // Пересоздаём распознаватель: после stop() инстанс не всегда перезапускается.
    recognitionRef.current?.abort();

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      setError(null);
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          const finalText = text.trim();
          if (finalText) optionsRef.current.onTranscript?.(finalText, true);
        } else {
          interim += text;
        }
      }
      const interimText = interim.trim();
      if (interimText) optionsRef.current.onTranscript?.(interimText, false);
    };

    recognition.onerror = (event) => {
      const message = ERROR_MESSAGES[event.error] ?? `Ошибка распознавания речи: ${event.error}`;
      if (event.error !== "aborted" && event.error !== "no-speech") {
        wantListeningRef.current = false;
        setError(message || null);
      }
    };

    recognition.onend = () => {
      // Chrome периодически останавливает сессию по тишине — перезапускаем,
      // пока пользователь не нажал «Стоп».
      if (wantListeningRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          /* инстанс уже закрыт — продолжаем ниже */
        }
      }
      setListening(false);
    };

    recognitionRef.current = recognition;
    wantListeningRef.current = true;
    setError(null);

    try {
      recognition.start();
    } catch {
      // start() бросает, если распознавание уже запущено.
      setListening(true);
    }
  }, [lang]);

  const toggle = useCallback(() => {
    if (wantListeningRef.current) stop();
    else start();
  }, [start, stop]);

  // При размонтировании — корректно останавливаем запись.
  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  return { supported, listening, error, start, stop, toggle };
}
