import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from "./auth";

export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
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
  const headers = new Headers(options.headers);
  let body: BodyInit | undefined;

  if (options.formData) {
    body = options.formData;
  } else if (options.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.json);
  }

  const needsAuth = options.auth !== false;
  const token = needsAuth ? await accessToken() : null;
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const method =
    options.method ??
    (options.json !== undefined || options.formData ? "POST" : "GET");

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

  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body
  }

  if (!res.ok) {
    const detail =
      data && typeof data === "object" && "detail" in data
        ? (data as { detail: unknown }).detail
        : null;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail
              .map((d) =>
                typeof d === "object" && d && "msg" in d
                  ? String((d as { msg: unknown }).msg)
                  : JSON.stringify(d)
              )
              .join("; ")
          : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return data as T;
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
