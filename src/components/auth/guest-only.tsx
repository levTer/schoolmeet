"use client";

import { useEffect, useState } from "react";
import { getSession, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

/** Middleware не вызывается при восстановлении страницы из истории браузера. */
export function GuestOnly({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    async function verifySession() {
      setChecking(true);
      try {
        const session = await getSession();
        if (!active) return;
        if (session?.user) router.replace("/dashboard");
        else setChecking(false);
      } catch {
        // Не показываем гостевую страницу, если сессию проверить не удалось.
      }
    }

    void verifySession();
    window.addEventListener("pageshow", verifySession);
    window.addEventListener("popstate", verifySession);
    // Скрываем форму до помещения документа в back/forward cache.
    function hideForm() {
      setChecking(true);
    }
    window.addEventListener("pagehide", hideForm);
    return () => {
      active = false;
      window.removeEventListener("pageshow", verifySession);
      window.removeEventListener("popstate", verifySession);
      window.removeEventListener("pagehide", hideForm);
    };
  }, [router]);

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [router, status]);

  if (checking || status !== "unauthenticated") return null;
  return <>{children}</>;
}
