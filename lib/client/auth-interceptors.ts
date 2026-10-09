import { AxiosError, CanceledError, type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import { isPublicPath } from "../public/paths.ts";
import type { AuthController } from "./auth-session.ts";

type SessionRequest = InternalAxiosRequestConfig & { sessionEpoch?: string; retried?: boolean };

async function attachSession(config: SessionRequest, controller: AuthController) {
  if (config.sessionEpoch && config.sessionEpoch !== controller.generation) throw new CanceledError();
  config.sessionEpoch = controller.generation;
  config.headers.set("Authorization", "Bearer " + await controller.getAccessToken());
  // Re-read after await: login/validate/clear may have rotated the auth AbortSignal meanwhile.
  if (config.sessionEpoch !== controller.generation) throw new CanceledError();
  const signal = controller.signal;
  config.signal = AbortSignal.any([signal, ...(config.signal ? [config.signal as AbortSignal] : [])]);
  if (signal.aborted) throw new CanceledError();
}

export function installAuthInterceptors(api: AxiosInstance, auth: () => AuthController) {
  api.interceptors.request.use(async (config: SessionRequest) => {
    if (typeof window !== "undefined" && isPublicPath(window.location.pathname)) {
      config.baseURL = "/api/public";
      const controller = auth();
      // Logged-in readers on /monitor still use the public BFF, but send the token so manager URLs can be revealed.
      if (controller.store.getState().status === "authenticated") await attachSession(config, controller);
      return config;
    }
    if (config.url === "/health" || config.url?.startsWith("/auth/")) return config;
    await attachSession(config, auth());
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
