import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "anon-key-not-set";

/**
 * Handles every email link Supabase sends:
 *  - ?code=…            → PKCE exchange (sign-up / password reset links)
 *  - ?token_hash=&type= → verifyOtp (staff invites, recovery, magic links)
 * Invites and recoveries land on /set-password, everything else on `next`.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next") ?? "/";

  const cookieStore = await cookies();
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // middleware handles cookie refresh
        }
      },
    },
  });

  try {
    if (code) {
      await supabase.auth.exchangeCodeForSession(code);
    } else if (tokenHash && type) {
      await supabase.auth.verifyOtp({
        type: type as never,
        token_hash: tokenHash,
      });
    }
  } catch {
    // fall through to the redirect — pages explain failures
  }

  const destination =
    type === "invite" || type === "recovery" ? "/set-password" : next;
  return NextResponse.redirect(`${origin}${destination}`);
}
