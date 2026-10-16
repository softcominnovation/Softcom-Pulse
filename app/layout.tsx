import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { getPublicConfig } from "@/lib/server/public-config";
import { Providers } from "./providers";
import "./globals.css";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return {
    title: getPublicConfig().appName,
    description: "Central de monitoramento da Softcom.",
    icons: {
      icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%23171717'/%3E%3Cpath d='M4 16h5l3-8 6 16 3-8h7' stroke='white' stroke-width='2' fill='none'/%3E%3C/svg%3E",
      apple: "/logo.png",
    },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0c1116" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body>
        <Providers config={getPublicConfig()}>{children}</Providers>
      </body>
    </html>
  );
}
