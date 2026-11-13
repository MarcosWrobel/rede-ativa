import { describe, it, expect, vi } from "vitest";
import {
  sanitizeMinutePayload,
  mergeParticipantSignatures,
} from "@/services/ataParticipantService";
import {
  acquireMinuteWriteLock,
  acquireSchoolYearSeqLock,
} from "@/lib/minuteLock";
import {
  sanitizeKinshipForRole,
  hasProtectedParticipantIdentityChanged,
} from "@/lib/participantKinship";
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
    expect(draftMerged[0].hasActiveSignLink).toBe(true);
    expect(draftMerged[0].hasSignature).toBe(false);

    const finalizedMerged = mergeParticipantSignatures(
      [{ id: "mp-1", name: "Ana Souza", role: "RESPONSAVEL" }],
      existing,
      { clearMobileTokens: true, minuteId: "ata-1" }
    );
    expect(finalizedMerged[0].mobileSignToken).toBeNull();
    expect(finalizedMerged[0].mobileSignExpiresAt).toBeNull();
    expect(finalizedMerged[0].hasActiveSignLink).toBe(false);
    expect(finalizedMerged[0].hasSignature).toBe(false);
  });

  it("N3 & N4: hasSignature reflete estritamente signatureData ou verifiedEmail, sem falso-positivo por signedAt/signatureMode isolados", () => {
    const mergedWithoutBlob = mergeParticipantSignatures(
      [
        {
          id: "mp-no-blob",
          name: "Participante Sem Blob",
          signatureMode: "SCREEN_CANVAS",
          signedAt: "2026-11-10T12:00:00Z",
          signatureData: null,
        },
      ],
      [],
      { clearMobileTokens: false, minuteId: "ata-n4" }
    );
    expect(mergedWithoutBlob[0].hasSignature).toBe(false);
    expect(mergedWithoutBlob[0].signedAt).toBeNull();

    const mergedWithBlob = mergeParticipantSignatures(
      [
        {
          id: "mp-with-blob",
          name: "Participante Com Blob",
          signatureMode: "SCREEN_CANVAS",
          signatureData: "data:image/png;base64,iVBORw0KGgo=",
        },
      ],
      [],
      { clearMobileTokens: false, minuteId: "ata-n4" }
    );
    expect(mergedWithBlob[0].hasSignature).toBe(true);
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

    // Fallback posicional 1-para-1 mantém id e provas verificadas no banco quando identidade e vínculo permanecem iguais
    const preserved = mergeParticipantSignatures(
      [{ role: "RESPONSAVEL", name: "João Antigo" }],
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

    // Bloqueia troca de nome/identidade em participante já assinado sem clearSignature
    expect(() =>
      mergeParticipantSignatures(
        [{ role: "RESPONSAVEL", name: "João Corrigido" }],
        existing,
        { clearMobileTokens: false, minuteId: "ata-2" }
      )
    ).toThrow(/^CONFLICT:/);

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
      $executeRaw: vi.fn().mockResolvedValue(1),
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

  it("rejeita CONFLICT em alteração de role, name, studentId, documentType, documentNumber, expectedEmail ou kinship de participante assinado, mas permite phone e diferença de maiúsculas no e-mail", () => {
    const baseExisting = [
      {
        id: "mp-signed",
        role: "RESPONSAVEL",
        studentId: "stu-1",
        name: "Maria Responsável",
        kinship: "Mãe",
        documentType: "RG",
        documentNumber: "12.345.678-9",
        expectedEmail: "maria@escola.pr.gov.br",
        phone: "42999990000",
        signatureMode: "SCREEN_CANVAS",
        signatureData: "data:image/png;base64,ABC",
        hasSignature: true,
        signedAt: new Date("2026-11-10T10:00:00Z"),
      },
    ];

    // Alteração apenas de telefone ou caixa de e-mail mantém provas intactas
    const phoneAndEmailCaseUpdated = mergeParticipantSignatures(
      [
        {
          id: "mp-signed",
          role: "RESPONSAVEL",
          studentId: "stu-1",
          name: "Maria Responsável",
          kinship: "Mãe",
          documentType: "RG",
          documentNumber: "12.345.678-9",
          expectedEmail: "Maria@Escola.pr.gov.br",
          phone: "42988887777",
        },
      ],
      baseExisting,
      { clearMobileTokens: false, minuteId: "ata-1" }
    );
    expect(phoneAndEmailCaseUpdated[0].phone).toBe("42988887777");
    expect(phoneAndEmailCaseUpdated[0].hasSignature).toBe(true);

    const forbiddenChanges: Array<[string, Record<string, any>]> = [
      ["role", { role: "PROFESSOR" }],
      ["name", { name: "Outro Responsável" }],
      ["studentId", { studentId: "stu-2" }],
      ["documentType", { documentType: "CPF" }],
      ["documentNumber", { documentNumber: "123456789" }],
      ["expectedEmail", { expectedEmail: "outra@escola.pr.gov.br" }],
      ["kinship", { kinship: "Tia" }],
    ];

    for (const [label, patch] of forbiddenChanges) {
      expect(
        () =>
          mergeParticipantSignatures(
            [
              {
                id: "mp-signed",
                role: "RESPONSAVEL",
                studentId: "stu-1",
                name: "Maria Responsável",
                kinship: "Mãe",
                documentType: "RG",
                documentNumber: "12.345.678-9",
                expectedEmail: "maria@escola.pr.gov.br",
                ...patch,
              },
            ],
            baseExisting,
            { clearMobileTokens: false, minuteId: "ata-1" }
          ),
        `Esperava CONFLICT para campo ${label}`
      ).toThrow(/^CONFLICT:/);
    }
  });

  it("sanitiza termos parentais em kinship para não-responsáveis apenas quando não assinado e queima token QR ao alterar identidade de não assinado", () => {
    expect(sanitizeKinshipForRole("EQUIPE_ESCOLAR", " mãe / pai ", { isSigned: false })).toBeNull();
    expect(sanitizeKinshipForRole("PROFESSOR", "  Responsável   Legal ", { isSigned: false })).toBeNull();
    expect(sanitizeKinshipForRole("PROFESSOR", "Docente — Filosofia", { isSigned: false })).toBe(
      "Docente — Filosofia"
    );
    // Participante já assinado preserva kinship legado intacto para revisão explícita
    expect(sanitizeKinshipForRole("EQUIPE_ESCOLAR", "Mãe/Pai", { isSigned: true })).toBe("Mãe/Pai");

    expect(
      hasProtectedParticipantIdentityChanged(
        { expectedEmail: "Ana@Escola.pr.gov.br", kinship: "Mãe" },
        { expectedEmail: "ana@escola.pr.gov.br", kinship: "Mãe" }
      )
    ).toBe(false);
    expect(
      hasProtectedParticipantIdentityChanged(
        { expectedEmail: "ana@escola.pr.gov.br", kinship: "Mãe" },
        { expectedEmail: "outra@escola.pr.gov.br", kinship: "Mãe" }
      )
    ).toBe(true);

    const existingUnsignedWithToken = [
      {
        id: "mp-qr",
        role: "RESPONSAVEL",
        name: "Carlos Pai",
        kinship: "Pai",
        mobileSignToken: "tok-qr-active",
        mobileSignExpiresAt: new Date("2026-11-15T12:00:00Z"),
        hasSignature: false,
      },
    ];

    const phoneOnlyChanged = mergeParticipantSignatures(
      [{ id: "mp-qr", role: "RESPONSAVEL", name: "Carlos Pai", kinship: "Pai", phone: "42911112222" }],
      existingUnsignedWithToken,
      { clearMobileTokens: false, minuteId: "ata-qr" }
    );
    expect(phoneOnlyChanged[0].mobileSignToken).toBe("tok-qr-active");
    expect(phoneOnlyChanged[0].hasActiveSignLink).toBe(true);

    const nameChangedBurnsToken = mergeParticipantSignatures(
      [{ id: "mp-qr", role: "RESPONSAVEL", name: "Carlos Outro", kinship: "Pai" }],
      existingUnsignedWithToken,
      { clearMobileTokens: false, minuteId: "ata-qr" }
    );
    expect(nameChangedBurnsToken[0].mobileSignToken).toBeNull();
    expect(nameChangedBurnsToken[0].hasActiveSignLink).toBe(false);
  });

  it("minuteLock exige $executeRaw ativo sem fallback silencioso", async () => {
    await expect(acquireMinuteWriteLock({} as any, "min-1")).rejects.toThrow(
      /Lock transacional indisponível/
    );
    await expect(acquireSchoolYearSeqLock({} as any, "school-1", 2026)).rejects.toThrow(
      /Lock transacional indisponível/
    );
  });

  it("preserva motivo e testemunha ao registrar recusa (REFUSED) e em atualizações subsequentes", () => {
    const firstSave = mergeParticipantSignatures(
      [
        {
          id: "mp-ref",
          role: "RESPONSAVEL",
          name: "Marcos Responsável",
          signatureMode: "REFUSED",
          refusalReason: "Não concorda com a advertência.",
          witnessName: "Prof. Helena",
        },
      ],
      [
        {
          id: "mp-ref",
          role: "RESPONSAVEL",
          name: "Marcos Responsável",
          signatureMode: "SCREEN_CANVAS",
          signatureData: "data:image/png;base64,OLD",
          hasSignature: true,
          signedAt: new Date("2026-11-10T10:00:00Z"),
        },
      ],
      { clearMobileTokens: false, minuteId: "ata-ref" }
    );

    expect(firstSave[0]).toMatchObject({
      signatureMode: "REFUSED",
      signatureData: null,
      hasSignature: false,
      refusalReason: "Não concorda com a advertência.",
      witnessName: "Prof. Helena",
    });

    // Reenvio subsequente mantém motivo e testemunha mesmo se omitidos no patch parcial
    const partialResave = mergeParticipantSignatures(
      [{ id: "mp-ref", role: "RESPONSAVEL", name: "Marcos Responsável", signatureMode: "REFUSED" }],
      [
        {
          id: "mp-ref",
          role: "RESPONSAVEL",
          name: "Marcos Responsável",
          signatureMode: "REFUSED",
          refusalReason: "Não concorda com a advertência.",
          witnessName: "Prof. Helena",
        },
      ],
      { clearMobileTokens: false, minuteId: "ata-ref" }
    );
    expect(partialResave[0].refusalReason).toBe("Não concorda com a advertência.");
    expect(partialResave[0].witnessName).toBe("Prof. Helena");

    // Cancelar recusa (PENDING + clearSignature) limpa motivo e testemunha
    const clearedRefusal = mergeParticipantSignatures(
      [
        {
          id: "mp-ref",
          role: "RESPONSAVEL",
          name: "Marcos Responsável",
          signatureMode: "PENDING",
          clearSignature: true,
        },
      ],
      [
        {
          id: "mp-ref",
          role: "RESPONSAVEL",
          name: "Marcos Responsável",
          signatureMode: "REFUSED",
          refusalReason: "Não concorda com a advertência.",
          witnessName: "Prof. Helena",
        },
      ],
      { clearMobileTokens: false, minuteId: "ata-ref" }
    );
    expect(clearedRefusal[0].signatureMode).toBe("PENDING");
    expect(clearedRefusal[0].refusalReason).toBeNull();
    expect(clearedRefusal[0].witnessName).toBeNull();
  });
});
