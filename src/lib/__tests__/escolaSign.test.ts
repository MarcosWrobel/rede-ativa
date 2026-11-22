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

  it("[A-03] bloqueia dev-mock-token em VERCEL_ENV=production e VERCEL_ENV=preview mesmo com ENABLE_DEV_AUTH=true", async () => {
    const env = process.env as Record<string, string | undefined>;
    const prevVercelEnv = env.VERCEL_ENV;
    const prevDevAuth = env.ENABLE_DEV_AUTH;
    const prevNodeEnv = env.NODE_ENV;
    try {
      env.ENABLE_DEV_AUTH = "true";
      env.NODE_ENV = "development";

      for (const vercelEnv of ["production", "preview"]) {
        env.VERCEL_ENV = vercelEnv;
        const res = await verifyEscolaGoogleIdToken(
          "dev-mock-token:docente@escola.pr.gov.br"
        );
        expect(res.ok).toBe(false);
        expect(res.error).toBeDefined();
      }
    } finally {
      if (prevVercelEnv === undefined) delete env.VERCEL_ENV;
      else env.VERCEL_ENV = prevVercelEnv;
      if (prevDevAuth === undefined) delete env.ENABLE_DEV_AUTH;
      else env.ENABLE_DEV_AUTH = prevDevAuth;
      if (prevNodeEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = prevNodeEnv;
    }
  });

  it("[A-03] exige correspondência exata de aud quando GOOGLE_CLIENT_ID está definido e falha fechado sem GOOGLE_CLIENT_ID em produção/preview", async () => {
    const env = process.env as Record<string, string | undefined>;
    const prevClientId = env.GOOGLE_CLIENT_ID;
    const prevNextClientId = env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    const prevVercelEnv = env.VERCEL_ENV;
    const prevFetch = globalThis.fetch;

    const futureExp = String(Math.floor(Date.now() / 1000) + 3600);
    let mockedAud: string | undefined = "wrong-client.apps.googleusercontent.com";

    try {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            email: "docente@escola.pr.gov.br",
            email_verified: "true",
            hd: "escola.pr.gov.br",
            name: "Docente Rede PR",
            exp: futureExp,
            ...(mockedAud !== undefined ? { aud: mockedAud } : {}),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )) as typeof fetch;

      env.VERCEL_ENV = "development";
      env.GOOGLE_CLIENT_ID = "expected-client.apps.googleusercontent.com";
      delete env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

      const mismatchRes = await verifyEscolaGoogleIdToken("real-token-aud-mismatch");
      expect(mismatchRes.ok).toBe(false);

      mockedAud = undefined;
      const missingAudRes = await verifyEscolaGoogleIdToken("real-token-aud-missing");
      expect(missingAudRes.ok).toBe(false);

      mockedAud = "expected-client.apps.googleusercontent.com";
      const matchRes = await verifyEscolaGoogleIdToken("real-token-aud-match");
      expect(matchRes.ok).toBe(true);
      expect(matchRes.tokenInfo?.email).toBe("docente@escola.pr.gov.br");

      delete env.GOOGLE_CLIENT_ID;
      env.VERCEL_ENV = "production";
      const missingConfigProdRes = await verifyEscolaGoogleIdToken("real-token-no-client-id");
      expect(missingConfigProdRes.ok).toBe(false);
    } finally {
      globalThis.fetch = prevFetch;
      if (prevClientId === undefined) delete env.GOOGLE_CLIENT_ID;
      else env.GOOGLE_CLIENT_ID = prevClientId;
      if (prevNextClientId === undefined) delete env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
      else env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = prevNextClientId;
      if (prevVercelEnv === undefined) delete env.VERCEL_ENV;
      else env.VERCEL_ENV = prevVercelEnv;
    }
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
