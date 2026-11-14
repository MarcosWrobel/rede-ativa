import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AtaEditorModal from "@/components/ata/AtaEditorModal";
import PrintPageClient from "@/app/atas/[id]/imprimir/PrintPageClient";
import MobileSignClient from "@/app/assinar/ata/[token]/MobileSignClient";
import { computeMinuteHash, verifyMinuteIntegrity } from "@/lib/ataCrypto";
import { formatParticipantRoleLabel, sanitizeKinshipForRole } from "@/lib/participantKinship";
import {
  applyCandidateToParticipantRow,
  applyManualParticipantFieldEdit,
  buildParticipantCandidates,
  ensureParticipantClientKey,
  getCandidatesForRowRole,
  pruneUntouchedSuggestionsForRemovedStudents,
  reconcileSavedParticipantsWithPersistedState,
  resolveRoleChangeWithCandidates,
  resolveSingleAutoFillCandidate,
  ScopedCandidateCache,
  stripClientParticipantMeta,
} from "@/components/ata/editor/participantCandidates";
import type { AtaParticipantDraft, AtaStudentOption } from "@/components/ata/editor/types";

const BASE_STUDENT_1: AtaStudentOption = {
  id: "stu-1",
  name: "João Pedro",
  classGroupName: "6º 1",
  cgm: "1001",
  email: "joao.pedro@escola.pr.gov.br",
  phone: "42999990001",
  guardianName: "Maria Silva",
  contacts: [
    {
      id: "cnt-1",
      studentId: "stu-1",
      name: "Maria Silva",
      kinship: "MAE",
      phone: "42999990001",
      isPrimary: true,
    },
    {
      id: "cnt-2",
      studentId: "stu-1",
      name: "Carlos Recado",
      kinship: "RECADO",
      phone: "42988881111",
      isPrimary: false,
    },
    {
      id: "cnt-3",
      studentId: "stu-1",
      name: "João Pedro",
      kinship: "PROPRIO_ALUNO",
      phone: "42977772222",
      isPrimary: false,
    },
  ],
};

const BASE_STUDENT_HOMONYM: AtaStudentOption = {
  id: "stu-2",
  name: "Ana Clara",
  classGroupName: "7º 2",
  cgm: "2002",
  email: "ana.clara@escola.pr.gov.br",
  phone: "42999990002",
  guardianName: "Maria Silva",
  contacts: [],
};

describe("Domínio Fase 2 — Elegibilidade, homônimos, estados e reconciliação", () => {
  it("exclui PROPRIO_ALUNO, separa RECADO/AVOS/TIOS/IRMAOS como FAMILIAR_CONTATO sem auto-fill e mantém homônimos separados", () => {
    const bundle = buildParticipantCandidates({
      students: [BASE_STUDENT_1, BASE_STUDENT_HOMONYM],
      staff: [{ id: "u-1", name: "Paula Servidora", email: "paula@escola.pr.gov.br" }],
    });

    // 2 estudantes, sem deduplicação de homônimos entre stu-1 e stu-2
    expect(bundle.studentCandidates.map((c) => c.key)).toEqual(["student:stu-1", "student:stu-2"]);
    expect(bundle.studentCandidates[0].payload.documentType).toBe("CGM");
    expect(bundle.studentCandidates[0].payload.documentNumber).toBe("1001");
    expect(bundle.studentCandidates[0].payload.expectedEmail).toBe("joao.pedro@escola.pr.gov.br");

    // PROPRIO_ALUNO (cnt-3) NÃO aparece nos candidatos familiares/responsáveis
    expect(bundle.byKey["contact:cnt-3"]).toBeUndefined();

    // guardian-legacy:stu-1 suprimido por redundância com cnt-1 do mesmo estudante,
    // mas guardian-legacy:stu-2 permanece separado mesmo tendo o mesmo nome "Maria Silva"!
    expect(bundle.byKey["guardian-legacy:stu-1"]).toBeUndefined();
    expect(bundle.byKey["guardian-legacy:stu-2"]).toBeDefined();
    expect(bundle.byKey["contact:cnt-1"]).toBeDefined();
    expect(bundle.byKey["contact:cnt-1"].label).toContain("João Pedro");
    expect(bundle.byKey["guardian-legacy:stu-2"].label).toContain("Ana Clara");

    // Proveniência estrita: guardian nunca herda CGM ou e-mail do estudante nem inventa kinship
    expect(bundle.byKey["guardian-legacy:stu-2"].payload.expectedEmail).toBeNull();
    expect(bundle.byKey["guardian-legacy:stu-2"].payload.documentNumber).toBe("");
    expect(bundle.byKey["guardian-legacy:stu-2"].payload.kinship).toBe("");

    // RECADO mapeia para FAMILIAR_CONTATO (não RESPONSAVEL) e não permite auto-fill
    const recado = bundle.byKey["contact:cnt-2"];
    expect(recado.targetRole).toBe("FAMILIAR_CONTATO");
    expect(recado.autoFillEligible).toBe(false);
    expect(recado.nonLegalContactNotice).toContain("não comprova guarda");
  });

  it("resolveSingleAutoFillCandidate só auto-preenche quando o conjunto completo tiver 1 alternativa elegível (nunca Mãe + Recado)", () => {
    // 1 Mãe + 1 Recado -> conjunto completo = 2 alternativas -> sem auto-fill!
    const mixedBundle = buildParticipantCandidates({
      students: [BASE_STUDENT_1],
      staff: [{ id: "u-1", name: "Paula Servidora", email: "paula@escola.pr.gov.br" }],
    });
    expect(mixedBundle.familyAndGuardianCandidates).toHaveLength(2);
    expect(resolveSingleAutoFillCandidate(mixedBundle.familyAndGuardianCandidates)).toBeNull();

    // Apenas 1 Avó (sem mãe/pai) -> exige seleção explícita -> sem auto-fill!
    const onlyAvosBundle = buildParticipantCandidates({
      students: [
        {
          id: "stu-avos",
          name: "Pedro",
          contacts: [
            {
              id: "c-avo",
              studentId: "stu-avos",
              name: "Dona Rosa",
              kinship: "AVOS",
              phone: "42999998888",
              isPrimary: false,
            },
          ],
        },
      ],
      staff: [],
    });
    expect(onlyAvosBundle.familyAndGuardianCandidates).toHaveLength(1);
    expect(onlyAvosBundle.familyAndGuardianCandidates[0].targetRole).toBe("FAMILIAR_CONTATO");
    expect(resolveSingleAutoFillCandidate(onlyAvosBundle.familyAndGuardianCandidates)).toBeNull();

    // 1 único servidor em staff -> em PROFESSOR nunca auto-preenche nem vira Docente!
    const teacherCandidates = getCandidatesForRowRole(mixedBundle, "PROFESSOR");
    expect(teacherCandidates).toHaveLength(1);
    expect(resolveSingleAutoFillCandidate(teacherCandidates)).toBeNull();
    expect(teacherCandidates[0].payload.kinship).toBe("");

    // 1 único responsável elegível sem contatos concorrentes -> auto-preenche!
    const singleGuardianBundle = buildParticipantCandidates({
      students: [BASE_STUDENT_HOMONYM],
      staff: [],
    });
    const sole = resolveSingleAutoFillCandidate(singleGuardianBundle.familyAndGuardianCandidates);
    expect(sole?.key).toBe("guardian-legacy:stu-2");
  });

  it("preserva EXPLICIT_CANDIDATE, MANUAL_EDIT, PERSISTED (pós-salvamento) e bloqueados ao desmarcar estudante no Passo 1", () => {
    const bundle = buildParticipantCandidates({
      students: [BASE_STUDENT_HOMONYM],
      staff: [],
    });
    const guardianCandidate = bundle.byKey["guardian-legacy:stu-2"];

    const autoRow = applyCandidateToParticipantRow(
      ensureParticipantClientKey({ role: "RESPONSAVEL", name: "", signatureMode: "PENDING" }, 0),
      guardianCandidate,
      "AUTO_SUGGESTED"
    );
    expect(autoRow.originState).toBe("AUTO_SUGGESTED");

    const explicitRow = applyCandidateToParticipantRow(
      ensureParticipantClientKey({ role: "RESPONSAVEL", name: "", signatureMode: "PENDING" }, 1),
      guardianCandidate,
      "EXPLICIT_CANDIDATE"
    );
    expect(explicitRow.originState).toBe("EXPLICIT_CANDIDATE");

    const manualRow = applyManualParticipantFieldEdit(autoRow, { phone: "42912345678" });
    expect(manualRow.originState).toBe("MANUAL_EDIT");

    // Fluxo obrigatório: preencher automaticamente -> salvar -> virar PERSISTED -> desmarcar estudante -> permanece!
    const reconciledAfterSave = reconcileSavedParticipantsWithPersistedState(
      [autoRow],
      [
        {
          id: "mp-saved-1",
          role: "RESPONSAVEL",
          name: "Maria Silva",
          signatureMode: "PENDING",
          phone: "42999990002",
        },
      ]
    );
    expect(reconciledAfterSave[0].id).toBe("mp-saved-1");
    expect(reconciledAfterSave[0].clientKey).toBe(autoRow.clientKey);
    expect(reconciledAfterSave[0].originState).toBe("PERSISTED");

    const afterUncheck = pruneUntouchedSuggestionsForRemovedStudents(
      [autoRow, explicitRow, manualRow, reconciledAfterSave[0]],
      []
    );
    expect(afterUncheck).toHaveLength(3);
    expect(afterUncheck.map((r) => r.originState)).toEqual([
      "EXPLICIT_CANDIDATE",
      "MANUAL_EDIT",
      "PERSISTED",
    ]);

    // stripClientParticipantMeta não vaza campos exclusivos de UI para a API
    const apiBody = stripClientParticipantMeta(explicitRow) as Record<string, unknown>;
    expect(apiBody.originState).toBeUndefined();
    expect(apiBody.clientKey).toBeUndefined();
    expect(apiBody.autoOriginStudentId).toBeUndefined();
  });

  it("limpa CGM, email e contatos do estudante ao trocar para outro papel, sem tocar em participantes assinados/recusados", () => {
    const bundle = buildParticipantCandidates({
      students: [BASE_STUDENT_1],
      staff: [{ id: "u-1", name: "Paula Servidora", email: "paula@escola.pr.gov.br" }],
    });

    const studentRow = applyCandidateToParticipantRow(
      ensureParticipantClientKey({ role: "ESTUDANTE", name: "", signatureMode: "PENDING" }, 0),
      bundle.byKey["student:stu-1"],
      "EXPLICIT_CANDIDATE"
    );
    // Mesmo que tenha edição manual pontual no nome, mudar de ESTUDANTE -> RESPONSAVEL troca de pessoa:
    // nunca mantém CGM, studentId, email do aluno nem telefone do aluno
    const editedStudent = applyManualParticipantFieldEdit(studentRow, { name: "João Editado" });
    const switchedToResp = resolveRoleChangeWithCandidates(editedStudent, "RESPONSAVEL", bundle);
    expect(switchedToResp.role).toBe("RESPONSAVEL");
    expect(switchedToResp.studentId).toBeNull();
    expect(switchedToResp.documentType).toBe("CPF");
    expect(switchedToResp.documentNumber).toBe("");
    expect(switchedToResp.expectedEmail).toBeNull();
    expect(switchedToResp.phone).toBe("");

    // Participante manual criado do zero em RESPONSAVEL -> TESTEMUNHA preserva dados da mesma pessoa
    const manualOriginRow: AtaParticipantDraft = ensureParticipantClientKey(
      {
        role: "RESPONSAVEL",
        name: "Testemunha João",
        phone: "42999993333",
        kinship: "Mãe",
        documentType: "CPF",
        signatureMode: "PENDING",
        originState: "MANUAL_EDIT",
      },
      1
    );
    const switchedSameManual = resolveRoleChangeWithCandidates(manualOriginRow, "TESTEMUNHA", bundle);
    expect(switchedSameManual.name).toBe("Testemunha João");
    expect(switchedSameManual.phone).toBe("42999993333");
    expect(switchedSameManual.kinship).toBe("");

    // Participante bloqueado por assinatura/REFUSED não é alterado em hipótese alguma
    const lockedRefused: AtaParticipantDraft = {
      ...studentRow,
      signatureMode: "REFUSED",
      refusalReason: "Recusou",
    };
    expect(resolveRoleChangeWithCandidates(lockedRefused, "RESPONSAVEL", bundle)).toEqual(
      lockedRefused
    );
  });

  it("respeita ciclo de vida e expiração do ScopedCandidateCache e bloqueia cache sem schoolId", () => {
    const cache = new ScopedCandidateCache<string[]>(1000);
    // Sem schoolId não grava nem retorna
    cache.set(null, "staff", ["A"], 100);
    expect(cache.get(null, "staff", 100)).toBeNull();
    expect(cache.get("", "staff", 100)).toBeNull();

    // Escolas diferentes isoladas + TTL curto
    cache.set("escola-a", "staff", ["Servidora A"], 1000);
    expect(cache.get("escola-b", "staff", 1100)).toBeNull();
    expect(cache.get("escola-a", "staff", 1500)).toEqual(["Servidora A"]);
    expect(cache.get("escola-a", "staff", 2001)).toBeNull();

    cache.set("escola-a", "contacts", ["stu-1"], 3000);
    cache.clearAll();
    expect(cache.get("escola-a", "contacts", 3100)).toBeNull();
  });

  it("renderiza AtaEditorModal em SSR sem erro com activeSchoolId e participante FAMILIAR_CONTATO", () => {
    const html = renderToStaticMarkup(
      React.createElement(AtaEditorModal, {
        isOpen: true,
        onClose: () => {},
        onSaved: () => {},
        activeSchoolId: "escola-a",
        availableStudents: [BASE_STUDENT_1],
        existingMinute: {
          id: "ata-ssr-1",
          year: 2026,
          status: "DRAFT",
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          isConfidential: false,
          attendedAt: new Date("2026-11-12T10:00:00Z").toISOString(),
          subject: "Atendimento SSR",
          rawNotes: "Notas",
          summary: "Resumo",
          students: [{ studentId: "stu-1", studentNameSnapshot: "João Pedro" }],
          participants: [
            {
              id: "mp-fam-1",
              role: "FAMILIAR_CONTATO",
              name: "Carlos Recado",
              kinship: "Contato de recado",
              signatureMode: "PENDING",
            },
          ],
          actionItems: [],
        },
      })
    );

    expect(html).toContain("Lavratura de Ata do Atendimento Pedagógico");
    expect(html).toContain("João Pedro");
  });

  it("apresenta FAMILIAR_CONTATO sem equiparação a Responsável Legal na visualização/impressão/assinatura e mantém hash histórico íntegro", () => {
    expect(formatParticipantRoleLabel("FAMILIAR_CONTATO")).toBe("Familiar / Contato");
    expect(formatParticipantRoleLabel("RESPONSAVEL")).toBe("Responsável Legal");
    expect(sanitizeKinshipForRole("FAMILIAR_CONTATO", "Responsável Legal", { isSigned: false })).toBeNull();
    expect(sanitizeKinshipForRole("FAMILIAR_CONTATO", "Contato de recado", { isSigned: false })).toBe(
      "Contato de recado"
    );

    const printHtml = renderToStaticMarkup(
      React.createElement(PrintPageClient, {
        minute: {
          id: "ata-view-fam-1",
          ataNumber: 12,
          year: 2026,
          status: "FINALIZED",
          category: "ACOMPANHAMENTO_PEDAGOGICO",
          attendedAt: "2026-11-12T10:00:00.000Z",
          finalizedAt: "2026-11-12T11:00:00.000Z",
          subject: "Atendimento",
          summary: "Resumo oficial",
          authorName: "Bruna Pedagoga",
          contentHash: "0".repeat(64),
          verificationCode: "ATA-FAM-12",
          school: { name: "Escola Teste", network: "ESTADUAL", city: "Curitiba", state: "PR" },
          students: [{ studentId: "stu-1", studentNameSnapshot: "João Pedro" }],
          participants: [
            {
              id: "mp-fam-view",
              role: "FAMILIAR_CONTATO",
              name: "Carlos Recado",
              kinship: "Contato de recado",
              signatureMode: "SCREEN_CANVAS",
            },
          ],
          actionItems: [],
          addendums: [],
        },
      })
    );

    expect(printHtml).toContain("Familiar / Contato");
    expect(printHtml).toContain("Contato de recado");
    expect(printHtml).not.toContain("FAMILIAR_CONTATO");
    expect(printHtml).not.toContain("Responsável Legal");

    const signHtml = renderToStaticMarkup(
      React.createElement(MobileSignClient, {
        token: "tok-fam-1",
        participantName: "Carlos Recado",
        participantRole: "FAMILIAR_CONTATO",
        schoolName: "Escola Teste",
        subject: "Pauta de atendimento",
        summary: "Resumo",
        googleClientId: "",
      })
    );

    expect(signHtml).toContain("Familiar / Contato");
    expect(signHtml).not.toContain("FAMILIAR_CONTATO");
    expect(signHtml).not.toContain("Responsável Legal");

    // Ata histórica anterior à Fase 2 (role: RESPONSAVEL) preserva exatamente a validação SHA-256 original
    const historicalPayload = {
      schoolId: "escola-hist",
      year: 2025,
      ataNumber: 7,
      attendedAt: "2025-10-10T14:00:00.000Z",
      category: "BUSCA_ATIVA_FALTAS",
      subject: "Ata histórica 2025",
      summary: "Texto histórico imutável lavrado antes da Fase 2.",
      authorEmail: "pedagoga@escola.pr.gov.br",
      students: [{ studentId: "stu-hist", name: "Aluno Histórico", className: "7º A", cgm: "5001" }],
      participants: [
        {
          role: "RESPONSAVEL",
          name: "Maria Responsável",
          documentNumber: "11122233344",
          signatureMode: "SCREEN_CANVAS",
          signatureData: "data:image/png;base64,hist",
        },
      ],
      actionItems: [],
    };
    const historicalHash = computeMinuteHash(historicalPayload);
    expect(verifyMinuteIntegrity(historicalPayload, historicalHash).isValid).toBe(true);
  });
});
