import { describe, it, expect } from "vitest";
import {
  verifyParticipantIdentityMatch,
  normalizeNameForMatch,
  verifyEscolaGoogleIdToken,
  isParticipantSigned,
} from "../escolaGoogleVerify";
import { computeMinuteHash, maskEmail } from "../ataCrypto";

describe("escolaGoogleVerify & Assinatura @escola.pr.gov.br", () => {
  it("normaliza nomes removendo acentos e preposições", () => {
    const words = normalizeNameForMatch("João Pedro da Silva Júnior");
    expect(words).toEqual(["joao", "pedro", "silva", "junior"]);
  });

  it("permite validação nominal legítima com conta Google do estudante", () => {
    // Aluno registrado na ata: "Lucas Gabriel de Oliveira"
    // Conta Google: "lucas.oliveira@escola.pr.gov.br", Nome no Workspace: "Lucas G. Oliveira"
    const match = verifyParticipantIdentityMatch({
      participantName: "Lucas Gabriel de Oliveira",
      verifiedEmail: "lucas.oliveira@escola.pr.gov.br",
      verifiedName: "Lucas G. Oliveira",
    });

    expect(match.match).toBe(true);
  });

  it("bloqueia tentativa de colega assinando no lugar de outro aluno", () => {
    // Participante da ata: "Maria Eduarda Santos"
    // Colega tentando assinar: "pedro.souza@escola.pr.gov.br", Nome: "Pedro Henrique Souza"
    const match = verifyParticipantIdentityMatch({
      participantName: "Maria Eduarda Santos",
      verifiedEmail: "pedro.souza@escola.pr.gov.br",
      verifiedName: "Pedro Henrique Souza",
    });

    expect(match.match).toBe(false);
    expect(match.reason).toContain("pertence a outra pessoa");
  });

  it("valida e-mail esperado quando previamente cadastrado", () => {
    const matchSuccess = verifyParticipantIdentityMatch({
      participantName: "Ana Clara",
      expectedEmail: "ana.clara@escola.pr.gov.br",
      verifiedEmail: "ana.clara@escola.pr.gov.br",
    });
    expect(matchSuccess.match).toBe(true);

    const matchFail = verifyParticipantIdentityMatch({
      participantName: "Ana Clara",
      expectedEmail: "ana.clara@escola.pr.gov.br",
      verifiedEmail: "outro.aluno@escola.pr.gov.br",
    });
    expect(matchFail.match).toBe(false);
  });

  it("rejeita tokens inválidos ou vazios", async () => {
    const res = await verifyEscolaGoogleIdToken("");
    expect(res.ok).toBe(false);
  });

  it("detecta corretamente status de participante assinado", () => {
    expect(isParticipantSigned({ verifiedEmail: "aluno@escola.pr.gov.br" })).toBe(true);
    expect(isParticipantSigned({ signatureMode: "ESCOLA_OAUTH" })).toBe(true);
    expect(isParticipantSigned({ signatureData: "data:image/png;base64,123", signatureMode: "SCREEN_CANVAS" })).toBe(true);
    expect(isParticipantSigned({ signatureMode: "PENDING", signatureData: null })).toBe(false);
    expect(isParticipantSigned({ signatureMode: "REFUSED" })).toBe(false);
  });

  it("mascara e-mails institucionais de acordo com a LGPD", () => {
    const masked = maskEmail("marcos.wrobel@escola.pr.gov.br");
    expect(masked).toBe("ma****.wr****@escola.pr.gov.br");

    const simple = maskEmail("ana@escola.pr.gov.br");
    expect(simple).toBe("an*@escola.pr.gov.br");
  });

  it("inclui verifiedEmail no hash canônico SHA-256 e altera o hash se modificado", () => {
    const basePayload = {
      schoolId: "school-1",
      year: 2026,
      ataNumber: 1,
      attendedAt: "2026-10-30T10:00:00.000Z",
      category: "ACOMPANHAMENTO_PEDAGOGICO",
      subject: "Pauta Geral",
      summary: "Texto formal da ata pedagógica com mais de 10 caracteres.",
      authorEmail: "pedagoga@escola.pr.gov.br",
      students: [{ studentId: "s1", name: "Estudante 1", cgm: "123" }],
      participants: [
        {
          role: "ESTUDANTE",
          name: "Estudante 1",
          signatureMode: "ESCOLA_OAUTH",
          verifiedEmail: "estudante1@escola.pr.gov.br",
        },
      ],
      actionItems: [],
    };

    const hash1 = computeMinuteHash(basePayload);
    expect(hash1).toHaveLength(64);

    const tamperedPayload = {
      ...basePayload,
      participants: [
        {
          ...basePayload.participants[0],
          verifiedEmail: "outro.aluno@escola.pr.gov.br",
        },
      ],
    };

    const hash2 = computeMinuteHash(tamperedPayload);
    expect(hash1).not.toBe(hash2);
  });
});
