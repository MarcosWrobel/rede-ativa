import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import EscolaSettingsClient from "@/app/configuracoes/escola/EscolaSettingsClient";

describe("EscolaSettingsClient SSR", () => {
  it("renders EscolaSettingsClient without error", () => {
    const html = renderToString(
      <EscolaSettingsClient
        school={{
          id: "cmvvaoxvl0000kw07c9m80sye",
          name: "Colégio Estadual Leopoldina B. Pedroso",
          shortName: "Leopoldina",
          inep: "41042730",
          network: "ESTADUAL",
          municipality: "Ponta Grossa",
          state: "PR",
          phone: "(42) 3224-0000",
          email: "leopoldinabpedroso@escola.pr.gov.br",
          address: "",
          logoUrl: "/logo.svg",
          hasSyncToken: false,
          syncTokenCreatedAt: null,
        }}
      />
    );
    expect(html).toContain("Identidade &amp; Dados da Escola");
  });
});
