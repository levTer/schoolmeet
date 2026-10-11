"use client";

import { SessionProvider } from "next-auth/react";

/**
 * Клиентские провайдеры приложения.
 * `SessionProvider` даёт компонентам доступ к `useSession()` — им пользуются
 * навбар, кнопка «Выйти» и формы авторизации.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
