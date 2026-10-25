import type { NextConfig } from "next";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Single .env at the repo root configures both Django and Next.js. Next only
// reads env files from its own directory, so we pull the root file in here and
// expose the NEXT_PUBLIC_* values (explicit `env` below makes inlining reliable).
// ---------------------------------------------------------------------------
const rootEnvPath = resolve(process.cwd(), "..", ".env");
const rootEnv: Record<string, string> = {};
if (existsSync(rootEnvPath)) {
  for (const line of readFileSync(rootEnvPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // strip trailing inline comments and surrounding quotes
    value = value.replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "");
    rootEnv[key] = value;
  }
}

// A real env var (e.g. set in Render's dashboard) wins over the file.
const publicApiUrl =
  process.env.NEXT_PUBLIC_API_URL || rootEnv.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const publicWhatsappPhone =
  (process.env.NEXT_PUBLIC_WHATSAPP_PHONE || rootEnv.NEXT_PUBLIC_WHATSAPP_PHONE || "").replace(
    /\D/g,
    ""
  );

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: publicApiUrl,
    // salon's public number — the footer's wa.me button uses it
    NEXT_PUBLIC_WHATSAPP_PHONE: publicWhatsappPhone,
  },
  images: {
    remotePatterns: [
      // Cloudinary-hosted images (avatars, gallery, hero)
      { protocol: "https", hostname: "res.cloudinary.com" },
    ],
  },
};

export default nextConfig;
