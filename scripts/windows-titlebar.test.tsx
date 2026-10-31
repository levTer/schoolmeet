/** Регрессии шапки EXE без запуска Windows или базы данных. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { SessionProvider } from "next-auth/react";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import { Navbar } from "../src/components/layout/Navbar";
import { SiteHeader } from "../src/components/landing/site-header";
import { ThemeProvider } from "../src/components/theme/theme-provider";
import { useDesktopTitlebar } from "../src/hooks/useDesktopTitlebar";

const admin = {
  id: "admin",
  name: "Администратор Fullhouse",
  email: "admin@example.test",
  role: "ADMIN" as const,
  schoolId: null,
  schoolName: "Fullhouse Team",
  classId: null,
  banned: false,
};

function TitlebarProbe() {
  const layout = useDesktopTitlebar();
  // JSDOM не вычисляет CSS env(), поэтому проверяем свойства до применения к DOM.
  return <output data-titlebar-layout={JSON.stringify(layout)} />;
}

test("широкая безопасная шапка включается только в Windows EXE", async (t) => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "https://eduflow.test/dashboard",
    pretendToBeVisual: true,
  });
  const globals = {
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    fetch: async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  let standalone = false;
  dom.window.matchMedia = (query) => ({
    matches: standalone && query === "(display-mode: standalone)",
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  });

  const rootElement = dom.window.document.getElementById("root")!;
  const root = createRoot(rootElement);
  const cases = [
    { name: "обычный сайт", bridge: undefined, standalone: false, expected: "web" },
    { name: "PWA в Windows", bridge: undefined, standalone: true, expected: "web" },
    { name: "Android APK", bridge: undefined, standalone: false, android: true, expected: "web" },
    { name: "неактивный мост", bridge: { isDesktop: false, platform: "win32" }, standalone: false, expected: "web" },
    { name: "macOS DMG", bridge: { isDesktop: true, platform: "darwin" }, standalone: false, expected: "other" },
    { name: "другая Electron-оболочка", bridge: { isDesktop: true, platform: "linux" }, standalone: false, expected: "other" },
    { name: "установленный Windows EXE", bridge: { isDesktop: true, platform: "win32" }, standalone: false, expected: "windows" },
  ] as const;

  try {
    for (const [index, scenario] of cases.entries()) {
      await t.test(scenario.name, async () => {
        standalone = scenario.standalone;
        dom.window.eduflowDesktop = scenario.bridge;
        dom.window.AndroidApp = "android" in scenario ? { setStatusBarColor() {} } : undefined;
        await act(async () => {
          root.render(
            <ThemeProvider key={index}>
              <SessionProvider session={null} refetchOnWindowFocus={false}>
                <PathnameContext.Provider value="/dashboard">
                  <TitlebarProbe />
                  <Navbar user={admin} />
                  <SiteHeader />
                </PathnameContext.Provider>
              </SessionProvider>
            </ThemeProvider>,
          );
        });

        const rawLayout = rootElement.querySelector("output")?.getAttribute("data-titlebar-layout");
        assert.ok(rawLayout);
        const layout = JSON.parse(rawLayout);
        const headers = rootElement.querySelectorAll("header");
        assert.equal(headers.length, 2);

        if (scenario.expected === "windows") {
          assert.equal(layout.isWindowsDesktop, true);
          assert.deepEqual(layout.titlebarStyle, {
            width: "env(titlebar-area-width, calc(100% - 140px))",
            marginLeft: "env(titlebar-area-x, 0px)",
            marginRight: 0,
          });
        } else {
          assert.equal(layout.isWindowsDesktop, false);
          if (scenario.expected === "other") {
            assert.deepEqual(layout.titlebarStyle, { paddingRight: "env(titlebar-area-width, 140px)" });
          } else {
            assert.equal(layout.titlebarStyle, undefined);
          }
        }

        for (const header of headers) {
          const bar = header.firstElementChild;
          assert.ok(bar);
          assert.equal(bar.classList.contains("max-w-none"), scenario.expected === "windows");
          assert.equal(bar.classList.contains("max-w-7xl"), scenario.expected !== "windows");
          const nav = bar.querySelector("nav");
          assert.ok(nav);
          assert.equal(nav.classList.contains("shrink-0"), scenario.expected === "windows");
          for (const link of nav.querySelectorAll("a")) {
            assert.equal(link.classList.contains("max-[850px]:px-1.5"), scenario.expected === "windows");
          }
        }

        if (scenario.expected === "windows") {
          const navbar = headers[0];
          for (const href of ["/dashboard", "/schedule", "/homework", "/meeting", "/admin"]) {
            assert.ok(navbar.querySelector(`nav a[href="${href}"]`), `Нет пункта ${href}`);
          }
          const profile = navbar.querySelector<HTMLButtonElement>('button[aria-label="Меню профиля"]');
          assert.ok(profile);
          await act(async () => profile.click());
          assert.equal(profile.getAttribute("aria-expanded"), "true");
          assert.ok(navbar.querySelector('[role="menu"] a[href="/account/security"]'));
          await act(async () => dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" })));
          assert.equal(profile.getAttribute("aria-expanded"), "false");

          const settings = navbar.querySelector<HTMLButtonElement>('button[aria-label="Открыть настройки внешнего вида"]');
          assert.ok(settings);
          await act(async () => settings.click());
          assert.equal(settings.getAttribute("aria-expanded"), "true");
          assert.ok(navbar.querySelector('[role="dialog"][aria-label="Настройки внешнего вида"]'));
          await act(async () => dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" })));
          assert.equal(settings.getAttribute("aria-expanded"), "false");
        }
      });
    }
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
