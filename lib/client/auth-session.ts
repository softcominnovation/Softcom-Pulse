import { createStore } from "zustand/vanilla";
import { z } from "zod";
import { sessionSchema, userSchema, REFRESH_SKEW_MS, type AuthSession, type LoginInput, type SessionView } from "../auth/contracts.ts";

export type AuthStatus = "loading" | "anonymous" | "authenticated" | "unavailable";
export type AuthState = { status: AuthStatus; session: AuthSession | null; issue: string | null };
const recordSchema = z.object({ version: z.literal(1), epoch: z.string(), session: sessionSchema.nullable() });
type RecordValue = z.infer<typeof recordSchema>;
export class SessionError extends Error {}
export type AuthTransport = {
  login: (input: LoginInput, signal: AbortSignal) => Promise<unknown>;
  refresh: (token: string, signal: AbortSignal) => Promise<unknown>;
  session: (token: string, signal: AbortSignal) => Promise<SessionView>;
  logout: (token: string) => Promise<{ revoked: boolean }>;
};
type Dependencies = {
  read: () => string | null;
  write: (value: string) => void;
  id: () => string;
  transport: AuthTransport;
  lock?: <T>(run: () => Promise<T>) => Promise<T>;
  transaction?: <T>(run: () => Promise<T>) => Promise<T>;
  reset: () => void;
};
export function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status;
}
export function messageOf(error: unknown) {
  if (error instanceof SessionError) return error.message;
  const status = statusOf(error);
  if (status === 401 || status === 403) return "E-mail ou senha inválidos.";
  if (status === 429) return "Muitas tentativas. Aguarde um momento e tente novamente.";
  return "Não foi possível acessar o serviço de autenticação. Tente novamente.";
}

export class AuthController {
  readonly store = createStore<AuthState>(() => ({ status: "loading", session: null, issue: null }));
  private deps: Dependencies;
  private epoch = "";
  private controller = new AbortController();
  private refreshPromise: Promise<AuthSession> | null = null;
  private validation: Promise<void> | null = null;
  private storageFailed = false;
  constructor(deps: Dependencies) { this.deps = deps; }
  get signal() { return this.controller.signal; }
  get generation() { return this.epoch; }

  private read(): RecordValue | null {
    try {
      const raw = this.deps.read();
      if (!raw) return null;
      const parsed = recordSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        this.storageFailed = true;
        throw new SessionError("Permita o armazenamento deste site para entrar com segurança.");
      }
    }
    this.store.setState({ issue: "A sessão salva não pôde ser recuperada. Entre novamente." });
    return null;
  }
  private write(record: RecordValue) {
    try { this.deps.write(JSON.stringify(record)); }
    catch {
      this.storageFailed = true;
      throw new SessionError("Não foi possível salvar a sessão. Verifique o armazenamento deste site.");
    }
  }
  private switchEpoch(epoch: string) {
    this.controller.abort();
    this.controller = new AbortController();
    this.epoch = epoch;
    this.refreshPromise = null;
    this.validation = null;
    this.deps.reset();
  }
  private assertCurrent(epoch: string) {
    if (this.storageFailed || epoch !== this.epoch || this.read()?.epoch !== epoch) throw new SessionError("Sessão alterada. Entre novamente.");
  }
  private transaction<T>(run: () => Promise<T>): Promise<T> {
    return this.deps.transaction ? this.deps.transaction(run) : run();
  }
  private save(session: AuthSession, epoch: string, expectedToken?: string) {
    return this.transaction(async () => {
      this.assertCurrent(epoch);
      if (expectedToken && this.read()?.session?.accessToken !== expectedToken) return false;
      this.write({ version: 1, epoch, session });
      this.store.setState({ session, status: "authenticated", issue: null });
      return true;
    });
  }
  private async clear(issue: string | null = null, expectedEpoch?: string) {
    this.switchEpoch(this.deps.id());
    const epoch = this.epoch;
    this.store.setState({ status: "anonymous", session: null, issue });
    try {
      const cleared = await this.transaction(async () => {
        if (expectedEpoch && this.read()?.epoch !== expectedEpoch) return false;
        if (epoch === this.epoch) this.write({ version: 1, epoch, session: null });
        return true;
      });
      if (!cleared) await this.sync();
    }
    catch (error) { this.store.setState({ issue: messageOf(error) }); }
  }
  private async fail(error: unknown, epoch: string) {
    if (epoch !== this.epoch) return;
    try {
      if (this.read()?.epoch !== epoch) { await this.sync(); return; }
    } catch { this.store.setState({ status: "unavailable", issue: messageOf(error) }); return; }
    if ([401, 403].includes(statusOf(error) ?? 0)) {
      await this.clear("Sua sessão expirou. Entre novamente.", epoch);
    } else {
      this.store.setState({ status: "unavailable", issue: messageOf(error) });
    }
  }

  async initialize() {
    try {
      const record = this.read();
      if (!record) { await this.clear(this.store.getState().issue); return; }
      if (record.epoch !== this.epoch) this.switchEpoch(record.epoch);
      this.store.setState({ session: record.session, status: record.session ? "loading" : "anonymous" });
      if (record.session) await this.validate();
    } catch (error) { this.store.setState({ status: "anonymous", session: null, issue: messageOf(error) }); }
  }
  async sync() {
    try {
      const record = this.read();
      if (record?.epoch === this.epoch && record.session?.accessToken === this.store.getState().session?.accessToken) return;
      await this.initialize();
    } catch (error) { await this.fail(error, this.epoch); }
  }
  async login(input: LoginInput) {
    this.storageFailed = false;
    const cleared = this.clear();
    const epoch = this.epoch;
    try {
      await cleared;
      this.assertCurrent(epoch);
      const response = await this.deps.transport.login(input, this.signal);
      const session = sessionSchema.parse(response);
      await this.save(session, epoch);
    } catch (error) {
      if (epoch === this.epoch) this.store.setState({ status: "anonymous", session: null, issue: messageOf(error) });
      throw error;
    }
  }
  async logout() {
    const token = this.store.getState().session?.refreshToken;
    await this.clear();
    if (!token) return { revoked: false };
    try { return await this.deps.transport.logout(token); }
    catch { return { revoked: false }; }
  }
  async invalidate() {
    if (this.read()?.epoch !== this.epoch) { await this.sync(); return; }
    await this.clear("Sua sessão expirou. Entre novamente.", this.epoch);
  }

  async getAccessToken() {
    const epoch = this.epoch;
    this.assertCurrent(epoch);
    const record = this.read();
    if (!record?.session) throw new SessionError("Entre para continuar.");
    if (record.session.expiresAt - Date.now() <= REFRESH_SKEW_MS) return (await this.refresh()).accessToken;
    return record.session.accessToken;
  }

  refresh(rejectedToken?: string): Promise<AuthSession> {
    if (this.refreshPromise) return this.refreshPromise;
    const epoch = this.epoch;
    if (!this.deps.lock) {
      return this.clear("Este navegador não permite renovar a sessão com segurança entre abas. Entre novamente.")
        .then(() => { throw new SessionError("Renovação indisponível neste navegador."); });
    }
    const operation = this.deps.lock(async () => {
      this.assertCurrent(epoch);
      const current = this.read()?.session;
      if (!current) throw new SessionError("Entre para continuar.");
      // Re-read under the origin-wide lock: another tab may already have rotated the pair.
      if ((rejectedToken && current.accessToken !== rejectedToken) || (!rejectedToken && current.expiresAt - Date.now() > REFRESH_SKEW_MS)) return current;
      const next = sessionSchema.parse(await this.deps.transport.refresh(current.refreshToken, this.signal));
      await this.save(next, epoch);
      return next;
    }).catch(async error => { await this.fail(error, epoch); throw error; });
    this.refreshPromise = operation;
    void operation.finally(() => { if (this.refreshPromise === operation) this.refreshPromise = null; }).catch(() => {});
    return operation;
  }

  validate(): Promise<void> {
    if (this.validation) return this.validation;
    const epoch = this.epoch;
    const operation = (async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          let token = await this.getAccessToken();
          let view: SessionView;
          try { view = await this.deps.transport.session(token, this.signal); }
          catch (error) {
            if (statusOf(error) !== 401) throw error;
            token = (await this.refresh(token)).accessToken;
            view = await this.deps.transport.session(token, this.signal);
          }
          this.assertCurrent(epoch);
          const current = this.read()?.session;
          if (!current) throw new SessionError("Entre para continuar.");
          if (current.accessToken !== token) continue;
          const validated = z.object({ user: userSchema, expiresAt: z.number().finite().positive() }).parse(view);
          if (await this.save({ ...current, ...validated }, epoch, token)) return;
        }
        throw new SessionError("A sessão está sendo atualizada. Tente novamente.");
      } catch (error) { await this.fail(error, epoch); }
    })();
    this.validation = operation;
    void operation.finally(() => { if (this.validation === operation) this.validation = null; }).catch(() => {});
    return operation;
  }
}
