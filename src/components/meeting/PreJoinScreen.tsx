"use client";

import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Mic,
  MicOff,
  Video,
  VideoOff,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { VideoGrid } from "@/components/meeting/VideoGrid";
import { FormAlert } from "@/components/ui/form-alert";
import { GradientButton } from "@/components/ui/gradient-button";
import { cn } from "@/lib/utils";
import type { DeviceAvailability } from "@/hooks/useWebRTC";
import type { Role } from "@/types";

interface PreJoinScreenProps {
  title: string;
  meetingCode: string;
  hostName: string;
  self: { name: string; role: Role };
  stream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  speaking: boolean;
  devices: DeviceAvailability;
  mediaError: string | null;
  joinError: string | null;
  isConnecting: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onJoin: () => void;
}

/**
 * Экран перед входом: превью камеры, проверка микрофона и камеры, выбор
 * состояния «вкл/выкл» и кнопка входа. После нажатия показываем «Подключаемся…».
 */
export function PreJoinScreen(props: PreJoinScreenProps) {
  const {
    title,
    meetingCode,
    hostName,
    self,
    stream,
    micOn,
    camOn,
    speaking,
    devices,
    mediaError,
    joinError,
    isConnecting,
    onToggleMic,
    onToggleCamera,
    onJoin,
  } = props;

  const previewTile = {
    id: "preview",
    name: self.name,
    role: self.role,
    stream,
    isLocal: true,
    videoOn: camOn && devices.hasCamera,
    audioOn: micOn && devices.hasMic,
    screenOn: false,
    handRaised: false,
    speaking,
  };

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center">
      {/* Превью */}
      <section className="relative">
        <div className="glass-strong aspect-video w-full overflow-hidden rounded-3xl shadow-glow">
          <VideoGrid tiles={[previewTile]} />
        </div>

        <div className="mt-4 flex items-center justify-center gap-3">
          <PreviewToggle
            on={micOn && devices.hasMic}
            onLabel="Микрофон включён"
            offLabel={devices.hasMic ? "Микрофон выключен" : "Микрофон недоступен"}
            onIcon={Mic}
            offIcon={MicOff}
            onClick={onToggleMic}
            disabled={isConnecting}
          />
          <PreviewToggle
            on={camOn && devices.hasCamera}
            onLabel="Камера включена"
            offLabel={devices.hasCamera ? "Камера выключена" : "Камера недоступна"}
            onIcon={Video}
            offIcon={VideoOff}
            onClick={onToggleCamera}
            disabled={isConnecting}
          />
        </div>

        {/* Проверка устройств */}
        <ul className="mt-5 grid gap-2 sm:grid-cols-2">
          <DeviceCheck label="Камера" ok={devices.hasCamera} />
          <DeviceCheck label="Микрофон" ok={devices.hasMic} />
        </ul>

        {mediaError && (
          <div className="mt-4">
            <FormAlert variant="error">{mediaError}</FormAlert>
          </div>
        )}
      </section>

      {/* Информация и вход */}
      <aside className="glass-strong animate-fade-up space-y-6 rounded-3xl p-6 shadow-glow">
        <div>
          <Link
            href="/meeting"
            className="inline-flex items-center gap-2 text-xs text-slate-400 transition hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            К списку уроков
          </Link>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-accent-300">Урок</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">{title}</h1>
          <p className="mt-2 text-sm text-slate-400">
            Ведёт <span className="text-slate-200">{hostName}</span>
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-slate-500">Код урока</p>
          <p className="mt-1 font-mono text-sm text-white">{meetingCode}</p>
        </div>

        {joinError && <FormAlert variant="error">{joinError}</FormAlert>}

        {isConnecting ? (
          <ConnectingState />
        ) : (
          <>
            <GradientButton onClick={onJoin} disabled={isConnecting}>
              Войти в урок
            </GradientButton>
            <p className="text-center text-xs leading-relaxed text-slate-500">
              Вы можете выключить микрофон и камеру до входа. Видео передаётся напрямую между участниками
              (WebRTC), а сообщения чата шифруются AES-256.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}

function ConnectingState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-accent-400/20 bg-accent-500/[0.06] px-5 py-6 text-center">
      <div className="relative flex h-14 w-14 items-center justify-center">
        <span className="absolute inset-0 animate-pulse-ring rounded-full bg-accent-400/30" />
        <Loader2 className="relative h-7 w-7 animate-spin text-accent-300" />
      </div>
      <div>
        <p className="text-base font-semibold text-white">Подключаемся…</p>
        <p className="mt-1 text-xs text-slate-400">Проверяем соединение и входим в комнату урока</p>
      </div>
    </div>
  );
}

function PreviewToggle({
  on,
  onLabel,
  offLabel,
  onIcon: OnIcon,
  offIcon: OffIcon,
  onClick,
  disabled,
}: {
  on: boolean;
  onLabel: string;
  offLabel: string;
  onIcon: LucideIcon;
  offIcon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}) {
  const Icon = on ? OnIcon : OffIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={cn(
        "inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition",
        "focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30 disabled:opacity-50",
        on
          ? "border-white/15 bg-white/10 text-white hover:bg-white/15"
          : "border-rose-400/25 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25",
      )}
    >
      <Icon className="h-4 w-4" />
      {on ? onLabel : offLabel}
    </button>
  );
}

function DeviceCheck({ label, ok }: { label: string; ok: boolean }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm backdrop-blur-xl",
        ok ? "border-emerald-400/20 bg-emerald-500/[0.06] text-emerald-100" : "border-amber-400/20 bg-amber-500/[0.06] text-amber-100",
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", ok ? "text-emerald-400" : "text-amber-400")} />
      <span className="flex-1">{label}</span>
      <span className="text-xs opacity-80">{ok ? "готово" : "не подключено"}</span>
    </li>
  );
}
