import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { encode } from "next-auth/jwt";
import { NextRequest } from "next/server";

import { middleware } from "../src/middleware";

process.env.NEXTAUTH_SECRET = "landing-redirect-test-secret";

async function request(path: string, role?: string, banned = false) {
  const headers = new Headers();
  if (role) {
    const jwt = await encode({
      secret: process.env.NEXTAUTH_SECRET!,
      token: { sub: "test-user", role, banned },
    });
    headers.set("cookie", `next-auth.session-token=${jwt}`);
  }
  return middleware(new NextRequest(`http://localhost:3000${path}`, { headers }));
}

describe("гостевой экран и строгий редирект", () => {
  for (const path of ["/", "/login", "/login?callbackUrl=/schedule", "/?callbackUrl=/"]) {
    it(`гость может открыть ${path}, без HTTP-кэширования`, async () => {
      const response = await request(path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
      assert.match(response.headers.get("Cache-Control")!, /no-store/);
    });

    for (const role of ["ADMIN", "TEACHER", "STUDENT"]) {
      it(`${role} с ${path} всегда отправляется в кабинет`, async () => {
        const response = await request(path, role);
        assert.equal(response.status, 307);
        assert.equal(response.headers.get("location"), "http://localhost:3000/dashboard");
        assert.match(response.headers.get("Cache-Control")!, /no-store/);
      });
    }
  }

  it("выход снова открывает гостевую страницу", async () => {
    assert.equal((await request("/", "STUDENT")).status, 307);
    assert.equal((await request("/")).status, 200);
  });

  it("блокировка по-прежнему закрывает кабинет", async () => {
    const response = await request("/dashboard", "STUDENT", true);
    assert.equal(response.headers.get("location"), "http://localhost:3000/banned");
  });

  it("защищённый маршрут по-прежнему требует входа", async () => {
    const response = await request("/schedule");
    assert.equal(response.headers.get("location"), "http://localhost:3000/login?callbackUrl=%2Fschedule");
  });

  it("главная содержит только заголовок и форму, а safe-area уже настроена", () => {
    const home = readFileSync("src/app/page.tsx", "utf8");
    assert.match(home, /Учиться вместе — проще/);
    assert.match(home, /<LoginForm compact/);
    assert.doesNotMatch(home, /Быстрый доступ|Здравствуйте|Открыть личный кабинет|<Hero|<SiteHeader|<SiteFooter|<Features|<Link/);
    assert.match(readFileSync("src/app/layout.tsx", "utf8"), /viewportFit: "cover"/);
    assert.ok(readFileSync("src/components/layout/Navbar.tsx", "utf8").includes("pt-[env(safe-area-inset-top)]"));
  });
});
