import { describe, it, expect } from "vitest";

describe("Fase 4: Painel Executivo da Secretaria (SEMEC) & Comparativo Inter-Escolas", () => {
  it("corretamente identifica defasagem de sincronização SERE (> 7 dias ou base zerada)", () => {
    const now = Date.now();
    const dayMs = 1000 * 60 * 60 * 24;

    const schoolA = {
      name: "Escola Sede Urbana",
      studentsCount: 250,
      lastSyncAt: new Date(now - 2 * dayMs).toISOString(),
    };

    const schoolB = {
      name: "Escola Rural Caetano Mendes",
      studentsCount: 180,
      lastSyncAt: new Date(now - 10 * dayMs).toISOString(), // 10 dias atrás
    };

    const schoolC = {
      name: "Escola Recém Cadastrada",
      studentsCount: 0, // Base zerada
      lastSyncAt: null,
    };

    const calcStatus = (s: { name: string; studentsCount: number; lastSyncAt: string | null }) => {
      const daysSinceSync = s.lastSyncAt
        ? Math.max(0, Math.floor((now - new Date(s.lastSyncAt).getTime()) / dayMs))
        : null;
      const isSyncOutdated = s.studentsCount === 0 || (daysSinceSync !== null && daysSinceSync > 7);
      return { daysSinceSync, isSyncOutdated };
    };

    const resA = calcStatus(schoolA);
    expect(resA.daysSinceSync).toBe(2);
    expect(resA.isSyncOutdated).toBe(false);

    const resB = calcStatus(schoolB);
    expect(resB.daysSinceSync).toBe(10);
    expect(resB.isSyncOutdated).toBe(true);

    const resC = calcStatus(schoolC);
    expect(resC.daysSinceSync).toBeNull();
    expect(resC.isSyncOutdated).toBe(true);
  });

  it("ordena escolas por menor frequência para evidenciar prioridade de intervenção pedagógica", () => {
    const schools = [
      { id: "1", name: "Escola Alfa", averageAttendance: 88.5, criticalCount: 4 },
      { id: "2", name: "Escola Beta", averageAttendance: 71.2, criticalCount: 22 },
      { id: "3", name: "Escola Gama", averageAttendance: 81.0, criticalCount: 9 },
    ];

    const sortedByPriority = [...schools].sort((a, b) => a.averageAttendance - b.averageAttendance);
    expect(sortedByPriority[0].id).toBe("2"); // Escola Beta (71.2%)
    expect(sortedByPriority[1].id).toBe("3"); // Escola Gama (81.0%)
    expect(sortedByPriority[2].id).toBe("1"); // Escola Alfa (88.5%)
  });

  it("calcula delta comparativo entre a frequência da unidade e a média da rede municipal", () => {
    const networkAverage = 78.4;
    const schoolAttendance = 82.6;

    const diff = Number((schoolAttendance - networkAverage).toFixed(1));
    expect(diff).toBe(4.2);
    expect(diff >= 0).toBe(true);

    const lowSchoolAttendance = 69.1;
    const lowDiff = Number((lowSchoolAttendance - networkAverage).toFixed(1));
    expect(lowDiff).toBe(-9.3);
    expect(lowDiff < 0).toBe(true);
  });
});
