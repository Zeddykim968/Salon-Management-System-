"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { createClient } from "@/lib/supabase";
import type { Me } from "@/lib/types";

const LINKS: Record<string, { href: string; label: string }[]> = {
  customer: [
    { href: "/#services", label: "Styles" },
    { href: "/#stylists", label: "Stylists" },
    { href: "/account", label: "My bookings" },
  ],
  salonist: [
    { href: "/staff", label: "Schedule" },
    { href: "/staff/profile", label: "Profile" },
    { href: "/staff/gallery", label: "Gallery" },
  ],
  nail_tech: [
    { href: "/staff", label: "Schedule" },
    { href: "/staff/profile", label: "Profile" },
    { href: "/staff/gallery", label: "Gallery" },
  ],
  admin: [
    { href: "/admin", label: "Overview" },
    { href: "/admin/staff", label: "Team" },
    { href: "/admin/messages", label: "Messages" },
    { href: "/admin/campaigns", label: "Offers" },
    { href: "/admin/site", label: "Site" },
  ],
};

const GUEST_LINKS = [
  { href: "/#services", label: "Styles" },
  { href: "/#stylists", label: "Stylists" },
  { href: "/#gallery", label: "Gallery" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          if (alive) setMe(null);
        } else {
          const profile = await api<Me>("/me");
          if (alive) setMe(profile);
        }
      } catch {
        if (alive) setMe(null);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [pathname]);

  async function signOut() {
    setSigningOut(true);
    try {
      await createClient().auth.signOut();
    } finally {
      setMe(null);
      setSigningOut(false);
      router.push("/");
      router.refresh();
    }
  }

  const links = me ? (LINKS[me.role] ?? GUEST_LINKS) : GUEST_LINKS;

  return (
    <header className="nav">
      <div className="container nav-inner">
        <Link href="/" className="brand">
          SALON
        </Link>
        <nav className="nav-links">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link${pathname === link.href ? " active" : ""}`}
            >
              {link.label}
            </Link>
          ))}
          {!ready ? null : me ? (
            <>
              <span className="avatar sm" title={me.full_name || me.email || ""}>
                {(me.full_name || me.email || "?").slice(0, 1).toUpperCase()}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={signOut}
                disabled={signingOut}
              >
                {signingOut ? "…" : "Log out"}
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="nav-link">
                Log in
              </Link>
              <Link href="/register" className="btn btn-lime btn-sm">
                Join now
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
