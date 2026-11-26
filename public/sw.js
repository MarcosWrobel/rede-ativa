// Service Worker de limpeza e descomissionamento do legado offline (v2.0.0-cleanup)
// Remove estritamente caches da Rede Ativa e encerra o próprio registro sem interceptar fetch.

const REDEATIVA_CACHE_PREFIXES = ["redeativa-", "leopoldina-"];

function isRedeAtivaCacheKey(key) {
  const normalized = String(key || "").toLowerCase();
  return REDEATIVA_CACHE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

async function clearRedeAtivaCaches() {
  if (typeof caches === "undefined" || typeof caches.keys !== "function") {
    return [];
  }
  const keys = await caches.keys();
  const targetKeys = keys.filter(isRedeAtivaCacheKey);
  await Promise.all(targetKeys.map((key) => caches.delete(key)));
  return targetKeys;
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const deletedCaches = await clearRedeAtivaCaches();
      if (typeof self.clients?.claim === "function") {
        await self.clients.claim().catch(() => {});
      }
      if (self.registration && typeof self.registration.unregister === "function") {
        await self.registration.unregister().catch(() => {});
      }
      if (typeof self.clients?.matchAll === "function") {
        const clientList = await self.clients.matchAll({
          includeUncontrolled: true,
          type: "window",
        });
        for (const client of clientList) {
          client.postMessage({
            type: "REDEATIVA_SW_CLEANED",
            deletedCaches,
          });
        }
      }
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event?.data?.type === "CLEAR_REDEATIVA_CACHES") {
    event.waitUntil(clearRedeAtivaCaches());
  }
});
