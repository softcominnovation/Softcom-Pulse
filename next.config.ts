import type { NextConfig } from "next";

const allowedDevOrigins = (process.env.PULSE_PUBLIC_HOSTS ?? "")
  .split(",")
  .map(host => host.trim().toLowerCase())
  .filter(host => host && host !== "localhost" && host !== "127.0.0.1");

const nextConfig: NextConfig = {
  output: "standalone",
  distDir: process.env.PULSE_E2E === "1" ? ".cache/next-e2e" : ".next",
  poweredByHeader: false,
  // Preserve same-origin monitor rewrites behind an HTTPS-to-HTTP tunnel.
  skipProxyUrlNormalize: true,
  ...(allowedDevOrigins.length ? { allowedDevOrigins } : {}),
};

export default nextConfig;
