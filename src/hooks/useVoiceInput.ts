"use client";

/**
 * Бесплатный голосовой ввод Лицея Сингулярити (этап 4).
 *
 * Работает СТРОГО через нативный браузерный Web Speech API
 * (`SpeechRecognition` / `webkitSpeechRecognition`) — никаких серверов,
 * API-ключей и внешних сервисов. Речь превращается в текст, который учитель
 * видит и может отредактировать перед отправкой в ИИ-панель.
 *
 * БЕЗОПАСНАЯ РАБОТА С МИКРОФОНОМ:
 *  - `start()` / `stop()` и все обработчики событий распознавателя обёрнуты в
 *    `try { … } catch { … }` — браузер никогда не получает uncaught exception
 *    (в т.ч. «recognition already started» при повторном клике);
 *  - `onerror` перехватывает `not-allowed`, `no-speech`, `audio-capture`,
 *    `network`, `aborted` и превращает их в человекочитаемый `error` —
 *    AI-панель показывает его аккуратным toast-уведомлением;
 *  - `listening` гарантированно сбрасывается в `false` при любой ошибке и при
 *    завершении сессии, поэтому повторный клик по кнопке безопасен.
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
  try {
    const scope = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
  } catch {
    return null;
  }
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

/**
 * Ошибки Web Speech API → подсказка учителю.
 * Текст `not-allowed` дублирует требование ТЗ дословно: «Разрешите доступ
 * к микрофону в настройках браузера».
 */
const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Разрешите доступ к микрофону в настройках браузера.",
  "service-not-allowed": "Разрешите доступ к микрофону в настройках браузера (распознавание речи запрещено).",
  "no-speech": "Речь не распознана. Попробуйте говорить громче и ближе к микрофону.",
  "audio-capture": "Микрофон не найден. Проверьте подключение устройства.",
  network: "Ошибка сети браузерного распознавания речи. Проверьте соединение и попробуйте ещё раз.",
  aborted: "",
};

/** Сколько раз подряд можно автоматически перезапускать сессию распознавания. */
const MAX_AUTO_RESTARTS = 20;

/** Безопасный вызов метода распознавателя: браузер может бросить исключение. */
function safeCall(action: () => void): boolean {
  try {
    action();
    return true;
  } catch {
    // «recognition already started» / «not started» и подобные ошибки браузера
    // не должны всплывать в консоль и ломать интерфейс.
    return false;
  }
}

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
  /** Счётчик автоматических перезапусков подряд (защита от бесконечного цикла). */
  const restartsRef = useRef(0);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    setSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  /** Останавливает текущий инстанс распознавателя, не выбрасывая исключений. */
  const teardownRecognition = useCallback((abort = false) => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    // Снимаем обработчики: поздние события закрытого инстанса не должны
    // трогать состояние уже новой сессии.
    try {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
    } catch {
      /* некоторые браузеры запрещают менять обработчики — не критично */
    }
    if (abort) {
      if (!safeCall(() => recognition.abort())) safeCall(() => recognition.stop());
    }
  }, []);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    restartsRef.current = 0;
    // Состояние сбрасываем ДО обращения к браузеру: даже если stop() бросит,
    // кнопка вернётся в исходное положение и повторный клик будет безопасен.
    setListening(false);
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      // «recognition has not started yet» — просто аварийно закрываем сессию.
      safeCall(() => recognition.abort());
    } finally {
      safeCall(() => {
        recognition.onstart = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
      });
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setListening(false);
      setError("Ваш браузер не поддерживает голосовой ввод. Откройте Chrome, Edge или Safari.");
      return;
    }

    // Повторный клик «Голос» при живой сессии не должен приводить к
    // «recognition already started»: сначала корректно закрываем старую.
    wantListeningRef.current = false;
    teardownRecognition(true);
    setListening(false);

    /** Запускает сам распознаватель (после получения доступа к микрофону). */
    const beginRecognition = () => {
      try {
        const recognition = new Ctor();
        recognition.lang = lang;
        // Одна фраза за сессию: по final-результату Chrome завершает сессию,
        // onend перезапускает её, пока пользователь не нажал «Стоп».
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
          try {
            restartsRef.current = 0;
            setListening(true);
            setError(null);
          } catch {
            /* загрузка состояния не должна ронять обработчик */
          }
        };

        recognition.onresult = (event) => {
          try {
            let interim = "";
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
              const result = event.results[i];
              const text = result?.[0]?.transcript ?? "";
              if (result.isFinal) {
                const finalText = text.trim();
                if (finalText) optionsRef.current.onTranscript?.(finalText, true);
              } else {
                interim += text;
              }
            }
            const interimText = interim.trim();
            if (interimText) optionsRef.current.onTranscript?.(interimText, false);
          } catch {
            // Битые/неполные результаты браузера игнорируем — панель не падает.
          }
        };

        recognition.onerror = (event) => {
          try {
            const code = event?.error ?? "unknown";
            // Любая ошибка завершает сессию: сбрасываем и «хочу слушать»,
            // и индикатор записи, чтобы повторный клик работал с нуля.
            wantListeningRef.current = false;
            restartsRef.current = 0;
            setListening(false);

            if (code === "aborted") {
              // Пользователь сам остановил запись — это не ошибка, тост не нужен.
              setError(null);
            } else if (code === "no-speech") {
              setError(ERROR_MESSAGES[code]);
            } else {
              setError(ERROR_MESSAGES[code] ?? `Не удалось распознать речь (${code}). Попробуйте ещё раз.`);
            }
          } catch {
            // Даже разбор ошибки не должен выбрасывать исключение наружу.
            setListening(false);
            wantListeningRef.current = false;
          } finally {
            safeCall(() => recognition.abort());
          }
        };

        recognition.onend = () => {
          // Сессия завершена (тишина, финальная фраза, ошибка) — индикатор
          // записи всегда гаснет. Автоперезапуск — только если учитель ещё
          // хочет слушать и лимит перезапусков не исчерпан.
          setListening(false);
          if (!wantListeningRef.current) return;
          if (restartsRef.current >= MAX_AUTO_RESTARTS) {
            wantListeningRef.current = false;
            return;
          }
          restartsRef.current += 1;
          if (!safeCall(() => recognition.start())) {
            // Инстанс уже закрыт — завершаем сессию без исключения.
            wantListeningRef.current = false;
            setListening(false);
          }
        };

        recognitionRef.current = recognition;
        wantListeningRef.current = true;
        setError(null);

        if (!safeCall(() => recognition.start())) {
          // start() бросает, если распознавание уже запущено или доступ
          // запрещён: не оставляем «висящий» индикатор записи.
          wantListeningRef.current = false;
          setListening(false);
          setError("Не удалось запустить распознавание речи. Разрешите доступ к микрофону и попробуйте ещё раз.");
        }
      } catch {
        wantListeningRef.current = false;
        setListening(false);
        setError("Не удалось запустить распознавание речи. Попробуйте ещё раз.");
      }
    };

    // Шаг 1: явный запрос микрофона (браузерный permission prompt).
    // Если API медиаустройств нет (не-HTTPS контекст) — пробуем Speech API
    // напрямую: он запросит доступ сам.
    try {
      if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((stream) => {
            // Разрешение получено — поток Speech API возьмёт сам, останавливаем.
            try {
              stream.getTracks().forEach((track) => track.stop());
            } catch {
              /* остановка трека не критична */
            }
            beginRecognition();
          })
          .catch((error: unknown) => {
            try {
              const name = error instanceof DOMException ? error.name : "";
              wantListeningRef.current = false;
              setListening(false);
              if (name === "NotAllowedError" || name === "PermissionDeniedError") {
                setError("Разрешите доступ к микрофону в настройках браузера.");
              } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
                setError("Микрофон не найден. Проверьте подключение устройства.");
              } else {
                setError("Не удалось получить доступ к микрофону. Попробуйте ещё раз.");
              }
            } catch {
              setListening(false);
              wantListeningRef.current = false;
            }
          });
      } else {
        beginRecognition();
      }
    } catch {
      // Синхронное исключение getUserMedia (небезопасный контекст и т.п.).
      wantListeningRef.current = false;
      setListening(false);
      setError("Браузер не разрешил доступ к микрофону. Откройте сайт по HTTPS и разрешите микрофон.");
    }
  }, [lang, teardownRecognition]);

  const toggle = useCallback(() => {
    try {
      if (wantListeningRef.current) stop();
      else start();
    } catch {
      // Двойная страховка: переключатель никогда не роняет интерфейс.
      wantListeningRef.current = false;
      setListening(false);
      setError("Голосовой ввод недоступен. Попробуйте ещё раз.");
    }
  }, [start, stop]);

  // При размонтировании — корректно останавливаем запись.
  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      teardownRecognition(true);
    };
  }, [teardownRecognition]);

  return { supported, listening, error, start, stop, toggle };
}
