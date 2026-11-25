import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logRequestFailure } = await import("./lib/server/diagnostics");
  logRequestFailure({ error, path: context.routePath || request.path, method: request.method, status: 500, code: "unhandled_request_error" });
};
