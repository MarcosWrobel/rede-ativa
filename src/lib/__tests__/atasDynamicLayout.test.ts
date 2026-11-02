import { describe, it, expect } from "vitest";

function getSchoolNetworkHeader(school: any) {
  const network = school?.network || "ESTADUAL";
  if (network === "MUNICIPAL") {
    return {
      line1: `Prefeitura Municipal de ${school?.city || "Município"} • Secretaria Municipal de Educação`,
      line2: school?.nre ? `Supervisão / Regional: ${school.nre}` : "Secretaria Municipal de Educação",
      unitType: "Escola Municipal",
      authority: "da Secretaria Municipal de Educação",
      protocolSystem: "aos sistemas de protocolo e arquivo permanente do Município",
    };
  }
  if (network === "PRIVADA") {
    return {
      line1: "Rede de Ensino Particular / Privada",
      line2: school?.nre ? `Supervisão Regional: ${school.nre}` : "Diretoria de Ensino",
      unitType: "Instituição de Ensino Particular",
      authority: "dos órgãos competentes do Sistema de Ensino",
      protocolSystem: "ao arquivo permanente e órgãos reguladores de Ensino",
    };
  }
  return {
    line1: `Governo do Estado ${school?.state === "PR" ? "do Paraná" : `de ${school?.state || "PR"}`} • Secretaria de Estado da Educação — SEED-PR`,
    line2: `Núcleo Regional de Educação de ${school?.nre || school?.city || "Ponta Grossa"}`,
    unitType: "Colégio Estadual",
    authority: "da SEED-PR",
    protocolSystem: "ao Sistema e-Protocolo da SEED-PR",
  };
}

describe("Fase 3: Dynamic Minutes Layout & Multi-Network Headers", () => {
  it("generates correct header and terms for ESTADUAL network (Colégio Leopoldina)", () => {
    const school = {
      name: "Colégio Estadual Leopoldina B. Pedroso",
      city: "Ponta Grossa",
      state: "PR",
      nre: "Ponta Grossa",
      network: "ESTADUAL",
    };
    const header = getSchoolNetworkHeader(school);
    expect(header.line1).toContain("Governo do Estado do Paraná • Secretaria de Estado da Educação — SEED-PR");
    expect(header.line2).toBe("Núcleo Regional de Educação de Ponta Grossa");
    expect(header.unitType).toBe("Colégio Estadual");
    expect(header.authority).toBe("da SEED-PR");
  });

  it("generates correct header and terms for MUNICIPAL network", () => {
    const school = {
      name: "Escola Municipal Professor Darcy Ribeiro",
      city: "Tibagi",
      state: "PR",
      nre: "SEMEC Tibagi",
      network: "MUNICIPAL",
    };
    const header = getSchoolNetworkHeader(school);
    expect(header.line1).toContain("Prefeitura Municipal de Tibagi • Secretaria Municipal de Educação");
    expect(header.line2).toBe("Supervisão / Regional: SEMEC Tibagi");
    expect(header.unitType).toBe("Escola Municipal");
    expect(header.protocolSystem).toContain("protocolo e arquivo permanente do Município");
  });

  it("generates correct header and terms for PRIVADA network", () => {
    const school = {
      name: "Colégio Sagrado Coração",
      city: "Curitiba",
      state: "PR",
      network: "PRIVADA",
    };
    const header = getSchoolNetworkHeader(school);
    expect(header.line1).toBe("Rede de Ensino Particular / Privada");
    expect(header.unitType).toBe("Instituição de Ensino Particular");
    expect(header.authority).toContain("Sistema de Ensino");
  });
});
