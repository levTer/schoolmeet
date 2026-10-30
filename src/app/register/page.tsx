import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Старый адрес регистрации (`/register`) — страница переехала на
 * `/auth/register` (секретные ссылки-приглашения `?code=…&invite=…`
 * указывают именно на него). Сохраняем редирект со всеми параметрами.
 */
export default async function LegacyRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; invite?: string }>;
}) {
  const { code, invite } = await searchParams;
  const params = new URLSearchParams();
  if (typeof code === "string") params.set("code", code);
  if (typeof invite === "string") params.set("invite", invite);
  const query = params.toString();
  redirect(`/auth/register${query ? `?${query}` : ""}`);
}
