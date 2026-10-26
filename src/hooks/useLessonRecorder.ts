"use client";

/**
 * Локальная запись урока на ПК (WebM, MediaRecorder).
 *
 * Запись идёт полностью на стороне ученика/учителя: поток собирается на канвасе
 * из видеотрека демонстрации экрана (приоритет) или камеры и микса звука —
 * локального микрофона и микрофонов участников (Web Audio API). Готовый файл
 * автоматически скачивается на компьютер как `eduflow-lesson-[дата].webm`.
 *
 * В финальный файл попадает ТОЛЬКО содержание урока: при демонстрации экрана
 * на канвас рисуется экран (вписанный целиком, без обрезки краёв) и камера
 * текущего спикера в углу. Элементы интерфейса, другие участники и пустое
 * пространство страницы в запись не попадают.
 *
 * Ничего не отправляется на сервер: это личный архив урока.
 *
 * Формат: `video/webm; codecs=vp9,opus` с откатом на `video/webm`
 * (Safari/старые Chrome не знают vp9).
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface LessonRecorderSource {
  /** Видеотрек демонстрации экрана — попадает в запись в первую очередь. */
  screenTrack: MediaStreamTrack | null;
  /** Видеотрек камеры: основа записи или «картинка в углу» поверх экрана. */
  cameraTrack: MediaStreamTrack | null;
  /**
   * Камера текущего спикера — «картинка в углу» при демонстрации экрана
   * (закреплённый участник → говорящий → учитель). Если её нет, в угол
   * попадает своя камера (`cameraTrack`).
   */
  speakerCameraTrack?: MediaStreamTrack | null;
  /** Потоки со звуком: свой микрофон и микрофоны участников комнаты. */
  audioStreams: MediaStream[];
}

export interface LessonRecorderApi {
  /** Поддерживает ли браузер запись (MediaRecorder). */
  isSupported: boolean;
  /** Идёт ли запись прямо сейчас. */
  isRecording: boolean;
  /** Момент старта записи (для таймера). */
  startedAt: number | null;
  /** Последняя ошибка записи (показывается тостом). */
  error: string | null;
  /** Запустить запись. */
  start: () => Promise<void>;
  /** Остановить запись и скачать файл. */
  stop: () => void;
}

/** Кандидаты mime-типа: сначала vp9+opus, затем просто webm. */
const MIME_CANDIDATES = ["video/webm; codecs=vp9,opus", "video/webm"];

/** Размер кадра записи (достаточно для конспекта, файл не раздувается). */
const RECORDING_WIDTH = 1280;
const RECORDING_HEIGHT = 720;

/** Правая нижняя камера в записи (как PiP на экране). */
const PIP_WIDTH = 320;
const PIP_HEIGHT = 180;
/** Отступ «картинки в углу» от краёв канвы записи. */
const PIP_MARGIN = 24;

/** Имя файла записи: `eduflow-lesson-YYYY-MM-DD.webm`. */
export function lessonRecordingFileName(date: Date = new Date()): string {
  return `eduflow-lesson-${date.toISOString().slice(0, 10)}.webm`;
}

/** Первый поддерживаемый браузером mime-тип записи. */
export function pickRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const candidate of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      /* isTypeSupported бросает в очень старых браузерах — просто идём дальше */
    }
  }
  return "";
}

/** Скачивание готового файла на компьютер. */
function downloadRecording(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Микс звука: свой микрофон и микрофоны участников сводятся в один трек.
 * Web Audio умеет обрабатывать и удалённые WebRTC-потоки.
 */
function mixAudio(streams: MediaStream[]): { stream: MediaStream | null; context: AudioContext | null } {
  const withAudio = streams.filter((stream) => stream.getAudioTracks().length > 0);
  if (withAudio.length === 0) return { stream: null, context: null };

  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return { stream: null, context: null };

  try {
    const context = new AudioContextCtor();
    const destination = context.createMediaStreamDestination();

    for (const stream of withAudio) {
      try {
        const node = context.createMediaStreamSource(stream);
        node.connect(destination);
      } catch {
        /* отдельный поток не читается — записываем остальные */
      }
    }

    void context.resume().catch(() => undefined);
    return { stream: destination.stream, context };
  } catch {
    return { stream: null, context: null };
  }
}

/** Тихо запускает скрытый <video> с потоком (для отрисовки на канвасе). */
async function playQuietly(video: HTMLVideoElement): Promise<void> {
  try {
    await video.play();
  } catch {
    /* автозапуск может быть запрещён — тогда рисуем последний доступный кадр */
  }
}

interface CompositeResult {
  track: MediaStreamTrack | null;
  cleanup: () => void;
}

/**
 * Вписывает кадр видео в прямоугольник, СОХРАНЯЯ пропорции (как
 * `object-fit: contain`): презентация или экран попадают в запись целиком,
 * без обрезки краёв, а свободное место остаётся чёрным.
 */
function drawVideoContain(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  box: { x: number; y: number; width: number; height: number },
): boolean {
  const frameWidth = video.videoWidth;
  const frameHeight = video.videoHeight;
  if (!frameWidth || !frameHeight) return false;

  const scale = Math.min(box.width / frameWidth, box.height / frameHeight);
  const width = frameWidth * scale;
  const height = frameHeight * scale;

  context.drawImage(video, box.x + (box.width - width) / 2, box.y + (box.height - height) / 2, width, height);
  return true;
}

/**
 * Композит «экран + камера спикера в углу» на канвасе: один видеотрек для
 * записи. Если канвас недоступен — возвращаем null, и тогда пишем «как есть».
 */
async function createCompositeTrack(
  screenTrack: MediaStreamTrack,
  cameraTrack: MediaStreamTrack | null,
): Promise<CompositeResult> {
  const noop: CompositeResult = { track: null, cleanup: () => undefined };

  if (typeof document === "undefined") return noop;

  const canvas = document.createElement("canvas");
  canvas.width = RECORDING_WIDTH;
  canvas.height = RECORDING_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context || typeof canvas.captureStream !== "function") return noop;

  const screenVideo = document.createElement("video");
  screenVideo.srcObject = new MediaStream([screenTrack]);
  screenVideo.muted = true;
  screenVideo.playsInline = true;

  const cameraVideo = document.createElement("video");
  cameraVideo.srcObject = cameraTrack ? new MediaStream([cameraTrack]) : null;
  cameraVideo.muted = true;
  cameraVideo.playsInline = true;

  await Promise.all([playQuietly(screenVideo), playQuietly(cameraVideo)]);

  const pipBox = {
    x: canvas.width - PIP_WIDTH - PIP_MARGIN,
    y: canvas.height - PIP_HEIGHT - PIP_MARGIN,
    width: PIP_WIDTH,
    height: PIP_HEIGHT,
  };

  let frame = 0;
  let painted = false;
  const draw = () => {
    frame = window.requestAnimationFrame(draw);

    // Фон кадра — только содержимое урока: экран и камера спикера.
    context.fillStyle = "#000000";
    context.fillRect(0, 0, canvas.width, canvas.height);

    if (screenVideo.readyState >= 2) {
      drawVideoContain(context, screenVideo, { x: 0, y: 0, width: canvas.width, height: canvas.height });
      painted = true;
    } else if (!painted) {
      // Экран ещё не отдаёт кадров — держим чёрный фон.
      context.fillStyle = "#000000";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (cameraTrack && cameraVideo.readyState >= 2) {
      // Подложка под «картинкой в углу», чтобы кадр не сливался с экраном.
      context.fillStyle = "#000000";
      context.fillRect(pipBox.x, pipBox.y, pipBox.width, pipBox.height);
      drawVideoContain(context, cameraVideo, pipBox);
    }
  };
  draw();

  const stream = canvas.captureStream(30);
  const track = stream.getVideoTracks()[0] ?? null;

  return {
    track,
    cleanup: () => {
      window.cancelAnimationFrame(frame);
      stream.getTracks().forEach((item) => item.stop());
      screenVideo.srcObject = null;
      cameraVideo.srcObject = null;
    },
  };
}

/** Хук локальной записи урока. */
export function useLessonRecorder(source: LessonRecorderSource): LessonRecorderApi {
  const [isRecording, setIsRecording] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const isSupported = typeof window !== "undefined" && typeof MediaRecorder !== "undefined";

  /** Освобождает ресурсы (канвас, аудио-контекст, треки записи). */
  const releaseResources = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state !== "inactive") recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return;

    if (!isSupported) {
      setError("Браузер не поддерживает запись урока (MediaRecorder).");
      return;
    }

    const { screenTrack, cameraTrack, speakerCameraTrack, audioStreams } = sourceRef.current;
    const baseVideo = screenTrack ?? cameraTrack;

    if (!baseVideo) {
      setError("Нет видеопотока: включите камеру или демонстрацию экрана перед записью.");
      return;
    }

    setError(null);

    // Видео: при демонстрации экрана на канвас идут ТОЛЬКО экран (вписанный
    // целиком) и камера текущего спикера в углу. Интерфейс, другие участники
    // и пустое пространство страницы в файл не попадают.
    let videoTrack: MediaStreamTrack | null = baseVideo;
    let cleanupComposite: (() => void) = () => undefined;

    if (screenTrack) {
      const cornerCamera = speakerCameraTrack ?? cameraTrack;
      const composite = await createCompositeTrack(screenTrack, cornerCamera);
      if (composite.track) {
        videoTrack = composite.track;
        cleanupComposite = composite.cleanup;
      }
    }

    // Звук: микс микрофонов участников.
    const { stream: mixedAudio, context: audioContext } = mixAudio(audioStreams);

    const recordingStream = new MediaStream();
    if (videoTrack) recordingStream.addTrack(videoTrack);
    if (mixedAudio) mixedAudio.getAudioTracks().forEach((track) => recordingStream.addTrack(track));

    const mimeType = pickRecordingMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(recordingStream, { mimeType }) : new MediaRecorder(recordingStream);
    } catch {
      cleanupComposite();
      void audioContext?.close().catch(() => undefined);
      setError("Не удалось начать запись: браузер отклонил формат WebM.");
      return;
    }

    const chunks: Blob[] = [];
    chunksRef.current = chunks;
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
      if (blob.size > 0) {
        downloadRecording(blob, lessonRecordingFileName());
      }
      cleanupComposite();
      void audioContext?.close().catch(() => undefined);
      releaseResources();
      if (mountedRef.current) {
        setIsRecording(false);
        setStartedAt(null);
      }
    };

    recorder.onerror = () => {
      cleanupComposite();
      void audioContext?.close().catch(() => undefined);
      releaseResources();
      if (mountedRef.current) {
        setIsRecording(false);
        setStartedAt(null);
        setError("Запись прервана: браузер сообщил об ошибке MediaRecorder.");
      }
    };

    cleanupRef.current = () => {
      cleanupComposite();
      void audioContext?.close().catch(() => undefined);
    };

    try {
      recorder.start(1000);
    } catch {
      cleanupComposite();
      void audioContext?.close().catch(() => undefined);
      releaseResources();
      setError("Не удалось начать запись: устройство занято другим приложением.");
      return;
    }

    setIsRecording(true);
    setStartedAt(Date.now());
  }, [isSupported, releaseResources]);

  // Уход со страницы: останавливаем запись и освобождаем устройства.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        // Финальный кусок записи успешно сохранится в файл.
        recorder.stop();
      } else {
        cleanupRef.current?.();
        cleanupRef.current = null;
      }
      recorderRef.current = null;
      chunksRef.current = [];
    };
  }, []);

  return { isSupported, isRecording, startedAt, error, start, stop };
}
