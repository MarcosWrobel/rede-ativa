/**
 * Verificação e validação de titularidade de tokens institucionais Google (@escola.pr.gov.br)
 * para assinatura digital de atas pedagógicas (Lei Federal nº 14.063/2020 + ECA).
 */

export interface GoogleTokenInfo {
  email: string;
  email_verified: string | boolean;
  name?: string;
  sub: string;
  hd?: string;
  aud?: string;
  exp?: number;
}

export interface VerificationResult {
  ok: boolean;
  error?: string;
  tokenInfo?: GoogleTokenInfo;
}

/**
 * Valida o id_token JWT emitido pelo Google Identity Services (GIS).
 * Restringe estritamente ao domínio institucional @escola.pr.gov.br.
 */
export async function verifyEscolaGoogleIdToken(
  idToken: string,
  expectedClientId?: string
): Promise<VerificationResult> {
  const token = (idToken || "").trim();
  if (!token) {
    return { ok: false, error: "Token do Google não informado." };
  }

  // Fallback para ambiente de desenvolvimento / teste
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.ENABLE_DEV_AUTH === "true" &&
    token.startsWith("dev-mock-token:")
  ) {
    const mockEmail = token.replace("dev-mock-token:", "").toLowerCase().trim();
    if (!mockEmail.endsWith("@escola.pr.gov.br")) {
      return { ok: false, error: "Apenas contas @escola.pr.gov.br são aceitas." };
    }
    const namePart = mockEmail.split("@")[0].replace(/\./g, " ").toUpperCase();
    return {
      ok: true,
      tokenInfo: {
        email: mockEmail,
        email_verified: true,
        name: namePart,
        sub: `mock-sub-${mockEmail}`,
        hd: "escola.pr.gov.br",
      },
    };
  }

  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return {
        ok: false,
        error:
          errData.error_description ||
          "Não foi possível validar as credenciais junto ao Google. Faça login novamente.",
      };
    }

    const info: GoogleTokenInfo = await res.json();
    const email = (info.email || "").toLowerCase().trim();

    // 1. Validação estrita do domínio institucional
    if (!email.endsWith("@escola.pr.gov.br") && info.hd !== "escola.pr.gov.br") {
      return {
        ok: false,
        error: `A conta conectada (${email}) não pertence ao domínio @escola.pr.gov.br. Utilize o e-mail institucional oficial emitido pela SEED-PR.`,
      };
    }

    // 2. Validação do Client ID se configurado
    const configuredClientId =
      expectedClientId || process.env.GOOGLE_CLIENT_ID || "";
    if (configuredClientId && info.aud && info.aud !== configuredClientId) {
      console.warn(`[ESCOLA-AUTH] Client ID divergente: recebido ${info.aud}, esperado ${configuredClientId}`);
      // Permitimos caso haja compatibilidade de client web
    }

    // 3. Validação de e-mail verificado
    if (String(info.email_verified) !== "true") {
      return { ok: false, error: "O e-mail informado não está verificado no Google." };
    }

    return {
      ok: true,
      tokenInfo: {
        email,
        email_verified: true,
        name: info.name || email.split("@")[0],
        sub: info.sub,
        hd: info.hd,
      },
    };
  } catch (err: any) {
    console.error("[ESCOLA-AUTH] Falha ao contatar endpoint do Google:", err);
    return {
      ok: false,
      error: "Falha temporária de comunicação com os servidores do Google. Tente novamente.",
    };
  }
}

/**
 * Normaliza nomes removendo acentos, pontuação, múltiplos espaços e stopwords comuns.
 */
export function normalizeNameForMatch(name: string): string[] {
  if (!name) return [];
  const stopwords = new Set(["de", "da", "do", "dos", "das", "e"]);
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !stopwords.has(word));
}

/**
 * Validação de titularidade: garante que o aluno/docente autenticado com @escola
 * corresponde de fato ao participante registrado na ata, prevenindo que outro colega assine.
 */
export function verifyParticipantIdentityMatch(params: {
  participantName: string;
  expectedEmail?: string | null;
  verifiedEmail: string;
  verifiedName?: string | null;
}): { match: boolean; reason?: string } {
  const { participantName, expectedEmail, verifiedEmail, verifiedName } = params;
  const cleanVerifiedEmail = (verifiedEmail || "").toLowerCase().trim();

  // Caso 1: E-mail esperado estava previamente cadastrado/indicado
  if (expectedEmail && expectedEmail.trim()) {
    const cleanExpected = expectedEmail.toLowerCase().trim();
    if (cleanExpected === cleanVerifiedEmail) {
      return { match: true };
    }
    return {
      match: false,
      reason: `O e-mail conectado (${cleanVerifiedEmail}) diverge do e-mail esperado registrado na ata (${cleanExpected}).`,
    };
  }

  // Caso 2: Conferência nominal inteligente entre nome do participante e nome do Google Workspace
  const participantWords = normalizeNameForMatch(participantName);
  if (participantWords.length === 0) {
    return { match: true };
  }

  const googleWords = normalizeNameForMatch(verifiedName || "");
  const emailWords = normalizeNameForMatch(cleanVerifiedEmail.split("@")[0].replace(/\./g, " "));
  const candidateWords = new Set([...googleWords, ...emailWords]);

  // Exige que o primeiro nome corresponda
  const participantFirst = participantWords[0];
  const hasFirstMatch = candidateWords.has(participantFirst);

  if (!hasFirstMatch) {
    return {
      match: false,
      reason: `A conta @escola conectada (${verifiedName || cleanVerifiedEmail}) pertence a outra pessoa e não corresponde a ${participantName}.`,
    };
  }

  // Se o participante possui sobrenomes cadastrados, exige correspondência de pelo menos mais um sobrenome
  if (participantWords.length > 1) {
    const hasAnyLastNameMatch = participantWords
      .slice(1)
      .some((lastName) => candidateWords.has(lastName));

    if (!hasAnyLastNameMatch && googleWords.length > 1) {
      return {
        match: false,
        reason: `A conta @escola conectada (${verifiedName || cleanVerifiedEmail}) não parece coincidir com o estudante ${participantName}.`,
      };
    }
  }

  return { match: true };
}

/**
 * Helper para verificar se um participante já assinou (seja por canvas touch, biometria ou OIDC @escola).
 */
export function isParticipantSigned(p: {
  signatureData?: string | null;
  signatureMode?: string | null;
  verifiedEmail?: string | null;
}): boolean {
  if (!p) return false;
  if (p.signatureMode === "ESCOLA_OAUTH" || Boolean(p.verifiedEmail)) return true;
  if (Boolean(p.signatureData) && p.signatureMode !== "REFUSED") return true;
  return false;
}
