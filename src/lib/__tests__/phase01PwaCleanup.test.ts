import fs from "fs";
import path from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PUBLIC_PATHS } from "@/lib/proxyConstants";
import {
  clearRedeAtivaCachesOnly,
  cleanupLegacyServiceWorkersAndCaches,
  isRedeAtivaCacheKey,
  isRedeAtivaServiceWorkerRegistration,
} from "@/lib/pwaCleanup";

const hoisted = vi.hoisted(() => ({
  mockSession: null as any,
}));

vi.mock("next-auth", () => ({
  default: vi.fn(() => ({
    auth: async () => hoisted.mockSession,
  })),
}));

import { proxy, config as proxyConfig } from "@/proxy";

function createInMemoryCacheStorage(initial: Record<string, Record<string, string>>) {
  const store = new Map<string, Map<string, string>>();
  for (const [cacheName, entries] of Object.entries(initial)) {
    store.set(cacheName, new Map(Object.entries(entries)));
  }

  const cacheStorage = {
    async keys() {
      return Array.from(store.keys());
    },
    async delete(cacheName: string) {
      return store.delete(cacheName);
    },
    async has(cacheName: string) {
      return store.has(cacheName);
    },
    async open(cacheName: string) {
      if (!store.has(cacheName)) {
        store.set(cacheName, new Map());
      }
      const bucket = store.get(cacheName)!;
      return {
        async keys() {
          return Array.from(bucket.keys()).map((url) => ({ url }));
        },
        async match(req: string | { url: string }) {
          const url = typeof req === "string" ? req : req.url;
          const body = bucket.get(url);
          return body ? { url, text: async () => body } : undefined;
        },
        async delete(req: string | { url: string }) {
          const url = typeof req === "string" ? req : req.url;
          return bucket.delete(url);
        },
      };
    },
    _dumpEntries(cacheName: string) {
      return Array.from(store.get(cacheName)?.keys() || []);
    },
  };

  return cacheStorage;
}

describe("Fase 01 — F08 Descomissionamento PWA e Limpeza Seletiva de Cache Storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockSession = null;
  });

  it("libera /sw.js sem sessão no proxy e configura headers no next.config.mjs", async () => {
    expect(PUBLIC_PATHS).toContain("/sw.js");
    expect(proxyConfig.matcher[0]).toContain("sw\\.js");

    const swRes = await proxy(new NextRequest("http://localhost:3000/sw.js"));
    expect(swRes.status).toBe(200);
    expect(swRes.headers.get("location")).toBeNull();

    const nextConfigMod: any = await import("../../../next.config.mjs");
    const headers = await nextConfigMod.default.headers();

    const swHeaderRule = headers.find((h: any) => h.source === "/sw.js");
    expect(swHeaderRule).toBeTruthy();
    expect(swHeaderRule.headers).toEqual(
      expect.arrayContaining([
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" },
      ])
    );

    const signoutRule = headers.find((h: any) => h.source === "/api/auth/signout");
    expect(signoutRule).toBeTruthy();
    expect(signoutRule.headers).toEqual(
      expect.arrayContaining([{ key: "Clear-Site-Data", value: '"cache"' }])
    );

    const buscaAtivaRule = headers.find((h: any) => h.source === "/busca-ativa/:path*");
    expect(buscaAtivaRule?.headers).toEqual(
      expect.arrayContaining([{ key: "Cache-Control", value: "private, no-store, max-age=0" }])
    );
  });

  it("remove exclusivamente caches e entradas da Rede Ativa (preservando outros caches da origem)", async () => {
    expect(isRedeAtivaCacheKey("redeativa-pwa-v1.2.0")).toBe(true);
    expect(isRedeAtivaCacheKey("leopoldina-v1")).toBe(true);
    expect(isRedeAtivaCacheKey("third-party-cache-v1")).toBe(false);

    const memCaches = createInMemoryCacheStorage({
      "redeativa-pwa-v1.2.0": {
        "https://app.example/busca-ativa": "<html>Estudante Confidencial</html>",
        "https://app.example/api/students": '[{"name":"Aluno Sigiloso"}]',
      },
      "leopoldina-v1": {
        "https://app.example/alunos/stu-1": "<html>Prontuário</html>",
      },
      "third-party-cache-v1": {
        "https://app.example/externo/recurso": "ok",
      },
    });

    const deleted = await clearRedeAtivaCachesOnly(memCaches as unknown as CacheStorage);
    expect(deleted.sort()).toEqual(["leopoldina-v1", "redeativa-pwa-v1.2.0"]);

    expect(await memCaches.keys()).toEqual(["third-party-cache-v1"]);
    expect(memCaches._dumpEntries("redeativa-pwa-v1.2.0")).toEqual([]);
    expect(memCaches._dumpEntries("leopoldina-v1")).toEqual([]);
    expect(memCaches._dumpEntries("third-party-cache-v1")).toEqual([
      "https://app.example/externo/recurso",
    ]);
  });

  it("public/sw.js v2.0.0-cleanup limpa entradas do legado v1.2.0, desregistra o SW e não intercepta fetch", async () => {
    const swPath = path.resolve(process.cwd(), "public/sw.js");
    const swSource = fs.readFileSync(swPath, "utf8");

    const memCaches = createInMemoryCacheStorage({
      "redeativa-pwa-v1.2.0": {
        "https://app.example/busca-ativa": "<html>Estudante A</html>",
        "https://app.example/api/students": "[]",
      },
      "leopoldina-assets": {
        "https://app.example/atas": "<html>Ata</html>",
      },
      "other-vendor-v2": {
        "https://app.example/vendor.js": "console.log(1)",
      },
    });

    const listeners: Record<string, Function> = {};
    const postedMessages: any[] = [];
    const unregisterMock = vi.fn(async () => true);
    const skipWaitingMock = vi.fn();
    const claimMock = vi.fn(async () => {});

    const fakeSelf: any = {
      addEventListener: (event: string, cb: Function) => {
        listeners[event] = cb;
      },
      skipWaiting: skipWaitingMock,
      registration: { unregister: unregisterMock },
      clients: {
        claim: claimMock,
        matchAll: vi.fn(async () => [{ postMessage: (msg: any) => postedMessages.push(msg) }]),
      },
    };

    const runner = new Function("self", "caches", swSource);
    runner(fakeSelf, memCaches);

    // Garante que o novo sw.js NÃO instala listener de fetch offline
    expect(listeners.fetch).toBeUndefined();
    expect(typeof listeners.install).toBe("function");
    expect(typeof listeners.activate).toBe("function");
    expect(typeof listeners.message).toBe("function");

    listeners.install({});
    expect(skipWaitingMock).toHaveBeenCalledTimes(1);

    let activatePromise: Promise<unknown> | undefined;
    listeners.activate({
      waitUntil: (p: Promise<unknown>) => {
        activatePromise = p;
      },
    });
    await activatePromise;

    expect(await memCaches.keys()).toEqual(["other-vendor-v2"]);
    expect(memCaches._dumpEntries("redeativa-pwa-v1.2.0")).toEqual([]);
    expect(unregisterMock).toHaveBeenCalledTimes(1);
    expect(postedMessages).toEqual([
      expect.objectContaining({
        type: "REDEATIVA_SW_CLEANED",
      }),
    ]);
  });

  it("PwaRegister / cleanupLegacyServiceWorkersAndCaches desregistra exclusivamente /sw.js da Rede Ativa e preserva outros workers", async () => {
    expect(
      isRedeAtivaServiceWorkerRegistration(
        { active: { scriptURL: "https://app.example/sw.js" } },
        "https://app.example"
      )
    ).toBe(true);
    expect(
      isRedeAtivaServiceWorkerRegistration(
        { active: { scriptURL: "https://app.example/outro-app/sw.js" } },
        "https://app.example"
      )
    ).toBe(false);
    expect(
      isRedeAtivaServiceWorkerRegistration(
        { active: { scriptURL: "https://other.example/sw.js" } },
        "https://app.example"
      )
    ).toBe(false);

    const registerSpy = vi.fn();
    const updateSpy = vi.fn(async () => {});
    const unregisterSpy = vi.fn(async () => true);
    const postMsgSpy = vi.fn();

    const otherUpdateSpy = vi.fn(async () => {});
    const otherUnregisterSpy = vi.fn(async () => true);
    const otherPostMsgSpy = vi.fn();

    const memCaches = createInMemoryCacheStorage({
      "redeativa-pwa-v1.2.0": { "https://app.example/busca-ativa": "cached" },
      "unrelated-cache": { "https://app.example/keep": "1" },
    });

    const originalWindow = globalThis.window;
    const originalNavigator = globalThis.navigator;

    Object.defineProperty(globalThis, "window", {
      value: {
        location: { origin: "https://app.example" },
        caches: memCaches,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          register: registerSpy,
          getRegistrations: vi.fn(async () => [
            {
              update: updateSpy,
              unregister: unregisterSpy,
              active: {
                scriptURL: "https://app.example/sw.js",
                postMessage: postMsgSpy,
              },
            },
            {
              update: otherUpdateSpy,
              unregister: otherUnregisterSpy,
              active: {
                scriptURL: "https://app.example/outro-app/sw.js",
                postMessage: otherPostMsgSpy,
              },
            },
          ]),
        },
      },
      configurable: true,
    });

    try {
      const result = await cleanupLegacyServiceWorkersAndCaches();
      expect(registerSpy).not.toHaveBeenCalled();
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(postMsgSpy).toHaveBeenCalledWith({ type: "CLEAR_REDEATIVA_CACHES" });
      expect(unregisterSpy).toHaveBeenCalledTimes(1);
      expect(otherUpdateSpy).not.toHaveBeenCalled();
      expect(otherPostMsgSpy).not.toHaveBeenCalled();
      expect(otherUnregisterSpy).not.toHaveBeenCalled();
      expect(result.unregisteredCount).toBe(1);
      expect(result.clearedCaches).toEqual(["redeativa-pwa-v1.2.0"]);
      expect(await memCaches.keys()).toEqual(["unrelated-cache"]);

      // Garante que PwaRegister não referencia .register("/sw.js") nem banner "RA"
      const pwaSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/components/PwaRegister.tsx"),
        "utf8"
      );
      expect(pwaSrc).not.toContain('.register("/sw.js")');
      expect(pwaSrc).not.toContain("beforeinstallprompt");
    } finally {
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
      Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true });
    }
  });
});
