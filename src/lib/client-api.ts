/**
 * Клиентская обёртка над fetch для API SchoolMeet.
 * Возвращает разобранный ответ `{ ok, data }` или ошибку с текстом и полями формы.
 * Никогда не бросает исключений — UI решает, что показать пользователю.
 */

export type ClientApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      error: string;
      code?: string;
      fields?: Record<string, string>;
      details?: unknown;
    };

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  json?: unknown;
  form?: FormData;
}

export async function apiRequest<T>(url: string, options: RequestOptions = {}): Promise<ClientApiResult<T>> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (options.form) {
    body = options.form; // boundary выставит браузер
  } else if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  }

  try {
    const response = await fetch(url, {
      method: options.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      cache: "no-store",
      credentials: "same-origin",
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; data?: T; error?: string; code?: string; fields?: Record<string, string>; details?: unknown }
      | null;

    if (response.ok && payload?.ok && payload.data !== undefined) {
      return { ok: true, data: payload.data };
    }

    return {
      ok: false,
      status: response.status,
      error: payload?.error ?? "Не удалось выполнить запрос. Попробуйте ещё раз.",
      code: payload?.code,
      fields: payload?.fields,
      details: payload?.details,
    };
  } catch {
    return { ok: false, status: 0, error: "Нет связи с сервером. Проверьте подключение." };
  }
}
