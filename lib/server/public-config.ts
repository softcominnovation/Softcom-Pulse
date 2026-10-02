import "server-only";
import type { PublicConfig } from "@/lib/public-config";

export function getPublicConfig(environment: NodeJS.ProcessEnv = process.env): PublicConfig {
  const appName = environment.NEXT_PUBLIC_APP_NAME?.trim() || "Softcom Pulse";
  const candidate = environment.NEXT_PUBLIC_SOFTCOM_URL || "https://www.softcomtecnologia.com.br";
  let softcomUrl = "https://www.softcomtecnologia.com.br";
  try {
    const url = new URL(candidate);
    if (url.protocol === "https:" || url.protocol === "http:") softcomUrl = url.href;
  } catch {}
  return { appName, softcomUrl };
}
