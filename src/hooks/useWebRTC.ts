"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_MEDIA_STATE, type MediaState, type SignalData } from "@/lib/realtime";
import { registerCallCleanup } from "@/lib/call-events";
import {
  getRelayRtcConfiguration,
  RELAY_CONNECT_TIMEOUT_MS,
  VPN_FRIENDLY_MEDIA_CONSTRAINTS,
  type RelayStage,
} from "@/lib/webrtc-config";

/**
 * Relay-only mesh WebRTC.
 *
 * Transport cascade (explicit, because RTCIceServer order is NOT a failover):
 *   TURNS/TCP 443 → TURN/TCP 443 → TURN/TCP 80 → custom TCP TURN ports.
 * A stage gets a bounded connect timeout. Only the deterministic recovery owner
 * advances a peer's stage, so both sides never race to replace the same PC.
 * The other side requests recovery with `restart-request`.
 *
 * `iceTransportPolicy: "relay"` is essential: with "all", a browser may keep a
 * direct UDP candidate even when TURN is configured. Only relay candidates are
 * sent. New PC generations discard stale answers/candidates after a restart.
 */
export type PeerConnectionState = "connecting" | "connected" | "failed";
export interface RemotePeer { socketId: string; stream: MediaStream; state: PeerConnectionState }
export interface DeviceAvailability { hasMic: boolean; hasCamera: boolean }

interface PeerEntry {
  socketId: string;
  pc: RTCPeerConnection;
  stream: MediaStream;
  state: PeerConnectionState;
  generation: string;
  stage: RelayStage;
  recoveryOwner: boolean;
  audioSender: RTCRtpSender | null;
  videoSender: RTCRtpSender | null;
  pendingCandidates: RTCIceCandidateInit[];
  connectTimer: ReturnType<typeof setTimeout> | null;
  recoveryTimer: ReturnType<typeof setTimeout> | null;
  requestedGeneration: string | null;
}

interface UseWebRTCParams {
  sendSignal: (to: string, data: SignalData) => void;
  onSignal: (handler: (from: string, data: SignalData) => void) => () => void;
  getSelfId?: () => string | null;
}

const isLive = (track: MediaStreamTrack | null | undefined): track is MediaStreamTrack =>
  Boolean(track && track.readyState === "live");
const newGeneration = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function describeMediaError(error: unknown, device: "камере" | "микрофону"): string {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError": case "SecurityError": return `Нет доступа к ${device}. Разрешите его в настройках браузера.`;
    case "NotFoundError": case "OverconstrainedError": return `Не найдено устройство для доступа к ${device}.`;
    case "NotReadableError": case "AbortError": return `${device === "камере" ? "Камера" : "Микрофон"} занят другим приложением.`;
    default: return `Не удалось получить доступ к ${device}.`;
  }
}

export function useWebRTC({ sendSignal, onSignal, getSelfId }: UseWebRTCParams) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [media, setMedia] = useState<MediaState>(DEFAULT_MEDIA_STATE);
  const [devices, setDevices] = useState<DeviceAvailability>({ hasMic: false, hasCamera: false });
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [screenTrack, setScreenTrack] = useState<MediaStreamTrack | null>(null);
  const [cameraTrack, setCameraTrack] = useState<MediaStreamTrack | null>(null);

  const micRef = useRef<MediaStreamTrack | null>(null);
  const cameraRef = useRef<MediaStreamTrack | null>(null);
  const screenRef = useRef<MediaStreamTrack | null>(null);
  const peersRef = useRef(new Map<string, PeerEntry>());
  const earlyCandidates = useRef(new Map<string, RTCIceCandidateInit[]>());
  const pendingRequestRef = useRef<Promise<void> | null>(null);
  const mediaVersionRef = useRef(0);
  const endedRef = useRef(false);
  const mountedRef = useRef(true);
  const selfIdOverrideRef = useRef<string | null>(null);
  const callbacksRef = useRef({ sendSignal, getSelfId });
  callbacksRef.current = { sendSignal, getSelfId };

  const syncPeers = useCallback(() => {
    if (!mountedRef.current) return;
    setPeers(Array.from(peersRef.current.values()).map(({ socketId, stream, state }) => ({ socketId, stream, state })));
  }, []);

  const refreshLocal = useCallback(() => {
    if (!mountedRef.current) return;
    const screen = isLive(screenRef.current) ? screenRef.current : null;
    const camera = isLive(cameraRef.current) ? cameraRef.current : null;
    const mic = isLive(micRef.current) ? micRef.current : null;
    const tracks: MediaStreamTrack[] = [];
    if (screen) tracks.push(screen); else if (camera) tracks.push(camera);
    if (mic) tracks.push(mic);
    setLocalStream(tracks.length ? new MediaStream(tracks) : null);
    setScreenTrack(screen);
    setCameraTrack(camera);
    setMedia({ audio: Boolean(mic?.enabled), video: Boolean(camera), screen: Boolean(screen) });
  }, []);

  const outgoingVideo = useCallback((): MediaStreamTrack | null => {
    if (isLive(screenRef.current)) return screenRef.current;
    return isLive(cameraRef.current) ? cameraRef.current : null;
  }, []);

  const acquire = useCallback(async (kind: "audio" | "video"): Promise<MediaStreamTrack> => {
    const constraints = kind === "audio"
      ? { audio: VPN_FRIENDLY_MEDIA_CONSTRAINTS.audio, video: false }
      : { audio: false, video: VPN_FRIENDLY_MEDIA_CONSTRAINTS.video };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const [track] = kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();
    if (!track) throw new DOMException("Устройство не вернуло дорожку", "NotFoundError");
    return track;
  }, []);

  const acquireDevices = useCallback(async (): Promise<void> => {
    if (endedRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError("Браузер не поддерживает доступ к камере и микрофону.");
      return;
    }
    const version = mediaVersionRef.current;
    const needMic = !isLive(micRef.current);
    const needCamera = !isLive(cameraRef.current);
    if (!needMic && !needCamera) return;
    const [micResult, cameraResult] = await Promise.allSettled([
      needMic ? acquire("audio") : Promise.resolve(null),
      needCamera ? acquire("video") : Promise.resolve(null),
    ]);
    const mic = micResult.status === "fulfilled" ? micResult.value : null;
    const camera = cameraResult.status === "fulfilled" ? cameraResult.value : null;
    // A call may end while the permission prompt is open. Never revive tracks.
    if (endedRef.current || version !== mediaVersionRef.current || !mountedRef.current) {
      mic?.stop(); camera?.stop(); return;
    }
    const errors: string[] = [];
    if (needMic) {
      if (mic) micRef.current = mic;
      else if (micResult.status === "rejected") errors.push(describeMediaError(micResult.reason, "микрофону"));
    }
    if (needCamera) {
      if (camera) cameraRef.current = camera;
      else if (cameraResult.status === "rejected") errors.push(describeMediaError(cameraResult.reason, "камере"));
    }
    setDevices({ hasMic: isLive(micRef.current), hasCamera: isLive(cameraRef.current) });
    setMediaError(errors.length ? errors.join(" ") : null);
    refreshLocal();
  }, [acquire, refreshLocal]);

  const requestMedia = useCallback((): Promise<void> => {
    if (!pendingRequestRef.current) {
      pendingRequestRef.current = acquireDevices().finally(() => { pendingRequestRef.current = null; });
    }
    return pendingRequestRef.current;
  }, [acquireDevices]);

  const releaseMedia = useCallback(() => {
    mediaVersionRef.current += 1;
    [micRef, cameraRef, screenRef].forEach((ref) => { ref.current?.stop(); ref.current = null; });
    refreshLocal();
  }, [refreshLocal]);

  const replaceOnPeers = useCallback((kind: "audio" | "video", track: MediaStreamTrack | null) => {
    peersRef.current.forEach((entry) => {
      const sender = kind === "audio" ? entry.audioSender : entry.videoSender;
      void sender?.replaceTrack(track).catch(() => undefined);
    });
  }, []);

  const toggleMic = useCallback(async () => {
    if (endedRef.current) return;
    const version = mediaVersionRef.current;
    const mic = micRef.current;
    if (isLive(mic)) mic.enabled = !mic.enabled;
    else {
      try {
        const track = await acquire("audio");
        if (endedRef.current || version !== mediaVersionRef.current) { track.stop(); return; }
        micRef.current = track;
        replaceOnPeers("audio", track);
        setDevices((prev) => ({ ...prev, hasMic: true }));
        setMediaError(null);
      } catch (error) {
        if (mountedRef.current) setMediaError(describeMediaError(error, "микрофону"));
      }
    }
    refreshLocal();
  }, [acquire, refreshLocal, replaceOnPeers]);

  const toggleCamera = useCallback(async () => {
    if (endedRef.current) return;
    const version = mediaVersionRef.current;
    const camera = cameraRef.current;
    if (isLive(camera)) {
      camera.stop(); cameraRef.current = null;
      if (!isLive(screenRef.current)) replaceOnPeers("video", null);
    } else {
      try {
        const track = await acquire("video");
        if (endedRef.current || version !== mediaVersionRef.current) { track.stop(); return; }
        cameraRef.current = track;
        if (!isLive(screenRef.current)) replaceOnPeers("video", track);
        setDevices((prev) => ({ ...prev, hasCamera: true }));
        setMediaError(null);
      } catch (error) {
        if (mountedRef.current) setMediaError(describeMediaError(error, "камере"));
      }
    }
    refreshLocal();
  }, [acquire, refreshLocal, replaceOnPeers]);

  const stopScreenShare = useCallback(() => {
    const screen = screenRef.current;
    if (!screen) return;
    screenRef.current = null;
    screen.stop();
    replaceOnPeers("video", outgoingVideo());
    refreshLocal();
  }, [outgoingVideo, refreshLocal, replaceOnPeers]);

  const toggleScreenShare = useCallback(async () => {
    if (endedRef.current) return;
    if (screenRef.current) { stopScreenShare(); return; }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMediaError("Демонстрация экрана не поддерживается в этом браузере."); return;
    }
    const version = mediaVersionRef.current;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      const [track] = stream.getVideoTracks();
      if (!track) return;
      if (endedRef.current || version !== mediaVersionRef.current) { track.stop(); return; }
      track.addEventListener("ended", stopScreenShare, { once: true });
      screenRef.current = track;
      replaceOnPeers("video", track);
      setMediaError(null);
      refreshLocal();
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") return;
      if (mountedRef.current) setMediaError("Не удалось начать демонстрацию экрана.");
    }
  }, [refreshLocal, replaceOnPeers, stopScreenShare]);

  /* ------------------------------ Peer lifecycle ----------------------------- */

  const clearPeerTimers = (entry: PeerEntry) => {
    if (entry.connectTimer) clearTimeout(entry.connectTimer);
    if (entry.recoveryTimer) clearTimeout(entry.recoveryTimer);
    entry.connectTimer = null; entry.recoveryTimer = null;
  };

  const closePeer = useCallback((socketId: string) => {
    const entry = peersRef.current.get(socketId);
    if (!entry) return;
    clearPeerTimers(entry);
    entry.pc.onicecandidate = null;
    entry.pc.ontrack = null;
    entry.pc.onconnectionstatechange = null;
    entry.pc.oniceconnectionstatechange = null;
    entry.pc.close();
    entry.stream.getTracks().forEach((track) => track.stop());
    entry.pendingCandidates = [];
    peersRef.current.delete(socketId);
    syncPeers();
  }, [syncPeers]);

  const bindTransceivers = useCallback((entry: PeerEntry) => {
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
  }, [outgoingVideo]);

  // Declared as a ref so state callbacks can request recovery without cycles.
  const recoverRef = useRef<(socketId: string, advance: boolean) => void>(() => undefined);

  const armConnectTimeout = useCallback((entry: PeerEntry) => {
    if (entry.connectTimer) clearTimeout(entry.connectTimer);
    entry.connectTimer = setTimeout(() => {
      if (peersRef.current.get(entry.socketId) !== entry || entry.state === "connected") return;
      if (entry.recoveryOwner) recoverRef.current(entry.socketId, true);
      else if (entry.requestedGeneration !== entry.generation) {
        entry.requestedGeneration = entry.generation;
        callbacksRef.current.sendSignal(entry.socketId, { type: "restart-request", generation: entry.generation });
      }
    }, RELAY_CONNECT_TIMEOUT_MS[entry.stage]);
  }, []);

  const createPeer = useCallback((socketId: string, offerer: boolean, stage: RelayStage, generation: string): PeerEntry => {
    closePeer(socketId);
    for (const key of Array.from(earlyCandidates.current.keys())) {
      if (key.startsWith(`${socketId}:`) && key !== `${socketId}:${generation}`) earlyCandidates.current.delete(key);
    }
    const selfId = selfIdOverrideRef.current ?? callbacksRef.current.getSelfId?.() ?? "";
    const pc = new RTCPeerConnection(getRelayRtcConfiguration(stage));
    const entry: PeerEntry = {
      socketId, pc, stream: new MediaStream(), state: "connecting", generation, stage,
      // Lexicographically larger socket id owns failover; both sides compute it.
      recoveryOwner: selfId > socketId,
      audioSender: null, videoSender: null, pendingCandidates: [],
      connectTimer: null, recoveryTimer: null, requestedGeneration: null,
    };
    if (offerer) {
      pc.addTransceiver("audio", { direction: "sendrecv" });
      pc.addTransceiver("video", { direction: "sendrecv" });
      bindTransceivers(entry);
    }
    pc.ontrack = (event) => {
      if (peersRef.current.get(socketId) !== entry) return;
      if (!entry.stream.getTracks().some((t) => t.id === event.track.id)) {
        entry.stream = new MediaStream([...entry.stream.getTracks(), event.track]);
      }
      syncPeers();
    };
    pc.onicecandidate = (event) => {
      if (peersRef.current.get(socketId) !== entry) return;
      const candidate = event.candidate;
      // Do not leak host/srflx candidates even if a browser gathers unexpectedly.
      const isRelay = candidate?.type === "relay" || /\btyp relay\b/.test(candidate?.candidate ?? "");
      if (candidate && !isRelay) return;
      callbacksRef.current.sendSignal(socketId, {
        type: "candidate", generation: entry.generation,
        candidate: candidate ? { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex } : null,
      });
    };
    const onStateChange = () => {
      if (peersRef.current.get(socketId) !== entry) return;
      const state = pc.connectionState;
      if (state === "connected") {
        entry.state = "connected";
        if (entry.connectTimer) clearTimeout(entry.connectTimer);
        entry.connectTimer = null;
        if (mountedRef.current) setNetworkError(null);
      } else if (state === "failed") {
        entry.state = "failed";
        recoverRef.current(socketId, true);
      } else if (state === "disconnected") {
        entry.state = "connecting";
        if (!entry.recoveryTimer) entry.recoveryTimer = setTimeout(() => {
          entry.recoveryTimer = null;
          if (pc.connectionState === "disconnected") recoverRef.current(socketId, false);
        }, 3_000);
      } else if (state === "closed") return;
      else entry.state = "connecting";
      syncPeers();
    };
    pc.onconnectionstatechange = onStateChange;
    pc.oniceconnectionstatechange = onStateChange;
    peersRef.current.set(socketId, entry);
    armConnectTimeout(entry);
    syncPeers();
    return entry;
  }, [armConnectTimeout, bindTransceivers, closePeer, syncPeers]);

  const makeOffer = useCallback(async (entry: PeerEntry) => {
    const offer = await entry.pc.createOffer();
    if (peersRef.current.get(entry.socketId) !== entry || endedRef.current) return;
    await entry.pc.setLocalDescription(offer);
    if (peersRef.current.get(entry.socketId) !== entry || endedRef.current) return;
    callbacksRef.current.sendSignal(entry.socketId, {
      type: "offer", sdp: entry.pc.localDescription?.sdp ?? offer.sdp ?? "",
      generation: entry.generation, relayStage: entry.stage,
    });
  }, []);

  const callPeer = useCallback(async (socketId: string) => {
    if (endedRef.current) return;
    const entry = createPeer(socketId, true, 0, newGeneration());
    await makeOffer(entry);
  }, [createPeer, makeOffer]);

  const recoverPeer = useCallback((socketId: string, advance: boolean) => {
    if (endedRef.current || !mountedRef.current) return;
    const current = peersRef.current.get(socketId);
    if (!current) return;
    if (!current.recoveryOwner) {
      if (current.requestedGeneration !== current.generation) {
        current.requestedGeneration = current.generation;
        callbacksRef.current.sendSignal(socketId, { type: "restart-request", generation: current.generation });
      }
      return;
    }
    const nextStage = (advance ? Math.min(3, current.stage + 1) : current.stage) as RelayStage;
    if (advance && current.stage === 3) {
      current.state = "failed";
      syncPeers();
      if (mountedRef.current) setNetworkError("Не удалось установить защищённое соединение через TURN. Проверьте сеть или доступность TURN-сервера и повторите попытку.");
      return;
    }
    const entry = createPeer(socketId, true, nextStage, newGeneration());
    void makeOffer(entry).catch((error) => console.warn("[webrtc] ICE restart offer failed", error));
  }, [createPeer, makeOffer, syncPeers]);
  recoverRef.current = recoverPeer;

  const flushPending = useCallback(async (entry: PeerEntry) => {
    const pending = entry.pendingCandidates.splice(0);
    for (const candidate of pending) {
      if (peersRef.current.get(entry.socketId) !== entry) return;
      await entry.pc.addIceCandidate(candidate).catch(() => undefined);
    }
  }, []);

  const handleSignal = useCallback(async (from: string, data: SignalData) => {
    if (endedRef.current) return;
    try {
      if (data.type === "restart-request") {
        const entry = peersRef.current.get(from);
        if (entry?.recoveryOwner && entry.generation === data.generation) recoverRef.current(from, entry.state === "failed");
        return;
      }
      if (data.type === "offer") {
        const generation = data.generation ?? newGeneration();
        const stage = (typeof data.relayStage === "number" && data.relayStage >= 0 && data.relayStage <= 3 ? data.relayStage : 0) as RelayStage;
        const entry = createPeer(from, false, stage, generation);
        const early = earlyCandidates.current.get(`${from}:${generation}`) ?? [];
        earlyCandidates.current.delete(`${from}:${generation}`);
        entry.pendingCandidates.push(...early);
        await entry.pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
        if (peersRef.current.get(from) !== entry) return;
        bindTransceivers(entry);
        await flushPending(entry);
        const answer = await entry.pc.createAnswer();
        if (peersRef.current.get(from) !== entry) return;
        await entry.pc.setLocalDescription(answer);
        if (peersRef.current.get(from) !== entry) return;
        callbacksRef.current.sendSignal(from, { type: "answer", sdp: entry.pc.localDescription?.sdp ?? answer.sdp ?? "", generation });
        return;
      }
      const entry = peersRef.current.get(from);
      if (!entry || (data.generation && data.generation !== entry.generation)) return;
      if (data.type === "answer") {
        if (entry.pc.signalingState !== "have-local-offer") return;
        await entry.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
        await flushPending(entry);
        return;
      }
      if (data.candidate) {
        // Defense in depth: accept only relay candidates from the remote peer.
        if (!/\btyp relay\b/.test(data.candidate.candidate)) return;
        const candidate: RTCIceCandidateInit = {
          candidate: data.candidate.candidate, sdpMid: data.candidate.sdpMid, sdpMLineIndex: data.candidate.sdpMLineIndex,
        };
        if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(candidate).catch(() => undefined);
        else entry.pendingCandidates.push(candidate);
      }
    } catch (error) {
      console.warn("[webrtc] Ошибка обработки сигнала от", from, error);
    }
  }, [bindTransceivers, createPeer, flushPending]);

  // Buffer candidates that overtake an offer (possible after a relay restart).
  useEffect(() => onSignal((from, data) => {
    if (data.type === "candidate" && data.candidate && data.generation && !peersRef.current.has(from)) {
      const key = `${from}:${data.generation}`;
      const list = earlyCandidates.current.get(key) ?? [];
      if (list.length < 100 && /\btyp relay\b/.test(data.candidate.candidate)) {
        list.push({ candidate: data.candidate.candidate, sdpMid: data.candidate.sdpMid, sdpMLineIndex: data.candidate.sdpMLineIndex });
        earlyCandidates.current.set(key, list);
      }
      return;
    }
    void handleSignal(from, data);
  }), [handleSignal, onSignal]);

  const connectToPeers = useCallback(async (socketIds: string[], localSocketId?: string) => {
    if (localSocketId) selfIdOverrideRef.current = localSocketId;
    if (endedRef.current) return;
    await Promise.all(socketIds.map((id) => callPeer(id).catch((error) => console.warn("[webrtc] Не удалось позвонить", id, error))));
  }, [callPeer]);

  const dropPeer = useCallback((socketId: string) => closePeer(socketId), [closePeer]);
  const dropAllPeers = useCallback(() => {
    Array.from(peersRef.current.keys()).forEach(closePeer);
    earlyCandidates.current.clear();
  }, [closePeer]);

  const hangUp = useCallback(() => {
    endedRef.current = true;
    dropAllPeers();
    releaseMedia();
    if (mountedRef.current) {
      setMedia(DEFAULT_MEDIA_STATE);
      setNetworkError(null);
    }
  }, [dropAllPeers, releaseMedia]);

  const retryConnections = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = false;
    setNetworkError(null);
    peersRef.current.forEach((entry) => {
      if (entry.recoveryOwner) {
        const fresh = createPeer(entry.socketId, true, 0, newGeneration());
        void makeOffer(fresh).catch(() => undefined);
      } else {
        callbacksRef.current.sendSignal(entry.socketId, { type: "restart-request", generation: entry.generation });
      }
    });
  }, [createPeer, makeOffer]);

  useEffect(() => registerCallCleanup(hangUp), [hangUp]);

  useEffect(() => {
    mountedRef.current = true;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const onNetworkChange = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (!endedRef.current) retryConnections();
      }, 500);
    };
    window.addEventListener("online", onNetworkChange);
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
    connection?.addEventListener("change", onNetworkChange);
    return () => {
      if (debounce) clearTimeout(debounce);
      window.removeEventListener("online", onNetworkChange);
      connection?.removeEventListener("change", onNetworkChange);
    };
  }, [retryConnections]);

  useEffect(() => {
    const peerMap = peersRef.current;
    const early = earlyCandidates.current;
    return () => {
      mountedRef.current = false;
      endedRef.current = true;
      mediaVersionRef.current += 1;
      peerMap.forEach((entry) => {
        clearPeerTimers(entry);
        entry.pc.onicecandidate = null; entry.pc.ontrack = null;
        entry.pc.onconnectionstatechange = null; entry.pc.oniceconnectionstatechange = null;
        entry.pc.close();
        entry.stream.getTracks().forEach((track) => track.stop());
      });
      peerMap.clear(); early.clear();
      [micRef, cameraRef, screenRef].forEach((ref) => { ref.current?.stop(); ref.current = null; });
    };
  }, []);

  return {
    localStream, media, devices, mediaError, networkError, peers, screenTrack, cameraTrack,
    requestMedia, releaseMedia, toggleMic, toggleCamera, toggleScreenShare,
    connectToPeers, dropPeer, dropAllPeers, hangUp, retryConnections,
  };
}
