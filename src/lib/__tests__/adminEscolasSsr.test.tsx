import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import AdminEscolasClient from "@/app/admin/escolas/AdminEscolasClient";

describe("AdminEscolasClient SSR", () => {
  it("renders AdminEscolasClient without error", () => {
    const html = renderToString(
      <AdminEscolasClient
        schools={[
          {
            id: "cmvvaoxvl0000kw07c9m80sye",
            name: "Colégio Estadual Leopoldina B. Pedroso",
            shortName: "Leopoldina",
            inep: "41042730",
            network: "ESTADUAL",
            municipality: "Ponta Grossa",
            state: "PR",
            phone: "(42) 3224-0000",
            email: "leopoldinabpedroso@escola.pr.gov.br",
            logoUrl: "/logo.svg",
            hasSyncToken: false,
            studentsCount: 689,
            classesCount: 23,
            staffCount: 7,
            createdAt: new Date().toISOString(),
          },
        ]}
        activeSchoolId="cmvvaoxvl0000kw07c9m80sye"
      />
    );
    expect(html).toContain("Gestão de Escolas");
  });
});
