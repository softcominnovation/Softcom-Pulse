import { CanceledError, isAxiosError } from "axios";

/** True when axios/fetch stopped because the caller or auth epoch aborted the request. */
export function requestCanceled(error: unknown) {
  return error instanceof CanceledError
    || (isAxiosError(error) && error.code === "ERR_CANCELED")
    || (error instanceof Error && (error.name === "CanceledError" || error.name === "AbortError"));
}
