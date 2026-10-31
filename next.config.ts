import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  distDir: process.env.PULSE_E2E === "1" ? ".cache/next-e2e" : ".next",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/sounds/notifications/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] }];
  },
};

export default nextConfig;
