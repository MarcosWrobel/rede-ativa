import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/faltas",
}));

import FaltasClient from "@/app/faltas/FaltasClient";

describe("FaltasClient SSR & Phase 1 UX", () => {
  it("renders FaltasClient without error e diferencia base vazia de filtro sem resultados", () => {
    const html = renderToString(
      <FaltasClient
        rankedAbsences={[]}
        lowAttendance={[]}
        classGroups={[]}
        templates={[]}
        currentSchool={{ id: "sch-ess", name: "Escola Teste", edition: "INSTITUCIONAL_ESSENCIAL" }}
        currentUser={{ name: "Test User", email: "test@escola.pr.gov.br", isAdmin: true }}
      />
    );
    expect(html).toContain("Tabela de infrequência escolar");
    expect(html).toContain("Nenhum registro de frequência cadastrado nesta unidade.");
    expect(html).toContain("Importar Frequência (Planilha)");
    expect(html).not.toContain("Sincronizar Frequência (Power BI)");
  });

  it("alinha percentuais e variações à direita com tabular-nums e usa badge estático sem pulsação para casos críticos", () => {
    const html = renderToString(
      <FaltasClient
        rankedAbsences={[]}
        lowAttendance={[
          {
            id: "rec-1",
            studentId: "st-1",
            attendancePercent: 62,
            lastWeekPercent: 60,
            prevWeekPercent: 74,
            deltaPercent: -14,
            actionStatus: null,
            actionNotes: null,
            student: {
              id: "st-1",
              name: "Estudante Crítico Sintético",
              cgm: "1234567",
              phone: "42999990001",
              phoneWhatsApp: "42999990001",
              classGroupId: "cg-1",
              classGroup: { id: "cg-1", name: "9º Ano A", segment: "ENSINO FUNDAMENTAL II", shift: "MANHA" },
              justifications: [],
              contacts: [],
            },
          },
        ]}
        classGroups={[
          { id: "cg-1", name: "9º Ano A", segment: "ENSINO FUNDAMENTAL II", shift: "MANHA" },
        ]}
        templates={[]}
        currentSchool={{ id: "sch-int", name: "Escola Piloto Teste", edition: "PILOTO_INTEGRADA" }}
        currentUser={{ name: "Test User", email: "test@escola.pr.gov.br", isAdmin: true }}
      />
    );

    const plainHtml = html.replace(/<!-- -->/g, "");
    expect(plainHtml).toContain("Sincronizar Frequência (Power BI)");
    expect(plainHtml).toContain("<span>Crítico</span><span aria-hidden=\"true\">•</span><span class=\"font-black\">62.0%</span>");
    expect(plainHtml).toContain("text-right tabular-nums");
    expect(plainHtml).toContain("Estudante Crítico Sintético");
    expect(plainHtml).toContain('tabindex="0"');
    expect(plainHtml).not.toContain("animate-pulse");

    const source = fs.readFileSync(
      path.join(process.cwd(), "src/app/faltas/FaltasClient.tsx"),
      "utf8"
    );
    expect(source).toContain("Nenhum estudante encontrado para os filtros aplicados.");
    expect(source).toContain('inputMode="decimal"');
    expect(source).toContain("Atualizar Encaminhamento");
    expect(source).toContain("ModalDialog");
  });
});
