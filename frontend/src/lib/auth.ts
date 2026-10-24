// JWT session storage — replaces the old Supabase session.
//
// Tokens live in first-party cookies so both client code (api.ts) and the
// Edge middleware (middleware.ts) can read them. The access token is short
// lived (30 min); api.ts transparently refreshes it when it expires.

const ACCESS = "salon_access";
const REFRESH = "salon_refresh";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`)
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string, maxAgeSeconds: number) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
}

export function getAccessToken(): string | null {
  return readCookie(ACCESS);
}

export function getRefreshToken(): string | null {
  return readCookie(REFRESH);
}

export function hasSession(): boolean {
  return Boolean(getRefreshToken() || getAccessToken());
}

/** Persist the token pair returned by /auth/login and /auth/refresh. */
export function saveTokens({ access, refresh }: { access: string; refresh?: string }) {
  // Access tokens live 30 min; refresh lives 14 days.
  writeCookie(ACCESS, access, 60 * 30);
  if (refresh) writeCookie(REFRESH, refresh, 60 * 60 * 24 * 14);
}

export function clearTokens() {
  writeCookie(ACCESS, "", 0);
  writeCookie(REFRESH, "", 0);
}
