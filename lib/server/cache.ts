import "server-only";
import { createClient } from "redis";

function createCacheClient() {
  return createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 2000, reconnectStrategy: false }, disableOfflineQueue: true });
}

type CacheClient = ReturnType<typeof createCacheClient>;
const globalCache = globalThis as unknown as { pulseCache?: CacheClient; pulseCacheConnecting?: Promise<CacheClient> };

export async function getCache(): Promise<CacheClient> {
  if (!process.env.REDIS_URL) throw new Error("Cache configuration is missing.");
  if (globalCache.pulseCache?.isReady) return globalCache.pulseCache;
  if (globalCache.pulseCacheConnecting) return globalCache.pulseCacheConnecting;

  const client = createCacheClient();
  client.on("error", () => {});
  globalCache.pulseCache = client;
  const connecting = client.connect().then(() => client).catch((error: unknown) => {
    if (client.isOpen) client.destroy();
    globalCache.pulseCache = undefined;
    throw error;
  }).finally(() => { globalCache.pulseCacheConnecting = undefined; });
  globalCache.pulseCacheConnecting = connecting;
  return connecting;
}

export async function pingCache() {
  const client = await getCache();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => {
        if (client.isOpen) client.destroy();
        if (globalCache.pulseCache === client) globalCache.pulseCache = undefined;
        reject(new Error("Cache request timed out."));
      }, 2000); }),
    ]);
  } finally { clearTimeout(timer); }
}
