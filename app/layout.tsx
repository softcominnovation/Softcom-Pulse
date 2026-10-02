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
    icons: { icon: "/logo.ico", apple: "/logo.png" },
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
