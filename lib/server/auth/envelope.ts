import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { userSchema } from "../../auth/contracts.ts";
import { AuthError } from "./errors.ts";

const envelopeSchema = z.object({
  type: z.enum(["access", "refresh"]),
  token: z.string().min(1),
  sessionId: z.string().uuid(),
  user: userSchema,
  expiresAt: z.number().finite().positive().optional(),
});
export type Envelope = z.infer<typeof envelopeSchema>;

function encryptionKey() {
  const value = process.env.TOKEN_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) throw new AuthError(503, "auth_unavailable");
  return key;
}

export function sealEnvelope(payload: Envelope) {
  const key = encryptionKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from("pulse.auth.v1"));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(envelopeSchema.parse(payload)), "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function openEnvelope(value: string, type: Envelope["type"], now = Date.now()): Envelope {
  const key = encryptionKey();
  try {
    if (value.length > 131072) throw new Error();
    const parts = value.split(".");
    if (parts.length !== 4 || parts[0] !== "v1" || parts.slice(1).some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const [nonce, ciphertext, tag] = parts.slice(1).map(part => Buffer.from(part, "base64url"));
    if ([nonce, ciphertext, tag].some((part, index) => part.toString("base64url") !== parts[index + 1])) throw new Error();
    if (nonce.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from("pulse.auth.v1"));
    decipher.setAuthTag(tag);
    const payload = envelopeSchema.parse(JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")));
    if (payload.type !== type) throw new Error();
    if (type === "access" && (!payload.expiresAt || payload.expiresAt <= now)) throw new Error();
    return payload;
  } catch {
    throw new AuthError();
  }
}
