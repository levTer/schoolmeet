/** Call lifecycle: host/admin authorization, relay cascade, cleanup order, banner & room UI guards. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";

import { canEndCallForAll, canManageLessonEnd, participantCount } from "../src/lib/call-rules";
import { cleanupAllCalls, registerCallCleanup } from "../src/lib/call-events";
import { getRelayIceServers, getRelayRtcConfiguration } from "../src/lib/webrtc-config";
import { parseSchoolRoomId } from "../src/lib/call-room";
import { liveLessonFromMeeting } from "../src/lib/live-lesson-rules";
import { CallRoomControls } from "../src/components/CallRoom/CallRoomControls";
import { LiveLessonCard } from "../src/components/dashboard/live-lesson-card";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function makeRouterStub(onRefresh: () => void): AppRouterInstance {
  return {
    back: () => undefined,
    forward: () => undefined,
    refresh: onRefresh,
    push: () => undefined,
    replace: () => undefined,
    prefetch: () => undefined,
  };
}

describe("host and school ADMIN END_CALL_FOR_ALL authorization", () => {
  const meeting = { hostId: "host-1", schoolId: "school-a" };

  it("allows the actual host in the same school", () => {
    assert.equal(canEndCallForAll({ id: "host-1", role: "TEACHER", schoolId: "school-a" }, meeting), true);
    assert.equal(canEndCallForAll({ id: "host-1", schoolId: "school-a" }, meeting), true);
    assert.equal(canManageLessonEnd({ id: "host-1", role: "TEACHER" }, meeting), true);
  });

  it("allows an ADMIN in the same school", () => {
    assert.equal(canEndCallForAll({ id: "admin-1", role: "ADMIN", schoolId: "school-a" }, meeting), true);
    assert.equal(canManageLessonEnd({ id: "admin-1", role: "ADMIN" }, meeting), true);
  });

  it("rejects students, non-host teachers, cross-school admins/hosts, and banned users", () => {
    for (const actor of [
      { id: "student-1", role: "STUDENT" as const, schoolId: "school-a" },
      { id: "teacher-2", role: "TEACHER" as const, schoolId: "school-a" },
      { id: "admin-no-role", schoolId: "school-a" },
      { id: "admin-other-school", role: "ADMIN" as const, schoolId: "school-b" },
      { id: "host-1", role: "TEACHER" as const, schoolId: "school-b" },
      { id: "host-1", role: "TEACHER" as const, schoolId: "school-a", isBanned: true },
      { id: "admin-1", role: "ADMIN" as const, schoolId: "school-a", isBanned: true },
      { id: "host-1", role: "TEACHER" as const, schoolId: null },
    ]) {
      assert.equal(canEndCallForAll(actor, meeting), false);
    }
    assert.equal(canManageLessonEnd({ id: "student-1", role: "STUDENT" }, meeting), false);
    assert.equal(canManageLessonEnd({ id: "teacher-2", role: "TEACHER" }, meeting), false);
    assert.equal(canManageLessonEnd(null, meeting), false);
  });

  it("counts unique users, not browser tabs", () => {
    assert.equal(participantCount([{ userId: "a" }, { userId: "a" }, { userId: "b" }]), 2);
  });

  it("parses only school-scoped room ids", () => {
    assert.equal(parseSchoolRoomId("room:school-a:math-101", "school-a"), "math-101");
    assert.equal(parseSchoolRoomId("room:school-b:math-101", "school-a"), null);
    assert.equal(parseSchoolRoomId("room:school-a:../etc", "school-a"), null);
  });

  it("server handler & end endpoint commit ended, scope by schoolId, broadcast CALL_ENDED, and clear room state", () => {
    const handler = read("src/server/signaling/callHandlers.ts");
    assert.match(handler, /status: "ended"/);
    assert.match(handler, /CALL_ENDED/);
    assert.match(handler, /leaveCurrentRoom\(target\)/);
    assert.match(handler, /clearRoomState\(roomId\)/);
    assert.match(handler, /canEndCallForAll\(actor, meeting\)/);

    const endService = read("src/lib/end-meeting.ts");
    assert.match(endService, /schoolScope\(actor\.schoolId\)/);
    assert.match(endService, /canEndCallForAll\(/);
    assert.match(endService, /status: "ended"/);
    assert.match(endService, /control\.endCallForAll\(/);

    const endRoute = read("src/app/api/meetings/[code]/end/route.ts");
    assert.match(endRoute, /requireSchoolViewer\(\)/);
    assert.match(endRoute, /endMeetingByActor\(/);
  });
});

describe("relay-only TCP cascade", () => {
  it("never includes STUN/UDP in call configurations", () => {
    for (const stage of [0, 1, 2, 3] as const) {
      const config = getRelayRtcConfiguration(stage, {} as NodeJS.ProcessEnv);
      assert.equal(config.iceTransportPolicy, "relay");
      for (const server of config.iceServers ?? []) {
        for (const url of Array.isArray(server.urls) ? server.urls : [server.urls]) {
          assert.match(url, /^turns?:/);
          assert.match(url, /transport=tcp/);
          assert.doesNotMatch(url, /transport=udp/);
        }
      }
    }
  });
  it("uses TURNS/TCP 443 first and TURN/TCP 80 as a later stage", () => {
    assert.ok(getRelayIceServers(0, {} as NodeJS.ProcessEnv).every((s) => String(s.urls).startsWith("turns:") && String(s.urls).includes(":443")));
    assert.ok(getRelayIceServers(2, {} as NodeJS.ProcessEnv).every((s) => String(s.urls).startsWith("turn:") && String(s.urls).includes(":80")));
  });
  it("prefers configured TURN over public examples and drops unauthenticated entries", () => {
    const env = {
      NEXT_PUBLIC_TURN_SERVERS: JSON.stringify([
        { urls: "turns:private.example:443?transport=tcp", username: "u", credential: "p" },
        { urls: "turns:no-auth.example:443?transport=tcp" },
      ]),
    } as NodeJS.ProcessEnv;
    const servers = getRelayIceServers(0, env);
    assert.equal(servers[0]?.urls, "turns:private.example:443?transport=tcp");
    assert.ok(servers.every((s) => s.username && s.credential));
  });
  it("engine restarts ICE on online/network change and filters non-relay candidates", () => {
    const source = read("src/hooks/useWebRTC.ts");
    assert.match(source, /addEventListener\("online"/);
    assert.match(source, /addEventListener\("change"/);
    assert.match(source, /candidate\?\.type === "relay"/);
    assert.match(source, /typ relay/);
    assert.match(source, /restart-request/);
  });
});

describe("global cleanup", () => {
  it("runs higher priority cleanup first and is idempotent per registration", () => {
    const order: string[] = [];
    const offLow = registerCallCleanup(() => order.push("tracks"), 0);
    const offHigh = registerCallCleanup(() => order.push("recorder"), 10);
    cleanupAllCalls();
    assert.deepEqual(order, ["recorder", "tracks"]);
    offLow(); offHigh();
    cleanupAllCalls();
    assert.deepEqual(order, ["recorder", "tracks"]);
  });

  it("root hook disconnects socket, shows organizer toast, and redirects participants to /dashboard", () => {
    const source = read("src/hooks/useCallEvents.ts");
    assert.match(source, /CALL_ENDED_REDIRECT_MS = 2_500/);
    assert.match(source, /Урок завершён организатором/);
    assert.match(source, /router\.replace\("\/dashboard"\)/);
    assert.match(source, /router\.refresh\(\)/);
    assert.match(read("src/hooks/useSocket.ts"), /socket\.on\("CALL_ENDED"[\s\S]{0,320}?socket\.disconnect\(\)/);
    assert.match(read("src/components/providers.tsx"), /useCallEvents\(\)/);
  });
});

describe("CallRoomControls UI", () => {
  it("disables end-for-all for non-hosts and allows both host and ADMIN to confirm with participant count", async () => {
    const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://eduflow.test/" });
    const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, React };
    const previous = new Map(Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);
    let ended = 0;
    try {
      await act(async () => root.render(React.createElement(CallRoomControls, {
        isHost: false, isAdmin: false, participantCount: 3, ending: false, onEndForAll: () => { ended += 1; }, onLeave: () => undefined,
      })));
      const endButton = container.querySelector<HTMLButtonElement>('button[aria-label="Завершить для всех"]')!;
      assert.equal(endButton.disabled, true);

      // Host can end for all
      await act(async () => root.render(React.createElement(CallRoomControls, {
        isHost: true, participantCount: 3, ending: false, onEndForAll: () => { ended += 1; }, onLeave: () => undefined,
      })));
      const hostButton = container.querySelector<HTMLButtonElement>('button[aria-label="Завершить для всех"]')!;
      assert.equal(hostButton.disabled, false);
      await act(async () => hostButton.click());
      const dialog = dom.window.document.querySelector('[role="dialog"]')!;
      assert.match(dialog.textContent ?? "", /\(3\)/);
      const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent?.includes("Завершить для всех"))!;
      await act(async () => confirm.click());
      assert.equal(ended, 1);

      // School ADMIN (not host) can also end for all inside the room
      await act(async () => root.render(React.createElement(CallRoomControls, {
        isHost: false, isAdmin: true, participantCount: 5, ending: false, onEndForAll: () => { ended += 1; }, onLeave: () => undefined,
      })));
      const adminButton = container.querySelector<HTMLButtonElement>('button[aria-label="Завершить для всех"]')!;
      assert.equal(adminButton.disabled, false);
      await act(async () => adminButton.click());
      const adminDialog = dom.window.document.querySelector('[role="dialog"]')!;
      assert.match(adminDialog.textContent ?? "", /\(5\)/);
      const adminConfirm = Array.from(adminDialog.querySelectorAll("button")).find((b) => b.textContent?.includes("Завершить для всех"))!;
      await act(async () => adminConfirm.click());
      assert.equal(ended, 2);
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
      }
    }
  });
});

describe("Dashboard LiveLessonCard End Lesson UI", () => {
  it("shows End Lesson only for host/ADMIN, confirms, posts to /api/meetings/[id]/end, refreshes router, and hides banner", async () => {
    const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://eduflow.test/dashboard" });
    const fetchCalls: Array<{ url: string; method?: string }> = [];
    const originalFetch = globalThis.fetch;
    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), method: init?.method });
      return new Response(
        JSON.stringify({ ok: true, data: { meetingId: "meet-42", status: "ended", endedAt: "2026-10-29T12:00:00.000Z" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const globals = {
      window: dom.window,
      self: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      CustomEvent: dom.window.CustomEvent,
      IS_REACT_ACT_ENVIRONMENT: true,
      React,
      fetch: mockFetch,
    };
    const previous = new Map(Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const [name, value] of Object.entries(globals)) {
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }

    let refreshCount = 0;
    const router = makeRouterStub(() => { refreshCount += 1; });
    const lesson = liveLessonFromMeeting({
      id: "meet-42",
      hostId: "teacher-host",
      title: "Внеплановый урок 29 окт.",
      meetingCode: "vneplanovyy-urok-42",
      host: { id: "teacher-host", name: "Анна Терентьева" },
    });

    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);

    const renderWithViewer = (currentUser: { id: string; role: "ADMIN" | "TEACHER" | "STUDENT" } | null, item = lesson) =>
      React.createElement(
        AppRouterContext.Provider,
        { value: router },
        React.createElement(LiveLessonCard, { lesson: item, currentUser }),
      );

    try {
      // 1. Student sees join button, never sees "Завершить урок"
      await act(async () => root.render(renderWithViewer({ id: "student-1", role: "STUDENT" })));
      assert.match(container.textContent ?? "", /ПРЯМО СЕЙЧАС ИДЁТ УРОК/);
      assert.equal(container.querySelector('button[aria-label="Завершить урок"]'), null);

      // 2. Non-host teacher does not see "Завершить урок"
      await act(async () => root.render(renderWithViewer({ id: "other-teacher", role: "TEACHER" })));
      assert.equal(container.querySelector('button[aria-label="Завершить урок"]'), null);

      // 3. Host sees red "🔴 Завершить урок" button, opens confirmation modal, confirms -> API + refresh + banner disappears
      await act(async () => root.render(renderWithViewer({ id: "teacher-host", role: "TEACHER" })));
      const hostEndBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Завершить урок"]');
      assert.ok(hostEndBtn, "host must see End Lesson button");
      assert.match(hostEndBtn.textContent ?? "", /Завершить урок/);

      await act(async () => hostEndBtn.click());
      const dialog = dom.window.document.querySelector('[role="dialog"]');
      assert.ok(dialog, "confirmation modal must open");
      assert.match(dialog.textContent ?? "", /Завершить этот урок для всех участников\?/);

      const confirmBtn = Array.from(dialog.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Завершить урок"),
      );
      assert.ok(confirmBtn, "confirm button must exist in dialog");

      await act(async () => confirmBtn.click());
      assert.deepEqual(fetchCalls, [{ url: "/api/meetings/meet-42/end", method: "POST" }]);
      assert.equal(refreshCount, 1);
      assert.equal(container.querySelector(".live-lesson-card"), null, "banner must immediately disappear");

      // 4. School ADMIN can also end another teacher's active lesson from the banner
      const secondLesson = liveLessonFromMeeting({
        id: "meet-99",
        hostId: "teacher-host",
        title: "Внеплановый урок 2",
        meetingCode: "vneplanovyy-urok-99",
        host: { id: "teacher-host", name: "Анна Терентьева" },
      });
      await act(async () => root.render(renderWithViewer({ id: "school-admin", role: "ADMIN" }, secondLesson)));
      const adminEndBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Завершить урок"]');
      assert.ok(adminEndBtn, "ADMIN must see End Lesson button");
      await act(async () => adminEndBtn.click());
      const adminDialog = dom.window.document.querySelector('[role="dialog"]')!;
      const adminConfirm = Array.from(adminDialog.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Завершить урок"),
      )!;
      await act(async () => adminConfirm.click());
      assert.equal(fetchCalls.at(-1)?.url, "/api/meetings/meet-99/end");
      assert.equal(refreshCount, 2);
      assert.equal(container.querySelector(".live-lesson-card"), null);
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      globalThis.fetch = originalFetch;
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
      }
    }
  });
});
