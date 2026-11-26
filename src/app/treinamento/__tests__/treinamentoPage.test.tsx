import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";
import PedagogicalFlowSimulator from "@/components/PedagogicalFlowSimulator";
import TreinamentoClient from "../TreinamentoClient";

const mockAuth = vi.fn();
const mockGetCurrentSchool = vi.fn();
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
}));

vi.mock("@/lib/auth", () => ({
  auth: () => mockAuth(),
}));

vi.mock("@/lib/serverAuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/lib/serverAuthContext")>("@/lib/serverAuthContext");
  return {
    ...actual,
    resolveServerUserAuthSnapshot: vi.fn(async (session: any) => ({
      id: "usr-1",
      email: session?.user?.email || "pedagoga@escola.pr.gov.br",
      name: "Pedagoga",
      role: session?.user?.role || "PEDAGOGA",
      active: session?.user?.active !== false,
      schoolId: "school-mun-1",
      schools: [{ schoolId: "school-mun-1", role: "PEDAGOGA", active: true, school: { id: "school-mun-1", inepCode: "41000001", name: "Escola Municipal Exemplo", city: "Tibagi", network: "MUNICIPAL", networkId: null, active: true } }],
      networks: [],
      source: "database",
    })),
  };
});

vi.mock("@/lib/currentSchool", () => ({
  getCurrentSchool: () => mockGetCurrentSchool(),
  getAuthorizedCurrentSchool: () => mockGetCurrentSchool(),
}));

import TreinamentoPage from "../page";

const FORBIDDEN_ITEM_10_REGEX =
  /fé pública|SHA-256|PBKDF2|PDF\/A-1b|100% LGPD|imutável|inviolável|workflow|ecossistema|\blead\b|\bticket\b|\bSERE\b|\bAPI\b|\bwebhook\b/i;

const FORBIDDEN_EXACT_TERMS = [
  "Lei 14.063/2020",
  "Lei nº 14.063/2020",
  "ISO 19005-1",
  "Dossiê Oficial",
  "Certidão",
  "5542999999999",
  "Leopoldina",
  "impossível rasurar",
  "100% seguro",
] as const;

function assertItem10Compliance(html: string) {
  const plainText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(plainText).not.toMatch(FORBIDDEN_ITEM_10_REGEX);
  expect(html).not.toMatch(FORBIDDEN_ITEM_10_REGEX);
  for (const term of FORBIDDEN_EXACT_TERMS) {
    expect(html).not.toContain(term);
  }
}

describe("Central de Orientação e Treinamento (/treinamento) & Simulador 2D", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redireciona usuários não autenticados para /login", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(TreinamentoPage()).rejects.toThrow("REDIRECT:/login");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("renderiza a página autenticada resolvendo a edição da escola ativa", async () => {
    mockAuth.mockResolvedValue({
      user: { email: "pedagoga@escola.pr.gov.br", role: "PEDAGOGA", active: true },
    });
    mockGetCurrentSchool.mockResolvedValue({
      id: "school-mun-1",
      inepCode: "41000001",
      name: "Escola Municipal Exemplo",
      edition: "INSTITUCIONAL_ESSENCIAL",
    });

    const element = await TreinamentoPage();
    const html = renderToString(element);

    expect(html).toContain("Orientação e Guias Operacionais");
    expect(html).toContain("Escola Municipal Exemplo");
    expect(html).toContain("Simulação demonstrativa");
    expect(html).toContain("Dados fictícios");
    expect(html).not.toContain("Guia 5:");
  });

  it("renderiza o simulador e os guias operacionais com o léxico pedagógico correto", () => {
    const html = renderToString(
      <TreinamentoClient
        schoolEdition="INSTITUCIONAL_ESSENCIAL"
        isSuperAdmin={false}
        schoolName="Escola Municipal Modelo"
      />
    );

    expect(html).toContain("Simulação demonstrativa");
    expect(html).toContain("Dados fictícios");
    expect(html).toContain("Compartilhar apresentação");
    expect(html).toContain("Guia 1: Importação de Matrículas e Atualização de Faltas");
    expect(html).toContain("Guia 2: Busca Ativa, Tentativas de Contato e Atestados");
    expect(html).toContain("Guia 3: Ata Pedagógica, Assinatura do Responsável e Complementos");
    expect(html).toContain("Guia 4: Histórico de Acompanhamento e Relatório de Intervenções");
    expect(html).toContain("Abrir estudantes");
    expect(html).toContain("Abrir busca ativa");
    expect(html).toContain("Ver atestados");
    expect(html).toContain("Abrir atas");
    expect(html).toContain("Ver estudantes");
    expect(html).toContain("Perguntas frequentes operacionais");
    expect(html).toContain("confirmação de autoria por PIN");
    expect(html).toContain(
      "Após a confirmação, alterações são registradas em complemento vinculado à ata, preservando o histórico."
    );
  });

  it("oculta totalmente o Guia 5 e a 5ª etapa do simulador na edição INSTITUCIONAL_ESSENCIAL", () => {
    const html = renderToString(
      <TreinamentoClient
        schoolEdition="INSTITUCIONAL_ESSENCIAL"
        isSuperAdmin={false}
      />
    );

    expect(html).not.toContain("Guia 5:");
    expect(html).not.toContain("5. Janela compacta");
    expect(html).not.toContain("Edição Piloto");
  });

  it("exibe o Guia 5 e a 5ª etapa do simulador em modo interno para PILOTO_INTEGRADA ou SUPERADMIN", () => {
    const pilotHtml = renderToString(
      <TreinamentoClient
        schoolEdition="PILOTO_INTEGRADA"
        isSuperAdmin={false}
      />
    );
    expect(pilotHtml).toContain("Guia 5: Configuração da Extensão de Navegador e Janela Compacta");
    expect(pilotHtml).toContain("5. Janela compacta");

    const superAdminHtml = renderToString(
      <TreinamentoClient
        schoolEdition="INSTITUCIONAL_ESSENCIAL"
        isSuperAdmin={true}
      />
    );
    expect(superAdminHtml).toContain("Guia 5: Configuração da Extensão de Navegador e Janela Compacta");
    expect(superAdminHtml).toContain("5. Janela compacta");
  });

  it("nunca exibe a 5ª etapa do simulador quando mode='public'", () => {
    const publicHtml = renderToString(
      <PedagogicalFlowSimulator
        mode="public"
        schoolEdition="PILOTO_INTEGRADA"
        isSuperAdmin={true}
      />
    );
    expect(publicHtml).not.toContain("5. Janela compacta");
  });

  it("renderiza o simulador interativo com App Shell fiel, ancoragem data-sim-target, destaque sim-focus-neon e controles de sub-etapas", () => {
    const html = renderToString(<PedagogicalFlowSimulator mode="public" />);

    expect(html).toContain("Colégio Estadual Exemplo");
    expect(html).toContain("Faltas e Frequência");
    expect(html).toContain("Estudantes e Turmas");
    expect(html).toContain("Atas Pedagógicas");
    expect(html).toContain("Encaminhamentos");
    expect(html).toContain("Importar planilha");
    expect(html).toContain("Sub-etapas da simulação");
    expect(html).toContain("Sub-etapa 1: Abrir envio");
    expect(html).toContain("Pausar");
    expect(html).toContain("Reiniciar");
    expect(html).toContain("Simulação demonstrativa • Dados fictícios");
    expect(html.match(/dark:[a-zA-Z0-9_-]+/g)).toBeNull();

    // Verifica presença dos atributos data-sim-target e destaque neon no alvo da sub-fase ativa
    expect(html).toContain('data-sim-target="btn-import-sheet"');
    expect(html).toContain('data-sim-target="btn-confirm-import"');
    expect(html).toContain('data-sim-target="row-student-lucas"');
    expect(html).toMatch(
      /data-sim-target="btn-import-sheet"[^>]*class="[^"]*sim-focus-neon/
    );
  });

  it("cumpre integralmente o Item 10 do GEMINI.md sem termos proibidos em TreinamentoClient e PedagogicalFlowSimulator", () => {
    const htmlEssencial = renderToString(
      <TreinamentoClient schoolEdition="INSTITUCIONAL_ESSENCIAL" isSuperAdmin={false} />
    );
    const htmlPiloto = renderToString(
      <TreinamentoClient schoolEdition="PILOTO_INTEGRADA" isSuperAdmin={true} />
    );
    const htmlSimPublic = renderToString(<PedagogicalFlowSimulator mode="public" />);
    const htmlSimInternal = renderToString(
      <PedagogicalFlowSimulator mode="internal" schoolEdition="PILOTO_INTEGRADA" isSuperAdmin={true} />
    );

    assertItem10Compliance(htmlEssencial);
    assertItem10Compliance(htmlPiloto);
    assertItem10Compliance(htmlSimPublic);
    assertItem10Compliance(htmlSimInternal);
  });

  it("aplica transição curta por cenário apenas no modo interno, pausa ao selecionar manualmente e respeita prefers-reduced-motion", () => {
    const internalHtml = renderToString(
      <PedagogicalFlowSimulator
        mode="internal"
        schoolEdition="INSTITUCIONAL_ESSENCIAL"
      />
    );
    const publicHtml = renderToString(
      <PedagogicalFlowSimulator mode="public" />
    );

    expect(internalHtml).toContain("sim-internal-scenario-enter");
    expect(publicHtml).not.toContain("sim-internal-scenario-enter");
    expect(publicHtml).toContain("sim-stage-enter sim-public-stage");

    const simSource = fs.readFileSync(
      path.join(process.cwd(), "src/components/PedagogicalFlowSimulator.tsx"),
      "utf8"
    );
    expect(simSource).toContain("prefers-reduced-motion: reduce");
    expect(simSource).toContain("Reprodução pausada");
    expect(simSource).not.toMatch(/dark:[a-zA-Z0-9_-]+/);

    const cssSource = fs.readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8"
    );
    expect(cssSource).toContain(".sim-internal-scenario-enter");
    expect(cssSource).toContain("simInternalScenarioEnter");
  });
});
