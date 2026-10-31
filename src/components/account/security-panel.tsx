"use client";

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { Copy, KeyRound, ShieldCheck, ShieldOff } from "lucide-react";

import { FormAlert } from "@/components/ui/form-alert";
import { canOpenExternalLink, copyToClipboard, isNativeShell, openInNativeShell } from "@/lib/clipboard";
import { PasswordField, TextField } from "@/components/ui/field";
import { GradientButton } from "@/components/ui/gradient-button";

interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: string | null;
  backupCodesLeft: number;
  requiredForRole: boolean;
}

type Stage = "idle" | "password" | "confirm" | "backupCodes" | "disable";

/**
 * Панель управления вторым фактором.
 *
 * Сценарии: включение (пароль → секрет → код → резервные коды), выключение
 * (пароль + код) и просмотр статуса. Все проверки — на сервере, интерфейс лишь
 * показывает результат: скрытая кнопка не является защитой.
 */
export function SecurityPanel() {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState("");
  const [otpauth, setOtpauth] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Какой именно блок скопирован: коды, секрет или ссылка.
  const [copied, setCopied] = useState<"codes" | "secret" | "link" | null>(null);
  // Подсказка о платформе: в приложении ссылку открывает оболочка.
  const [shellNote, setShellNote] = useState<string | null>(null);
  // Признаки оболочки узнаём после монтирования: на сервере `window` нет, и
  // разное содержимое серверного и клиентского рендера дало бы hydration-ошибку.
  const [nativeShell, setNativeShell] = useState(false);
  // Умеет ли оболочка открыть `otpauth://` (в старых APK такого моста нет).
  const [linkSupported, setLinkSupported] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/account/2fa", { cache: "no-store" });
      const payload = (await response.json()) as { ok: boolean; data?: TwoFactorStatus };
      if (payload.ok && payload.data) setStatus(payload.data);
    } catch {
      setError("Не удалось загрузить состояние защиты. Обновите страницу.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setNativeShell(isNativeShell());
    setLinkSupported(canOpenExternalLink());
  }, []);

  function reset() {
    setStage("idle");
    setPassword("");
    setCode("");
    setSecret("");
    setOtpauth("");
    setBackupCodes([]);
    setError(null);
    setCopied(null);
    setShellNote(null);
  }

  async function request<T>(method: string, body: unknown): Promise<T> {
    const response = await fetch("/api/account/2fa", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { ok: boolean; data?: T; error?: string };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? "Не удалось выполнить действие");
    }
    return payload.data as T;
  }

  async function startEnrollment() {
    setBusy(true);
    setError(null);
    try {
      const data = await request<{ secret: string; otpauthUri: string }>("POST", { password });
      setSecret(data.secret);
      setOtpauth(data.otpauthUri);
      setStage("confirm");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrollment() {
    setBusy(true);
    setError(null);
    try {
      const data = await request<{ backupCodes: string[] }>("PUT", { code });
      setBackupCodes(data.backupCodes);
      setStage("backupCodes");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      await request("DELETE", { password, code });
      reset();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Копирование с запасным путём.
   *
   * `navigator.clipboard` есть не везде: в старых WebView (Android) и в
   * сборках Electron он может отсутствовать или отказать. Тогда используется
   * `document.execCommand("copy")`; если не сработал и он — просим перенести
   * вручную, но текст остаётся на экране.
   */
  async function copy(kind: "codes" | "secret" | "link", value: string) {
    const done = await copyToClipboard(value);
    if (done) {
      setCopied(kind);
      setError(null);
      return;
    }
    setCopied(null);
    setError("Скопировать автоматически не удалось — выделите текст и скопируйте вручную.");
  }

  /**
   * «Открыть в приложении-аутентификаторе».
   *
   * В Electron ссылку отдаём нативной оболочке (`eduflowDesktop.openExternal`),
   * иначе навигация по неизвестной схеме блокируется политикой окна. В браузере
   * и в Android-оболочке работает обычный переход — там схему ловит система.
   */
  function openAuthenticator(event: MouseEvent<HTMLAnchorElement>, uri: string) {
    if (!openInNativeShell(uri)) return;
    event.preventDefault();
    setShellNote("Ссылка передана приложению-аутентификатору на этом компьютере.");
  }

  if (!status) {
    return <div className="h-24 animate-pulse rounded-2xl bg-white/5" />;
  }

  return (
    <section className="space-y-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <header className="flex items-start gap-3">
        {status.enabled ? (
          <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-300" />
        ) : (
          <ShieldOff className="mt-0.5 h-5 w-5 text-amber-300" />
        )}
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-white">Двухфакторная защита</h2>
          <p className="text-sm text-slate-400">
            {status.enabled
              ? `Включена. Резервных кодов осталось: ${status.backupCodesLeft}.`
              : "Выключена. Для учителей и администраторов включение обязательно: аккаунт даёт доступ к урокам и данным класса."}
          </p>
        </div>
      </header>

      {error && (
        <FormAlert variant="error" onDismiss={() => setError(null)}>
          {error}
        </FormAlert>
      )}

      {stage === "backupCodes" ? (
        <div className="space-y-3">
          <FormAlert variant="success">
            Защита включена. Сохраните резервные коды — они показываются один раз и заменяют
            приложение, если телефон потеряется.
          </FormAlert>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-sm text-slate-200">
            {backupCodes.map((value) => (
              <span key={value}>{value}</span>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copy("codes", backupCodes.join("\n"))}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5"
            >
              <Copy className="h-4 w-4" />
              {copied === "codes" ? "Скопировано" : "Скопировать коды"}
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5"
            >
              Готово
            </button>
          </div>
        </div>
      ) : stage === "confirm" ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            Добавьте аккаунт в приложение-аутентификатор (Google Authenticator, Aegis, 1Password)
            и введите код из него.
          </p>
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">Секрет для ручного ввода</p>
            <p className="mt-1 break-all font-mono text-sm text-slate-100">{secret}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {linkSupported ? (
                <a
                  href={otpauth}
                  onClick={(event) => openAuthenticator(event, otpauth)}
                  className="text-xs text-brand-200 underline underline-offset-4"
                >
                  Открыть в приложении-аутентификаторе
                </a>
              ) : (
                <span className="text-xs text-slate-400">
                  Открыть ссылку на этом телефоне нельзя — введите секрет в приложении вручную.
                </span>
              )}
              <button
                type="button"
                onClick={() => void copy("secret", secret)}
                className="text-xs text-slate-400 underline underline-offset-4 transition hover:text-white"
              >
                {copied === "secret" ? "Секрет скопирован" : "Скопировать секрет"}
              </button>
              <button
                type="button"
                onClick={() => void copy("link", otpauth)}
                className="text-xs text-slate-400 underline underline-offset-4 transition hover:text-white"
              >
                {copied === "link" ? "Ссылка скопирована" : "Скопировать ссылку"}
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Работает без интернета: код считают телефон и сервер по одному ключу и времени.
              {nativeShell
                ? " Если приложение-аутентификатор стоит на этом же телефоне, скопируйте секрет кнопкой выше и вставьте его в приложении."
                : " Если телефон отдельный, откройте эту ссылку на телефоне или введите секрет вручную."}
            </p>
            {shellNote && <p className="mt-2 text-[11px] text-emerald-300">{shellNote}</p>}
          </div>
          <TextField
            label="Код из приложения"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <GradientButton type="button" loading={busy} loadingText="Проверяем…" onClick={confirmEnrollment}>
              Включить защиту
            </GradientButton>
            <button
              type="button"
              onClick={reset}
              className="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/5"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : stage === "password" ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-300">Подтвердите пароль — иначе включить защиту мог бы и чужой с украденной сессией.</p>
          <PasswordField
            label="Текущий пароль"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <GradientButton type="button" loading={busy} loadingText="Готовим…" onClick={startEnrollment}>
              Продолжить
            </GradientButton>
            <button
              type="button"
              onClick={reset}
              className="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/5"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : stage === "disable" ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            Отключение снимает второй фактор. Предъявите пароль и текущий код (или резервный код).
          </p>
          <PasswordField
            label="Текущий пароль"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <TextField
            label="Код из приложения или резервный код"
            name="code"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <GradientButton type="button" loading={busy} loadingText="Отключаем…" onClick={disable}>
              Отключить защиту
            </GradientButton>
            <button
              type="button"
              onClick={reset}
              className="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/5"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {status.enabled ? (
            <button
              type="button"
              onClick={() => setStage("disable")}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 transition hover:bg-rose-500/20"
            >
              <ShieldOff className="h-4 w-4" />
              Отключить защиту
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStage("password")}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-brand-contrast transition hover:bg-brand-400"
            >
              <KeyRound className="h-4 w-4" />
              Включить защиту
            </button>
          )}
        </div>
      )}

      <p className="text-xs leading-relaxed text-slate-500">
        Потеряли телефон и резервные коды? Администратор школы может снять второй фактор — это
        действие попадает в журнал аудита.
      </p>
    </section>
  );
}
