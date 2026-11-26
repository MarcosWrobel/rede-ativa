import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  auth: vi.fn(async () => null as any),
  getCurrentSchool: vi.fn(async () => ({
    id: "school-piloto-1",
    inepCode: "41042730",
    name: "Colégio Estadual Leopoldina B. Pedroso",
    city: "Ponta Grossa",
    state: "PR",
    nre: "Ponta Grossa",
    network: "ESTADUAL",
    edition: "PILOTO_INTEGRADA" as const,
  })),
  findSchoolBySyncToken: vi.fn(async () => null as any),
  checkRateLimit: vi.fn(async () => ({
    success: true,
    limit: 10,
    remaining: 9,
    resetAt: Date.now() + 60000,
    retryAfterSeconds: 60,
  })),
  resetRateLimit: vi.fn(async () => {}),
  logAudit: vi.fn(async () => {}),
  studentFindMany: vi.fn(async () => [] as any[]),
  studentUpdate: vi.fn(async () => ({})),
  absenceJustificationFindMany: vi.fn(async () => [] as any[]),
  absenceJustificationCreate: vi.fn(async () => ({})),
  absenceJustificationUpdate: vi.fn(async () => ({})),
  absenceJustificationDeleteMany: vi.fn(async () => ({ count: 0 })),
  executeRaw: vi.fn(async () => 1),
  queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
    const sqlText = Array.isArray(strings) ? strings.join(" ") : String(strings);
    if (sqlText.includes("UPDATE \"Student\"")) {
      return [{ id: "st-1" }];
    }
    if (sqlText.includes("\"serpStatus\"")) {
      return [{ studentId: "st-active-2", serpStatus: "EM_ACOMPANHAMENTO" }];
    }
    return [{ studentId: "st-1", attendancePercent: 72 }];
  }),
  transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
}));

vi.mock("@/lib/auth", () => ({
  auth: hoisted.auth,
}));

vi.mock("@/lib/currentSchool", () => ({
  getCurrentSchool: hoisted.getCurrentSchool,
}));

vi.mock("@/lib/syncToken", async () => {
  const actual = await vi.importActual<typeof import("@/lib/syncToken")>("@/lib/syncToken");
  return {
    ...actual,
    findSchoolBySyncToken: hoisted.findSchoolBySyncToken,
  };
});

vi.mock("@/lib/rateLimit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rateLimit")>("@/lib/rateLimit");
  return {
    ...actual,
    checkRateLimit: hoisted.checkRateLimit,
    resetRateLimit: hoisted.resetRateLimit,
  };
});

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return {
    ...actual,
    logAudit: hoisted.logAudit,
  };
});

vi.mock("@/lib/prisma", () => {
  const prismaObj: any = {
    student: {
      findMany: hoisted.studentFindMany,
      update: hoisted.studentUpdate,
    },
    absenceJustification: {
      findMany: hoisted.absenceJustificationFindMany,
      create: hoisted.absenceJustificationCreate,
      update: hoisted.absenceJustificationUpdate,
      deleteMany: hoisted.absenceJustificationDeleteMany,
    },
    $executeRaw: hoisted.executeRaw,
    $queryRaw: hoisted.queryRaw,
  };
  prismaObj.$transaction = vi.fn(async (arg: any) =>
    typeof arg === "function" ? arg(prismaObj) : Promise.all(arg)
  );
  return { prisma: prismaObj };
});

import { parseFrequencyImportInput } from "@/lib/frequencyImportParser";
import { applyPendingCgmUpdatesSafely } from "@/lib/syncCgmGuard";
import {
  normalizeClassGroupDisplayName,
  normalizeClassGroupKey,
} from "@/lib/classGroupName";
import { POST as frequenciaSyncPost } from "@/app/api/frequencia/sync/route";
import { POST as serpSyncPost } from "@/app/api/serp/sync/route";

describe("Sincronização de Frequência Power BI, CSV & JSON", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.auth.mockResolvedValue({
      user: {
        id: "usr-admin-1",
        email: "admin@escola.pr.gov.br",
        name: "Admin",
        role: "SUPERADMIN",
        active: true,
        schoolId: "school-piloto-1",
      },
    });
    hoisted.getCurrentSchool.mockResolvedValue({
      id: "school-piloto-1",
      inepCode: "41042730",
      name: "Colégio Estadual Leopoldina B. Pedroso",
      city: "Ponta Grossa",
      state: "PR",
      nre: "Ponta Grossa",
      network: "ESTADUAL",
      edition: "PILOTO_INTEGRADA",
    });
    hoisted.findSchoolBySyncToken.mockResolvedValue(null);
    hoisted.studentFindMany.mockResolvedValue([]);
    hoisted.studentUpdate.mockResolvedValue({});
    hoisted.executeRaw.mockResolvedValue(1);
    hoisted.transaction.mockImplementation(async (ops: any[]) => Promise.all(ops));
  });

  describe("parseFrequencyImportInput (CSV & JSON)", () => {
    it("interpreta CSV completo de 11 colunas com BOM gerado pela extensão", () => {
      const csv =
        '\uFEFFCGM;Nome;Turma;Media_Geral_Presenca;Presenca_Semana_Atual;Presenca_Semana_Anterior;Amparo_Legal_Vigencia_Max;Deficiencia_Altas_Habilidades;Ganhando_Mundo;SERP;Idade\r\n' +
        '"1010870581";"YAN TAYLON ALVES DA SILVA";"1º Série 2 Tarde - 2636941";"100,00%";"100,00%";"100,00%";"";"";"";"";"16"\r\n' +
        '"1008896093";"YASMIM PADILHA DINIZ";"2º Série 1 Tarde - 2715990";"95,44%";"100,00%";"100,00%";"30/11/2026";"1";"";"Sim";"15"';

      const res = parseFrequencyImportInput(csv);
      expect(res.error).toBeUndefined();
      expect(res.rows).toHaveLength(2);
      expect(res.rows[0]).toMatchObject({
        cgm: "1010870581",
        nome: "YAN TAYLON ALVES DA SILVA",
        turma: "1º Série 2 Tarde - 2636941",
        mediaGeral: "100,00%",
        semanaAtual: "100,00%",
        semanaAnterior: "100,00%",
        idade: "16",
      });
      expect(res.rows[1]).toMatchObject({
        cgm: "1008896093",
        amparoLegalVigencia: "30/11/2026",
        deficienciaAltasHabilidades: "1",
        serpAtivo: "Sim",
        idade: "15",
      });
    });

    it("preserva decimais brasileiros entre aspas quando o CSV usa vírgula como delimitador", () => {
      const csv =
        'CGM,Nome,Turma,Media_Geral_Presenca,Presenca_Semana_Atual,Presenca_Semana_Anterior\n' +
        '"1013901640","YASMIM FERREIRA SANTOS","3º Série 3 Noite","51,77%","33,33%","20,00%"';

      const res = parseFrequencyImportInput(csv);
      expect(res.error).toBeUndefined();
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].mediaGeral).toBe("51,77%");
      expect(res.rows[0].semanaAtual).toBe("33,33%");
      expect(res.rows[0].semanaAnterior).toBe("20,00%");
    });

    it("suporta JSON da extensão e também alias 'frequencia' sugerido no placeholder", () => {
      const jsonDirect = JSON.stringify([
        { cgm: "101", nome: "ESTUDANTE A", frequencia: "85%" },
        { cgm: "102", nome: "ESTUDANTE B", mediaGeral: "72,5%" },
      ]);
      const parsed = parseFrequencyImportInput(jsonDirect);
      expect(parsed.error).toBeUndefined();
      expect(parsed.rows).toHaveLength(2);
      expect(parsed.rows[0].mediaGeral).toBe("85%");
      expect(parsed.rows[1].mediaGeral).toBe("72,5%");

      const wrapped = parseFrequencyImportInput(JSON.stringify({ alunos: [{ cgm: "103", nome: "C", mediaGeral: "90%" }] }));
      expect(wrapped.rows).toHaveLength(1);
      expect(wrapped.rows[0].cgm).toBe("103");
    });

    it("retorna erro legível quando o CSV contém apenas cabeçalho", () => {
      const res = parseFrequencyImportInput("CGM;Nome;Turma;Media_Geral_Presenca");
      expect(res.rows).toEqual([]);
      expect(res.error).toContain("cabeçalho");
    });
  });

  describe("POST /api/frequencia/sync (Blindagem P2002, JSON, CSV & Delta)", () => {
    it("evita erro 500 (P2002) quando o CGM já pertence a estudante inativo ou de outra escola", async () => {
      // 1ª chamada: estudantes ativos da escola (estudante sem CGM)
      // 2ª chamada (populateGlobalTakenCgms): CGM já está vinculado a estudante inativo ou de outra escola
      hoisted.studentFindMany
        .mockResolvedValueOnce([
          {
            id: "st-active-no-cgm",
            cgm: null,
            name: "MARIA CLARA PEREIRA",
            isExchangeStudent: false,
            isSpecialNeeds: false,
            age: 15,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "st-other-school-or-inactive",
            cgm: "1008896093",
          },
        ]);

      const req = new Request("http://localhost:3000/api/frequencia/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alunos: [
            {
              cgm: "1008896093",
              nome: "MARIA CLARA PEREIRA",
              turma: "1º Série",
              mediaGeral: "82,50%",
              semanaAtual: "100,00%",
              semanaAnterior: "75,00%",
              idade: 15,
            },
          ],
        }),
      });

      const res = await frequenciaSyncPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sucesso).toBe(true);
      expect(data.atualizados).toBe(1);
      expect(data.cgmVinculados).toBe(0);
      // Não tentou atualizar Student.cgm para o valor colidente
      expect(hoisted.studentUpdate).not.toHaveBeenCalled();
      // Gravou LowAttendanceRecord ($queryRaw) e AttendanceSnapshot ($executeRaw) normalmente (excluindo set_config)
      const dataSqlCalls = [
        ...hoisted.queryRaw.mock.calls,
        ...hoisted.executeRaw.mock.calls,
      ].filter(([tpl]: any) => !String(tpl?.[0] ?? tpl).includes("set_config"));
      expect(dataSqlCalls).toHaveLength(2);
    });

    it("recupera sem HTTP 500 se uma colisão concorrente P2002 ocorrer durante o update de CGM", async () => {
      const p2002Error: any = new Error("Unique constraint failed on the fields: (`cgm`)");
      p2002Error.code = "P2002";

      const mockPrisma = {
        student: {
          findMany: vi.fn(async () => []),
          update: vi
            .fn()
            .mockRejectedValueOnce(p2002Error) // falha na transação para st-1
            .mockResolvedValueOnce({}) // st-2 ok no fallback (não chega se st-1 falhou no tx)
            .mockRejectedValueOnce(p2002Error) // st-1 no fallback individual
            .mockResolvedValueOnce({ id: "st-2", cgm: "222" }), // st-2 no fallback individual
        },
        $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
      };

      const pending = new Map<string, string>([
        ["st-1", "111"],
        ["st-2", "222"],
      ]);

      const bound = await applyPendingCgmUpdatesSafely(mockPrisma, pending);
      expect(bound).toBe(1);
    });

    it("aceita campo alias 'frequencia' e evita UPDATE em Student quando idade/flags já estão idênticos", async () => {
      hoisted.studentFindMany.mockResolvedValueOnce([
        {
          id: "st-1",
          cgm: "1010870581",
          name: "YAN TAYLON",
          isExchangeStudent: false,
          isSpecialNeeds: false,
          age: 16,
        },
      ]);

      const req = new Request("http://localhost:3000/api/frequencia/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alunos: [
            {
              cgm: "1010870581",
              nome: "YAN TAYLON",
              frequencia: "100%",
              idade: 16,
            },
          ],
        }),
      });

      const res = await frequenciaSyncPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.atualizados).toBe(1);
      expect(data.estudantesEnriquecidos).toBe(0);
      // Apenas 2 chamadas de dados (LowAttendanceRecord + AttendanceSnapshot), sem UPDATE Student redundante
      const dataSqlCalls = [
        ...hoisted.queryRaw.mock.calls,
        ...hoisted.executeRaw.mock.calls,
      ].filter(([tpl]: any) => !String(tpl?.[0] ?? tpl).includes("set_config"));
      expect(dataSqlCalls).toHaveLength(2);
    });

    it("executa atualização em lote via SQL quando há alteração real de idade/PCD/Ganhando Mundo", async () => {
      hoisted.studentFindMany.mockResolvedValueOnce([
        {
          id: "st-1",
          cgm: "1010870581",
          name: "YAN TAYLON",
          isExchangeStudent: false,
          isSpecialNeeds: false,
          age: null,
        },
      ]);

      const req = new Request("http://localhost:3000/api/frequencia/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alunos: [
            {
              cgm: "1010870581",
              nome: "YAN TAYLON",
              mediaGeral: "95,44%",
              idade: "16",
              deficienciaAltasHabilidades: "1",
            },
          ],
        }),
      });

      const res = await frequenciaSyncPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.estudantesEnriquecidos).toBe(1);
      // LowAttendanceRecord + AttendanceSnapshot + bulk UPDATE Student (excluindo set_config de withTenantContext)
      const dataSqlCalls = [
        ...hoisted.queryRaw.mock.calls,
        ...hoisted.executeRaw.mock.calls,
      ].filter(([tpl]: any) => !String(tpl?.[0] ?? tpl).includes("set_config"));
      expect(dataSqlCalls).toHaveLength(3);
    });

    it("permite reverter badges isExchangeStudent/isSpecialNeeds quando payload envia false explícito e preserva quando omitido", async () => {
      hoisted.studentFindMany.mockResolvedValueOnce([
        {
          id: "st-reset-1",
          cgm: "1010870581",
          name: "ALUNO CORRIGIDO",
          isExchangeStudent: true,
          isSpecialNeeds: true,
          age: 16,
        },
        {
          id: "st-keep-2",
          cgm: "1010870582",
          name: "ALUNO PRESERVADO",
          isExchangeStudent: true,
          isSpecialNeeds: true,
          age: 16,
        },
      ]);

      const req = new Request("http://localhost:3000/api/frequencia/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alunos: [
            {
              cgm: "1010870581",
              nome: "ALUNO CORRIGIDO",
              mediaGeral: "95,00%",
              ganhandoMundo: false,
              deficienciaAltasHabilidades: false,
              idade: 16,
            },
            {
              cgm: "1010870582",
              nome: "ALUNO PRESERVADO",
              mediaGeral: "95,00%",
              idade: 16,
            },
          ],
        }),
      });

      const res = await frequenciaSyncPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.estudantesEnriquecidos).toBe(1);
      // st-reset-1 teve flags revertidas para false, então não entra em deleteMany de amparos
      expect(hoisted.absenceJustificationDeleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            studentId: { in: ["st-keep-2"] },
          }),
        })
      );
    });

    it("normaliza nomes e chaves de turmas para evitar duplicidades (° vs º, acentos e espaços)", () => {
      expect(normalizeClassGroupDisplayName("1°   2 ")).toBe("1º 2");
      expect(normalizeClassGroupKey("1° 2")).toBe(normalizeClassGroupKey("1º 2"));
      expect(normalizeClassGroupKey("1º Serie")).toBe(normalizeClassGroupKey("1º Série"));
      expect(normalizeClassGroupKey("1ª Série")).toBe(normalizeClassGroupKey("1º Série"));
      expect(normalizeClassGroupKey("1º ADM")).not.toBe(normalizeClassGroupKey("1º 2"));
    });

    it("retorna 400 (não 500) para JSON malformado", async () => {
      const req = new Request("http://localhost:3000/api/frequencia/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{json-invalido",
      });

      const res = await frequenciaSyncPost(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Payload JSON");
    });

    it("bloqueia com 403 para escolas na edição INSTITUCIONAL_ESSENCIAL", async () => {
      hoisted.getCurrentSchool.mockResolvedValueOnce({
        id: "school-essencial-1",
        inepCode: "41999999",
        name: "Escola Municipal Teste",
        city: "Tibagi",
        state: "PR",
        nre: "SEMEC",
        network: "MUNICIPAL",
        edition: "INSTITUCIONAL_ESSENCIAL",
      } as any);

      const req = new Request("http://localhost:3000/api/frequencia/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alunos: [{ cgm: "123", nome: "ALUNO", mediaGeral: "80%" }],
        }),
      });

      const res = await frequenciaSyncPost(req);
      expect(res.status).toBe(403);
    });

    it("não vaza detalhes internos de banco no JSON 500 quando ocorre falha inesperada", async () => {
      hoisted.studentFindMany.mockRejectedValueOnce(new Error("postgres://secret-dsn-leak"));

      const req = new Request("http://localhost:3000/api/frequencia/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alunos: [{ cgm: "123", nome: "ALUNO", mediaGeral: "80%" }],
        }),
      });

      const res = await frequenciaSyncPost(req);
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({ error: "Erro interno durante a sincronização de frequência." });
      expect(JSON.stringify(data)).not.toContain("secret-dsn-leak");
    });
  });

  describe("POST /api/serp/sync (Blindagem P2002 de CGM)", () => {
    it("impede colisão P2002 ao sincronizar fichas SERP para aluno sem CGM cujo CGM está em uso globalmente", async () => {
      hoisted.studentFindMany
        .mockResolvedValueOnce([
          {
            id: "st-active-2",
            cgm: null,
            name: "JOAO PEDRO SOUZA",
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "st-other-inactive",
            cgm: "1005627024",
          },
        ]);

      const req = new Request("http://localhost:3000/api/serp/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fichas: [
            {
              cgm: "1005627024",
              nome: "JOAO PEDRO SOUZA",
              numeroFicha: "99881",
              status: "EM_ACOMPANHAMENTO",
            },
          ],
        }),
      });

      const res = await serpSyncPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sucesso).toBe(true);
      expect(data.atualizados).toBe(1);
      expect(data.cgmVinculados).toBe(0);
      expect(hoisted.studentUpdate).not.toHaveBeenCalled();
    });

    it("reflete em atualizados, emRiscoCount, estudantesEnriquecidos e conselhoTutelarCount apenas linhas retornadas pelo RETURNING quando filtro escolar descarta parte do lote", async () => {
      hoisted.studentFindMany.mockResolvedValueOnce([
        { id: "st-keep", cgm: "111", name: "ALUNO MANTIDO", age: 14 },
        { id: "st-drop", cgm: "222", name: "ALUNO DESCARTADO", age: 14 },
      ]);

      hoisted.queryRaw
        .mockResolvedValueOnce([{ studentId: "st-keep", attendancePercent: 85 }] as any)
        .mockResolvedValueOnce([{ id: "st-keep" }] as any);

      const freqReq = new Request("http://localhost:3000/api/frequencia/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alunos: [
            { cgm: "111", nome: "ALUNO MANTIDO", mediaGeral: "85%", idade: 15 },
            { cgm: "222", nome: "ALUNO DESCARTADO", mediaGeral: "45%", idade: 17 },
          ],
        }),
      });
      const freqRes = await frequenciaSyncPost(freqReq);
      expect(freqRes.status).toBe(200);
      const freqJson = await freqRes.json();
      expect(freqJson).toMatchObject({
        sucesso: true,
        totalRecebido: 2,
        atualizados: 1,
        emRiscoCount: 0,
        estudantesEnriquecidos: 1,
      });
      expect(hoisted.logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "UPDATE_LOW_ATTENDANCE",
          details: expect.objectContaining({
            atualizados: 1,
            emRiscoCount: 0,
            estudantesEnriquecidos: 1,
          }),
        })
      );

      hoisted.logAudit.mockClear();
      hoisted.studentFindMany.mockResolvedValueOnce([
        { id: "st-keep", cgm: "111", name: "ALUNO MANTIDO" },
        { id: "st-drop", cgm: "222", name: "ALUNO DESCARTADO" },
      ]);
      hoisted.queryRaw.mockResolvedValueOnce([
        { studentId: "st-keep", serpStatus: "EM_ACOMPANHAMENTO" },
      ] as any);

      const serpReq = new Request("http://localhost:3000/api/serp/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fichas: [
            { cgm: "111", nome: "ALUNO MANTIDO", status: "EM_ACOMPANHAMENTO" },
            { cgm: "222", nome: "ALUNO DESCARTADO", status: "CONSELHO_TUTELAR" },
          ],
        }),
      });
      const serpRes = await serpSyncPost(serpReq);
      expect(serpRes.status).toBe(200);
      const serpJson = await serpRes.json();
      expect(serpJson).toMatchObject({
        sucesso: true,
        totalRecebido: 2,
        atualizados: 1,
        conselhoTutelarCount: 0,
      });
      expect(hoisted.logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "UPDATE_LOW_ATTENDANCE",
          entityType: "SerpSync",
          details: expect.objectContaining({
            atualizados: 1,
            conselhoTutelarCount: 0,
          }),
        })
      );
    });
  });
});
