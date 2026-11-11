import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import ImpactoClient from "../ImpactoClient";
import ImpactoPage from "../page";

// Mock do next/navigation
vi.mock("next/navigation", () => ({
  permanentRedirect: vi.fn((url: string) => {
    throw new Error(`PERMANENT_REDIRECT:${url}`);
  }),
}));

const FORBIDDEN_PRODUCTION_UI_TERMS = [
  "Fé Pública",
  "fé pública",
  "100% LGPD",
  "+38%",
  "80%",
  "5542999999999",
  "Leopoldina",
  "Lei 14.063/2020",
  "Lei nº 14.063/2020",
  "ECA Art. 56",
  "ISO 19005-1",
  "SHA-256",
  "PBKDF2",
  "Sim, plenamente",
  "total respaldo",
  "Imutabilidade",
  "imutável",
  "Inviolável",
  "Impossível rasurar",
  "Dossiê Oficial",
  "Certidão",
  "Workflow Operacional",
] as const;

describe("Landing Page de Produção (/) & Redirecionamento (/impacto)", () => {
  it("renderiza a landing de produção com logo oficial, paleta do Hero, sem barra de preview e com CTA para /login", () => {
    const html = renderToString(<ImpactoClient />);
    const plainText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

    expect(html).not.toContain("Ambiente de Demonstração / Preview Landing Page");
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/login"');
    expect(html).toContain("Acessar sistema");
    expect(html).toContain('src="/logo.svg"');
    expect(html).toContain('src="/logo-symbol.svg"');
    expect(html).toContain("from-emerald-600 via-teal-600 to-sky-600");
    expect(plainText).toContain(
      "Conecte os contatos com as famílias, os atendimentos e as atas em um único fluxo."
    );
  });

  it("renderiza os cards enxutos do Hero, simulação demonstrativa rotulada e colunas operacionais", () => {
    const html = renderToString(<ImpactoClient />);

    expect(html).toContain("Mensagem pronta em 1 clique");
    expect(html).toContain("Atas padronizadas e prontas em instantes");
    expect(html).toContain("Redução da exposição de conversas na tela");
    expect(html).toContain("Relatório de contatos e intervenções");
    expect(html).toContain("Simulação demonstrativa • Dados fictícios");
    expect(html).toContain("Fluxo completo");
    expect(html).toContain("Contatos com famílias");
    expect(html).toContain("Menos retrabalho na busca ativa e nas atas");
    expect(html).toContain("Acompanhamento escolar e registro pedagógico.");
  });

  it("garante conformidade com Modo Claro e ausência de termos proibidos pela Seção 10 do GEMINI.md", () => {
    const html = renderToString(<ImpactoClient />);
    expect(html.match(/dark:[a-zA-Z0-9_-]+/g)).toBeNull();

    for (const forbidden of FORBIDDEN_PRODUCTION_UI_TERMS) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("redireciona a rota legada /impacto permanentemente (308) para a raiz /", () => {
    expect(() => ImpactoPage()).toThrow("PERMANENT_REDIRECT:/");
  });
});
