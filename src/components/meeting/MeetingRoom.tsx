"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, Users, Wifi, WifiOff } from "lucide-react";

import { Chat, CHAT_MAX_MESSAGE_LENGTH, type ChatViewMessage } from "@/components/meeting/Chat";
import { Controls } from "@/components/meeting/Controls";
import { PreJoinScreen } from "@/components/meeting/PreJoinScreen";
import { VideoGrid, type GridTile } from "@/components/meeting/VideoGrid";
import { FormAlert } from "@/components/ui/form-alert";
import { Logo } from "@/components/landing/logo";
import { useSocket, type SocketStatus } from "@/hooks/useSocket";
import { useSpeakingIndicator } from "@/hooks/useSpeakingIndicator";
import { formatDuration, useElapsedSeconds } from "@/hooks/useElapsed";
import { useWebRTC } from "@/hooks/useWebRTC";
import { decryptMessage, encryptMessage } from "@/lib/crypto";
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
export function MeetingRoom({ meetingCode, title, hostName, encryptionKey, self }: MeetingRoomProps) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("precheck");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [seenCount, setSeenCount] = useState(0);
  const [chatError, setChatError] = useState<string | null>(null);

  // WebRTC-слой создаётся после сокета, поэтому колбэки сокета читают его через ref.
  const dropPeerRef = useRef<(socketId: string) => void>(() => undefined);
  const rejoinRef = useRef<(result: JoinRoomResult) => void>(() => undefined);

  const socket = useSocket({
    onUserLeft: (socketId) => dropPeerRef.current(socketId),
    onRejoin: (result) => rejoinRef.current(result),
  });

  const rtc = useWebRTC({ sendSignal: socket.sendSignal, onSignal: socket.onSignal });
  const { requestMedia, hangUp, connectToPeers, dropPeer, dropAllPeers, toggleMic, toggleCamera, toggleScreenShare } =
    rtc;
  const { sendMediaState, setHandRaised, sendChat, leaveRoom, disconnect } = socket;

  useEffect(() => {
    dropPeerRef.current = dropPeer;
    rejoinRef.current = (result) => {
      // Сервер забыл нас при разрыве связи: пересоздаём все соединения.
      dropAllPeers();
      const others = result.participants
        .filter((participant) => participant.socketId !== result.self.socketId)
        .map((participant) => participant.socketId);
      void connectToPeers(others);
    };
  }, [connectToPeers, dropAllPeers, dropPeer]);

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
      const ack = await withTimeout(socket.joinRoom(meetingCode), JOIN_TIMEOUT_MS);
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
      await connectToPeers(others);

      setStartedAt(Date.now());
      setPhase("live");
    } catch (error) {
      setJoinError(describeJoinError(error));
      setPhase("precheck");
    }
  };

  const leave = () => {
    hangUp();
    leaveRoom();
    disconnect();
    router.push("/dashboard");
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
      stream: rtc.localStream,
      isLocal: true,
      videoOn: rtc.media.video || rtc.media.screen,
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
  }, [self, rtc.localStream, rtc.media, rtc.peers, handRaised, speaking, socket.participants, socket.selfId]);

  /* ---------------------------------- Чат ----------------------------------- */

  const messages: ChatViewMessage[] = useMemo(
    () =>
      socket.messages.map((message) => ({
        id: message.id,
        createdAt: message.createdAt,
        author: message.author,
        text: tryDecrypt(message.ciphertext, encryptionKey),
      })),
    [socket.messages, encryptionKey],
  );

  useEffect(() => {
    if (chatOpen) setSeenCount(messages.length);
  }, [chatOpen, messages.length]);

  const unreadCount = chatOpen ? 0 : Math.max(0, messages.length - seenCount);

  const sendMessage = async (text: string): Promise<boolean> => {
    if (text.length > CHAT_MAX_MESSAGE_LENGTH) return false;
    setChatError(null);
    const ciphertext = encryptMessage(text, encryptionKey);
    const ack = await sendChat(ciphertext);
    if (!ack.ok) setChatError(ack.error);
    return ack.ok;
  };

  const elapsed = useElapsedSeconds(startedAt);
  const isLive = phase === "live";

  /* ---------------------------------- Разметка ------------------------------ */

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-ink-950">
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
            <div className="flex min-h-0 flex-1 gap-3 p-3 pb-0">
              <div className="glass relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-3xl">
                {rtc.mediaError && (
                  <div className="absolute inset-x-4 top-4 z-10">
                    <FormAlert variant="error">{rtc.mediaError}</FormAlert>
                  </div>
                )}
                <VideoGrid tiles={tiles} />
              </div>

              {chatOpen && (
                <div className="animate-fade-in hidden min-h-0 md:flex">
                  <Chat
                    messages={messages}
                    selfUserId={self.id}
                    onSend={sendMessage}
                    onClose={() => setChatOpen(false)}
                  />
                </div>
              )}
            </div>

            {/* Мобильный чат — поверх сетки */}
            {chatOpen && (
              <div className="animate-fade-in fixed inset-x-3 bottom-24 top-20 z-40 md:hidden">
                <Chat
                  messages={messages}
                  selfUserId={self.id}
                  onSend={sendMessage}
                  onClose={() => setChatOpen(false)}
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
        <footer className="flex shrink-0 justify-center px-3 pb-4 pt-3">
          <Controls
            micOn={rtc.media.audio}
            camOn={rtc.media.video}
            screenOn={rtc.media.screen}
            hasMic={rtc.devices.hasMic}
            hasCamera={rtc.devices.hasCamera}
            chatOpen={chatOpen}
            unreadCount={unreadCount}
            handRaised={handRaised}
            raisedHandsCount={raisedHandsCount}
            onToggleMic={() => void toggleMic()}
            onToggleCamera={() => void toggleCamera()}
            onToggleScreen={() => void toggleScreenShare()}
            onToggleChat={() => setChatOpen((open) => !open)}
            onToggleHand={() => setHandRaised(!handRaised)}
            onLeave={leave}
          />
        </footer>
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
      return "Соединение заблокировано: откройте урок с адреса приложения SchoolMeet.";
    case "TIMEOUT":
      return "Сервер не отвечает. Проверьте интернет и попробуйте ещё раз.";
    default:
      return "Не удалось войти в урок. Попробуйте ещё раз.";
  }
}
