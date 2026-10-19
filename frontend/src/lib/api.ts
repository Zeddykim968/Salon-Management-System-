import { createClient } from "./supabase";

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

async function accessToken(): Promise<string | null> {
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
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
