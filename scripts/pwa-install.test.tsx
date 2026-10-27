/** Проверки реальных кликов по ссылке APK и отдельной кнопке PWA без браузера. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { InstallBlock } from "../src/components/landing/install-block";
import { PwaInstallButton } from "../src/components/pwa-install-button";

const APK_LABEL = "🤖 Скачать файл APK напрямую";
const PWA_LABEL = "📲 Добавить иконку на экран (PWA)";

test("скачивание APK и установка PWA не перехватывают действия друг друга", async (t) => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "https://eduflow.test/",
    pretendToBeVisual: true,
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    // tsx использует классический JSX runtime; Next.js подключает его автоматически.
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  dom.window.matchMedia = () => ({
    matches: false,
    media: "(display-mode: standalone)",
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  });

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let promptCalls = 0;

  function buttonWithText(parent: ParentNode, label: string): HTMLButtonElement {
    const button = [...parent.querySelectorAll("button")].find((element) => element.textContent?.includes(label));
    assert.ok(button, `Не найдена кнопка «${label}»`);
    return button;
  }

  function apkLink(parent: ParentNode): HTMLAnchorElement {
    const link = parent.querySelector<HTMLAnchorElement>('a[href="/eduflow.apk"]');
    assert.ok(link, "Не найдена ссылка на APK");
    assert.equal(link.textContent?.trim(), APK_LABEL);
    assert.equal(link.getAttribute("download"), "EduFlow.apk");
    assert.equal(link.getAttribute("target"), "_blank");
    assert.equal(link.getAttribute("rel"), "noopener noreferrer");
    return link;
  }

  function dispatchPrompt(
    outcome: "accepted" | "dismissed",
    prompt: () => Promise<void> = async () => {},
  ) {
    const event = new dom.window.Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: () => {
        promptCalls += 1;
        return prompt();
      },
      userChoice: Promise.resolve({ outcome, platform: "web" }),
    });
    dom.window.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, "beforeinstallprompt не был сохранён");
  }

  async function click(element: HTMLElement) {
    await act(async () => element.click());
  }

  async function clickApk(link: HTMLAnchorElement) {
    // JSDOM не умеет скачивать файлы; отменяем только навигацию самого браузера.
    link.addEventListener("click", (event) => event.preventDefault(), { once: true });
    await click(link);
  }

  try {
    await act(async () => root.render(<><InstallBlock /><PwaInstallButton /></>));

    await t.test("лендинг и выбор в шапке показывают независимые действия", async () => {
      await act(async () => dispatchPrompt("dismissed"));
      const landingApk = apkLink(container);
      const landingPwa = buttonWithText(container, PWA_LABEL);
      assert.notEqual(landingApk, landingPwa);
      assert.equal(landingPwa.disabled, false);
      await clickApk(landingApk);
      assert.equal(promptCalls, 0, "скачивание APK вызвало PWA prompt");
      assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);

      const header = container.querySelector<HTMLButtonElement>('button[aria-label="Установить EduFlow"]');
      assert.ok(header);
      header.focus();
      await click(header);
      assert.equal(promptCalls, 0, "открытие выбора запустило PWA prompt");
      const dialog = dom.window.document.querySelector<HTMLElement>('[role="dialog"]');
      assert.ok(dialog);
      assert.equal(dialog.parentElement?.parentElement?.parentElement, dom.window.document.body, "модалка должна быть вне ограничений шапки");
      assert.equal(dom.window.document.body.style.overflow, "hidden");
      assert.equal(dom.window.document.activeElement, dialog);
      const modalApk = apkLink(dialog);
      assert.notEqual(modalApk, buttonWithText(dialog, PWA_LABEL));
      await clickApk(modalApk);
      assert.equal(promptCalls, 0, "ссылка APK в модалке вызвала PWA prompt");
    });

    await t.test("только PWA-кнопка в модалке вызывает сохранённый prompt; отказ сохраняет выбор", async () => {
      const dialog = dom.window.document.querySelector<HTMLElement>('[role="dialog"]');
      assert.ok(dialog);
      await act(async () => {
        buttonWithText(dialog, PWA_LABEL).click();
        // prompt должен вызываться непосредственно в обработчике пользовательского клика.
        assert.equal(promptCalls, 1);
      });
      assert.ok(dom.window.document.querySelector('[role="dialog"] a[href="/eduflow.apk"]'));
      assert.equal(dialog.textContent?.includes("Если браузер не предлагает установку автоматически"), false);
    });

    await t.test("без доступного prompt модалка объясняет установку через браузер", async () => {
      const dialog = dom.window.document.querySelector<HTMLElement>('[role="dialog"]');
      assert.ok(dialog);
      await click(buttonWithText(dialog, PWA_LABEL));
      assert.equal(promptCalls, 1);
      assert.match(dialog.textContent!, /Если браузер не предлагает установку автоматически/);
      assert.match(dialog.textContent!, /Поделиться/);
      assert.match(dialog.textContent!, /Android/);
      await click(buttonWithText(dialog, "Ко всем вариантам установки"));
      assert.ok(apkLink(dialog));
      const close = dialog.querySelector<HTMLButtonElement>('button[aria-label="Закрыть окно установки"]');
      assert.ok(close);
      await click(close);
      assert.equal(dom.window.document.body.style.overflow, "");
      assert.equal(dom.window.document.activeElement?.getAttribute("aria-label"), "Установить EduFlow");
    });

    await t.test("лендинг показывает инструкцию при недоступном или завершившемся ошибкой prompt", async () => {
      const landingPwa = buttonWithText(container, PWA_LABEL);
      landingPwa.focus();
      await click(landingPwa);
      let dialog = dom.window.document.querySelector<HTMLElement>('[role="dialog"]');
      assert.ok(dialog);
      assert.equal(dialog.parentElement?.parentElement?.parentElement, dom.window.document.body, "инструкция не должна обрезаться анимацией лендинга");
      assert.match(dialog.textContent!, /Если браузер не предлагает установку автоматически/);
      assert.match(dialog.textContent!, /Android/);
      await act(async () => dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" })));
      assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
      assert.equal(dom.window.document.activeElement, landingPwa);

      await act(async () => dispatchPrompt("dismissed", async () => { throw new Error("prompt unavailable"); }));
      await click(buttonWithText(container, PWA_LABEL));
      assert.equal(promptCalls, 2);
      dialog = dom.window.document.querySelector<HTMLElement>('[role="dialog"]');
      assert.ok(dialog);
      assert.match(dialog.textContent!, /Если браузер не предлагает установку автоматически/);
      await click(buttonWithText(dialog, "Понятно"));
    });

    await t.test("лендинг вызывает prompt один раз, блокирует повтор и не открывает подсказку при отказе", async () => {
      let finishPrompt: (() => void) | undefined;
      await act(async () => dispatchPrompt("dismissed", () => new Promise<void>((resolve) => { finishPrompt = resolve; })));
      const pwa = buttonWithText(container, PWA_LABEL);
      await act(async () => {
        pwa.click();
        assert.equal(promptCalls, 3, "prompt не вызван непосредственно по клику");
      });
      assert.equal(pwa.disabled, true);
      pwa.click();
      assert.equal(promptCalls, 3);
      assert.ok(finishPrompt);
      await act(async () => finishPrompt!());
      assert.equal(pwa.disabled, false);
      assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
    });

    await t.test("после принятия PWA модалка закрывается, а APK остаётся доступным", async () => {
      const header = container.querySelector<HTMLButtonElement>('button[aria-label="Установить EduFlow"]');
      assert.ok(header);
      await click(header);
      const dialog = dom.window.document.querySelector<HTMLElement>('[role="dialog"]');
      assert.ok(dialog);
      await act(async () => dispatchPrompt("accepted"));
      await click(buttonWithText(dialog, PWA_LABEL));
      assert.equal(promptCalls, 4);
      assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
      assert.equal(dom.window.document.body.style.overflow, "");
      assert.equal(buttonWithText(container, PWA_LABEL).disabled, true);
      assert.match(container.textContent!, /PWA уже установлено/);
      assert.ok(apkLink(container));
      assert.equal(container.querySelector('button[aria-label="Установить EduFlow"]'), null);
    });
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
