import { NextResponse, type NextRequest } from "next/server";

const API_URL = (
  process.env.NEXT_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");

const STAFF_ROLES = ["salonist", "nail_tech", "admin"];

const ACCESS_COOKIE = "salon_access";

function readAccess(request: NextRequest): string | null {
  return request.cookies.get(ACCESS_COOKIE)?.value ?? null;
}

async function fetchRole(token: string): Promise<string | null> {
  // The backend is the authority on roles; middleware just mirrors it.
  try {
    const res = await fetch(`${API_URL}/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.role === "string" ? data.role : null;
  } catch {
    return null;
  }
}

function homeFor(role: string | null): string {
  if (role === "admin") return "/admin";
  if (role === "salonist" || role === "nail_tech") return "/staff";
  return "/account";
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isAuthPage = path === "/login" || path === "/register";
  const token = readAccess(request);

  if (isAuthPage) {
    if (!token) return NextResponse.next();
    const role = await fetchRole(token);
    if (!role) return NextResponse.next(); // expired token → let them see login
    return NextResponse.redirect(new URL(homeFor(role), request.url));
  }

  if (!token) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (path.startsWith("/staff") || path.startsWith("/admin")) {
    const role = await fetchRole(token);
    if (role === null) {
      // cannot verify → treat as signed out (backend enforces anyway)
      const url = new URL("/login", request.url);
      url.searchParams.set("next", path);
      return NextResponse.redirect(url);
    }
    if (path.startsWith("/admin") && role !== "admin") {
      return NextResponse.redirect(new URL(homeFor(role), request.url));
    }
    if (path.startsWith("/staff") && !STAFF_ROLES.includes(role)) {
      return NextResponse.redirect(new URL(homeFor(role), request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/account",
    "/account/:path*",
    "/staff",
    "/staff/:path*",
    "/admin",
    "/admin/:path*",
    "/login",
    "/register",
  ],
};
