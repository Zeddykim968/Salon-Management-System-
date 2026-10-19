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
  themeColor: "#0b0b10",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
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
