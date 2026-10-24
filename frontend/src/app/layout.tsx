import type { Metadata, Viewport } from "next";

import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SALON — book your style",
    template: "%s · SALON",
  },
  description:
    "Fast, transparent salon booking for students: braids, wigs, nails and more. See real prices, live stylist availability and chat with us on WhatsApp.",
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
      <body>
        <Nav />
        <main>{children}</main>
        <footer className="footer">
          <div className="container row between">
            <div>
              <strong style={{ color: "var(--pink)" }}>SALON ✨</strong> — student
              friendly, walk in glowing.
            </div>
            <div className="small">
              Prices in KSh · WhatsApp-first · © {new Date().getFullYear()}
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
