import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Старый адрес регистрации (`/register`) — страница переехала на
 * `/auth/register` (секретные ссылки-приглашения `?code=…&invite=…`
 * указывают именно на него). Сохраняем редирект со всеми параметрами.
 */
export default function LegacyRegisterPage({ searchParams }: { searchParams?: { code?: string; invite?: string } }) {
  const params = new URLSearchParams();
  if (typeof searchParams?.code === "string") params.set("code", searchParams.code);
  if (typeof searchParams?.invite === "string") params.set("invite", searchParams.invite);
  const query = params.toString();
  redirect(`/auth/register${query ? `?${query}` : ""}`);
}
