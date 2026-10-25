"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { clearTokens, hasSession } from "@/lib/auth";
import type { Me } from "@/lib/types";
import ThemeToggle from "./ThemeToggle";
import { EASE, Magnetic } from "./motion";

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

const DESKTOP = "(min-width: 641px)";

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!hasSession()) {
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

  // Close the mobile panel on navigation and whenever we widen to desktop.
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    const media = window.matchMedia(DESKTOP);
    const onChange = () => {
      if (media.matches) setMenuOpen(false);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  async function signOut() {
    setSigningOut(true);
    try {
      clearTokens();
    } finally {
      setMe(null);
      setSigningOut(false);
      setMenuOpen(false);
      router.push("/");
      router.refresh();
    }
  }

  const links = me ? (LINKS[me.role] ?? GUEST_LINKS) : GUEST_LINKS;
  const isCurrent = (href: string) => href === pathname;

  const account = !ready ? null : me ? (
    <>
      <span className="avatar sm" title={me.full_name || me.email || ""}>
        {(me.full_name || me.email || "?").slice(0, 1).toUpperCase()}
      </span>
      <button className="btn btn-ghost btn-sm" onClick={signOut} disabled={signingOut}>
        {signingOut ? "…" : "Log out"}
      </button>
    </>
  ) : (
    <>
      <Link href="/login" className="nav-link">
        Log in
      </Link>
      <Magnetic strength={0.35}>
        <Link href="/register" className="btn btn-lime btn-sm">
          Be part of us
        </Link>
      </Magnetic>
    </>
  );

  return (
    <header className="nav">
      <div className="container nav-inner">
        <Magnetic strength={0.18}>
          <Link href="/" className="brand">
            Beauty Parlour
          </Link>
        </Magnetic>

        {/* ------------------------------------------------- desktop row */}
        <nav className="nav-links">
          <ThemeToggle />
          {links.map((link) => {
            const active = isCurrent(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`nav-link${active ? " active" : ""}`}
              >
                {active ? (
                  <motion.span
                    layoutId="nav-pill"
                    className="nav-pill"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                ) : null}
                <span>{link.label}</span>
              </Link>
            );
          })}
          {account}
        </nav>

        {/* -------------------------------------------------- burger */}
        <button
          className="nav-burger"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <motion.span
            animate={menuOpen ? { rotate: 45, y: 7 } : { rotate: 0, y: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 26 }}
          />
          <motion.span
            animate={{ opacity: menuOpen ? 0 : 1 }}
            transition={{ duration: 0.12 }}
          />
          <motion.span
            animate={menuOpen ? { rotate: -45, y: -7 } : { rotate: 0, y: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 26 }}
          />
        </button>
      </div>

      {/* ------------------------------------------------ mobile panel */}
      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            className="mobile-panel"
            initial={{ opacity: 0, scale: 0.94, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.28, ease: EASE }}
          >
            {links.map((link, index) => (
              <motion.div
                key={link.href}
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.05 + index * 0.045, ease: EASE }}
              >
                <Link
                  href={link.href}
                  className={`nav-link${isCurrent(link.href) ? " active" : ""}`}
                  onClick={() => setMenuOpen(false)}
                >
                  {link.label}
                </Link>
              </motion.div>
            ))}
            <div className="row tight" style={{ marginTop: 8 }}>
              <ThemeToggle />
              {account}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
