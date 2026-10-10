export type PollCache<T> = {
  get: (key: string) => T | undefined;
  set: (key: string, value: T) => void;
};

export type PollResult<T> = {
  key: string | null;
  data: T | null;
  failed: boolean;
  loading: boolean;
};

export function createPollCache<T>(): PollCache<T> {
  const values = new Map<string, T>();
  return {
    get: key => values.get(key),
    set: (key, value) => { values.set(key, value); },
  };
}

/** Prefer live poll state; fall back to cache for the current key so screen switches keep painted data. */
export function resolvePollView<T>(result: PollResult<T>, key: string | null, cached: T | undefined) {
  if (result.key === key) return { data: result.data, failed: result.failed, loading: result.loading };
  if (cached !== undefined) return { data: cached, failed: false, loading: true };
  return { data: null as T | null, failed: false, loading: true };
}
