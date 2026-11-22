import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";
import BuscaAtivaClient from "@/app/busca-ativa/BuscaAtivaClient";
import ModalDialog from "@/components/ModalDialog";

describe("BuscaAtivaClient & ModalDialog SSR", () => {
  it("renders BuscaAtivaClient without error", () => {
    const html = renderToString(
      <BuscaAtivaClient
        classGroups={[]}
        templates={[]}
        initialStudents={[]}
        initialSelectedStudentId=""
        initialCustomPhone=""
        initialMode="individual"
        initialTurmaId=""
        currentUser={{
          name: "MARCOS ADRIANO WROBEL",
          email: "marcos.wrobel@escola.pr.gov.br",
        }}
      />
    );
    expect(html).toContain("Painel de Busca Ativa");
  });

  it("renders Fila por Turma com prioridade na revisão de contato e mantém regiões aria-live e ações contextuais", () => {
    const html = renderToString(
      <BuscaAtivaClient
        classGroups={[
          { id: "cg-1", name: "8º Ano B", segment: "ENSINO FUNDAMENTAL II", shift: "TARDE" },
        ]}
        templates={[
          {
            id: "tpl-1",
            title: "Infrequência Consecutiva",
            content: "Olá [RESPONSAVEL], notamos ausências de [ESTUDANTE].",
          },
        ]}
        initialStudents={[
          {
            id: "st-1",
            name: "Estudante Teste Fila",
            classGroupId: "cg-1",
            classGroup: { id: "cg-1", name: "8º Ano B", shift: "TARDE" },
            guardianName: "Responsável Teste",
            phone: "42999991111",
            phoneWhatsApp: "42999991111",
            lowAttendanceRecord: { attendancePercent: 68 },
            justifications: [],
            contacts: [],
            messageLogs: [],
          },
        ]}
        initialMode="fila"
        initialTurmaId="cg-1"
        currentUser={{
          name: "Pedagoga Teste",
          email: "pedagoga@escola.pr.gov.br",
        }}
      />
    );

    const plainHtml = html.replace(/<!-- -->/g, "");
    expect(plainHtml).toContain("Estudante Teste Fila");
    expect(plainHtml).toContain("68%");

    const source = fs.readFileSync(
      path.join(process.cwd(), "src/app/busca-ativa/BuscaAtivaClient.tsx"),
      "utf8"
    );
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain("1. Abrir WhatsApp");
    expect(source).toContain("2. Confirmar envio");
    expect(source).toContain("O envio ainda não foi confirmado");
    expect(source).toContain("Fila da turma concluída");
  });

  it("renderiza ModalDialog acessível com closedby e rótulos vinculados", () => {
    const html = renderToString(
      <ModalDialog
        open={true}
        onClose={() => {}}
        title="Confirmar cadastro"
        subtitle="Revise os dados antes de prosseguir."
        preventClose={true}
      >
        <p>Conteúdo sintético</p>
      </ModalDialog>
    );

    expect(html).toContain("<dialog");
    expect(html).toContain("aria-labelledby=");
    expect(html).toContain("aria-describedby=");
    expect(html).toContain('closedby="none"');
    expect(html).toContain('aria-label="Fechar"');
  });
});
