/** Typed API client. Session lives in an httpOnly cookie; tokens never touch JS or localStorage. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const BASE = "/api/v1";

async function request<T>(method: string, path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  let res: Response;
  try {
    res = await fetch(url.pathname + url.search, {
      method,
      credentials: "same-origin",
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), "x-lifepilot-csrf": "1" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "network", "Can't reach LifePilot. Check your connection and that the API is running.");
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? "error", e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string, query?: Record<string, string | number | boolean | undefined>) => request<T>("GET", path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string, body?: unknown, query?: Record<string, string>) => request<T>("DELETE", path, body, query),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "validation_error" && Array.isArray(err.details) && err.details[0]) {
      const d = err.details[0] as { path: string; message: string };
      return `${d.path ? d.path + ": " : ""}${d.message}`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}
