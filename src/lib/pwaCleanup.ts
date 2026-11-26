/**
 * Utilitário cliente de limpeza do legado PWA (F08).
 * - Remove exclusivamente caches com prefixos da Rede Ativa (`redeativa-` e `leopoldina-`).
 * - Atualiza Service Workers já instalados (para buscar `/sw.js` de limpeza) e solicita o desregistro.
 * - Nunca chama `navigator.serviceWorker.register(...)`, evitando loops de reinstalação.
 */

export const REDEATIVA_CACHE_PREFIXES = ["redeativa-", "leopoldina-"] as const;

export function isRedeAtivaCacheKey(cacheKey: string): boolean {
  const normalized = String(cacheKey || "").toLowerCase();
  return REDEATIVA_CACHE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export interface ServiceWorkerRegistrationLike {
  active?: { scriptURL?: string; postMessage?: (msg: unknown) => void } | null;
  waiting?: { scriptURL?: string; postMessage?: (msg: unknown) => void } | null;
  installing?: { scriptURL?: string; postMessage?: (msg: unknown) => void } | null;
  update?: () => Promise<unknown>;
  unregister?: () => Promise<boolean>;
}

/**
 * Identifica exclusivamente o Service Worker da própria Rede Ativa (`/sw.js` na mesma origem),
 * preservando eventuais workers de outros aplicativos hospedados no mesmo domínio ou em testes.
 */
export function isRedeAtivaServiceWorkerRegistration(
  registration: ServiceWorkerRegistrationLike | null | undefined,
  currentOrigin?: string | null
): boolean {
  if (!registration) return false;
  const resolvedOrigin =
    currentOrigin ||
    (typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://localhost");

  const candidates = [
    registration.active?.scriptURL,
    registration.waiting?.scriptURL,
    registration.installing?.scriptURL,
  ].filter((u): u is string => typeof u === "string" && u.trim().length > 0);

  return candidates.some((scriptUrl) => {
    try {
      const parsed = new URL(scriptUrl, resolvedOrigin);
      return parsed.origin === resolvedOrigin && parsed.pathname === "/sw.js";
    } catch {
      return false;
    }
  });
}

export async function clearRedeAtivaCachesOnly(
  cacheStorage?: CacheStorage | null
): Promise<string[]> {
  const targetCaches =
    cacheStorage ??
    (typeof window !== "undefined" && "caches" in window ? window.caches : null);

  if (!targetCaches || typeof targetCaches.keys !== "function") {
    return [];
  }

  const keys = await targetCaches.keys();
  const redeAtivaKeys = keys.filter(isRedeAtivaCacheKey);

  await Promise.all(
    redeAtivaKeys.map((key) =>
      targetCaches.delete(key).catch(() => false)
    )
  );

  return redeAtivaKeys;
}

export interface LegacyPwaCleanupResult {
  clearedCaches: string[];
  unregisteredCount: number;
}

export async function cleanupLegacyServiceWorkersAndCaches(): Promise<LegacyPwaCleanupResult> {
  if (typeof window === "undefined") {
    return { clearedCaches: [], unregisteredCount: 0 };
  }

  let unregisteredCount = 0;

  if (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof navigator.serviceWorker?.getRegistrations === "function"
  ) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        if (!isRedeAtivaServiceWorkerRegistration(registration)) {
          continue;
        }
        try {
          if (typeof registration.update === "function") {
            await registration.update().catch(() => {});
          }
        } catch {
          // Segue para envio de mensagem e desregistro
        }

        try {
          registration.active?.postMessage?.({ type: "CLEAR_REDEATIVA_CACHES" });
          registration.waiting?.postMessage?.({ type: "CLEAR_REDEATIVA_CACHES" });
          registration.installing?.postMessage?.({ type: "CLEAR_REDEATIVA_CACHES" });
        } catch {
          // Ignora falha ao postar mensagem para worker em encerramento
        }

        try {
          const ok = await registration.unregister();
          if (ok) unregisteredCount += 1;
        } catch {
          // Segue limpando o Cache Storage local
        }
      }
    } catch {
      // Falha em getRegistrations não impede limpeza dos caches locais
    }
  }

  const clearedCaches = await clearRedeAtivaCachesOnly();
  return { clearedCaches, unregisteredCount };
}
