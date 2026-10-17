"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_MEDIA_STATE, type MediaState, type SignalData } from "@/lib/realtime";
import { getIceServers } from "@/lib/webrtc-config";

/**
 * WebRTC-слой звонка: локальные камера / микрофон / демонстрация экрана и mesh-соединения
 * с участниками комнаты.
 *
 * Сигналинг (SDP offer/answer и ICE-кандидаты) идёт через Socket.IO-событие `signal`
 * (см. `useSocket`). Медиа-поток — напрямую между браузерами (`RTCPeerConnection`).
 *
 * Правило переговоров без «гонки»: тот, кто входит в комнату, отправляет offer всем
 * уже находящимся там; уже находящиеся только отвечают на offer.
 *
 * Трансиверы (аудио и видео, sendrecv) привязываются к m-line из SDP: инициатор создаёт
 * их до offer, отвечающий берёт уже сопоставленные с offer трансиверы. Так оба
 * направления попадают в SDP, а включение камеры, микрофона или экрана делается
 * через `replaceTrack` без повторной переговорки.
 */

export type PeerConnectionState = "connecting" | "connected" | "failed";

export interface RemotePeer {
  socketId: string;
  stream: MediaStream;
  state: PeerConnectionState;
}

export interface DeviceAvailability {
  hasMic: boolean;
  hasCamera: boolean;
}

interface PeerEntry {
  socketId: string;
  pc: RTCPeerConnection;
  stream: MediaStream;
  state: PeerConnectionState;
  audioSender: RTCRtpSender | null;
  videoSender: RTCRtpSender | null;
  pendingCandidates: RTCIceCandidateInit[];
}

interface UseWebRTCParams {
  sendSignal: (to: string, data: SignalData) => void;
  onSignal: (handler: (from: string, data: SignalData) => void) => () => void;
}

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, max: 30 },
  facingMode: "user",
};

const isLive = (track: MediaStreamTrack | null | undefined): track is MediaStreamTrack =>
  Boolean(track && track.readyState === "live");

/** Применяет ICE-кандидатов, пришедших раньше remote description. */
async function flushPendingCandidates(entry: PeerEntry): Promise<void> {
  const pending = entry.pendingCandidates.splice(0);
  for (const candidate of pending) {
    await entry.pc.addIceCandidate(candidate).catch(() => undefined);
  }
}

/** Понятное сообщение об ошибке доступа к устройству. */
function describeMediaError(error: unknown, device: "камере" | "микрофону"): string {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return `Нет доступа к ${device}. Разрешите его в настройках браузера.`;
    case "NotFoundError":
    case "OverconstrainedError":
      return `Не найдено устройство для доступа к ${device}.`;
    case "NotReadableError":
    case "AbortError":
      return `${capitalize(device)} занята другим приложением.`;
    default:
      return `Не удалось получить доступ к ${device}.`;
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function useWebRTC({ sendSignal, onSignal }: UseWebRTCParams) {
  /** Поток, который показываем в собственном окошке (камера или экран + микрофон). */
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [media, setMedia] = useState<MediaState>(DEFAULT_MEDIA_STATE);
  const [devices, setDevices] = useState<DeviceAvailability>({ hasMic: false, hasCamera: false });
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  /** Отдельные треки экрана и камеры — нужны локальной записи урока. */
  const [screenTrack, setScreenTrack] = useState<MediaStreamTrack | null>(null);
  const [cameraTrack, setCameraTrack] = useState<MediaStreamTrack | null>(null);

  const micRef = useRef<MediaStreamTrack | null>(null);
  const cameraRef = useRef<MediaStreamTrack | null>(null);
  const screenRef = useRef<MediaStreamTrack | null>(null);
  const peersRef = useRef(new Map<string, PeerEntry>());
  const pendingRequestRef = useRef<Promise<void> | null>(null);

  /* ------------------------------ Локальные медиа ----------------------------- */

  /** Пересобирает превью и флаги состояния после любого изменения треков. */
  const refreshLocal = useCallback(() => {
    const screen = isLive(screenRef.current) ? screenRef.current : null;
    const camera = isLive(cameraRef.current) ? cameraRef.current : null;
    const mic = isLive(micRef.current) ? micRef.current : null;

    const tracks: MediaStreamTrack[] = [];
    if (screen) tracks.push(screen);
    else if (camera) tracks.push(camera);
    if (mic) tracks.push(mic);

    setLocalStream(tracks.length > 0 ? new MediaStream(tracks) : null);
    setScreenTrack(screen);
    setCameraTrack(camera);
    setMedia({
      audio: Boolean(mic && mic.enabled),
      video: Boolean(camera),
      screen: Boolean(screen),
    });
  }, []);

  /** Трек, который уходит собеседникам в видео-слот: экран приоритетнее камеры. */
  const outgoingVideo = useCallback((): MediaStreamTrack | null => {
    if (isLive(screenRef.current)) return screenRef.current;
    if (isLive(cameraRef.current)) return cameraRef.current;
    return null;
  }, []);

  const acquire = useCallback(async (kind: "audio" | "video"): Promise<MediaStreamTrack> => {
    const stream = await navigator.mediaDevices.getUserMedia(
      kind === "audio" ? { audio: AUDIO_CONSTRAINTS, video: false } : { audio: false, video: VIDEO_CONSTRAINTS },
    );
    const [track] = kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();
    if (!track) throw new DOMException("Устройство не вернуло дорожку", "NotFoundError");
    return track;
  }, []);

  /** Запрашивает камеру и микрофон для превью (предпроверка перед входом). */
  const acquireDevices = useCallback(async (): Promise<void> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError("Браузер не поддерживает доступ к камере и микрофону.");
      return;
    }

    const needMic = !isLive(micRef.current);
    const needCamera = !isLive(cameraRef.current);
    if (!needMic && !needCamera) return;

    const [micResult, cameraResult] = await Promise.allSettled([
      needMic ? acquire("audio") : Promise.resolve(null),
      needCamera ? acquire("video") : Promise.resolve(null),
    ]);

    const errors: string[] = [];

    if (needMic) {
      if (micResult.status === "fulfilled" && micResult.value) {
        micRef.current = micResult.value;
      } else if (micResult.status === "rejected") {
        errors.push(describeMediaError(micResult.reason, "микрофону"));
      }
    }

    if (needCamera) {
      if (cameraResult.status === "fulfilled" && cameraResult.value) {
        cameraRef.current = cameraResult.value;
      } else if (cameraResult.status === "rejected") {
        errors.push(describeMediaError(cameraResult.reason, "камере"));
      }
    }

    setDevices({ hasMic: isLive(micRef.current), hasCamera: isLive(cameraRef.current) });
    setMediaError(errors.length > 0 ? errors.join(" ") : null);
    refreshLocal();
  }, [acquire, refreshLocal]);

  /**
   * Повторный вызов во время уже идущего запроса возвращает тот же промис:
   * иначе React Strict Mode (двойной эффект в dev) открыл бы камеру дважды.
   */
  const requestMedia = useCallback((): Promise<void> => {
    if (!pendingRequestRef.current) {
      pendingRequestRef.current = acquireDevices().finally(() => {
        pendingRequestRef.current = null;
      });
    }
    return pendingRequestRef.current;
  }, [acquireDevices]);

  /** Останавливает локальные треки без закрытия соединений (отмена на предпроверке). */
  const releaseMedia = useCallback(() => {
    [micRef, cameraRef, screenRef].forEach((ref) => {
      ref.current?.stop();
      ref.current = null;
    });
    refreshLocal();
  }, [refreshLocal]);

  const replaceOnPeers = useCallback((kind: "audio" | "video", track: MediaStreamTrack | null) => {
    peersRef.current.forEach((entry) => {
      const sender = kind === "audio" ? entry.audioSender : entry.videoSender;
      if (!sender) return;
      sender.replaceTrack(track).catch((error: unknown) => {
        console.warn(`[webrtc] replaceTrack(${kind}) для ${entry.socketId} не выполнен`, error);
      });
    });
  }, []);

  const toggleMic = useCallback(async () => {
    const mic = micRef.current;

    if (isLive(mic)) {
      mic.enabled = !mic.enabled;
    } else {
      try {
        const track = await acquire("audio");
        micRef.current = track;
        replaceOnPeers("audio", track);
        setDevices((prev) => ({ ...prev, hasMic: true }));
        setMediaError(null);
      } catch (error) {
        setMediaError(describeMediaError(error, "микрофону"));
        setDevices((prev) => ({ ...prev, hasMic: false }));
      }
    }
    refreshLocal();
  }, [acquire, refreshLocal, replaceOnPeers]);

  const toggleCamera = useCallback(async () => {
    const camera = cameraRef.current;

    if (isLive(camera)) {
      // Выключаем камеру по-настоящему: гасим индикатор и освобождаем устройство.
      camera.stop();
      cameraRef.current = null;
      if (!isLive(screenRef.current)) replaceOnPeers("video", null);
    } else {
      try {
        const track = await acquire("video");
        cameraRef.current = track;
        if (!isLive(screenRef.current)) replaceOnPeers("video", track);
        setDevices((prev) => ({ ...prev, hasCamera: true }));
        setMediaError(null);
      } catch (error) {
        setMediaError(describeMediaError(error, "камере"));
        setDevices((prev) => ({ ...prev, hasCamera: false }));
      }
    }
    refreshLocal();
  }, [acquire, refreshLocal, replaceOnPeers]);

  /** Останавливает демонстрацию экрана и возвращает камеру (или пустой слот). */
  const stopScreenShare = useCallback(() => {
    const screen = screenRef.current;
    if (!screen) return;

    screenRef.current = null;
    screen.stop();
    replaceOnPeers("video", outgoingVideo());
    refreshLocal();
  }, [outgoingVideo, refreshLocal, replaceOnPeers]);

  const toggleScreenShare = useCallback(async () => {
    if (screenRef.current) {
      stopScreenShare();
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMediaError("Демонстрация экрана не поддерживается в этом браузере.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      const [track] = stream.getVideoTracks();
      if (!track) return;

      // Пользователь может остановить демонстрацию кнопкой браузера.
      track.addEventListener("ended", stopScreenShare);
      screenRef.current = track;
      replaceOnPeers("video", track);
      setMediaError(null);
      refreshLocal();
    } catch (error) {
      // Отмена выбора экрана — не ошибка, молча возвращаемся.
      if (error instanceof DOMException && error.name === "NotAllowedError") return;
      setMediaError("Не удалось начать демонстрацию экрана.");
    }
  }, [refreshLocal, replaceOnPeers, stopScreenShare]);

  /* ------------------------------ Peer-соединения ----------------------------- */

  const syncPeers = useCallback(() => {
    setPeers(
      Array.from(peersRef.current.values()).map(({ socketId, stream, state }) => ({ socketId, stream, state })),
    );
  }, []);

  const closePeer = useCallback(
    (socketId: string) => {
      const entry = peersRef.current.get(socketId);
      if (!entry) return;
      entry.pc.onicecandidate = null;
      entry.pc.ontrack = null;
      entry.pc.onconnectionstatechange = null;
      entry.pc.close();
      peersRef.current.delete(socketId);
      syncPeers();
    },
    [syncPeers],
  );

  /**
   * Привязывает аудио- и видео-трансиверы пира к текущим локальным трекам.
   * Вызывается инициатором до offer и отвечающим после setRemoteDescription(offer).
   */
  const bindTransceivers = useCallback(
    (entry: PeerEntry) => {
      entry.pc.getTransceivers().forEach((transceiver) => {
        const kind = transceiver.receiver.track.kind;
        if (kind !== "audio" && kind !== "video") return;
        if (transceiver.currentDirection === "stopped") return;
        transceiver.direction = "sendrecv";

        const track = kind === "audio" ? (isLive(micRef.current) ? micRef.current : null) : outgoingVideo();
        if (kind === "audio" && !entry.audioSender) entry.audioSender = transceiver.sender;
        if (kind === "video" && !entry.videoSender) entry.videoSender = transceiver.sender;
        void transceiver.sender.replaceTrack(track).catch(() => undefined);
      });
    },
    [outgoingVideo],
  );

  const createPeer = useCallback(
    (socketId: string, initiator: boolean): PeerEntry => {
      // Если соединение с этим идентификатором уже есть — заменяем его свежим.
      closePeer(socketId);

      const pc = new RTCPeerConnection({ iceServers: getIceServers() });

      const entry: PeerEntry = {
        socketId,
        pc,
        stream: new MediaStream(),
        state: "connecting",
        audioSender: null,
        videoSender: null,
        pendingCandidates: [],
      };

      if (initiator) {
        // Инициатор создаёт трансиверы до offer, чтобы они попали в SDP.
        pc.addTransceiver("audio", { direction: "sendrecv" });
        pc.addTransceiver("video", { direction: "sendrecv" });
        bindTransceivers(entry);
      }

      pc.ontrack = (event) => {
        entry.stream = new MediaStream([...entry.stream.getTracks(), event.track]);
        syncPeers();
      };

      pc.onicecandidate = (event) => {
        const candidate = event.candidate;
        if (!candidate) return;
        sendSignal(socketId, {
          type: "candidate",
          candidate: { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex },
        });
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        entry.state = state === "connected" ? "connected" : state === "failed" ? "failed" : "connecting";
        syncPeers();
      };

      peersRef.current.set(socketId, entry);
      syncPeers();
      return entry;
    },
    [bindTransceivers, closePeer, sendSignal, syncPeers],
  );

  /** Мы входим в комнату — отправляем offer участнику, который уже там. */
  const callPeer = useCallback(
    async (socketId: string) => {
      const entry = createPeer(socketId, true);
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      sendSignal(socketId, { type: "offer", sdp: entry.pc.localDescription?.sdp ?? offer.sdp ?? "" });
    },
    [createPeer, sendSignal],
  );

  const handleSignal = useCallback(
    async (from: string, data: SignalData) => {
      try {
        if (data.type === "offer") {
          const entry = createPeer(from, false);
          await entry.pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
          bindTransceivers(entry);
          await flushPendingCandidates(entry);
          const answer = await entry.pc.createAnswer();
          await entry.pc.setLocalDescription(answer);
          sendSignal(from, { type: "answer", sdp: entry.pc.localDescription?.sdp ?? answer.sdp ?? "" });
          return;
        }

        const entry = peersRef.current.get(from);
        if (!entry) return;

        if (data.type === "answer") {
          if (entry.pc.signalingState !== "have-local-offer") return;
          await entry.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
          await flushPendingCandidates(entry);
          return;
        }

        if (data.candidate) {
          const candidate: RTCIceCandidateInit = {
            candidate: data.candidate.candidate,
            sdpMid: data.candidate.sdpMid,
            sdpMLineIndex: data.candidate.sdpMLineIndex,
          };
          if (entry.pc.remoteDescription) {
            await entry.pc.addIceCandidate(candidate).catch(() => undefined);
          } else {
            entry.pendingCandidates.push(candidate);
          }
        }
      } catch (error) {
        console.warn("[webrtc] Ошибка обработки сигнала от", from, error);
      }
    },
    [bindTransceivers, createPeer, sendSignal],
  );

  /** Подключаемся ко всем участникам, которые уже были в комнате. */
  const connectToPeers = useCallback(
    async (socketIds: string[]) => {
      await Promise.all(
        socketIds.map((id) =>
          callPeer(id).catch((error: unknown) => console.warn("[webrtc] Не удалось позвонить", id, error)),
        ),
      );
    },
    [callPeer],
  );

  const dropPeer = useCallback((socketId: string) => closePeer(socketId), [closePeer]);

  const dropAllPeers = useCallback(() => {
    Array.from(peersRef.current.keys()).forEach((id) => closePeer(id));
  }, [closePeer]);

  /** Завершение звонка: закрываем все соединения и освобождаем устройства. */
  const hangUp = useCallback(() => {
    dropAllPeers();
    releaseMedia();
    setMedia(DEFAULT_MEDIA_STATE);
  }, [dropAllPeers, releaseMedia]);

  useEffect(() => onSignal((from, data) => void handleSignal(from, data)), [handleSignal, onSignal]);

  // При размонтировании освобождаем всё, чтобы не держать камеру включённой.
  useEffect(() => {
    const peerMap = peersRef.current;
    return () => {
      Array.from(peerMap.keys()).forEach((id) => {
        const entry = peerMap.get(id);
        entry?.pc.close();
      });
      peerMap.clear();
      [micRef, cameraRef, screenRef].forEach((ref) => {
        ref.current?.stop();
        ref.current = null;
      });
    };
  }, []);

  return {
    localStream,
    media,
    devices,
    mediaError,
    peers,
    screenTrack,
    cameraTrack,
    requestMedia,
    releaseMedia,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    connectToPeers,
    dropPeer,
    dropAllPeers,
    hangUp,
  };
}
