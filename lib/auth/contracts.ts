import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email("Informe um e-mail válido.").max(150, "Use até 150 caracteres."),
  senha: z.string().min(1, "Informe sua senha.").max(50, "Use até 50 caracteres."),
});
export type LoginInput = z.infer<typeof loginSchema>;

const accessSchema = z.object({ chave: z.string(), nome: z.string(), grupo: z.string(), permitido: z.boolean() });
export const userSchema = z.object({
  id: z.number().finite(),
  nome: z.string().nullable().optional(),
  nomeCompleto: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  setor: z.string().nullable().optional(),
  empresa: z.string().nullable().optional(),
  administrador: z.boolean().nullable().optional(),
  acessos: z.array(accessSchema).nullable().optional(),
  permissoes: z.array(z.string()).nullable().optional(),
  solicitante: z.union([z.number(), z.boolean()]).nullable().optional(),
});
export type AuthUser = z.infer<typeof userSchema>;
export const sessionSchema = z.object({
  accessToken: z.string().startsWith("v1.").max(131072),
  refreshToken: z.string().startsWith("v1.").max(131072),
  tokenType: z.literal("Bearer"),
  expiresAt: z.number().finite().positive(),
  user: userSchema,
});
export type AuthSession = z.infer<typeof sessionSchema>;
export type SessionView = Pick<AuthSession, "user" | "expiresAt">;
export const STORAGE_KEY = "pulse.auth.v1";
export const REFRESH_LOCK = "pulse.auth.refresh.v1";
export const STORAGE_LOCK = "pulse.auth.storage.v1";
export const REFRESH_SKEW_MS = 30_000;
