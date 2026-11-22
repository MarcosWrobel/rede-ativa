import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";
import SecretariaClient from "@/app/secretaria/SecretariaClient";

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

  it("renderiza SecretariaClient com ranking alinhado à direita em tabular-nums, filtro de defasadas próximo ao alerta e ModalDialog", () => {
    const html = renderToString(
      React.createElement(SecretariaClient, {
        city: "Município Teste",
        isSuperAdmin: false,
        initialSchools: [
          {
            id: "sch-1",
            name: "Escola Municipal Piloto",
            shortName: "Piloto",
            inepCode: "41000001",
            city: "Município Teste",
            state: "PR",
            district: "Sede Urbana",
            studentsCount: 120,
            classesCount: 5,
            staffCount: 12,
            minutesCount: 8,
            criticalCount: 14,
            averageAttendance: 72.4,
            isSyncOutdated: true,
            daysSinceSync: 10,
          },
        ],
        metrics: {
          totalSchools: 1,
          totalStudents: 120,
          totalClasses: 5,
          networkAverageAttendance: 72.4,
          criticalStudentsCount: 14,
          messagesSentThisMonth: 9,
        },
        currentUser: { name: "Gestão Rede", email: "rede@teste.pr.gov.br" },
      })
    );

    const plainHtml = html.replace(/<!-- -->/g, "");
    expect(plainHtml).toContain("Alerta de Defasagem SERE: 1 unidade requer atualização");
    expect(plainHtml).toContain("Ver Apenas Defasadas");
    expect(plainHtml).toContain("text-right tabular-nums");
    expect(plainHtml).toContain("72.4%");
    expect(plainHtml).toContain("<dialog");
    expect(plainHtml).toContain("Identificação Institucional");
    expect(plainHtml).toContain("Canais de Contato");

    const source = fs.readFileSync(
      path.join(process.cwd(), "src/app/secretaria/SecretariaClient.tsx"),
      "utf8"
    );
    expect(source).toContain("ModalDialog");
    expect(source).toContain("preventClose={creating}");
  });
});
