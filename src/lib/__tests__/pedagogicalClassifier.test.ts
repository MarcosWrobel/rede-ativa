import { describe, it, expect } from "vitest";
import {
  getIsoWeekKey,
  parseEnrollmentDetailMetrics,
  detectAbruptDrop,
  getActiveJustification,
} from "../pedagogicalClassifier";
import {
  studentContactCreateSchema,
  justificationCreateSchema,
  inPersonAttendanceCreateSchema,
} from "../schemas";

describe("pedagogicalClassifier (Fase 3)", () => {
  it("calcula semana ISO consistente no formato YYYY-Www", () => {
    const key = getIsoWeekKey(new Date("2026-10-30T12:00:00-03:00"));
    expect(key).toMatch(/^\d{4}-W\d{2}$/);
    expect(key).toBe("2026-W44");
  });

  it("extrai CGM e percentuais semanais de enrollmentDetail do Power BI", () => {
    const metrics = parseEnrollmentDetailMetrics(
      "CGM: 10099887 | Semana Atual: 40,0% | Semana Anterior: 90,0%"
    );
    expect(metrics.cgm).toBe("10099887");
    expect(metrics.weeklyNum).toBe(40);
    expect(metrics.prevWeeklyNum).toBe(90);
    expect(metrics.variacao).toBe(-50);
  });

  it("detecta queda abrupta recente mesmo em aluno ainda regular no acumulado anual", () => {
    const alert = detectAbruptDrop({
      attendancePercent: 86.5,
      weeklyPercent: 40,
      previousWeeklyPercent: 100,
    });
    expect(alert.isAbruptDrop).toBe(true);
    expect(alert.dropDelta).toBe(-60);

    const stable = detectAbruptDrop({
      attendancePercent: 92,
      weeklyPercent: 95,
      previousWeeklyPercent: 100,
    });
    expect(stable.isAbruptDrop).toBe(false);
  });

  it("detecta queda acumulada entre snapshots históricos", () => {
    const fromSnapshots = detectAbruptDrop({
      attendancePercent: 78,
      snapshots: [
        { attendancePercent: 78 },
        { attendancePercent: 83.5 },
      ],
    });
    expect(fromSnapshots.isAbruptDrop).toBe(true);
    expect(fromSnapshots.dropDelta).toBe(-5.5);
  });

  it("identifica atestado médico vigente considerando datas civis em Brasília", () => {
    const justifications = [
      {
        id: "j-past",
        type: "ATESTADO_MEDICO",
        startDate: "2026-08-01",
        endDate: "2026-08-05",
      },
      {
        id: "j-current",
        type: "ATESTADO_MEDICO",
        startDate: "2026-10-28",
        endDate: "2026-11-02",
        notes: "Repouso pós-cirúrgico",
      },
    ];

    const active = getActiveJustification(
      justifications,
      new Date("2026-10-30T09:50:00-03:00")
    );
    expect(active?.id).toBe("j-current");

    const noneAfter = getActiveJustification(
      justifications,
      new Date("2026-11-10T10:00:00-03:00")
    );
    expect(noneAfter).toBeNull();
  });
});

describe("Fase 3 Zod Schemas", () => {
  it("valida múltiplos contatos, atestados (startDate <= endDate) e atas presenciais", () => {
    expect(
      studentContactCreateSchema.safeParse({
        name: "Maria da Silva",
        kinship: "MAE",
        phone: "41998887766",
        isPrimary: true,
      }).success
    ).toBe(true);

    // Data final anterior à inicial deve falhar
    expect(
      justificationCreateSchema.safeParse({
        type: "ATESTADO_MEDICO",
        startDate: "2026-10-30",
        endDate: "2026-10-25",
      }).success
    ).toBe(false);

    expect(
      justificationCreateSchema.safeParse({
        type: "ATESTADO_MEDICO",
        startDate: "2026-10-28",
        endDate: "2026-10-31",
        notes: "Atestado entregue na secretaria",
      }).success
    ).toBe(true);

    expect(
      inPersonAttendanceCreateSchema.safeParse({
        attendedAt: "2026-10-30",
        guardianPresent: "João da Silva (Pai)",
        subject: "Reunião sobre faltas recorrentes",
        summary: "Família comprometeu-se a acompanhar a frequência diária no turno matutino.",
      }).success
    ).toBe(true);
  });
});
