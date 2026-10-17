"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import {
  SOCKET_PATH,
  type Ack,
  type ChatEnvelope,
  type ClientToServerEvents,
  type JoinRoomResult,
  type MediaState,
  type RoomClosedPayload,
  type RoomParticipant,
  type SessionRevokedPayload,
  type ServerToClientEvents,
  type SignalData,
  type WhiteboardClearPayload,
  type WhiteboardCursorPayload,
  type WhiteboardDeletePayload,
  type WhiteboardDrawPolicy,
  type WhiteboardObjectPayload,
  type WhiteboardServerEvent,
  type WhiteboardState,
} from "@/lib/realtime";

/**
 * Подключение к Socket.IO-серверу Лицея Сингулярити и события комнаты.
 *
 * Сокет создаётся лениво и подключается только по `connect()` / `joinRoom()`.
 * Авторизация — по cookie сессии NextAuth, поэтому отдельный токен не нужен.
 * После разрыва связи хук сам переподключается и заново входит в комнату
 * (сервер при разрыве забывает участника), а вызывающий код получает `onRejoin`,
 * чтобы пересоздать WebRTC-соединения.
 */

export type SocketStatus = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type SignalHandler = (from: string, data: SignalData) => void;
type WhiteboardHandler = (event: WhiteboardServerEvent) => void;

/**
 * Ошибки, при которых переподключаться бессмысленно: нет сессии, чужой origin,
 * заблокированный аккаунт или превышен лимит рукопожатий (этап 6).
 */
const FATAL_CONNECT_ERRORS = new Set(["UNAUTHORIZED", "FORBIDDEN_ORIGIN", "ACCOUNT_BANNED", "RATE_LIMITED"]);

const MAX_CHAT_HISTORY = 100;

export interface UseSocketOptions {
  /** Участник вышел из комнаты — закрыть его WebRTC-соединение. */
  onUserLeft?: (socketId: string) => void;
  /** Сокет переподключился и снова вошёл в комнату — пересоздать пиры. */
  onRejoin?: (result: JoinRoomResult) => void;
  /** Администратор завершил урок — комната закрыта, переподключаться нельзя. */
  onRoomClosed?: (payload: RoomClosedPayload) => void;
  /** Доступ отозван (блокировка аккаунта) — сокет будет разорван сервером. */
  onSessionRevoked?: (payload: SessionRevokedPayload) => void;
}

export function useSocket(options: UseSocketOptions = {}) {
  const [status, setStatus] = useState<SocketStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [messages, setMessages] = useState<ChatEnvelope[]>([]);
  const [typingUsers, setTypingUsers] = useState<Array<{ socketId: string; name: string }>>([]);

  const socketRef = useRef<ClientSocket | null>(null);
  const roomRef = useRef<string | null>(null);
  const hasConnectedRef = useRef(false);
  /** Комната закрыта администратором или доступ отозван — не переподключаемся. */
  const terminatedRef = useRef(false);
  const signalHandlersRef = useRef(new Set<SignalHandler>());
  const whiteboardHandlersRef = useRef(new Set<WhiteboardHandler>());
  const typingTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const optionsRef = useRef(options);

  const emitWhiteboard = useCallback((event: WhiteboardServerEvent) => {
    whiteboardHandlersRef.current.forEach((handler) => handler(event));
  }, []);

  useEffect(() => {
    optionsRef.current = options;
  });

  const updateParticipant = useCallback(
    (socketId: string, update: (participant: RoomParticipant) => RoomParticipant) => {
      setParticipants((prev) => prev.map((item) => (item.socketId === socketId ? update(item) : item)));
    },
    [],
  );

  const applyJoinResult = useCallback((result: JoinRoomResult) => {
    setSelfId(result.self.socketId);
    setParticipants(result.participants);
    setMessages(result.history.slice(-MAX_CHAT_HISTORY));
    setTypingUsers([]);
    typingTimersRef.current.forEach(clearTimeout);
    typingTimersRef.current.clear();
  }, []);

  /** Создаём сокет один раз и вешаем постоянные обработчики. */
  const getSocket = useCallback((): ClientSocket => {
    if (socketRef.current) return socketRef.current;

    const socket: ClientSocket = io({
      path: SOCKET_PATH,
      withCredentials: true,
      transports: ["websocket", "polling"],
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
    });

    socket.on("connect", () => {
      setSelfId(socket.id ?? null);
      setError(null);

      const isReconnect = hasConnectedRef.current;
      hasConnectedRef.current = true;
      setStatus("connected");

      const roomId = roomRef.current;
      if (isReconnect && roomId) {
        socket.emit("join-room", { roomId }, (ack: Ack<JoinRoomResult>) => {
          if (!ack.ok) {
            roomRef.current = null;
            setError(ack.error);
            if (ack.code === "SCHOOL_MISMATCH") {
              terminatedRef.current = true;
              socket.disconnect();
              setStatus("error");
            }
            return;
          }
          applyJoinResult(ack.data);
          optionsRef.current.onRejoin?.(ack.data);
        });
      }
    });

    socket.on("disconnect", (reason) => {
      if (reason === "io client disconnect" || terminatedRef.current) {
        setStatus("disconnected");
        return;
      }
      // Сервер сам разорвал соединение. Socket.IO в этом случае не переподключается,
      // поэтому делаем это вручную. Если сессия истекла, connect_error вернёт UNAUTHORIZED.
      setStatus("reconnecting");
      if (reason === "io server disconnect") socket.connect();
    });

    /* Админ завершил урок: комната закрыта, участники выходят. */
    socket.on("room-closed", (payload) => {
      terminatedRef.current = true;
      roomRef.current = null;
      setParticipants([]);
      setMessages([]);
      setStatus("disconnected");
      optionsRef.current.onRoomClosed?.(payload);
    });

    /* Аккаунт заблокирован: сервер сам разорвёт соединение. */
    socket.on("session-revoked", (payload) => {
      terminatedRef.current = true;
      roomRef.current = null;
      setParticipants([]);
      setMessages([]);
      setStatus("error");
      setError(payload.message);
      optionsRef.current.onSessionRevoked?.(payload);
    });

    socket.on("connect_error", (err) => {
      setError(err.message);
      if (FATAL_CONNECT_ERRORS.has(err.message)) {
        setStatus("error");
        socket.disconnect();
        return;
      }
      setStatus(hasConnectedRef.current ? "reconnecting" : "connecting");
    });

    socket.on("user-joined", (participant) => {
      setParticipants((prev) => [...prev.filter((item) => item.socketId !== participant.socketId), participant]);
    });

    socket.on("user-left", ({ socketId }) => {
      setParticipants((prev) => prev.filter((item) => item.socketId !== socketId));
      optionsRef.current.onUserLeft?.(socketId);
    });

    socket.on("signal", ({ from, data }) => {
      signalHandlersRef.current.forEach((handler) => handler(from, data));
    });

    socket.on("raise-hand", ({ socketId, raised }) => {
      updateParticipant(socketId, (item) => ({ ...item, handRaised: raised }));
    });

    socket.on("media-state", ({ socketId, media }) => {
      updateParticipant(socketId, (item) => ({ ...item, media }));
    });

    socket.on("chat-message", (message) => {
      setMessages((prev) => [...prev, message].slice(-MAX_CHAT_HISTORY));
    });

    socket.on("typing", ({ socketId, name }) => {
      setTypingUsers((previous) => [
        ...previous.filter((user) => user.socketId !== socketId),
        { socketId, name },
      ]);
      const existing = typingTimersRef.current.get(socketId);
      if (existing) clearTimeout(existing);
      typingTimersRef.current.set(socketId, setTimeout(() => {
        typingTimersRef.current.delete(socketId);
        setTypingUsers((previous) => previous.filter((user) => user.socketId !== socketId));
      }, 3500));
    });

    socket.on("whiteboard-add", (payload) => emitWhiteboard({ type: "add", payload }));
    socket.on("whiteboard-modify", (payload) => emitWhiteboard({ type: "modify", payload }));
    socket.on("whiteboard-delete", (payload) => emitWhiteboard({ type: "delete", payload }));
    socket.on("whiteboard-clear", (payload) => emitWhiteboard({ type: "clear", payload }));
    socket.on("whiteboard-cursor", (payload) => emitWhiteboard({ type: "cursor", payload }));
    socket.on("whiteboard-access", (payload) => emitWhiteboard({ type: "access", payload }));
    socket.on("whiteboard-page", (payload) => emitWhiteboard({ type: "page", payload }));

    socketRef.current = socket;
    return socket;
  }, [applyJoinResult, emitWhiteboard, updateParticipant]);

  /** Подключается к серверу. Резолвится, когда соединение установлено. */
  const connect = useCallback((): Promise<void> => {
    const socket = getSocket();
    if (socket.connected) return Promise.resolve();

    setStatus((current) => (current === "connected" ? current : "connecting"));

    return new Promise((resolve, reject) => {
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        if (!FATAL_CONNECT_ERRORS.has(err.message)) return;
        cleanup();
        reject(new Error(err.message));
      };
      const cleanup = () => {
        socket.off("connect", onConnect);
        socket.off("connect_error", onError);
      };

      socket.on("connect", onConnect);
      socket.on("connect_error", onError);
      socket.connect();
    });
  }, [getSocket]);

  /** Входит в комнату урока по коду. Подключается, если сокета ещё нет. */
  const joinRoom = useCallback(
    async (roomId: string): Promise<Ack<JoinRoomResult>> => {
      await connect();
      const socket = getSocket();

      return new Promise((resolve) => {
        socket.emit("join-room", { roomId }, (ack: Ack<JoinRoomResult>) => {
          if (ack.ok) {
            roomRef.current = roomId;
            applyJoinResult(ack.data);
          } else {
            roomRef.current = null;
            setError(ack.error);
            if (ack.code === "SCHOOL_MISMATCH") {
              terminatedRef.current = true;
              socket.disconnect();
              setStatus("error");
            }
          }
          resolve(ack);
        });
      });
    },
    [applyJoinResult, connect, getSocket],
  );

  const leaveRoom = useCallback(() => {
    roomRef.current = null;
    setParticipants([]);
    setMessages([]);
    setTypingUsers([]);
    typingTimersRef.current.forEach(clearTimeout);
    typingTimersRef.current.clear();
    socketRef.current?.emit("leave-room");
  }, []);

  const disconnect = useCallback(() => {
    roomRef.current = null;
    socketRef.current?.disconnect();
    setStatus("disconnected");
  }, []);

  const sendSignal = useCallback(
    (to: string, data: SignalData) => {
      socketRef.current?.emit("signal", { to, data });
    },
    [],
  );

  /** Подписка на входящие SDP/ICE-сообщения. Возвращает функцию отписки. */
  const onSignal = useCallback((handler: SignalHandler) => {
    signalHandlersRef.current.add(handler);
    return () => {
      signalHandlersRef.current.delete(handler);
    };
  }, []);

  const setHandRaised = useCallback((raised: boolean) => {
    socketRef.current?.emit("raise-hand", { raised });
  }, []);

  const sendMediaState = useCallback((media: MediaState) => {
    socketRef.current?.emit("media-state", media);
  }, []);

  const sendTyping = useCallback(() => {
    socketRef.current?.emit("typing");
  }, []);

  /**
   * Отправляет уже зашифрованное сообщение. Возвращает ack сервера.
   *
   * `recipientId = null` (по умолчанию) — сообщение для всей комнаты,
   * иначе сервер доставит его только адресату и автору.
   */
  const sendChat = useCallback(
    (ciphertext: string, recipientId: string | null = null): Promise<Ack<{ id: string }>> => {
      const socket = socketRef.current;
      if (!socket?.connected) {
        return Promise.resolve({ ok: false, code: "OFFLINE", error: "Нет соединения с сервером" });
      }
      return new Promise((resolve) => {
        socket.emit("chat-message", { ciphertext, recipientId }, (ack) => resolve(ack));
      });
    },
    [],
  );

  /* ------------------------------- Доска --------------------------------- */

  /** Отправляет событие доски и возвращает true, если сервер его принял. */
  const sendWhiteboard = useCallback(
    async (
      emit: (ack: (result: Ack) => void) => void,
    ): Promise<boolean> => {
      const socket = socketRef.current;
      if (!socket?.connected) return false;
      return new Promise((resolve) => {
        emit((result) => resolve(result.ok));
      });
    },
    [],
  );

  const sendWhiteboardAdd = useCallback(
    (payload: WhiteboardObjectPayload) =>
      sendWhiteboard((ack) => socketRef.current?.emit("whiteboard-add", payload, ack)),
    [sendWhiteboard],
  );

  const sendWhiteboardModify = useCallback(
    (payload: WhiteboardObjectPayload) =>
      sendWhiteboard((ack) => socketRef.current?.emit("whiteboard-modify", payload, ack)),
    [sendWhiteboard],
  );

  const sendWhiteboardDelete = useCallback(
    (payload: WhiteboardDeletePayload) =>
      sendWhiteboard((ack) => socketRef.current?.emit("whiteboard-delete", payload, ack)),
    [sendWhiteboard],
  );

  const sendWhiteboardClear = useCallback(
    (payload: WhiteboardClearPayload) =>
      sendWhiteboard((ack) => socketRef.current?.emit("whiteboard-clear", payload, ack)),
    [sendWhiteboard],
  );

  const sendWhiteboardAccess = useCallback(
    (payload: { drawPolicy: WhiteboardDrawPolicy }) =>
      sendWhiteboard((ack) => socketRef.current?.emit("whiteboard-access", payload, ack)),
    [sendWhiteboard],
  );

  const sendWhiteboardPage = useCallback(
    (payload: { page: number }) =>
      sendWhiteboard((ack) => socketRef.current?.emit("whiteboard-page", payload, ack)),
    [sendWhiteboard],
  );

  /** Курсор — без ack, отправляется часто и теряет старые значения. */
  const sendWhiteboardCursor = useCallback((payload: WhiteboardCursorPayload) => {
    socketRef.current?.emit("whiteboard-cursor", payload);
  }, []);

  /** Запрашивает полное состояние доски (при открытии панели). */
  const syncWhiteboard = useCallback((): Promise<WhiteboardState | null> => {
    const socket = socketRef.current;
    if (!socket?.connected) return Promise.resolve(null);
    return new Promise((resolve) => {
      socket.emit("whiteboard-sync", undefined, (ack: Ack<WhiteboardState>) => {
        resolve(ack.ok ? ack.data : null);
      });
    });
  }, []);

  /** Подписка на входящие события доски. Возвращает функцию отписки. */
  const onWhiteboard = useCallback((handler: WhiteboardHandler) => {
    whiteboardHandlersRef.current.add(handler);
    return () => {
      whiteboardHandlersRef.current.delete(handler);
    };
  }, []);

  // Отключаемся при размонтировании страницы урока.
  useEffect(() => {
    const typingTimers = typingTimersRef.current;
    return () => {
      socketRef.current?.disconnect();
      typingTimers.forEach(clearTimeout);
      typingTimers.clear();
      socketRef.current = null;
      hasConnectedRef.current = false;
    };
  }, []);

  return {
    status,
    error,
    selfId,
    participants,
    messages,
    typingUsers,
    connect,
    joinRoom,
    leaveRoom,
    disconnect,
    sendSignal,
    onSignal,
    setHandRaised,
    sendMediaState,
    sendTyping,
    sendChat,
    sendWhiteboardAdd,
    sendWhiteboardModify,
    sendWhiteboardDelete,
    sendWhiteboardClear,
    sendWhiteboardCursor,
    sendWhiteboardAccess,
    sendWhiteboardPage,
    syncWhiteboard,
    onWhiteboard,
  };
}
