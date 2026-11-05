import { describe, it, expect } from "vitest";
import {
  generatePredictiveRecommendations,
  getCategoryMeta,
  CATEGORY_LABELS,
  CauseBreakdownItem,
} from "../predictiveAnalytics";

describe("predictiveAnalytics", () => {
  describe("getCategoryMeta", () => {
    it("deve retornar metadados corretos para categorias mapeadas", () => {
      const saude = getCategoryMeta("SAUDE");
      expect(saude.label).toContain("Saúde");
      expect(saude.color).toContain("rose");

      const transporte = getCategoryMeta("TRANSPORTE");
      expect(transporte.label).toContain("Transporte");

      const trabalho = getCategoryMeta("TRABALHO");
      expect(trabalho.label).toContain("Trabalho");
    });

    it("deve retornar fallback seguro para categorias desconhecidas", () => {
      const fallback = getCategoryMeta("DESCONHECIDO");
      expect(fallback.label).toBe("DESCONHECIDO");
      expect(fallback.color).toContain("slate");
    });
  });

  describe("generatePredictiveRecommendations", () => {
    it("deve emitir recomendação de monitoramento regular quando não houver anomalias", () => {
      const recommendations = generatePredictiveRecommendations([]);
      expect(recommendations).toHaveLength(1);
      expect(recommendations[0].priority).toBe("INFO");
      expect(recommendations[0].title).toContain("Monitoramento Preventivo");
    });

    it("deve disparar alerta de alta prioridade quando houver registro de trabalho infantil", () => {
      const causes: CauseBreakdownItem[] = [
        { category: "TRABALHO", count: 2, percentage: 5 },
      ];
      const recommendations = generatePredictiveRecommendations(causes, 5);
      const trabalhoAlert = recommendations.find((r) => r.title.includes("Trabalho Infantil"));
      expect(trabalhoAlert).toBeDefined();
      expect(trabalhoAlert?.priority).toBe("HIGH");
      expect(trabalhoAlert?.action).toContain("ECA");
    });

    it("deve disparar recomendação para transporte escolar quando ultrapassar 20%", () => {
      const causes: CauseBreakdownItem[] = [
        { category: "TRANSPORTE", count: 12, percentage: 25 },
      ];
      const recommendations = generatePredictiveRecommendations(causes, 8);
      const transporteAlert = recommendations.find((r) => r.title.includes("Transporte Escolar"));
      expect(transporteAlert).toBeDefined();
      expect(transporteAlert?.priority).toBe("HIGH");
      expect(transporteAlert?.action).toContain("linhas rurais");
    });

    it("deve disparar recomendação para saúde quando ultrapassar 30%", () => {
      const causes: CauseBreakdownItem[] = [
        { category: "SAUDE", count: 15, percentage: 35 },
      ];
      const recommendations = generatePredictiveRecommendations(causes, 6);
      const saudeAlert = recommendations.find((r) => r.title.includes("Saúde"));
      expect(saudeAlert).toBeDefined();
      expect(saudeAlert?.priority).toBe("MEDIUM");
      expect(saudeAlert?.action).toContain("Secretaria de Saúde");
    });

    it("deve disparar recomendação quando a taxa crítica da rede for superior a 15%", () => {
      const causes: CauseBreakdownItem[] = [
        { category: "OUTROS", count: 3, percentage: 10 },
      ];
      const recommendations = generatePredictiveRecommendations(causes, 18.5);
      const criticalRateAlert = recommendations.find((r) => r.title.includes("Taxa Crítica"));
      expect(criticalRateAlert).toBeDefined();
      expect(criticalRateAlert?.priority).toBe("HIGH");
    });
  });
});
