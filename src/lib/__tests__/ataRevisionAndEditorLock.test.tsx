import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import fs from "fs";
import path from "path";
import { renderToString } from "react-dom/server";

const { mockPrisma, mockHeaders } = vi.hoisted(() => ({
  mockPrisma: {
    pedagogicalMinuteParticipant: {
      findUnique: vi.fn(),
    },
  },
  mockHeaders: vi.fn(async () => new Headers({ "x-forwarded-for": "127.0.0.1" })),
}));

vi.mock("next/headers", () => ({
  headers: mockHeaders,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ success: true, retryAfterSeconds: 60 })),
  hashIp: vi.fn(() => "hashed-ip"),
  RATE_LIMIT_POLICIES: {
    SIGN_TOKEN_ACCESS: { max: 30, windowMs: 60_000 },
  },
}));

import {
  evaluateEffectivePhysicalProof,
  evaluateMinuteRevisionLock,
  getOfficialSummaryRemainingChars,
  hasEffectiveMinuteDraftChanges,
  hasFinalizationContentConflicts,
  hasMinimumOfficialSummary,
} from "@/lib/ataRevision";
import {
  anonymizeOtherMinorsInText,
  buildRestrictedConfidentialMinuteSummary,
  buildStudentMaskingEntries,
  canAccessPhysicalProofHistoryItem,
  filterAccessiblePhysicalProofHistory,
  retainNecessaryPreviousStudentNames,
  stripParticipantSecrets,
} from "@/lib/ataCrypto";
import AtaEditorModal from "@/components/ata/AtaEditorModal";
import PhysicalScanModal from "@/components/ata/PhysicalScanModal";
import SignatureCanvas from "@/components/ata/SignatureCanvas";
import MobileSignClient from "@/app/assinar/ata/[token]/MobileSignClient";
import AssinarAtaPage from "@/app/assinar/ata/[token]/page";
import AdminEscolasClient from "@/app/admin/escolas/AdminEscolasClient";

describe("ataRevision, Trava do Editor e Conformidade Regra 10", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("evaluateMinuteRevisionLock distingue rascunho livre, revisão assinada, legado sem signedRevision e recusa formal", () => {
    const unsignedDraft = evaluateMinuteRevisionLock({
      status: "DRAFT",
      contentRevision: 1,
      participants: [
        { id: "p1", role: "RESPONSAVEL", name: "Mãe", signatureMode: "PENDING", hasSignature: false },
      ],
    });
    expect(unsignedDraft.isLockedBySignature).toBe(false);
    expect(unsignedDraft.hasLegacyUnprovableProof).toBe(false);
    expect(unsignedDraft.canFinalize).toBe(true);

    const refusedOnlyDraft = evaluateMinuteRevisionLock({
      status: "DRAFT",
      contentRevision: 1,
      participants: [
        { id: "p1", role: "RESPONSAVEL", name: "Mãe", signatureMode: "REFUSED", hasSignature: false },
      ],
    });
    expect(refusedOnlyDraft.signedCount).toBe(0);
    expect(refusedOnlyDraft.isLockedBySignature).toBe(false);

    const lockedCurrentDraft = evaluateMinuteRevisionLock({
      status: "DRAFT",
      contentRevision: 2,
      participants: [
        {
          id: "p1",
          role: "RESPONSAVEL",
          name: "Mãe",
          signatureMode: "SCREEN_CANVAS",
          hasSignature: true,
          signedRevision: 2,
        },
        { id: "p2", role: "PROFESSOR", name: "Docente", signatureMode: "PENDING", hasSignature: false },
      ],
    });
    expect(lockedCurrentDraft.validSignedCount).toBe(1);
    expect(lockedCurrentDraft.legacySignedCount).toBe(0);
    expect(lockedCurrentDraft.isLockedBySignature).toBe(true);
    expect(lockedCurrentDraft.hasLegacyUnprovableProof).toBe(false);
    expect(lockedCurrentDraft.canCollectRemainingSignatures).toBe(true);
    expect(lockedCurrentDraft.canFinalize).toBe(true);

    const legacySignedDraft = evaluateMinuteRevisionLock({
      status: "DRAFT",
      contentRevision: 1,
      participants: [
        {
          id: "p1",
          role: "RESPONSAVEL",
          name: "Mãe",
          signatureMode: "MOBILE_QR",
          hasSignature: true,
          signedRevision: null,
        },
      ],
    });
    expect(legacySignedDraft.hasLegacyUnprovableProof).toBe(true);
    expect(legacySignedDraft.isLockedBySignature).toBe(true);
    expect(legacySignedDraft.canCollectRemainingSignatures).toBe(false);
    expect(legacySignedDraft.canFinalize).toBe(false);

    const mismatchedSignedDraft = evaluateMinuteRevisionLock({
      status: "DRAFT",
      contentRevision: 3,
      participants: [
        {
          id: "p1",
          role: "RESPONSAVEL",
          name: "Mãe",
          signatureMode: "MOBILE_QR",
          hasSignature: true,
          signedRevision: 2,
        },
      ],
    });
    expect(mismatchedSignedDraft.hasLegacyUnprovableProof).toBe(true);
    expect(mismatchedSignedDraft.canFinalize).toBe(false);
  });

  it("evaluateMinuteRevisionLock avalia via física / Gov.br ativa, legada e superada em rascunho", () => {
    const activePhysical = evaluateMinuteRevisionLock({
      status: "DRAFT",
      contentRevision: 2,
      hasPhysicalScan: true,
      physicalScanRevision: 2,
      physicalScanSupersededAt: null,
      participants: [],
    });
    expect(activePhysical.hasActivePhysicalProof).toBe(true);
    expect(activePhysical.isPhysicalProofValid).toBe(true);
    expect(activePhysical.hasLegacyUnprovableProof).toBe(false);
    expect(activePhysical.isLockedBySignature).toBe(true);
    expect(activePhysical.canFinalize).toBe(true);

    const legacyPhysical = evaluateMinuteRevisionLock({
      status: "DRAFT",
      contentRevision: 1,
      hasPhysicalScan: true,
      physicalScanRevision: null,
      physicalScanSupersededAt: null,
      participants: [],
    });
    expect(legacyPhysical.isPhysicalProofLegacy).toBe(true);
    expect(legacyPhysical.hasLegacyUnprovableProof).toBe(true);
    expect(legacyPhysical.canFinalize).toBe(false);

    const supersededPhysical = evaluateMinuteRevisionLock({
      status: "DRAFT",
      contentRevision: 2,
      hasPhysicalScan: true,
      physicalScanRevision: 1,
      physicalScanSupersededAt: new Date("2026-11-24T12:00:00Z"),
      participants: [],
    });
    expect(supersededPhysical.hasActivePhysicalProof).toBe(false);
    expect(supersededPhysical.hasLegacyUnprovableProof).toBe(false);
    expect(supersededPhysical.isLockedBySignature).toBe(false);
  });

  it("hasEffectiveMinuteDraftChanges e hasFinalizationContentConflicts detectam no-op vs mutações de conteúdo/vínculos/itens", () => {
    const baseMinute = {
      category: "BUSCA_ATIVA_FALTAS",
      isConfidential: false,
      attendedAt: new Date("2026-11-20T14:00:00.000Z"),
      subject: "Atendimento de Frequência",
      rawNotes: "Notas",
      summary: "Texto completo da ata pedagógica.",
      agreementsSummary: "Comparecer às aulas",
      students: [{ studentId: "stu-1" }],
      participants: [
        {
          id: "p1",
          role: "RESPONSAVEL",
          name: "Maria Silva",
          signatureMode: "PENDING",
        },
      ],
      actionItems: [
        {
          description: "Acompanhar presença semanal",
          responsible: "FAMILIA",
          dueDate: new Date("2026-11-27T00:00:00.000Z"),
          status: "PENDING",
        },
      ],
    };

    expect(
      hasEffectiveMinuteDraftChanges(baseMinute, {
        category: "BUSCA_ATIVA_FALTAS",
        isConfidential: false,
        attendedAt: "2026-11-20T14:00:00.000Z",
        subject: "Atendimento de Frequência",
        rawNotes: "Notas",
        summary: "Texto completo da ata pedagógica.",
        agreementsSummary: "Comparecer às aulas",
        studentIds: ["stu-1"],
        participants: [{ id: "p1", role: "RESPONSAVEL", name: "Maria Silva" }],
        actionItems: [
          { description: "Acompanhar presença semanal", responsible: "FAMILIA", dueDate: "2026-11-27" },
        ],
      })
    ).toBe(false);

    expect(
      hasEffectiveMinuteDraftChanges(baseMinute, {
        summary: "Texto completo da ata pedagógica.   ",
      })
    ).toBe(true);
    expect(
      hasEffectiveMinuteDraftChanges(
        {
          ...baseMinute,
          students: [
            {
              studentId: "stu-1",
              studentNameSnapshot: "Lucas Mendes",
              classNameSnapshot: "6º Ano A",
              cgmSnapshot: "1001",
            },
          ],
        },
        {
          nextStudentSnapshots: [
            {
              studentId: "stu-1",
              studentNameSnapshot: "Lucas Mendes Atualizado",
              classNameSnapshot: "6º Ano B",
              cgmSnapshot: "1001",
            },
          ],
        }
      )
    ).toBe(true);
    expect(hasEffectiveMinuteDraftChanges(baseMinute, { subject: "Assunto Alterado" })).toBe(true);
    expect(hasEffectiveMinuteDraftChanges(baseMinute, { studentIds: ["stu-1", "stu-2"] })).toBe(true);
    expect(
      hasEffectiveMinuteDraftChanges(baseMinute, {
        participants: [{ id: "p1", role: "RESPONSAVEL", name: "Maria Alterada" }],
      })
    ).toBe(true);
    expect(
      hasEffectiveMinuteDraftChanges(baseMinute, {
        actionItems: [{ description: "Outro encaminhamento", responsible: "ESCOLA" }],
      })
    ).toBe(true);

    expect(
      hasFinalizationContentConflicts(
        {
          ...baseMinute,
          participants: [
            {
              id: "p1",
              role: "RESPONSAVEL",
              name: "Maria Silva",
              signatureMode: "SCREEN_CANVAS",
              hasSignature: true,
              signedRevision: 1,
            },
          ],
        },
        {
          signingPin: "8391",
          subject: "Atendimento de Frequência",
          summary: "Texto completo da ata pedagógica.",
        }
      )
    ).toBe(false);

    expect(
      hasFinalizationContentConflicts(
        {
          ...baseMinute,
          participants: [
            {
              id: "p1",
              role: "RESPONSAVEL",
              name: "Maria Silva",
              signatureMode: "SCREEN_CANVAS",
              hasSignature: true,
              signedRevision: 1,
            },
          ],
        },
        {
          signingPin: "8391",
          summary: "Texto modificado após assinatura!",
        }
      )
    ).toBe(true);

    expect(
      hasFinalizationContentConflicts(
        {
          ...baseMinute,
          participants: [
            {
              id: "p1",
              role: "RESPONSAVEL",
              name: "Maria Silva",
              signatureMode: "SCREEN_CANVAS",
              hasSignature: true,
              signedRevision: 1,
            },
          ],
        },
        {
          signingPin: "8391",
          participants: [{ id: "p1", role: "RESPONSAVEL", name: "Maria Silva", clearSignature: true }],
        }
      )
    ).toBe(true);
  });

  it("AtaEditorModal exibe editor travado após 1ª assinatura, botão Reabrir para edição e mantém coleta restante", () => {
    const html = renderToString(
      <AtaEditorModal
        isOpen={true}
        onClose={() => {}}
        onSaved={() => {}}
        availableStudents={[
          { id: "stu-1", name: "Lucas Mendes", classGroupName: "6º Ano A", cgm: "1001" },
        ]}
        existingMinute={{
          id: "min-locked-1",
          status: "DRAFT",
          contentRevision: 1,
          attendedAt: "2026-11-20T14:00:00.000Z",
          category: "BUSCA_ATIVA_FALTAS",
          subject: "Alinhamento de Frequência",
          summary: "Atendimento realizado com a família do estudante.",
          students: [{ studentId: "stu-1", studentNameSnapshot: "Lucas Mendes", classNameSnapshot: "6º Ano A", cgmSnapshot: "1001" }],
          participants: [
            {
              id: "part-signed",
              role: "RESPONSAVEL",
              name: "Mãe do Lucas",
              signatureMode: "SCREEN_CANVAS",
              hasSignature: true,
              signedRevision: 1,
              signedAt: "2026-11-20T14:15:00.000Z",
            },
            {
              id: "part-pending",
              role: "PROFESSOR",
              name: "Docente Carlos",
              expectedEmail: "carlos@escola.pr.gov.br",
              signatureMode: "PENDING",
              hasSignature: false,
            },
          ],
          actionItems: [],
        }}
      />
    );

    const cleanHtml = html.replace(/<!-- -->/g, "");
    expect(cleanHtml).toContain("Reabrir para edição");
    expect(cleanHtml).toContain("Lavrar Ata");
    expect(cleanHtml).toContain("QR Celular");
    expect(cleanHtml).toContain("Revisão 1");
    expect(cleanHtml).toMatch(/disabled/);
    expect(cleanHtml).not.toMatch(/f[eé]\s+p[uú]blica/i);
  });

  it("AtaEditorModal exibe aviso bloqueante em rascunho legado sem vínculo de revisão comprovado", () => {
    const html = renderToString(
      <AtaEditorModal
        isOpen={true}
        onClose={() => {}}
        onSaved={() => {}}
        availableStudents={[
          { id: "stu-1", name: "Lucas Mendes", classGroupName: "6º Ano A", cgm: "1001" },
        ]}
        existingMinute={{
          id: "min-legacy-1",
          status: "DRAFT",
          contentRevision: 1,
          attendedAt: "2026-11-20T14:00:00.000Z",
          category: "BUSCA_ATIVA_FALTAS",
          subject: "Ata Legada",
          summary: "Registro legado com assinatura anterior à revisão.",
          students: [{ studentId: "stu-1", studentNameSnapshot: "Lucas Mendes", classNameSnapshot: "6º Ano A", cgmSnapshot: "1001" }],
          participants: [
            {
              id: "part-legacy",
              role: "RESPONSAVEL",
              name: "Mãe do Lucas",
              signatureMode: "MOBILE_QR",
              hasSignature: true,
              signedRevision: null,
              signedAt: "2026-11-19T14:15:00.000Z",
            },
          ],
          actionItems: [],
        }}
      />
    );

    const cleanHtml = html.replace(/<!-- -->/g, "");
    expect(cleanHtml).toContain("Reabrir para edição");
    expect(cleanHtml).toMatch(/revis[ãa]o anterior|v[ií]nculo de revis[ãa]o|sem comprova[cç][ãa]o de revis[ãa]o/i);
    expect(cleanHtml).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Lavrar Ata/);
  });

  it("MobileSignClient exibe atendimento na revisão vigente e AssinarAtaPage orienta sobre link de revisão superada", async () => {
    const clientHtml = renderToString(
      <MobileSignClient
        token="tok-rev-2"
        participantName="Responsável Ana"
        participantRole="RESPONSAVEL"
        schoolName="Colégio Estadual Modelo"
        subject="Atendimento Escolar"
        summary="Texto conferido na revisão 2."
        minuteRevision={2}
      />
    ).replace(/<!-- -->/g, "");
    expect(clientHtml).toContain("Atendimento Escolar");
    expect(clientHtml).toContain("Responsável Ana");
    expect(clientHtml).toContain("Colégio Estadual Modelo");
    expect(clientHtml).not.toMatch(/f[eé]\s+p[uú]blica/i);

    mockPrisma.pedagogicalMinuteParticipant.findUnique.mockResolvedValueOnce({
      id: "part-old",
      name: "Responsável Ana",
      role: "RESPONSAVEL",
      mobileSignToken: "tok-old-rev1",
      mobileSignExpiresAt: new Date(Date.now() + 600_000),
      mobileSignRevision: 1,
      minute: {
        id: "min-rev2",
        status: "DRAFT",
        contentRevision: 2,
        subject: "Atendimento",
        summary: "Resumo atualizado",
        attendedAt: new Date(),
        school: { name: "Colégio Estadual Modelo" },
        students: [],
        participants: [],
      },
    });

    const pageEl = await AssinarAtaPage({ params: Promise.resolve({ token: "tok-old-rev1" }) });
    const pageHtml = renderToString(pageEl as React.ReactElement);
    expect(pageHtml).toContain("Link Desatualizado ou Substituído");
    expect(pageHtml).toContain("Solicite um novo link atualizado");
  });

  it("Regra 10: telas e rotas da Frente 2 não exibem 'fé pública' nem jargão técnico proibido ao usuário", () => {
    const filesToInspect = [
      "src/components/ata/AtaEditorModal.tsx",
      "src/components/ata/PhysicalScanModal.tsx",
      "src/components/ata/SignatureCanvas.tsx",
      "src/app/assinar/ata/[token]/MobileSignClient.tsx",
      "src/app/assinar/ata/[token]/page.tsx",
      "src/app/api/atas/[id]/reopen/route.ts",
      "src/app/api/atas/[id]/sign-screen/route.ts",
    ];

    const rootDir = path.resolve(__dirname, "../../..");
    for (const rel of filesToInspect) {
      const content = fs.readFileSync(path.join(rootDir, rel), "utf8");
      // Remove comentários internos (/* ... */, // ...) preservando strings e JSX visíveis
      const withoutComments = content
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(withoutComments, `Termo proibido em ${rel}`).not.toMatch(/f[eé]\s+p[uú]blica/i);
    }
  });

  it("AtaEditorModal separa salvamento da conferência: bloqueia coleta até confirmar revisão", () => {
    const html = renderToString(
      <AtaEditorModal
        isOpen={true}
        onClose={() => {}}
        onSaved={() => {}}
        availableStudents={[
          { id: "stu-1", name: "Lucas Mendes", classGroupName: "6º Ano A", cgm: "1001" },
        ]}
        existingMinute={{
          id: "min-review-1",
          status: "DRAFT",
          contentRevision: 2,
          attendedAt: "2026-11-20T14:00:00.000Z",
          category: "BUSCA_ATIVA_FALTAS",
          subject: "Atendimento Persistido",
          summary: "Conteúdo gravado na revisão 2.",
          students: [
            {
              studentId: "stu-1",
              studentNameSnapshot: "Lucas Mendes",
              classNameSnapshot: "6º Ano A",
              cgmSnapshot: "1001",
            },
          ],
          participants: [
            {
              id: "part-pending-1",
              role: "RESPONSAVEL",
              name: "Mãe do Lucas",
              signatureMode: "PENDING",
              hasSignature: false,
            },
          ],
          actionItems: [],
        }}
      />
    ).replace(/<!-- -->/g, "");

    expect(html).toContain("Conferência da Revisão 2");
    expect(html).toContain("Confirmar conferência da Revisão 2");
    expect(html).toContain("Coleta bloqueada até conferir");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Assinar na Tela/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?QR Celular/);
  });

  it("PhysicalScanModal separa histórico superado da prova vigente e evaluateEffectivePhysicalProof preserva legados lavrados", () => {
    const html = renderToString(
      <PhysicalScanModal
        isOpen={true}
        onClose={() => {}}
        onSuccess={() => {}}
        minute={{
          id: "min-hist-1",
          ataNumber: null,
          year: 2026,
          status: "DRAFT",
          contentRevision: 2,
          subject: "Reaberta sem prova ativa",
          hasPhysicalScan: false,
          govBrVerified: false,
          physicalScanSupersededAt: "2026-11-24T12:00:00.000Z",
          physicalProofHistory: [
            {
              id: "hist-1",
              contentRevision: 1,
              scanMimeType: "application/pdf",
              scanSizeBytes: 1024,
              scanSha256: "abc123",
              uploadedAt: "2026-11-23T12:00:00.000Z",
              uploadedBy: "Pedagoga Ana",
              govBrVerified: true,
              govBrProtocol: "ITI-HIST-1",
              supersededAt: "2026-11-24T12:00:00.000Z",
              supersededByRevision: 2,
            },
          ],
        }}
      />
    ).replace(/<!-- -->/g, "");

    expect(html).toContain("Vias físicas anteriores em guarda (histórico)");
    expect(html).toContain("historyId=hist-1");
    expect(html).not.toContain("Via Física Digitalizada Anexa");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Salvar Anexo Oficial/);

    expect(
      evaluateEffectivePhysicalProof({
        status: "FINALIZED",
        contentRevision: 1,
        physicalScanRevision: null,
        physicalScanSupersededAt: null,
        hasPhysicalScan: true,
        govBrVerified: true,
        govBrProtocol: "ITI-LEGACY-2026",
      })
    ).toMatchObject({
      hasValidPhysicalProof: true,
      isLegacyPreVersioningFinalizedProof: true,
      isValidGovBrVerified: true,
      effectiveGovBrProtocol: "ITI-LEGACY-2026",
    });

    expect(
      evaluateEffectivePhysicalProof({
        status: "FINALIZED",
        contentRevision: 2,
        physicalScanRevision: null,
        physicalScanSupersededAt: "2026-11-24T12:00:00.000Z",
        hasPhysicalScan: false,
        govBrVerified: false,
        govBrProtocol: null,
      })
    ).toMatchObject({
      hasValidPhysicalProof: false,
      isValidGovBrVerified: false,
      effectiveGovBrProtocol: null,
    });
  });

  it("Rodada 8 Ponto 4: AtaEditorModal exibe íntegra do assunto, texto longo e combinados sem line-clamp-2; SignatureCanvas exige Confirmar assinatura", () => {
    const longMarker = "TRECHO_FINAL_INTEGRAL_R8_CONFIRMADO";
    const agreementsMarker = "COMBINADOS_PRAZO_INTEGRAL_R8";
    const longSummary =
      "Parágrafo inicial detalhando o acompanhamento pedagógico presencial com a família. ".repeat(14) +
      longMarker;

    const modalHtml = renderToString(
      <AtaEditorModal
        isOpen={true}
        onClose={() => {}}
        onSaved={() => {}}
        availableStudents={[
          { id: "stu-1", name: "Lucas Mendes", classGroupName: "6º Ano A", cgm: "1001" },
        ]}
        existingMinute={{
          id: "min-r8-full-review",
          status: "DRAFT",
          contentRevision: 2,
          attendedAt: "2026-11-24T14:00:00.000Z",
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          subject: "Assunto Integral da Revisão 2 para Conferência Completa",
          summary: longSummary,
          agreementsSummary: `Compromisso familiar firmado na revisão vigente: ${agreementsMarker}`,
          students: [
            {
              studentId: "stu-1",
              studentNameSnapshot: "Lucas Mendes",
              classNameSnapshot: "6º Ano A",
              cgmSnapshot: "1001",
            },
          ],
          participants: [
            {
              id: "part-1",
              role: "RESPONSAVEL",
              name: "Mãe do Lucas",
              signatureMode: "PENDING",
              hasSignature: false,
            },
          ],
          actionItems: [],
        }}
      />
    ).replace(/<!-- -->/g, "");

    expect(modalHtml).toContain("Assunto Integral da Revisão 2 para Conferência Completa");
    expect(modalHtml).toContain(longMarker);
    expect(modalHtml).toContain(agreementsMarker);
    expect(modalHtml).not.toContain("line-clamp-2");

    const canvasHtml = renderToString(
      <SignatureCanvas
        signerName="Mãe do Lucas"
        revisionLabel="Revisão 2"
        onSave={() => {}}
        onCancel={() => {}}
      />
    ).replace(/<!-- -->/g, "");

    expect(canvasHtml).toContain("Revisão 2");
    expect(canvasHtml).toContain("Limpar traço");
    expect(canvasHtml).toContain("Cancelar");
    expect(canvasHtml).toContain("Confirmar assinatura");
    expect(canvasHtml).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Confirmar assinatura/);

    const rootDir = path.resolve(__dirname, "../../..");
    const canvasSource = fs.readFileSync(
      path.join(rootDir, "src/components/ata/SignatureCanvas.tsx"),
      "utf8"
    );
    const finishStrokeMatch = canvasSource.match(/const finishStroke =[\s\S]*?^\s*\};/m);
    expect(finishStrokeMatch).not.toBeNull();
    expect(finishStrokeMatch![0]).not.toContain("onSave(");
  });

  it("Rodada 8 Pontos 1 e 3: sigilo histórico trata legados/desconhecidos de forma restritiva e mascaramento cobre nomes anteriores por studentId", () => {
    const pedSession = {
      user: {
        id: "u-ped",
        email: "pedagoga@escola.local",
        role: "PEDAGOGA",
        active: true,
        schoolId: "sch-1",
        schools: [{ schoolId: "sch-1", role: "PEDAGOGA", active: true }],
      },
    };
    const gestorSession = {
      user: {
        id: "u-gestor",
        email: "direcao@escola.local",
        role: "GESTOR_ESCOLAR",
        active: true,
        schoolId: "sch-1",
        schools: [{ schoolId: "sch-1", role: "GESTOR_ESCOLAR", active: true }],
      },
    };

    const items = [
      {
        id: "h-public-known",
        schoolId: "sch-1",
        originIsConfidential: false,
        originAuthorId: "u-other",
        originAuthorEmail: "outra@escola.local",
        supersededAt: new Date("2026-11-24T10:00:00Z"),
        supersededByRevision: 2,
      },
      {
        id: "h-secret",
        schoolId: "sch-1",
        originIsConfidential: true,
        originAuthorId: "u-other",
        originAuthorEmail: "outra@escola.local",
        supersededAt: new Date("2026-11-24T11:00:00Z"),
        supersededByRevision: 3,
      },
      {
        id: "h-legacy-unknown",
        schoolId: "sch-1",
        originIsConfidential: null,
        originAuthorId: null,
        originAuthorEmail: null,
        supersededAt: new Date("2026-11-23T11:00:00Z"),
        supersededByRevision: null,
      },
    ];

    expect(filterAccessiblePhysicalProofHistory(items, "sch-1", "sch-1", pedSession).map((x) => x.id)).toEqual([
      "h-public-known",
    ]);
    expect(filterAccessiblePhysicalProofHistory(items, "sch-1", "sch-1", gestorSession).map((x) => x.id)).toEqual([
      "h-public-known",
      "h-secret",
      "h-legacy-unknown",
    ]);
    expect(canAccessPhysicalProofHistoryItem(items[2], "sch-1", "sch-2", gestorSession)).toBe(false);

    const retained = retainNecessaryPreviousStudentNames(
      ["Nome Nunca Citado", "João Marcos Silva"],
      "Joao Antigo",
      "Mateus Henrique Costa",
      [
        "Mediação entre Lucas e Joao Marcos Silva",
        "Combinado com Mateus Henrique Costa e Joao.",
        null,
      ]
    );
    expect(retained).toContain("João Marcos Silva");
    expect(retained).not.toContain("Nome Nunca Citado");

    const entries = buildStudentMaskingEntries([
      { studentId: "stu-1", studentNameSnapshot: "Joao Pedro Almeida" },
      {
        studentId: "stu-2",
        studentNameSnapshot: "Mateus Henrique Costa",
        previousNameSnapshots: ["João Marcos Silva"],
      },
    ]);
    const masked = anonymizeOtherMinorsInText(
      "Joao Pedro Almeida relatou conversa com Joao Marcos Silva e Mateus Henrique Costa (Mateus).",
      "stu-1",
      entries
    );
    expect(masked).toContain("Joao Pedro Almeida");
    expect(masked).not.toContain("João Marcos");
    expect(masked).not.toContain("Joao Marcos");
    expect(masked).not.toContain("Mateus");
    expect(masked).toContain("J. M. S. (outro estudante)");
    expect(masked).toContain("M. H. C. (outro estudante)");
  });

  it("Rodada 9: regra centralizada de texto oficial mínimo (>=10 após trim), notas brutas separadas e sanitização estrita", () => {
    expect(hasMinimumOfficialSummary("")).toBe(false);
    expect(hasMinimumOfficialSummary("         ")).toBe(false);
    expect(hasMinimumOfficialSummary("  Curto 9  ")).toBe(false);
    expect(hasMinimumOfficialSummary("   1234567890   ")).toBe(true);
    expect(getOfficialSummaryRemainingChars("")).toBe(10);
    expect(getOfficialSummaryRemainingChars("  abc   ")).toBe(7);
    expect(getOfficialSummaryRemainingChars("Texto completo ok.")).toBe(0);

    const restricted = buildRestrictedConfidentialMinuteSummary({
      id: "min-sec",
      schoolId: "sch-1",
      year: 2026,
      ataNumber: 4,
      status: "FINALIZED",
      attendedAt: "2026-11-20T12:00:00Z",
    });
    expect(restricted).toEqual(
      expect.objectContaining({
        id: "min-sec",
        restrictedConfidential: true,
        isConfidential: true,
        students: [],
        participants: [],
      })
    );
    expect((restricted as any).category).toBeUndefined();
    expect((restricted as any).authorEmail).toBeUndefined();
    expect((restricted as any).authorName).toBeUndefined();

    const cleanFromSign = stripParticipantSecrets({
      id: "min-sign",
      students: [{ studentId: "stu-2", studentNameSnapshot: "Atual", previousNameSnapshots: ["Antigo"] }],
      participants: [{ id: "p1", name: "Resp", mobileSignToken: "tok", hasSignature: true }],
    });
    expect(cleanFromSign.students[0]).not.toHaveProperty("previousNameSnapshots");
    expect((cleanFromSign.participants[0] as any).mobileSignToken).toBeUndefined();

    // Editor com rawNotes preenchido e summary vazio + link ativo -> separa notas brutas, bloqueia coleta e orienta equipe
    const htmlIncomplete = renderToString(
      <AtaEditorModal
        isOpen={true}
        onClose={() => {}}
        onSaved={() => {}}
        availableStudents={[
          { id: "stu-1", name: "Lucas Mendes", classGroupName: "6º Ano A", cgm: "1001" },
        ]}
        existingMinute={{
          id: "min-inc-1",
          status: "DRAFT",
          contentRevision: 1,
          attendedAt: "2026-11-20T14:00:00.000Z",
          category: "BUSCA_ATIVA_FALTAS",
          subject: "Rascunho sem texto oficial",
          rawNotes: "NOTAS_BRUTAS_INTERNAS_EXCLUSIVAS",
          summary: "   ",
          students: [{ studentId: "stu-1", studentNameSnapshot: "Lucas Mendes" }],
          participants: [
            {
              id: "part-inc-1",
              role: "RESPONSAVEL",
              name: "Mãe do Lucas",
              signatureMode: "PENDING",
              hasSignature: false,
              hasActiveSignLink: true,
            },
          ],
          actionItems: [],
        }}
      />
    ).replace(/<!-- -->/g, "");

    const summaryMatch = htmlIncomplete.match(/data-testid="review-persisted-summary"[^>]*>([\s\S]*?)<\/div>/);
    expect(summaryMatch?.[1] || "").toContain("Nenhum texto oficial salvo ainda nesta revisão.");
    expect(summaryMatch?.[1] || "").not.toContain("NOTAS_BRUTAS_INTERNAS_EXCLUSIVAS");
    expect(htmlIncomplete).toContain('data-testid="review-persisted-raw-notes"');
    expect(htmlIncomplete).toContain("NOTAS_BRUTAS_INTERNAS_EXCLUSIVAS");
    expect(htmlIncomplete).toContain('data-testid="incomplete-summary-active-link-warning"');
    expect(htmlIncomplete).toContain("Faltam 10 caractere(s)");
    expect(htmlIncomplete).not.toContain("Confirmar conferência da Revisão 1");
    expect(htmlIncomplete).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Assinar na Tela/);
    expect(htmlIncomplete).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?QR Celular/);

    // AdminEscolasClient mostra situação na escola e disponibilidade no servidor sem aceite obrigatório
    const escolasHtml = renderToString(
      <AdminEscolasClient
        schools={[
          {
            id: "default-leopoldina",
            name: "Unidade Piloto Sintética",
            shortName: "Piloto",
            inep: "41042730",
            network: "ESTADUAL",
            municipality: "Ponta Grossa",
            state: "PR",
            phone: null,
            email: null,
            logoUrl: null,
            aiExternalFormalizeEnabled: true,
            hasSyncToken: false,
            studentsCount: 10,
            classesCount: 1,
            staffCount: 2,
            createdAt: new Date().toISOString(),
          },
          {
            id: "school-b",
            name: "Escola Secundária Local",
            shortName: "Secundária",
            inep: "41099999",
            network: "MUNICIPAL",
            municipality: "Tibagi",
            state: "PR",
            phone: null,
            email: null,
            logoUrl: null,
            aiExternalFormalizeEnabled: false,
            hasSyncToken: false,
            studentsCount: 5,
            classesCount: 1,
            staffCount: 1,
            createdAt: new Date().toISOString(),
          },
        ]}
        activeSchoolId="default-leopoldina"
        aiServerStatus={{
          provider: "google_gemini",
          providerLabel: "Provedor configurado no servidor",
          globalEnabled: true,
          credentialConfigured: true,
          available: true,
          unavailableReason: null,
        }}
      />
    ).replace(/<!-- -->/g, "");

    expect(escolasHtml).toContain('data-testid="ai-server-availability-banner"');
    expect(escolasHtml).toContain("Servidor habilitado");
    expect(escolasHtml).toContain("Atas: IA externa ativa");
    expect(escolasHtml).toContain("Atas: modo local");
    expect(escolasHtml).not.toContain("institutionalAcceptanceConfirmed");
  });
});
