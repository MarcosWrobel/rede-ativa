import { describe, it, expect } from "vitest";
import {
  normalizeStudentName,
  normalizeWhatsAppPhone,
  parseAttendancePercent,
  normalizeSerpStatus,
  buildStudentLookupMaps,
} from "../studentMatcher";
import {
  studentCreateSchema,
  userCreateSchema,
  frequenciaSyncSchema,
  messageSendSchema,
} from "../schemas";

describe("studentMatcher", () => {
  it("normaliza nomes removendo acentos, espaços extras e sufixos de CGM", () => {
    expect(normalizeStudentName("  João   Vítor  Gonçalves - 10293847 ")).toBe(
      "JOAO VITOR GONCALVES"
    );
    expect(normalizeStudentName(null)).toBe("");
  });

  it("normaliza telefones brasileiros para padrão WhatsApp (DDI 55)", () => {
    expect(normalizeWhatsAppPhone("(41) 99876-5432")).toBe("5541998765432");
    expect(normalizeWhatsAppPhone("5541998765432")).toBe("5541998765432");
    // Corrige duplicação acidental de DDI 5555...
    expect(normalizeWhatsAppPhone("555541998765432")).toBe("5541998765432");
    expect(normalizeWhatsAppPhone("")).toBe("");
  });

  it("converte percentuais do Power BI (vírgula, %, número)", () => {
    expect(parseAttendancePercent("74,8%")).toBeCloseTo(74.8);
    expect(parseAttendancePercent("82.5")).toBeCloseTo(82.5);
    expect(parseAttendancePercent(91)).toBe(91);
    expect(parseAttendancePercent("—")).toBeNull();
    expect(parseAttendancePercent(null)).toBeNull();
  });

  it("classifica status do SERP nas 4 categorias oficiais", () => {
    expect(normalizeSerpStatus("Encaminhado ao Conselho Tutelar")).toBe("CONSELHO_TUTELAR");
    expect(normalizeSerpStatus("Aguardando retorno - CT")).toBe("CONSELHO_TUTELAR");
    expect(normalizeSerpStatus("Ministério Público / Promotoria")).toBe("MINISTERIO_PUBLICO");
    expect(normalizeSerpStatus("Ficha Arquivada - Frequência normalizada")).toBe("ARQUIVADO");
    expect(normalizeSerpStatus("Em acompanhamento escolar")).toBe("EM_ACOMPANHAMENTO");
  });

  it("constrói mapas O(1) de busca por CGM e nome normalizado", () => {
    const { cgmMap, nameMap, usedCgms } = buildStudentLookupMaps([
      { id: "s1", cgm: "123456", name: "José Ávila" },
      { id: "s2", cgm: null, name: "Maria Eduarda" },
    ]);

    expect(cgmMap.get("123456")).toBe("s1");
    expect(usedCgms.has("123456")).toBe(true);
    expect(nameMap.get("JOSE AVILA")).toEqual({ id: "s1", hasCgm: true });
    expect(nameMap.get("MARIA EDUARDA")).toEqual({ id: "s2", hasCgm: false });
  });
});

describe("Zod API Schemas (schemas.ts)", () => {
  it("valida criação de estudante rejeitando telefone curto", () => {
    const bad = studentCreateSchema.safeParse({
      name: "Pedro",
      phone: "123",
      classGroupId: "cg-1",
    });
    expect(bad.success).toBe(false);

    const good = studentCreateSchema.safeParse({
      name: "Pedro Henrique",
      phone: "(41) 99988-7766",
      classGroupId: "cg-1",
    });
    expect(good.success).toBe(true);
  });

  it("restringe pré-autorização de equipe ao domínio @escola.pr.gov.br", () => {
    expect(
      userCreateSchema.safeParse({ email: "usuario@gmail.com" }).success
    ).toBe(false);

    const ok = userCreateSchema.safeParse({
      email: "  Pedagoga.Teste@escola.pr.gov.br ",
      role: "PEDAGOGA",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.email).toBe("pedagoga.teste@escola.pr.gov.br");
    }
  });

  it("rejeita payload vazio de sincronização de frequência e valida envio de mensagem", () => {
    expect(frequenciaSyncSchema.safeParse({ alunos: [] }).success).toBe(false);
    expect(
      frequenciaSyncSchema.safeParse({
        alunos: [{ cgm: "998877", nome: "ALUNO TESTE", mediaGeral: "72,5%" }],
      }).success
    ).toBe(true);

    expect(
      messageSendSchema.safeParse({
        studentId: "s1",
        reasonTitle: "Faltas",
        messageContent: "Bom dia!",
      }).success
    ).toBe(true);
  });
});
