/** Call lifecycle: host authorization, relay cascade, cleanup order, UI guards. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { canEndCallForAll, participantCount } from "../src/lib/call-rules";
import { cleanupAllCalls, registerCallCleanup } from "../src/lib/call-events";
import { getRelayIceServers, getRelayRtcConfiguration } from "../src/lib/webrtc-config";
import { parseSchoolRoomId } from "../src/lib/call-room";
import { CallRoomControls } from "../src/components/CallRoom/CallRoomControls";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("host-only END_CALL_FOR_ALL", () => {
  const meeting = { hostId: "host-1", schoolId: "school-a" };
  it("allows the actual host in the same school", () => {
    assert.equal(canEndCallForAll({ id: "host-1", schoolId: "school-a" }, meeting), true);
  });
  it("rejects students, other teachers/admins, other schools, banned hosts", () => {
    for (const actor of [
      { id: "student-1", schoolId: "school-a" },
      { id: "teacher-2", schoolId: "school-a" },
      { id: "admin-1", schoolId: "school-a" },
      { id: "host-1", schoolId: "school-b" },
      { id: "host-1", schoolId: "school-a", isBanned: true },
      { id: "host-1", schoolId: null },
    ]) assert.equal(canEndCallForAll(actor, meeting), false);
  });
  it("counts unique users, not browser tabs", () => {
    assert.equal(participantCount([{ userId: "a" }, { userId: "a" }, { userId: "b" }]), 2);
  });
  it("parses only school-scoped room ids", () => {
    assert.equal(parseSchoolRoomId("room:school-a:math-101", "school-a"), "math-101");
    assert.equal(parseSchoolRoomId("room:school-b:math-101", "school-a"), null);
    assert.equal(parseSchoolRoomId("room:school-a:../etc", "school-a"), null);
  });
  it("server handler commits ended, broadcasts, clears memberships and room state", () => {
    const source = read("src/server/signaling/callHandlers.ts");
    assert.match(source, /status: "ended"/);
    assert.match(source, /CALL_ENDED/);
    assert.match(source, /leaveCurrentRoom\(target\)/);
    assert.match(source, /clearRoomState\(roomId\)/);
    assert.match(source, /canEndCallForAll\(actor, meeting\)/);
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
  it("root hook redirects to lobby after 2.5s and shows organizer toast", () => {
    const source = read("src/hooks/useCallEvents.ts");
    assert.match(source, /CALL_ENDED_REDIRECT_MS = 2_500/);
    assert.match(source, /router\.replace\("\/meeting"\)/);
    assert.match(source, /Организатор \$\{payload\.endedBy\.name\} завершил звонок/);
    assert.match(read("src/components/providers.tsx"), /useCallEvents\(\)/);
  });
});

describe("CallRoomControls UI", () => {
  it("disables end-for-all for non-hosts and confirms with participant count", async () => {
    const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://eduflow.test/" });
    const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, React };
    const previous = new Map(Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);
    let ended = 0;
    try {
      await act(async () => root.render(React.createElement(CallRoomControls, {
        isHost: false, participantCount: 3, ending: false, onEndForAll: () => { ended += 1; }, onLeave: () => undefined,
      })));
      const endButton = container.querySelector<HTMLButtonElement>('button[aria-label="Завершить для всех"]')!;
      assert.equal(endButton.disabled, true);
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
