import { clearAccessToken, clearTokens, getAccessToken, getRefreshToken, saveTokens } from "./auth";

export const API_URL = (
  process.env.NEXT_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// True while a /auth/refresh call is in flight, so concurrent requests wait
// on one refresh instead of firing one each.
let refreshing: Promise<string | null> | null = null;

async function tryRefresh(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh }),
      cache: "no-store",
    });
    if (!res.ok) {
      clearTokens();
      return null;
    }
    const data = (await res.json()) as { access: string; refresh?: string };
    saveTokens({ access: data.access, refresh: data.refresh ?? refresh });
    return data.access;
  } catch {
    return null;
  }
}

/** Return a usable access token, refreshing it first if it has expired. */
async function accessToken(): Promise<string | null> {
  const token = getAccessToken();
  if (token) return token;
  if (!getRefreshToken()) return null;
  refreshing = refreshing ?? tryRefresh();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

export interface ApiOptions {
  method?: string;
  json?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
  auth?: boolean; // default: attach token when present
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const needsAuth = options.auth !== false;
  const method =
    options.method ??
    (options.json !== undefined || options.formData ? "POST" : "GET");

  // A 401 means the access token died while it was still sitting in the
  // cookie (lifetime skew, clock drift, revoked secret). Refresh once and
  // replay the request instead of surfacing `token_not_valid` to the UI —
  // otherwise a long-lived page (staff messages, schedule) silently stops
  // receiving updates until a full reload.
  let retried = false;
  while (true) {
    const headers = new Headers(options.headers);
    let body: BodyInit | undefined;

    if (options.formData) {
      body = options.formData;
    } else if (options.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.json);
    }

    const token = needsAuth ? await accessToken() : null;
    if (token) headers.set("Authorization", `Bearer ${token}`);

    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body,
        cache: "no-store",
      });
    } catch {
      throw new ApiError(0, "Cannot reach the API — is the backend running?");
    }

    if (res.status === 401 && needsAuth && !retried && getRefreshToken()) {
      retried = true;
      // Drop only the stale access token so accessToken() forces a refresh;
      // the refresh token must survive this, so no clearTokens() here.
      clearAccessToken();
      continue;
    }

    return parseBody<T>(res);
  }
}

async function parseBody<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body
  }

  if (!res.ok) {
    throw new ApiError(res.status, humanError(data, res.status));
  }

  return data as T;
}

/**
 * DRF errors arrive as {"detail": …}, ["msg", …] or {"field": ["msg"]} —
 * flatten whatever shape into one human sentence.
 */
function humanError(data: unknown, status: number): string {
  const root =
    data && typeof data === "object" && "detail" in data
      ? (data as { detail: unknown }).detail
      : data;
  const parts: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      if (value) parts.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if ("msg" in record) walk(record.msg);
      else Object.values(record).forEach(walk);
    }
  };
  walk(root);
  return parts.join(" ") || `Request failed (${status})`;
}

/** Upload a file with multipart/form-data. */
export function apiUpload<T = unknown>(path: string, formData: FormData, method = "POST") {
  return api<T>(path, { formData, method });
}

export const waLink = (number: string, text: string) =>
  `https://wa.me/${(number || "").replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

export const kes = (amount: number | null | undefined) =>
  amount === null || amount === undefined
    ? "—"
    : `KSh ${Number(amount).toLocaleString("en-KE")}`;
