import { describe, it, expect, vi } from "vitest";
import {
  sanitizeMinutePayload,
  mergeParticipantSignatures,
} from "@/services/ataParticipantService";
import {
  calculateBusinessDaysDiff,
  evaluateExtemporaneousFinalization,
  buildCanonicalMinutePayload,
  executeMinuteFinalization,
} from "@/services/ataFinalizationService";

describe("ataParticipantService - Sanitização e Pareamento de Signatários", () => {
  it("sanitizeMinutePayload diferencia modo CREATE vs UPDATE para participantes apenas com id e normaliza assunto/itens", () => {
    const raw = {
      subject: " ",
      participants: [
        { id: "mp-existing", name: "" },
        { name: "X" },
        { name: "" },
        { name: "  Maria Responsável  " },
      ],
      actionItems: [
        { description: " ", responsible: "FAMILIA", dueDate: "2026-11-20" },
        { description: "  Acompanhar frequência  ", responsible: "ESCOLA", dueDate: "  " },
      ],
    };

    const createResult = sanitizeMinutePayload(raw, "CREATE");
    expect(createResult.subject).toBe("Atendimento Pedagógico");
    expect(createResult.participants).toHaveLength(2);
    expect(createResult.participants.map((p) => p.name)).toEqual([
      "Responsável Presente",
      "Maria Responsável",
    ]);
    expect(createResult.actionItems).toEqual([
      { description: "Acompanhar frequência", responsible: "ESCOLA", dueDate: null },
    ]);

    const updateResult = sanitizeMinutePayload(raw, "UPDATE");
    expect(updateResult.participants).toHaveLength(3);
    expect(updateResult.participants[0]).toMatchObject({
      id: "mp-existing",
      name: "Responsável Presente",
    });
  });

  it("mergeParticipantSignatures preserva token mobile quando clearMobileTokens=false e queima quando true", () => {
    const tokenExpiry = new Date("2026-11-12T12:00:00Z");
    const existing = [
      {
        id: "mp-1",
        role: "RESPONSAVEL",
        name: "Ana Souza",
        signatureMode: "PENDING",
        mobileSignToken: "tok-mobile-abc",
        mobileSignExpiresAt: tokenExpiry,
      },
    ];

    const draftMerged = mergeParticipantSignatures(
      [{ id: "mp-1", name: "Ana Souza", role: "RESPONSAVEL" }],
      existing,
      { clearMobileTokens: false, minuteId: "ata-1" }
    );
    expect(draftMerged[0].minuteId).toBe("ata-1");
    expect(draftMerged[0].mobileSignToken).toBe("tok-mobile-abc");
    expect(draftMerged[0].mobileSignExpiresAt).toEqual(tokenExpiry);

    const finalizedMerged = mergeParticipantSignatures(
      [{ id: "mp-1", name: "Ana Souza", role: "RESPONSAVEL" }],
      existing,
      { clearMobileTokens: true, minuteId: "ata-1" }
    );
    expect(finalizedMerged[0].mobileSignToken).toBeNull();
    expect(finalizedMerged[0].mobileSignExpiresAt).toBeNull();
  });

  it("mergeParticipantSignatures aplica fallback 1-para-1, preserva provas OIDC/WebAuthn e limpa provas em REFUSED/clearSignature", () => {
    const authTime = new Date("2026-11-10T10:00:00Z");
    const existing = [
      {
        id: "mp-oidc",
        role: "RESPONSAVEL",
        name: "João Antigo",
        signatureMode: "ESCOLA_OAUTH",
        signatureData: "data:image/png;base64,ABC",
        signedAt: authTime,
        signerIp: "200.150.10.2",
        signerUserAgent: "Chrome Mobile",
        biometricStrokeData: "[[1,2]]",
        clientTimestampIso: "2026-11-10T10:00:00.000Z",
        biometricVerified: true,
        biometricDeviceType: "platform",
        biometricAuthTime: authTime,
        verifiedEmail: "resp@escola.pr.gov.br",
        verifiedGoogleSub: "sub-999",
        verifiedGoogleName: "João Verificado",
        emailVerifiedAt: authTime,
        mobileSignToken: "tok-burn",
      },
    ];

    // Fallback posicional 1-para-1 mantém id e provas verificadas no banco
    const preserved = mergeParticipantSignatures(
      [{ role: "RESPONSAVEL", name: "João Corrigido" }],
      existing,
      { clearMobileTokens: false, minuteId: "ata-2" }
    );
    expect(preserved[0]).toMatchObject({
      id: "mp-oidc",
      signatureMode: "ESCOLA_OAUTH",
      verifiedEmail: "resp@escola.pr.gov.br",
      verifiedGoogleSub: "sub-999",
      biometricVerified: true,
      biometricStrokeData: "[[1,2]]",
      signerUserAgent: "Chrome Mobile",
      signerIp: "200.150.10.2",
      mobileSignToken: null, // já assinou/verificou email -> token queimado
    });

    // Recusa formal limpa assinaturas e provas biométricas/OIDC
    const refused = mergeParticipantSignatures(
      [
        {
          id: "mp-oidc",
          name: "João Corrigido",
          signatureMode: "REFUSED",
          refusalReason: "Recusou assinar na presença da testemunha",
          witnessName: "Prof. Carla",
        },
      ],
      existing,
      { clearMobileTokens: false, minuteId: "ata-2" }
    );
    expect(refused[0]).toMatchObject({
      signatureMode: "REFUSED",
      signatureData: null,
      signedAt: null,
      biometricVerified: false,
      verifiedEmail: null,
      verifiedGoogleSub: null,
      signerIp: null,
      mobileSignToken: null,
      refusalReason: "Recusou assinar na presença da testemunha",
      witnessName: "Prof. Carla",
    });

    // Limpeza explícita apaga provas anteriores
    const cleared = mergeParticipantSignatures(
      [{ id: "mp-oidc", name: "João Corrigido", clearSignature: true }],
      existing,
      { clearMobileTokens: false, minuteId: "ata-2" }
    );
    expect(cleared[0]).toMatchObject({
      signatureMode: "PENDING",
      signatureData: null,
      signedAt: null,
      biometricVerified: false,
      verifiedEmail: null,
      signerIp: null,
      refusalReason: null,
      witnessName: null,
    });
  });
});

describe("ataFinalizationService - Regras de Lavratura e Fuso America/Sao_Paulo", () => {
  it("calculateBusinessDaysDiff respeita a virada de dia no fuso America/Sao_Paulo vs UTC", () => {
    // 2026-11-06T01:30:00Z equivale a 2026-11-05 22:30 BRT (quinta-feira em Brasília, sexta em UTC)
    const thursdayNightBrt = new Date("2026-11-06T01:30:00Z");
    // 2026-11-13T15:00:00Z equivale a 2026-11-13 12:00 BRT (sexta-feira seguinte) -> 6 dias úteis em BRT
    const nextFridayNoonBrt = new Date("2026-11-13T15:00:00Z");
    expect(calculateBusinessDaysDiff(thursdayNightBrt, nextFridayNoonBrt)).toBe(6);

    // 2026-11-06T12:00:00Z equivale a 2026-11-06 09:00 BRT (sexta-feira) -> 5 dias úteis em BRT
    const fridayMorningBrt = new Date("2026-11-06T12:00:00Z");
    expect(calculateBusinessDaysDiff(fridayMorningBrt, nextFridayNoonBrt)).toBe(5);
  });

  it("evaluateExtemporaneousFinalization exige justificativa acima de 5 dias úteis e aceita opcional dentro do prazo", () => {
    const attendedOld = new Date("2026-10-01T14:00:00Z");
    const finalizedLater = new Date("2026-10-15T14:00:00Z");

    expect(() =>
      evaluateExtemporaneousFinalization(attendedOld, finalizedLater, "")
    ).toThrow(/VALIDATION:.*5 dias úteis/);

    expect(
      evaluateExtemporaneousFinalization(
        attendedOld,
        finalizedLater,
        "Aguardou retorno da família para assinatura"
      )
    ).toEqual({
      isExtemporaneous: true,
      extemporaneousReason: "Aguardou retorno da família para assinatura",
    });

    const recent = new Date("2026-10-13T14:00:00Z");
    expect(evaluateExtemporaneousFinalization(recent, finalizedLater, "")).toEqual({
      isExtemporaneous: false,
      extemporaneousReason: null,
    });
  });

  it("buildCanonicalMinutePayload gera estrutura determinística consistente", () => {
    const payload = buildCanonicalMinutePayload({
      minute: {
        schoolId: "school-1",
        attendedAt: new Date("2026-11-10T14:00:00.000Z"),
        category: "BUSCA_ATIVA",
        isConfidential: false,
        subject: "Atendimento Familiar",
        summary: "Família compareceu e comprometeu-se com a frequência.",
        agreementsSummary: "Retorno imediato",
        students: [
          {
            studentId: "stu-1",
            studentNameSnapshot: "Estudante Teste",
            classNameSnapshot: "6º A",
            cgmSnapshot: "123456",
          },
        ],
        participants: [
          {
            role: "RESPONSAVEL",
            name: "Mãe Teste",
            signatureMode: "SCREEN_CANVAS",
          },
        ],
        actionItems: [
          {
            description: "Comparecer às aulas",
            responsible: "FAMILIA",
            dueDate: new Date("2026-11-17T00:00:00.000Z"),
          },
        ],
      },
      year: 2026,
      ataNumber: 12,
      isExtemporaneous: false,
      extemporaneousReason: null,
      authorEmail: "pedagoga@escola.pr.gov.br",
    });

    expect(payload.ataNumber).toBe(12);
    expect(payload.attendedAt).toBe("2026-11-10T14:00:00.000Z");
    expect(payload.students[0].cgm).toBe("123456");
    expect(payload.actionItems?.[0]?.dueDate).toBe("2026-11-17T00:00:00.000Z");
  });

  it("executeMinuteFinalization retorna idempotente para ata FINALIZED e bloqueia STATUS_INVALID/FORBIDDEN", async () => {
    const finalizedMinute = {
      id: "ata-fin",
      schoolId: "school-1",
      status: "FINALIZED",
      ataNumber: 7,
      students: [],
      participants: [],
      actionItems: [],
      addendums: [],
    };

    const mockPrisma: any = {
      $transaction: vi.fn(async (fn: any) => fn(mockPrisma)),
      pedagogicalMinute: {
        findUnique: vi.fn().mockResolvedValue(finalizedMinute),
      },
    };

    const res = await executeMinuteFinalization({
      prisma: mockPrisma,
      minuteId: "ata-fin",
      rawBody: null,
      author: { email: "ped@escola.pr.gov.br", role: "PEDAGOGA" },
      verifyTenantOwnership: () => true,
    });
    expect(res.alreadyFinalized).toBe(true);
    expect(res.minute).toBe(finalizedMinute);

    mockPrisma.pedagogicalMinute.findUnique.mockResolvedValueOnce({
      ...finalizedMinute,
      status: "VOIDED",
    });
    await expect(
      executeMinuteFinalization({
        prisma: mockPrisma,
        minuteId: "ata-fin",
        rawBody: null,
        author: { email: "ped@escola.pr.gov.br", role: "PEDAGOGA" },
        verifyTenantOwnership: () => true,
      })
    ).rejects.toThrow(/^STATUS_INVALID:/);

    mockPrisma.pedagogicalMinute.findUnique.mockResolvedValueOnce({
      ...finalizedMinute,
      schoolId: "other-school",
      status: "DRAFT",
    });
    await expect(
      executeMinuteFinalization({
        prisma: mockPrisma,
        minuteId: "ata-fin",
        rawBody: null,
        author: { email: "ped@escola.pr.gov.br", role: "PEDAGOGA" },
        verifyTenantOwnership: () => false,
      })
    ).rejects.toThrow(/^FORBIDDEN:/);
  });

  it("executeMinuteFinalization realiza retry em erro P2002 de concorrência e sela hash na sequência", async () => {
    let attempts = 0;
    const draftMinute = {
      id: "ata-draft",
      schoolId: "school-1",
      status: "DRAFT",
      attendedAt: new Date(),
      category: "BUSCA_ATIVA",
      isConfidential: false,
      subject: "Atendimento sobre frequência",
      rawNotes: "Notas",
      summary: "Texto oficial completo da ata pedagógica para lavratura.",
      agreementsSummary: "Combinados",
      authorName: "Pedagoga Silva",
      students: [
        {
          studentId: "stu-1",
          studentNameSnapshot: "Aluno Um",
          classNameSnapshot: "7º B",
          cgmSnapshot: "999",
        },
      ],
      participants: [
        {
          id: "mp-1",
          role: "RESPONSAVEL",
          name: "Responsável Um",
          documentType: "RG",
          documentNumber: "123456",
          signatureMode: "SCREEN_CANVAS",
          signatureData: "data:image/png;base64,XYZ",
          biometricStrokeData: null,
          biometricVerified: false,
          verifiedEmail: null,
          refusalReason: null,
        },
      ],
      actionItems: [],
    };

    const updateMock = vi.fn().mockImplementation(async ({ data }: any) => {
      if (data.status === "FINALIZED") {
        return {
          ...draftMinute,
          ...data,
          addendums: [],
        };
      }
      return draftMinute;
    });

    const txMock: any = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      pedagogicalMinute: {
        findUnique: vi.fn().mockResolvedValue(draftMinute),
        findFirst: vi.fn().mockResolvedValue({ ataNumber: 4 }),
        update: updateMock,
      },
    };

    const mockPrisma: any = {
      $transaction: vi.fn(async (fn: any) => {
        attempts++;
        if (attempts === 1) {
          const err: any = new Error("Unique constraint failed");
          err.code = "P2002";
          throw err;
        }
        return fn(txMock);
      }),
    };

    const result = await executeMinuteFinalization({
      prisma: mockPrisma,
      minuteId: "ata-draft",
      rawBody: null,
      author: {
        userId: "user-1",
        userName: "Pedagoga Silva",
        email: "ped@escola.pr.gov.br",
        role: "PEDAGOGA",
        ip: "127.0.0.1",
      },
      verifyTenantOwnership: () => true,
    });

    expect(attempts).toBe(2);
    expect(result.alreadyFinalized).toBe(false);
    expect(result.minute.ataNumber).toBe(5);
    expect(result.minute.status).toBe("FINALIZED");
    expect(typeof result.minute.contentHash).toBe("string");
    expect(result.minute.contentHash.length).toBe(64);
  });
});
