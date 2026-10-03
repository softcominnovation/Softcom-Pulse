import { AxiosError, CanceledError, type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import type { AuthController } from "./auth-session.ts";

type SessionRequest = InternalAxiosRequestConfig & { sessionEpoch?: string; retried?: boolean };

export function installAuthInterceptors(api: AxiosInstance, auth: () => AuthController) {
  api.interceptors.request.use(async (config: SessionRequest) => {
    if (config.url === "/health" || config.url?.startsWith("/auth/")) return config;
    const controller = auth();
    if (config.sessionEpoch && config.sessionEpoch !== controller.generation) throw new CanceledError();
    config.sessionEpoch = controller.generation;
    const signal = controller.signal;
    config.headers.set("Authorization", "Bearer " + await controller.getAccessToken());
    config.signal = AbortSignal.any([signal, ...(config.signal ? [config.signal as AbortSignal] : [])]);
    if (signal.aborted || config.sessionEpoch !== controller.generation) throw new CanceledError();
    return config;
  });
  api.interceptors.response.use(response => {
    const config = response.config as SessionRequest;
    if (config.sessionEpoch && config.sessionEpoch !== auth().generation) throw new CanceledError();
    return response;
  }, async (error: AxiosError) => {
    const config = error.config as SessionRequest | undefined;
    if (!config?.sessionEpoch) throw error;
    const controller = auth();
    if (config.sessionEpoch !== controller.generation) throw new CanceledError();
    if (error.response?.status !== 401) throw error;
    if (config.retried) { await controller.invalidate(); throw error; }
    config.retried = true;
    const previous = String(config.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    await controller.refresh(previous);
    return api.request(config);
  });
}
