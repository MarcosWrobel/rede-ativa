import { describe, it, expect, vi } from "vitest";
import {
  resolveSchoolEdition,
  isPilotIntegrated,
  canUseGovernmentScrapers,
  PILOT_SCHOOL_INEP,
  PILOT_SCHOOL_ID,
} from "../platformEditions";

describe("Governança de Edições da Plataforma — Rede Ativa SaaS", () => {
  describe("Regra Inegociável 1: Inviolabilidade da Escola Piloto Fundadora", () => {
    it("sempre resolve como PILOTO_INTEGRADA para o INEP 41042730", () => {
      const edition = resolveSchoolEdition({
        inepCode: PILOT_SCHOOL_INEP,
        settingsJson: JSON.stringify({ edition: "INSTITUCIONAL_ESSENCIAL" }),
      });
      expect(edition).toBe("PILOTO_INTEGRADA");
      expect(isPilotIntegrated(edition)).toBe(true);
      expect(canUseGovernmentScrapers({ inepCode: PILOT_SCHOOL_INEP })).toBe(true);
    });

    it("sempre resolve como PILOTO_INTEGRADA para o ID técnico legado default-leopoldina", () => {
      const edition = resolveSchoolEdition({
        id: PILOT_SCHOOL_ID,
        inepCode: "00000000",
        settingsJson: null,
      });
      expect(edition).toBe("PILOTO_INTEGRADA");
      expect(canUseGovernmentScrapers({ id: PILOT_SCHOOL_ID })).toBe(true);
    });
  });

  describe("Herança Hierárquica e Resolução de Edições", () => {
    it("respeita a edição explícita PILOTO_INTEGRADA configurada na escola", () => {
      const school = {
        inepCode: "41999999",
        settingsJson: JSON.stringify({ edition: "PILOTO_INTEGRADA" }),
      };
      expect(resolveSchoolEdition(school)).toBe("PILOTO_INTEGRADA");
      expect(canUseGovernmentScrapers(school)).toBe(true);
    });

    it("respeita a edição explícita INSTITUCIONAL_ESSENCIAL configurada na escola", () => {
      const school = {
        inepCode: "41999999",
        settingsJson: JSON.stringify({ edition: "INSTITUCIONAL_ESSENCIAL" }),
      };
      expect(resolveSchoolEdition(school)).toBe("INSTITUCIONAL_ESSENCIAL");
      expect(canUseGovernmentScrapers(school)).toBe(false);
    });

    it("herda a edição PILOTO_INTEGRADA da SEMEC / Rede vinculada quando a escola não tem configuração própria", () => {
      const school = {
        inepCode: "41888888",
        networkId: "semec-curitiba",
        settingsJson: null,
      };
      const networkSettingsJson = JSON.stringify({ edition: "PILOTO_INTEGRADA" });
      expect(resolveSchoolEdition(school, networkSettingsJson)).toBe("PILOTO_INTEGRADA");
      expect(canUseGovernmentScrapers(school, networkSettingsJson)).toBe(true);
    });

    it("herda a edição INSTITUCIONAL_ESSENCIAL da SEMEC quando a escola não tem configuração", () => {
      const school = {
        inepCode: "41777777",
        networkId: "semec-tibagi",
        settingsJson: JSON.stringify({ district: "Caetano Mendes" }), // sem edition
      };
      const networkSettingsJson = JSON.stringify({ edition: "INSTITUCIONAL_ESSENCIAL" });
      expect(resolveSchoolEdition(school, networkSettingsJson)).toBe("INSTITUCIONAL_ESSENCIAL");
      expect(canUseGovernmentScrapers(school, networkSettingsJson)).toBe(false);
    });

    it("aplica fallback seguro INSTITUCIONAL_ESSENCIAL para escolas novas sem rede configurada", () => {
      const school = {
        inepCode: "41555555",
        settingsJson: null,
      };
      expect(resolveSchoolEdition(school)).toBe("INSTITUCIONAL_ESSENCIAL");
      expect(canUseGovernmentScrapers(school)).toBe(false);
    });

    it("preserva retrocompatibilidade com flag legada enablePowerBiSync", () => {
      const school = {
        inepCode: "41444444",
        settingsJson: JSON.stringify({ enablePowerBiSync: true }),
      };
      expect(resolveSchoolEdition(school)).toBe("PILOTO_INTEGRADA");
      expect(canUseGovernmentScrapers(school)).toBe(true);
    });

    it("trata JSON inválido com fallback seguro", () => {
      const school = {
        inepCode: "41333333",
        settingsJson: "{ invalid json ...",
      };
      expect(resolveSchoolEdition(school)).toBe("INSTITUCIONAL_ESSENCIAL");
    });
  });
});
