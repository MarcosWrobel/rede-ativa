import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import BuscaAtivaClient from "@/app/busca-ativa/BuscaAtivaClient";

describe("BuscaAtivaClient SSR", () => {
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
});
