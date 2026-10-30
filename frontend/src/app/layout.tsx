import type { Metadata, Viewport } from "next";
import { Fraunces } from "next/font/google";

import MotionShell from "@/components/MotionShell";
import Nav from "@/components/Nav";
import { Magnetic } from "@/components/motion";
import "./globals.css";

// Display face for headings, kickers and the brand — the body keeps the
// system sans for speed. `variable` exposes it as --font-display.
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

// Salon social profiles (footer). Override either in the root .env — but they
// ship with defaults so the icons are always visible even when the env file
// (e.g. on Vercel) doesn't carry them yet.
const INSTAGRAM_URL =
  (process.env.NEXT_PUBLIC_INSTAGRAM_URL || "").trim() ||
  "https://www.instagram.com/theprincebeautyparlour";
const TIKTOK_URL =
  (process.env.NEXT_PUBLIC_TIKTOK_URL || "").trim() ||
  "https://www.tiktok.com/@theprincebeautyparlour";

// Public salon number for the footer's click-to-chat button (digits only).
const WHATSAPP_PHONE = (process.env.NEXT_PUBLIC_WHATSAPP_PHONE || "").replace(/\D/g, "");
const WHATSAPP_HREF = WHATSAPP_PHONE
  ? `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(
      "Hi! I'd like to book an appointment 💇‍♀️"
    )}`
  : null;

export const metadata: Metadata = {
  title: {
    default: "The Prince Beauty Parlour — Gataka",
    template: "%s · The Prince Beauty Parlour",
  },
  description:
    "The Prince Beauty Parlour, Gataka. Real prices, live stylist availability and instant booking for braids, wigs, silk presses and nails — confirm in chat or take it to WhatsApp.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fff6fb" },
    { media: "(prefers-color-scheme: dark)", color: "#150a1f" },
  ],
  width: "device-width",
  initialScale: 1,
};

// Applies the saved theme before paint so there's no flash of the wrong colors.
const themeInit = `try{var t=localStorage.getItem("salon_theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.setAttribute("data-theme","dark")}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className={display.variable}>
        <MotionShell>
          <Nav />
          <main>{children}</main>
          <footer className="footer">
            <div className="container row between">
              <div>
                <strong style={{ color: "var(--pink)" }}>
                  The Prince Beauty Parlour ✨
                </strong>{" "}
                — Gataka&apos;s salon, walk out glowing.
              </div>
              <div className="small">
                📍 Gataka · Rongai · Come have a taste of us · ©{" "}
                {new Date().getFullYear()}
              </div>
              <div className="row tight">
                {INSTAGRAM_URL ? (
                  <a
                    className="social-link"
                    href={INSTAGRAM_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="The Prince Beauty Parlour on Instagram"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="17"
                      height="17"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      aria-hidden="true"
                    >
                      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
                      <circle cx="12" cy="12" r="4" />
                      <circle
                        cx="17.2"
                        cy="6.8"
                        r="1.15"
                        fill="currentColor"
                        stroke="none"
                      />
                    </svg>
                  </a>
                ) : null}
                {TIKTOK_URL ? (
                  <a
                    className="social-link"
                    href={TIKTOK_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="The Prince Beauty Parlour on TikTok"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="17"
                      height="17"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M16.5 3c.3 1.6 1.2 2.95 2.7 3.25v2.65a5.9 5.9 0 0 1-2.65-.95v5.95a5.4 5.4 0 1 1-5.4-5.4c.28 0 .55.03.82.08v2.72a2.72 2.72 0 1 0 1.9 2.6V3h2.63z" />
                    </svg>
                  </a>
                ) : null}
                {WHATSAPP_HREF ? (
                  <Magnetic strength={0.35}>
                    <a
                      className="btn btn-ghost btn-sm wa-btn"
                      href={WHATSAPP_HREF}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Chat on WhatsApp 💬
                    </a>
                  </Magnetic>
                ) : null}
              </div>
            </div>
          </footer>
        </MotionShell>
      </body>
    </html>
  );
}
