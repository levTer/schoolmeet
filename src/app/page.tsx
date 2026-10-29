import { Suspense } from "react";
import { getServerSession, type Session } from "next-auth";
import { redirect } from "next/navigation";

import { GuestOnly } from "@/components/auth/guest-only";
import { LoginForm, LoginFormSkeleton } from "@/components/auth/login-form";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  let session: Session | null = null;
  try {
    session = await getServerSession(authOptions);
  } catch (error) {
    console.error("[HOME_SESSION_ERROR]", error);
  }

  if (session?.user) redirect("/dashboard");

  return (
    <GuestOnly>
      <main className="flex min-h-[100dvh] items-center justify-center px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(2rem+env(safe-area-inset-top))]">
        <section className="w-full max-w-sm" aria-labelledby="welcome-title">
          <h1 id="welcome-title" className="text-center text-3xl font-semibold tracking-tight">
            EduFlow
          </h1>
          <p className="mb-8 mt-2 text-center text-sm text-slate-400">
            Учиться вместе — проще
          </p>
          <Suspense fallback={<LoginFormSkeleton compact />}>
            <LoginForm compact />
          </Suspense>
        </section>
      </main>
    </GuestOnly>
  );
}
