import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import ImpactoClient from "../ImpactoClient";
import ImpactoPage from "../page";

describe("Landing Page de Vendas & Playground Interativo (/impacto)", () => {
  it("renderiza o cabeçalho executivo, selos legais e simulador de tempo via renderToString", () => {
    const html = renderToString(<ImpactoClient />);

    expect(html).toContain("Rede Ativa");
    expect(html).toContain("Lei 14.063/2020");
    expect(html).toContain("ECA Art. 56");
    expect(html).toContain("ISO 19005-1");
    expect(html).toContain("Horas Semanais Gastas com Burocracia Mecânica");
    expect(html).toContain("Rotina Manual Tradicional");
    expect(html).toContain("Com a Rede Ativa SaaS");
  });

  it("renderiza a bancada interativa do playground com as 3 abas essenciais", () => {
    const html = renderToString(<ImpactoClient />);

    expect(html).toContain("Bancada Interativa");
    expect(html).toContain("Experimente o Fluxo da Sua Escola na Prática");
    expect(html).toContain("1. Busca Ativa &amp; WhatsApp Protegido");
    expect(html).toContain("2. Livro de Atas &amp; QR Code do Pai");
    expect(html).toContain("3. Dossiê ECA em 1 Clique");
  });

  it("renderiza o simulador de Busca Ativa com estudantes de exemplo e proteção de privacidade", () => {
    const html = renderToString(<ImpactoClient />);

    expect(html).toContain("Simulador de Busca Ativa Humanizada");
    expect(html).toContain("Lucas Mendes da Silva");
    expect(html).toContain("Mariana Costa Ribeiro");
    expect(html).toContain("Janela Protegida (Rede Ativa)");
    expect(html).toContain("Disparar Mensagem de Busca Ativa");
  });

  it("renderiza a página Server Component ImpactoPage com sucesso", () => {
    const pageHtml = renderToString(<ImpactoPage />);
    expect(pageHtml).toContain("Rede Ativa");
    expect(pageHtml).toContain("Da Sobrecarga Burocrática");
  });
});
