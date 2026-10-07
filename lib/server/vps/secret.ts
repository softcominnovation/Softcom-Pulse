import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { BffError } from "../bff.ts";

function key() {
  const value = process.env.TOKEN_ENCRYPTION_KEY ?? "";
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) throw new BffError(503, "vps_monitor_secret_unavailable");
  return decoded;
}
export function sealVpsMonitorKey(secret: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  cipher.setAAD(Buffer.from("pulse.vps.monitor.v1"));
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}
export function openVpsMonitorKey(value: string) {
  try {
    const parts = value.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") throw new Error();
    const [nonce, ciphertext, tag] = parts.slice(1).map(part => Buffer.from(part, "base64url"));
    if (nonce.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key(), nonce);
    decipher.setAAD(Buffer.from("pulse.vps.monitor.v1"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof BffError) throw error;
    throw new BffError(503, "vps_monitor_secret_unavailable");
  }
}
