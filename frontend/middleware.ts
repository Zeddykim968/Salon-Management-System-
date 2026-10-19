import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const API_URL = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "anon-key-not-set";

const STAFF_ROLES = ["salonist", "nail_tech", "admin"];

async function fetchRole(token: string): Promise<string | null> {
  // The backend is the authority on roles; middleware just mirrors it.
  const res = await fetch(`${API_URL}/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data?.role === "string" ? data.role : null;
}

function homeFor(role: string | null): string {
  if (role === "admin") return "/admin";
  if (role === "salonist" || role === "nail_tech") return "/staff";
  return "/account";
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const path = request.nextUrl.pathname;
  const isAuthPage = path === "/login" || path === "/register";

  if (isAuthPage) {
    if (!session) return response;
    try {
      const role = await fetchRole(session.access_token);
      return NextResponse.redirect(new URL(homeFor(role), request.url));
    } catch {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  if (!session) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (path.startsWith("/staff") || path.startsWith("/admin")) {
    let role: string | null = null;
    try {
      role = await fetchRole(session.access_token);
    } catch {
      role = null;
    }
    if (role === null) {
      // cannot verify → treat as signed out (backend enforces anyway)
      const url = new URL("/login", request.url);
      url.searchParams.set("next", path);
      return NextResponse.redirect(url);
    }
    if (path.startsWith("/admin") && role !== "admin") {
      return NextResponse.redirect(new URL(homeFor(role), request.url));
    }
    if (
      path.startsWith("/staff") &&
      path !== "/staff" &&
      !STAFF_ROLES.includes(role)
    ) {
      return NextResponse.redirect(new URL(homeFor(role), request.url));
    }
    if (path.startsWith("/staff") && !STAFF_ROLES.includes(role)) {
      return NextResponse.redirect(new URL(homeFor(role), request.url));
    }
  }

  return response;
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
