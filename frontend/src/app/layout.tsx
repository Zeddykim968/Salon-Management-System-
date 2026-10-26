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
                — Gataka&apos;s salon, walk in glowing.
              </div>
              <div className="small">
                📍 Gataka · Prices in KSh · WhatsApp-first · ©{" "}
                {new Date().getFullYear()}
              </div>
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
          </footer>
        </MotionShell>
      </body>
    </html>
  );
}
