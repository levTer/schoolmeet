"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock3, LogOut, PhoneOff, ShieldAlert, Users, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";

import {
  Chat,
  CHAT_MAX_MESSAGE_LENGTH,
  type ChatRecipientOption,
  type ChatViewMessage,
} from "@/components/meeting/Chat";
import { Controls } from "@/components/meeting/Controls";
import { AIWidget } from "@/components/meeting/AIWidget";
import { Filmstrip } from "@/components/meeting/Filmstrip";
import { PreJoinScreen } from "@/components/meeting/PreJoinScreen";
import { VideoGrid, pickSpotlightTile, type GridTile } from "@/components/meeting/VideoGrid";
import { Whiteboard, WHITEBOARD_TOP_RESERVED_PX, type WhiteboardAiBridge } from "@/components/meeting/Whiteboard";
import { FormAlert } from "@/components/ui/form-alert";
import { Logo } from "@/components/landing/logo";
import { useSocket, type SocketStatus } from "@/hooks/useSocket";
import { useSpeakingIndicator } from "@/hooks/useSpeakingIndicator";
import { formatDuration, useElapsedSeconds } from "@/hooks/useElapsed";
import { useLessonRecorder, lessonRecordingFileName } from "@/hooks/useLessonRecorder";
import { useIsDesktopLayout } from "@/hooks/useMediaQuery";
import { useWebRTC } from "@/hooks/useWebRTC";
import type { WhiteboardSync } from "@/hooks/useWhiteboard";
import type { DrawingInstruction } from "@/lib/ai-provider";
import { canPinChatMessage } from "@/lib/chat-rules";
import { registerCallCleanup } from "@/lib/call-events";
import { participantCount } from "@/lib/call-rules";
import { decryptMessage, encryptMessage } from "@/lib/crypto";
import { drawCommand, getCanvasSnapshot } from "@/lib/whiteboard-bridge";
import type { JoinRoomResult } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { ROLE_LABELS, type Role } from "@/types";

export interface MeetingRoomProps {
  meetingCode: string;
  title: string;
  hostName: string;
  /** Ключ комнаты для AES-256 (отдаётся сервером только авторизованным). */
  encryptionKey: string;
  self: { id: string; name: string; role: Role };
  /**
   * Разовый допуск по коду класса (строгие школы, H-02): выдаётся
   * `ClassCodeGate` после проверки `Class.code`. Отправляется серверу при
   * каждом `join-room` (включая переподключение) — без него вход в урок
   * чужого класса строгой школы запрещён.
   */
  classCodeGrant?: string | null;
}

type Phase = "precheck" | "connecting" | "live";

const JOIN_TIMEOUT_MS = 15_000;

const SOCKET_STATUS_LABEL: Record<SocketStatus, string> = {
  idle: "Не подключено",
  connecting: "Подключение…",
  connected: "Онлайн",
  reconnecting: "Переподключение…",
  disconnected: "Отключено",
  error: "Ошибка соединения",
};

/**
 * Страница урока: предпроверка устройств → вход → видеосетка, чат и панель управления.
 * Сам оркестрирует два хука: `useSocket` (комната, чат, сигналинг) и `useWebRTC` (медиа и пиры).
 */
export function MeetingRoom({ meetingCode, title, hostName, encryptionKey, self, classCodeGrant }: MeetingRoomProps) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("precheck");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [callMeta, setCallMeta] = useState<{ hostId: string; roomId: string } | null>(null);
  const [endingCall, setEndingCall] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [seenCount, setSeenCount] = useState(0);
  const [chatError, setChatError] = useState<string | null>(null);
  /**
   * Закреплённые участники (мульти-закрепление): можно закрепить 2, 3 и более
   * человек сразу — их плитки идут первыми в сетке и в полоске участников.
   */
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  /** Глобальный ИИ-виджет (плавающая кнопка в углу экрана). */
  const [aiOpen, setAiOpen] = useState(false);
  /** Комната закрыта администратором или доступ отозван — показываем экран-заглушку. */
  const [closure, setClosure] = useState<{
    title: string;
    message: string;
    tone: "danger" | "info";
  } | null>(null);
  /**
   * Десктопная раскладка (`md` и выше): сцена + правая колонка «плитка
   * шоколада» с камерами. Ниже `md` лента участников становится
   * горизонтальной полоской в обычном потоке документа.
   */
  const desktopLayout = useIsDesktopLayout();

  // WebRTC-слой создаётся после сокета, поэтому колбэки сокета читают его через ref.
  const dropPeerRef = useRef<(socketId: string) => void>(() => undefined);
  const rejoinRef = useRef<(result: JoinRoomResult) => void>(() => undefined);
  const hangUpRef = useRef<() => void>(() => undefined);

  const socket = useSocket({
    onUserLeft: (socketId) => dropPeerRef.current(socketId),
    onRejoin: (result) => rejoinRef.current(result),
    onRoomClosed: (payload) => {
      // Админ завершил урок: гасим медиа и показываем экран «урок завершён».
      hangUpRef.current();
      setClosure({ title: "Урок завершён администратором", message: payload.message, tone: "danger" });
    },
    onSessionRevoked: (payload) => {
      hangUpRef.current();
      setClosure({ title: "Доступ отозван", message: payload.message, tone: "info" });
    },
    onCallEnded: (payload) => {
      hangUpRef.current();
      setClosure({
        title: "Звонок завершён",
        message: `Организатор ${payload.endedBy.name} завершил звонок для всех участников.`,
        tone: "info",
      });
    },
  });

  const rtc = useWebRTC({ sendSignal: socket.sendSignal, onSignal: socket.onSignal, getSelfId: socket.getSelfId });
  const { requestMedia, hangUp, connectToPeers, dropPeer, dropAllPeers, toggleMic, toggleCamera, toggleScreenShare } =
    rtc;
  const { sendMediaState, setHandRaised, sendChat, sendTyping, leaveRoom, disconnect } = socket;

  /* ---------------------------- Локальная запись ---------------------------- */

  /** Потоки для микса звука: свой микрофон и микрофоны участников комнаты. */
  const recordingAudioStreams = useMemo(() => {
    const streams: MediaStream[] = [];
    if (rtc.localStream) streams.push(rtc.localStream);
    rtc.peers.forEach((peer) => streams.push(peer.stream));
    return streams;
  }, [rtc.localStream, rtc.peers]);

  /**
   * Поток СВОЕЙ камеры (лицо), отдельно от демонстрации экрана.
   *
   * Раньше окошко «вы» и полоска участников показывали `localStream`, а он при
   * демонстрации экрана содержит ЭКРАН — получалась рекурсия: свой же экран
   * в мини-плитке. Теперь в плитке участников и в «картинке в углу» записи
   * строго камера (плюс дорожка микрофона для индикатора речи).
   */
  const localCameraStream = useMemo(() => {
    const audio = rtc.localStream?.getAudioTracks()[0] ?? null;
    const video = rtc.cameraTrack;
    const tracks = [video, audio].filter((track): track is MediaStreamTrack => Boolean(track));
    return tracks.length > 0 ? new MediaStream(tracks) : null;
  }, [rtc.localStream, rtc.cameraTrack]);

  /* ------------------------- Глобальный ИИ и доска ------------------------- */
  // UI Role Guard: ИИ-ассистент доступен только TEACHER и ADMIN
  // Проверка по сессии: session?.user?.role === 'TEACHER' || session?.user?.role === 'ADMIN'
  const sessionForAI = { user: { role: self.role } } as { user: { role: Role } };
  const isTeacherOrAdmin = sessionForAI?.user?.role === 'TEACHER' || sessionForAI?.user?.role === 'ADMIN';

  /** Мост «доска → ИИ»: снимок доски и рисование по инструкции ИИ. */
  const boardBridgeRef = useRef<WhiteboardAiBridge | null>(null);
  const handleAiBridge = useCallback((bridge: WhiteboardAiBridge | null) => {
    boardBridgeRef.current = bridge;
  }, []);
  // Мост ИИ↔доска: снимок и рисование идут через реестр whiteboard-bridge
  // (доска регистрируется сама при открытии); ref из пропса — запасной путь.
  const captureBoard = useCallback(
    () => getCanvasSnapshot() ?? boardBridgeRef.current?.captureBoard() ?? null,
    [],
  );
  const applyDrawing = useCallback((instructions: DrawingInstruction[]) => {
    if (!drawCommand(instructions).applied) boardBridgeRef.current?.applyDrawing(instructions);
  }, []);

  /** Адаптер доски поверх сокета — передаётся в Whiteboard/useWhiteboard. */
  const boardSync = useMemo<WhiteboardSync>(
    () => ({
      sendAdd: socket.sendWhiteboardAdd,
      sendModify: socket.sendWhiteboardModify,
      sendDelete: socket.sendWhiteboardDelete,
      sendClear: socket.sendWhiteboardClear,
      sendCursor: socket.sendWhiteboardCursor,
      sendAccess: socket.sendWhiteboardAccess,
      sendPage: socket.sendWhiteboardPage,
      requestState: socket.syncWhiteboard,
      subscribe: socket.onWhiteboard,
    }),
    [
      socket.sendWhiteboardAdd,
      socket.sendWhiteboardModify,
      socket.sendWhiteboardDelete,
      socket.sendWhiteboardClear,
      socket.sendWhiteboardCursor,
      socket.sendWhiteboardAccess,
      socket.sendWhiteboardPage,
      socket.syncWhiteboard,
      socket.onWhiteboard,
    ],
  );

  useEffect(() => {
    dropPeerRef.current = dropPeer;
    hangUpRef.current = hangUp;
    rejoinRef.current = (result) => {
      // Сервер забыл нас при разрыве связи: пересоздаём все соединения.
      dropAllPeers();
      setCallMeta({ hostId: result.hostId, roomId: result.roomId });
      setStartedAt(Date.parse(result.startedAt));
      const others = result.participants
        .filter((participant) => participant.socketId !== result.self.socketId)
        .map((participant) => participant.socketId);
      void connectToPeers(others, result.self.socketId);
    };
  }, [connectToPeers, dropAllPeers, dropPeer, hangUp]);

  // Предпроверка: сразу запрашиваем камеру и микрофон.
  useEffect(() => {
    void requestMedia();
  }, [requestMedia]);

  // Размонтирование страницы — завершаем звонок и освобождаем устройства.
  useEffect(() => () => hangUp(), [hangUp]);

  // Сообщаем собеседникам состояние своих устройств (иконки микрофона и камеры).
  useEffect(() => {
    if (phase !== "live") return;
    sendMediaState({ audio: rtc.media.audio, video: rtc.media.video, screen: rtc.media.screen });
  }, [phase, rtc.media.audio, rtc.media.video, rtc.media.screen, socket.selfId, sendMediaState]);

  const selfParticipant = socket.participants.find((participant) => participant.socketId === socket.selfId);
  const handRaised = selfParticipant?.handRaised ?? false;
  const raisedHandsCount = socket.participants.filter((participant) => participant.handRaised).length;

  /* ---------------------------------- Вход ---------------------------------- */

  const enterCall = async () => {
    setJoinError(null);
    setPhase("connecting");

    try {
      // `classCodeGrant` — допуск по коду класса (строгие школы): сервер
      // проверяет подпись и привязку к этому пользователю и комнате (H-02).
      const ack = await withTimeout(
        socket.joinRoom(meetingCode, { classCodeGrant: classCodeGrant ?? null }),
        JOIN_TIMEOUT_MS,
      );
      if (!ack.ok) {
        setJoinError(ack.error);
        setPhase("precheck");
        return;
      }

      const others = ack.data.participants
        .filter((participant) => participant.socketId !== ack.data.self.socketId)
        .map((participant) => participant.socketId);

      // Пока подключаемся, уже пришедшие сообщения не считаем новыми.
      setSeenCount(ack.data.history.length);
      setCallMeta({ hostId: ack.data.hostId, roomId: ack.data.roomId });
      setStartedAt(Date.parse(ack.data.startedAt));
      await connectToPeers(others, ack.data.self.socketId);
      setPhase("live");
    } catch (error) {
      setJoinError(describeJoinError(error));
      setPhase("precheck");
    }
  };

  const leave = () => {
    recorder.stop();
    hangUp();
    leaveRoom();
    disconnect();
    router.push("/meeting");
  };

  const isHost = callMeta?.hostId === self.id;

  const endForAll = async () => {
    if (!isHost || endingCall) return;
    setEndingCall(true);
    const ack = await socket.endCallForAll(callMeta?.roomId);
    if (!ack.ok) {
      setEndingCall(false);
      toast.error(ack.error);
    }
    // On success the server broadcasts CALL_ENDED; root useCallEvents cleans up
    // and redirects. Do not optimistically close the host before confirmation.
  };

  /**
   * Закрепить/открепить участника. Закрепленных может быть несколько:
   * повторный клик по закрепленной плитке убирает её из списка.
   */
  const togglePin = (tileId: string) => {
    setPinnedIds((current) =>
      current.includes(tileId) ? current.filter((id) => id !== tileId) : [...current, tileId],
    );
  };

  /* --------------------------------- Видео ---------------------------------- */

  const speakingStreams = useMemo(
    () => ({
      local: rtc.localStream,
      ...Object.fromEntries(rtc.peers.map((peer) => [peer.socketId, peer.stream])),
    }),
    [rtc.localStream, rtc.peers],
  );
  const speaking = useSpeakingIndicator(speakingStreams);

  const tiles: GridTile[] = useMemo(() => {
    const local: GridTile = {
      id: "local",
      name: self.name,
      role: self.role,
      // При демонстрации экрана в своей плитке показываем КАМЕРУ (лицо), а не
      // дубль экрана: `localStream` в этот момент содержит экран.
      stream: rtc.media.screen ? localCameraStream : rtc.localStream,
      isLocal: true,
      videoOn: rtc.media.video,
      audioOn: rtc.media.audio,
      screenOn: rtc.media.screen,
      handRaised,
      speaking: speaking.has("local"),
    };

    const remote: GridTile[] = socket.participants
      .filter((participant) => participant.socketId !== socket.selfId)
      .map((participant) => {
        const peer = rtc.peers.find((item) => item.socketId === participant.socketId);
        return {
          id: participant.socketId,
          name: participant.name,
          role: participant.role,
          stream: peer?.stream ?? null,
          videoOn: participant.media.video || participant.media.screen,
          audioOn: participant.media.audio,
          screenOn: participant.media.screen,
          handRaised: participant.handRaised,
          speaking: speaking.has(participant.socketId),
          connection: peer?.state ?? "connecting",
        };
      });

    return [local, ...remote];
  }, [
    self,
    rtc.localStream,
    rtc.media,
    rtc.peers,
    localCameraStream,
    handRaised,
    speaking,
    socket.participants,
    socket.selfId,
  ]);

  /**
   * Камера текущего спикера для записи: закреплённый участник → говорящий →
   * учитель → первый доступный. Свой экран в запись не попадает дважды.
   */
  const recordingSpeakerTrack = useMemo(() => {
    const screenTileId = tiles.find((tile) => tile.screenOn)?.id ?? null;
    const spotlight = pickSpotlightTile(tiles, pinnedIds, screenTileId);
    if (!spotlight) return null;
    // Свой поток: строго камера, даже при демонстрации экрана.
    if (spotlight.isLocal) return rtc.cameraTrack;
    // Чужой участник, который сам делится экраном, отправляет в видео-слот
    // экран — это дубль сцены, а не «картинка в углу». Берём следующего.
    if (spotlight.screenOn) return null;
    return spotlight.stream?.getVideoTracks()[0] ?? null;
  }, [tiles, pinnedIds, rtc.cameraTrack]);

  const recorder = useLessonRecorder({
    screenTrack: rtc.screenTrack,
    cameraTrack: rtc.cameraTrack,
    speakerCameraTrack: recordingSpeakerTrack,
    audioStreams: recordingAudioStreams,
  });

  const recordingSeconds = useElapsedSeconds(recorder.startedAt);

  // Global CALL_ENDED cleanup stops/saves the recording before tracks stop.
  const stopRecording = recorder.stop;
  useEffect(() => registerCallCleanup(stopRecording, 10), [stopRecording]);
  /** Имя файла текущей записи — показываем в подтверждении. */
  const recordingNameRef = useRef(lessonRecordingFileName());

  /* --------------------------------- Запись --------------------------------- */

  const wasRecording = useRef(false);

  useEffect(() => {
    if (recorder.isRecording && !wasRecording.current) {
      toast.success("Запись урока началась", {
        description: "Файл сохранится на ваш компьютер, когда вы остановите запись.",
      });
    }
    if (!recorder.isRecording && wasRecording.current) {
      toast.success("Запись остановлена", {
        description: `Файл ${recordingNameRef.current} сохранён на ваш компьютер.`,
      });
    }
    wasRecording.current = recorder.isRecording;
  }, [recorder.isRecording]);

  useEffect(() => {
    if (recorder.error) toast.error(recorder.error);
  }, [recorder.error]);

  const toggleRecording = () => {
    if (recorder.isRecording) {
      recorder.stop();
      return;
    }
    recordingNameRef.current = lessonRecordingFileName();
    void recorder.start();
  };

  /* ---------------------------------- Чат ----------------------------------- */

  const messages: ChatViewMessage[] = useMemo(
    () =>
      socket.messages.map((message) => ({
        id: message.id,
        createdAt: message.createdAt,
        author: message.author,
        recipient: message.recipient,
        text: tryDecrypt(message.ciphertext, encryptionKey),
      })),
    [socket.messages, encryptionKey],
  );

  /** Кому можно написать приватно: участники урока, кроме самого автора. */
  const chatRecipients: ChatRecipientOption[] = useMemo(() => {
    const seen = new Set<string>();
    const options: ChatRecipientOption[] = [];
    for (const participant of socket.participants) {
      if (participant.userId === self.id || seen.has(participant.userId)) continue;
      seen.add(participant.userId);
      options.push({ userId: participant.userId, name: participant.name });
    }
    return options.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [socket.participants, self.id]);

  useEffect(() => {
    if (chatOpen) setSeenCount(messages.length);
  }, [chatOpen, messages.length]);

  const unreadCount = chatOpen ? 0 : Math.max(0, messages.length - seenCount);

  /**
   * Закреплённое сообщение урока: сервер присылает конверт, текст
   * расшифровываем здесь же (AES-256). `null` — плашки нет.
   */
  const pinnedMessage: ChatViewMessage | null = useMemo(() => {
    const pinned = socket.pinnedMessage;
    if (!pinned) return null;
    return {
      id: pinned.id,
      createdAt: pinned.createdAt,
      author: pinned.author,
      recipient: pinned.recipient ? { userId: pinned.recipient.userId, name: pinned.recipient.name } : null,
      text: tryDecrypt(pinned.ciphertext, encryptionKey),
    };
  }, [socket.pinnedMessage, encryptionKey]);

  /** Закреплять и откреплять сообщения может только учитель/администратор. */
  const canPinMessages = canPinChatMessage(self.role);

  /** Закрепить сообщение (кнопка на пузыре) — сервер проверяет право. */
  const handlePinMessage = (messageId: string) => {
    void socket.pinMessage(messageId);
  };

  /** Открепить: крестик в плашке сбрасывает закрепление у всей комнаты. */
  const handleUnpinMessage = () => {
    void socket.pinMessage(null);
  };

  /** `recipientId = null` — сообщение всей комнате, иначе приватное адресату. */
  const sendMessage = async (text: string, recipientId: string | null): Promise<boolean> => {
    if (text.length > CHAT_MAX_MESSAGE_LENGTH) return false;
    setChatError(null);
    const ciphertext = encryptMessage(text, encryptionKey);
    const ack = await sendChat(ciphertext, recipientId);
    if (!ack.ok) setChatError(ack.error);
    return ack.ok;
  };

  const elapsed = useElapsedSeconds(startedAt);
  const isLive = phase === "live";
  /** Кто-то (вы или участник) делится экраном — включаем режим Filmstrip. */
  const screenShareActive = useMemo(() => tiles.some((tile) => tile.screenOn), [tiles]);

  /* ---------------------------------- Разметка ------------------------------ */

  /* Урок закрыт администратором или доступ отозван — вместо комнаты экран-заглушка. */
  if (closure) {
    const isDanger = closure.tone === "danger";

    return (
      <div className="relative flex h-dvh min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-ink-950 px-5">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div
            className={`absolute left-1/2 top-0 h-[24rem] w-[24rem] -translate-x-1/2 rounded-full blur-[150px] ${
              isDanger ? "bg-rose-500/15" : "bg-brand-600/20"
            }`}
          />
        </div>

        <div className="glass-strong animate-fade-up w-full max-w-lg rounded-3xl p-8 text-center">
          <span
            className={`mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl border ${
              isDanger ? "border-rose-400/30 bg-rose-500/15" : "border-brand-400/30 bg-brand-500/15"
            }`}
          >
            {isDanger ? (
              <PhoneOff className="h-6 w-6 text-rose-300" />
            ) : (
              <ShieldAlert className="h-6 w-6 text-brand-200" />
            )}
          </span>

          <h1 className="mt-5 text-xl font-semibold text-white">{closure.title}</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">{closure.message}</p>
          <p className="mt-2 text-xs text-slate-500">
            Урок <span className="font-mono text-slate-300">{meetingCode}</span> · {title}
          </p>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-gradient px-5 py-3 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.02]"
            >
              <LogOut className="h-4 w-4" />
              В кабинет
            </Link>
            <Link
              href="/meeting"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/10"
            >
              Другие уроки
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-dvh min-h-[100dvh] flex-col overflow-hidden bg-ink-950">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/4 top-0 h-[28rem] w-[28rem] rounded-full bg-brand-600/20 blur-[150px]" />
        <div className="absolute right-0 top-1/3 h-[24rem] w-[24rem] rounded-full bg-accent-500/15 blur-[150px]" />
      </div>

      {/* Шапка звонка */}
      <header className="glass z-10 flex h-16 shrink-0 items-center gap-3 border-x-0 border-t-0 px-4 sm:px-6">
        <Logo size="sm" showWordmark={false} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{title}</p>
          <p className="truncate text-[11px] text-slate-400">
            <span className="font-mono text-slate-300">{meetingCode}</span> · {hostName} ·{" "}
            {ROLE_LABELS[self.role]}
          </p>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
              socket.status === "connected"
                ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                : socket.status === "error" || socket.status === "disconnected"
                  ? "border-rose-400/25 bg-rose-500/10 text-rose-200"
                  : "border-amber-400/25 bg-amber-500/10 text-amber-200",
            )}
          >
            {socket.status === "connected" ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {SOCKET_STATUS_LABEL[socket.status]}
          </span>

          {isLive && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-slate-200">
              <Users className="h-3.5 w-3.5 text-accent-300" />
              {socket.participants.length}
            </span>
          )}
        </div>

        <span
          aria-label="Длительность звонка"
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 font-mono text-sm tabular-nums",
            isLive
              ? "border-accent-400/30 bg-accent-500/10 text-accent-200 shadow-glow-accent"
              : "border-white/10 bg-white/[0.04] text-slate-500",
          )}
        >
          {isLive && <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />}
          <Clock3 className="h-3.5 w-3.5" />
          {formatDuration(elapsed)}
        </span>
      </header>

      {/* Основная область */}
      <main className="flex min-h-0 flex-1 flex-col">
        {phase !== "live" ? (
          <div className="flex-1 overflow-y-auto">
            <PreJoinScreen
              title={title}
              meetingCode={meetingCode}
              hostName={hostName}
              self={self}
              stream={rtc.localStream}
              micOn={rtc.media.audio}
              camOn={rtc.media.video}
              speaking={speaking.has("local")}
              devices={rtc.devices}
              mediaError={rtc.mediaError}
              joinError={joinError}
              isConnecting={phase === "connecting"}
              onToggleMic={() => void toggleMic()}
              onToggleCamera={() => void toggleCamera()}
              onJoin={() => void enterCall()}
            />
          </div>
        ) : (
          <>
            {rtc.networkError && (
              <div className="px-3 pt-3">
                <FormAlert variant="error">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>{rtc.networkError}</span>
                    <button
                      type="button"
                      onClick={rtc.retryConnections}
                      className="rounded-lg border border-rose-300/30 px-3 py-1 text-xs font-semibold hover:bg-rose-500/10"
                    >
                      Повторить подключение
                    </button>
                  </div>
                </FormAlert>
              </div>
            )}
            {/*
              Мобильные (< md): при демонстрации экрана лента участников идёт
              горизонтальной полоской в ОБЫЧНОМ потоке документа — не absolute
              и не поверх сцены. Поэтому она не перекрывает ни тулбар доски,
              ни нижнюю панель управления, и на смартфоне не наслаиваются 3+
              камер друг на друга.
            */}
            {screenShareActive && !boardOpen && !desktopLayout && (
              <div className="shrink-0 px-3 pt-3">
                <Filmstrip tiles={tiles} pinnedIds={pinnedIds} onPin={togglePin} />
              </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 pb-0">
              <div className="flex min-h-0 flex-1 gap-3">
                <div className="glass relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-3xl">
                  {rtc.mediaError && (
                    <div className="absolute inset-x-4 top-4 z-10">
                      <FormAlert variant="error">{rtc.mediaError}</FormAlert>
                    </div>
                  )}
                  {/*
                    Когда открыта доска, сетка «молчит» (silent): звук участников
                    в этот момент играет из Filmstrip внутри оверлея доски. ТРЕКИ
                    НЕ отключаем — видео и сигналы продолжают идти, вход/выход
                    участников не пересоздаётся.
                  */}
                  <VideoGrid tiles={tiles} pinnedIds={pinnedIds} onPin={togglePin} silent={boardOpen} />
                </div>

                {/*
                  Десктоп (md+): правая колонка «плитка шоколада» — камеры
                  участников столбиком с вертикальной прокруткой, когда сцена
                  занята демонстрацией экрана. При открытой доске эту колонку
                  рендерит сам оверлей доски, поэтому здесь только экран.
                */}
                {screenShareActive && !boardOpen && desktopLayout && (
                  <aside
                    className="hidden min-h-0 w-60 shrink-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-ink-950/60 md:flex lg:w-72"
                    aria-label="Камеры участников"
                  >
                    <Filmstrip tiles={tiles} pinnedIds={pinnedIds} onPin={togglePin} layout="vertical" />
                  </aside>
                )}

                {chatOpen && (
                  <div className="animate-fade-in hidden min-h-0 md:flex">
                    <Chat
                      messages={messages}
                      selfUserId={self.id}
                      recipients={chatRecipients}
                      onSend={sendMessage}
                      onTyping={sendTyping}
                      typingNames={socket.typingUsers.map((user) => user.name)}
                      onClose={() => setChatOpen(false)}
                      pinnedMessage={pinnedMessage}
                      canPinMessages={canPinMessages}
                      onPinMessage={handlePinMessage}
                      onUnpinMessage={handleUnpinMessage}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Мобильный чат — поверх сетки */}
            {chatOpen && (
              <div className="animate-fade-in safe-mb fixed inset-x-3 bottom-24 top-20 z-40 md:hidden">
                <Chat
                  messages={messages}
                  selfUserId={self.id}
                  recipients={chatRecipients}
                  onSend={sendMessage}
                  onTyping={sendTyping}
                  onClose={() => setChatOpen(false)}
                  pinnedMessage={pinnedMessage}
                  canPinMessages={canPinMessages}
                  onPinMessage={handlePinMessage}
                  onUnpinMessage={handleUnpinMessage}
                />
              </div>
            )}

            {chatError && (
              <p className="mx-auto mt-2 text-xs text-rose-300">{chatError}</p>
            )}
          </>
        )}
      </main>

      {/* Нижняя панель */}
      {isLive && (
        <footer className="safe-pb flex shrink-0 justify-center px-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3">
          <Controls
            micOn={rtc.media.audio}
            camOn={rtc.media.video}
            screenOn={rtc.media.screen}
            hasMic={rtc.devices.hasMic}
            hasCamera={rtc.devices.hasCamera}
            chatOpen={chatOpen}
            unreadCount={unreadCount}
            boardOpen={boardOpen}
            handRaised={handRaised}
            raisedHandsCount={raisedHandsCount}
            recording={recorder.isRecording}
            recordingSupported={recorder.isSupported}
            recordingSeconds={recordingSeconds}
            onToggleMic={() => void toggleMic()}
            onToggleCamera={() => void toggleCamera()}
            onToggleScreen={() => void toggleScreenShare()}
            onToggleChat={() => setChatOpen((open) => !open)}
            onToggleBoard={() => setBoardOpen((open) => !open)}
            onToggleHand={() => setHandRaised(!handRaised)}
            onToggleRecording={toggleRecording}
            onLeave={leave}
            isHost={isHost}
            participantCount={participantCount(socket.participants)}
            endingCall={endingCall}
            onEndForAll={() => void endForAll()}
          />
        </footer>
      )}

      {/* Интерактивная доска (поверх звонка) */}
      {isLive && boardOpen && (
        <Whiteboard
          self={self}
          meetingTitle={title}
          sync={boardSync}
          aiOpen={aiOpen}
          onAiOpenChange={setAiOpen}
          onAiBridge={handleAiBridge}
          // Filmstrip СВЕРХУ над тулбаром доски: камеры участников остаются
          // видимыми, треки не отключаются, тулбар под полоской кликабелен.
          topStrip={<Filmstrip tiles={tiles} pinnedIds={pinnedIds} onPin={togglePin} />}
          onClose={() => setBoardOpen(false)}
        />
      )}

      {/* Глобальный ИИ-ассистент: плавающая кнопка + окно поверх любой страницы урока.
          При открытой доске окно не заходит в верхнюю зону (шапка + Filmstrip +
          тулбар доски) — тулбар остаётся видимым и кликабельным.
          UI Role Guard: показывается только если session?.user?.role === 'TEACHER' || session?.user?.role === 'ADMIN' */}
      {isLive && isTeacherOrAdmin && (
        <AIWidget
          role={self.role}
          meetingTitle={title}
          open={aiOpen}
          onOpenChange={setAiOpen}
          onApplyDrawing={applyDrawing}
          captureBoard={captureBoard}
          chatMessages={messages}
          reservedTop={boardOpen ? WHITEBOARD_TOP_RESERVED_PX : undefined}
        />
      )}
    </div>
  );
}

/** Расшифровка сообщения: при неверном ключе возвращаем null, а не падаем. */
function tryDecrypt(ciphertext: string, key: string): string | null {
  try {
    return decryptMessage(ciphertext, key);
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("TIMEOUT")), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function describeJoinError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  switch (message) {
    case "UNAUTHORIZED":
      return "Сессия истекла. Войдите в систему заново.";
    case "FORBIDDEN_ORIGIN":
      return "Соединение заблокировано: откройте урок с адреса приложения EduFlow.";
    case "ACCOUNT_BANNED":
      return "Аккаунт заблокирован администратором. Доступ к урокам закрыт.";
    case "RATE_LIMITED":
      return "Слишком много попыток подключения. Подождите минуту и попробуйте снова.";
    case "TIMEOUT":
      return "Сервер не отвечает. Проверьте интернет и попробуйте ещё раз.";
    default:
      return "Не удалось войти в урок. Попробуйте ещё раз.";
  }
}
