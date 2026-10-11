"use client";

import { SessionProvider } from "next-auth/react";
import { Toaster } from "sonner";

/**
 * Клиентские провайдеры приложения.
 * `SessionProvider` даёт компонентам доступ к `useSession()` — им пользуются
 * навбар, кнопка «Выйти» и формы авторизации.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <Toaster theme="dark" position="top-right" richColors closeButton />
    </SessionProvider>
  );
}
