import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import RootDispatcherPage, { metadata as rootMetadata } from "../page";

// Mocks do Next.js e Auth
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

let mockSession: any = null;
let mockHostHeader = "redeativa.app.br";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => {
      if (name.toLowerCase() === "host" || name.toLowerCase() === "x-forwarded-host") {
        return mockHostHeader;
      }
      return null;
    },
  }),
}));

vi.mock("@/lib/auth", () => ({
  auth: async () => mockSession,
}));

describe("Roteamento Inteligente da Raiz (src/app/page.tsx)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = null;
    mockHostHeader = "redeativa.app.br";
  });

  describe("Cenário 1: Usuárias Autenticadas (Despacho RBAC)", () => {
    it("despacha SUPERADMIN autenticado para /admin", async () => {
      mockSession = {
        user: { email: "super@admin.com", role: "SUPERADMIN", active: true },
      };

      await expect(RootDispatcherPage()).rejects.toThrow("REDIRECT:/admin");
    });

    it("despacha GESTAO_SECRETARIA autenticada para /secretaria", async () => {
      mockSession = {
        user: { email: "secretaria@educacao.pr.gov.br", role: "GESTAO_SECRETARIA", active: true },
      };

      await expect(RootDispatcherPage()).rejects.toThrow("REDIRECT:/secretaria");
    });

    it("despacha GESTOR_ESCOLAR autenticado para /gestao", async () => {
      mockSession = {
        user: { email: "direcao@escola.pr.gov.br", role: "GESTOR_ESCOLAR", active: true },
      };

      await expect(RootDispatcherPage()).rejects.toThrow("REDIRECT:/gestao");
    });

    it("despacha PEDAGOGA / Docente autenticada para /busca-ativa", async () => {
      mockSession = {
        user: { email: "pedagoga@escola.pr.gov.br", role: "PEDAGOGA", active: true },
      };

      await expect(RootDispatcherPage()).rejects.toThrow("REDIRECT:/busca-ativa");
    });
  });

  describe("Cenário 2: Usuárias Não-Autenticadas em Domínios Legados (.vercel.app)", () => {
    it("redireciona busca-ativa-leopoldina.vercel.app diretamente para /login para preservar PWAs instalados", async () => {
      mockSession = null;
      mockHostHeader = "busca-ativa-leopoldina.vercel.app";

      await expect(RootDispatcherPage()).rejects.toThrow("REDIRECT:/login");
    });

    it("redireciona registro-leopoldina.vercel.app diretamente para /login", async () => {
      mockSession = null;
      mockHostHeader = "registro-leopoldina.vercel.app";

      await expect(RootDispatcherPage()).rejects.toThrow("REDIRECT:/login");
    });

    it("redireciona qualquer subdomínio .vercel.app para /login", async () => {
      mockSession = null;
      mockHostHeader = "rede-ativa-teste.vercel.app";

      await expect(RootDispatcherPage()).rejects.toThrow("REDIRECT:/login");
    });
  });

  describe("Cenário 3: Usuárias Não-Autenticadas no Domínio Oficial e Localhost", () => {
    it("renderiza a Landing Page oficial com o botão Acessar sistema quando acessado por redeativa.app.br", async () => {
      mockSession = null;
      mockHostHeader = "redeativa.app.br";

      const pageComponent = await RootDispatcherPage();
      const html = renderToString(pageComponent as React.ReactElement);

      expect(html).toContain("Rede Ativa");
      expect(html).toContain("Acessar sistema");
      expect(html).toContain('href="/login"');
    });

    it("renderiza a Landing Page oficial quando acessado por www.redeativa.app.br", async () => {
      mockSession = null;
      mockHostHeader = "www.redeativa.app.br";

      const pageComponent = await RootDispatcherPage();
      const html = renderToString(pageComponent as React.ReactElement);

      expect(html).toContain("Rede Ativa");
      expect(html).toContain("Acessar sistema");
    });

    it("renderiza a Landing Page oficial em ambiente de desenvolvimento local (localhost)", async () => {
      mockSession = null;
      mockHostHeader = "localhost:3001";

      const pageComponent = await RootDispatcherPage();
      const html = renderToString(pageComponent as React.ReactElement);

      expect(html).toContain("Rede Ativa");
      expect(html).toContain("Acessar sistema");
    });

    it("mantém metadados da raiz livres de promessas absolutas e jargões da Seção 10", () => {
      expect(rootMetadata.title).toContain("Rede Ativa");
      expect(String(rootMetadata.description)).toContain("supervisão humana");
      expect(String(rootMetadata.description)).not.toContain("80%");
      expect(String(rootMetadata.description)).not.toContain("Fé Pública");
      expect(String(rootMetadata.description)).not.toContain("14.063");
    });
  });
});
