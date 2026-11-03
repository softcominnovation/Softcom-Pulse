import "server-only";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type CompatibleAsset = "monitor-compat.js" | "monitor-compat.css" | "monitor-compat-notifications.css" | "monitor-compat-audio.js" | "monitor-compat-bootstrap.js" | "monitor-auto-scroll.js";

export function compatibleAssetUrl(name: CompatibleAsset) {
  const digest = createHash("sha256").update(readFileSync(join(process.cwd(), "public", name))).digest("hex").slice(0, 20);
  return `/${name}?v=${digest}`;
}
