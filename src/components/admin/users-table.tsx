"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Unlock,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { UserModal } from "@/components/admin/user-modal";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminUserRow, ListUsersResult } from "@/lib/admin-users";
import { adminCapabilities, type AdminActor } from "@/lib/admin-permissions";
import { apiRequest } from "@/lib/client-api";
import { GRADES, GRADE_LABELS, type GradeCode } from "@/lib/schedule-rules";
import { cn, getInitials } from "@/lib/utils";
import { ROLE_LABELS, type Role } from "@/types";

interface UsersTableProps {
  initial: ListUsersResult;
  actor: AdminActor;
}

const ROLE_BADGES: Record<Role, string> = {
  ADMIN: "border-rose-400/30 bg-rose-500/15 text-rose-200",
  TEACHER: "border-brand-400/30 bg-brand-500/15 text-brand-100",
  STUDENT: "border-accent-400/30 bg-accent-500/15 text-accent-300",
};

const SEARCH_DEBOUNCE_MS = 350;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Таблица пользователей админ-панели: поиск по имени/email, фильтры по роли и
 * классу, пагинация, модалка создания/редактирования и блокировка аккаунта
 * (с мгновенным разрывом сокет-сессий на сервере).
 */
export function UsersTable({ initial, actor }: UsersTableProps) {
  const router = useRouter();
  const capabilities = adminCapabilities(actor);

  const [data, setData] = useState<ListUsersResult>(initial);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [role, setRole] = useState<Role | "ALL">("ALL");
  const [grade, setGrade] = useState<GradeCode | "ALL">("ALL");
  const [bannedOnly, setBannedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmBanId, setConfirmBanId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const isFirstRender = useRef(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (role !== "ALL") params.set("role", role);
    if (grade !== "ALL") params.set("grade", grade);
    if (bannedOnly) params.set("banned", "1");
    params.set("page", String(page));

    const result = await apiRequest<ListUsersResult>(`/api/admin/users?${params.toString()}`);
    setLoading(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setData(result.data);
  }, [bannedOnly, debouncedSearch, grade, page, role]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    void load();
  }, [load]);

  const toggleBan = async (user: AdminUserRow) => {
    setPendingId(user.id);
    const result = await apiRequest<{ user: AdminUserRow; disconnect: { sessions: number } }>(
      `/api/admin/users/${user.id}`,
      { method: "PATCH", json: { isBanned: !user.isBanned } },
    );
    setPendingId(null);
    setConfirmBanId(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    const { user: updated, disconnect } = result.data;
    setData((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
    }));

    if (updated.isBanned) {
      toast.success(
        disconnect.sessions > 0
          ? `${updated.name} заблокирован, разорвано сессий: ${disconnect.sessions}`
          : `${updated.name} заблокирован`,
      );
    } else {
      toast.success(`${updated.name} разблокирован`);
    }

    router.refresh();
  };

  const pageCount = Math.max(1, data.pageCount);

  const renderUserActions = (user: AdminUserRow, mobile = false) => {
    const rowCapabilities = adminCapabilities(actor, { id: user.id, role: user.role });
    const awaitingBanConfirm = confirmBanId === user.id;

    return (
      <div className={cn("items-center gap-2", mobile ? "grid grid-cols-2" : "flex flex-wrap justify-end")}>
        <button
          type="button"
          onClick={() => setEditing(user)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10",
            mobile && "w-full justify-center px-2",
          )}
        >
          <Pencil className="h-3.5 w-3.5" />
          Изменить
        </button>

        {rowCapabilities["users.ban"] ? (
          <button
            type="button"
            disabled={pendingId === user.id}
            onClick={() => {
              if (user.isBanned) {
                void toggleBan(user);
                return;
              }
              if (awaitingBanConfirm) {
                void toggleBan(user);
                return;
              }
              setConfirmBanId(user.id);
              window.setTimeout(() => setConfirmBanId((current) => (current === user.id ? null : current)), 5000);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50",
              mobile && "w-full justify-center px-2",
              user.isBanned
                ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                : awaitingBanConfirm
                  ? "border-rose-400/50 bg-rose-500/25 text-rose-100"
                  : "border-rose-400/25 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20",
            )}
          >
            {user.isBanned ? (
              <>
                <Unlock className="h-3.5 w-3.5 shrink-0" />
                Разблокировать
              </>
            ) : (
              <>
                <Ban className="h-3.5 w-3.5 shrink-0" />
                {awaitingBanConfirm ? "Точно?" : "Заблокировать"}
              </>
            )}
          </button>
        ) : (
          <span className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5 text-xs text-slate-500",
            mobile && "col-span-2 justify-center",
          )}>
            <Users className="h-3.5 w-3.5" />
            Только просмотр
          </span>
        )}
      </div>
    );
  };

  return (
    <section className="space-y-5">
      {/* Панель фильтров */}
      <div className="glass-card p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1 space-y-1.5">
            <label htmlFor="admin-users-search" className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Поиск
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                id="admin-users-search"
                value={search}
                placeholder="Имя или email"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                className="w-full rounded-xl border border-white/10 bg-white/[0.035] py-3 pl-10 pr-3.5 text-sm text-white outline-none backdrop-blur-xl transition placeholder:text-slate-600 hover:border-white/20 focus:border-accent-400/70 focus:ring-4 focus:ring-accent-500/15"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="admin-users-role" className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Роль
            </label>
            <select
              id="admin-users-role"
              value={role}
              onChange={(event) => {
                setRole(event.target.value as Role | "ALL");
                setPage(1);
              }}
              className="rounded-xl border border-white/10 bg-ink-900/60 px-3.5 py-3 text-sm text-white outline-none transition hover:border-white/20 focus:border-accent-400/70"
            >
              <option value="ALL">Все роли</option>
              <option value="STUDENT">Ученики</option>
              <option value="TEACHER">Учителя</option>
              <option value="ADMIN">Администраторы</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="admin-users-grade" className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Класс
            </label>
            <select
              id="admin-users-grade"
              value={grade}
              onChange={(event) => {
                setGrade(event.target.value as GradeCode | "ALL");
                setPage(1);
              }}
              className="rounded-xl border border-white/10 bg-ink-900/60 px-3.5 py-3 text-sm text-white outline-none transition hover:border-white/20 focus:border-accent-400/70"
            >
              <option value="ALL">Все классы</option>
              {GRADES.map((item) => (
                <option key={item} value={item}>
                  {GRADE_LABELS[item]}
                </option>
              ))}
            </select>
          </div>

          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3.5 py-3 text-sm text-slate-200 transition hover:border-white/20">
            <input
              type="checkbox"
              checked={bannedOnly}
              onChange={(event) => {
                setBannedOnly(event.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 accent-rose-500"
            />
            Только заблокированные
          </label>

          <button
            type="button"
            onClick={() => void load()}
            title="Обновить список"
            className="inline-flex h-[46px] items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm text-slate-300 transition hover:bg-white/10"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>

          {capabilities["users.create"] && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex h-[46px] items-center gap-2 rounded-xl bg-brand-gradient px-4 text-sm font-semibold text-white shadow-glow transition hover:scale-[1.02]"
            >
              <UserPlus className="h-4 w-4" />
              Добавить
            </button>
          )}
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Найдено пользователей: {data.total} · страница {data.page} из {pageCount}
          {!capabilities["users.role.change"] && " · учителю доступна модерация только учеников"}
        </p>
      </div>

      {/* Таблица */}
      <div className="glass-card overflow-hidden">
        {loading && data.items.length === 0 ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-slate-400">
            Ничего не найдено. Измените фильтры или создайте нового пользователя.
          </p>
        ) : (
          <>
            <div className={cn("divide-y divide-white/5 transition-opacity md:hidden", loading && "opacity-60")}>
              {data.items.map((user) => (
                <article
                  key={user.id}
                  className={cn("p-4", user.isBanned && "bg-rose-500/[0.05]")}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-white">
                      {getInitials(user.name) || "SM"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-medium text-white">{user.name}</p>
                        <span className={cn(
                          "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                          ROLE_BADGES[user.role],
                        )}>
                          {ROLE_LABELS[user.role]}
                        </span>
                      </div>
                      <p className="mt-1 break-all text-xs text-slate-500">{user.email}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {user.isBanned ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/30 bg-rose-500/15 px-2.5 py-1 text-[11px] font-medium text-rose-200">
                        <Ban className="h-3 w-3" />
                        Заблокирован
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200">
                        <ShieldCheck className="h-3 w-3" />
                        Активен
                      </span>
                    )}
                    {user.isOnline && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-400/30 bg-accent-500/10 px-2.5 py-1 text-[11px] font-medium text-accent-200">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-400" />
                        В уроке
                      </span>
                    )}
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-slate-500">Класс</dt>
                      <dd className="mt-1 text-slate-300">{user.grade ? GRADE_LABELS[user.grade] : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Создан</dt>
                      <dd className="mt-1 text-slate-300">{formatDate(user.createdAt)}</dd>
                    </div>
                  </dl>

                  <div className="mt-4">{renderUserActions(user, true)}</div>
                </article>
              ))}
            </div>

            <div className={cn("hidden overflow-x-auto transition-opacity md:block", loading && "opacity-60")}>
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-500">
                <tr className="border-b border-white/5">
                  <th className="px-6 py-3 font-medium">Пользователь</th>
                  <th className="px-4 py-3 font-medium">Роль</th>
                  <th className="px-4 py-3 font-medium">Класс</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  <th className="px-4 py-3 font-medium">Создан</th>
                  <th className="px-6 py-3 text-right font-medium">Действия</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((user) => {
                  return (
                    <tr
                      key={user.id}
                      className={cn(
                        "border-b border-white/5 transition last:border-0 hover:bg-white/[0.03]",
                        user.isBanned && "bg-rose-500/[0.05]",
                      )}
                    >
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-3">
                          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-white">
                            {getInitials(user.name) || "SM"}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-white">{user.name}</span>
                            <span className="block truncate text-xs text-slate-500">{user.email}</span>
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3.5">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                            ROLE_BADGES[user.role],
                          )}
                        >
                          {ROLE_LABELS[user.role]}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-slate-400">
                        {user.grade ? GRADE_LABELS[user.grade] : "—"}
                      </td>

                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap gap-1.5">
                          {user.isBanned ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/30 bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-medium text-rose-200">
                              <Ban className="h-3 w-3" />
                              Заблокирован
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-200">
                              <ShieldCheck className="h-3 w-3" />
                              Активен
                            </span>
                          )}
                          {user.isOnline && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-400/30 bg-accent-500/10 px-2.5 py-0.5 text-[11px] font-medium text-accent-200">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-400" />
                              В уроке
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-slate-500">{formatDate(user.createdAt)}</td>

                      <td className="px-6 py-3.5">{renderUserActions(user)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </>
        )}

        {/* Пагинация */}
        <div className="flex items-center justify-between gap-3 border-t border-white/5 px-3 py-4 md:px-6">
          <span className="text-xs text-slate-500">
            {data.total === 0
              ? "Нет записей"
              : `Показаны ${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.total)} из ${data.total}`}
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={data.page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Назад
            </button>
            <span className="text-xs text-slate-400">
              {data.page} / {pageCount}
            </span>
            <button
              type="button"
              disabled={data.page >= pageCount || loading}
              onClick={() => setPage((current) => current + 1)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10 disabled:opacity-40"
            >
              Вперёд
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {creating && (
        <UserModal
          mode="create"
          actor={actor}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void load();
          }}
        />
      )}

      {editing && (
        <UserModal
          mode="edit"
          user={editing}
          actor={actor}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </section>
  );
}
