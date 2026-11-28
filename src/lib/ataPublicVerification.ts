import { prisma } from "@/lib/prisma";
import { withTenantContext } from "@/lib/rlsTenantContext";
import {
  maskName,
  maskDocument,
  maskEmail,
  verifyMinuteIntegrity,
  verifyAddendumChain,
} from "@/lib/ataCrypto";
import { evaluateEffectivePhysicalProof } from "@/lib/ataRevision";

export interface PublicAtaParticipantSummary {
  role: string;
  maskedName: string;
  maskedDoc: string;
  maskedEmail: string | null;
  isEscolaSigned: boolean;
  signatureMode: string | null;
  biometricVerified: boolean;
  signedAt: Date | null;
}

export interface PublicAtaAddendumSummary {
  index: number;
  createdAt: Date;
  author: string;
  hash: string;
}

export interface PublicAtaVerificationData {
  isAuthentic: boolean;
  minuteHashValid: boolean;
  addendumChainValid: boolean;
  verificationCode: string | null;
  school: {
    name: string;
    city: string | null;
    state: string | null;
    nre: string | null;
    inepCode: string | null;
  };
  ataNumber: number | null;
  year: number;
  status: string;
  category: string;
  isExtemporaneous: boolean;
  govBrVerified: boolean;
  govBrProtocol: string | null;
  attendedAt: Date;
  finalizedAt: Date | null;
  authorName: string;
  authorRole: string;
  contentHash: string | null;
  participants: PublicAtaParticipantSummary[];
  addendumsCount: number;
  addendums: PublicAtaAddendumSummary[];
  isVoided: boolean;
  voidedAt: Date | null;
  voidReason: string | null;
}

export function normalizePublicAtaCode(
  rawCode: string,
  options?: { decodeUriComponent?: boolean }
): string {
  if (options?.decodeUriComponent) {
    try {
      return decodeURIComponent(rawCode).toUpperCase().trim();
    } catch {
      return rawCode.toUpperCase().trim();
    }
  }
  return rawCode.toUpperCase().trim();
}

/**
 * Consulta pública somente leitura de Ata por código de verificação.
 *
 * 1. Localiza apenas metadados mínimos (`id`, `schoolId`, `verificationCode`) pelo código.
 *    Sob `FORCE RLS` na Fase B, esta resolução inicial será atendida por função
 *    `SECURITY DEFINER` dedicada restrita a `app_runtime` retornando apenas `{ id, schoolId }`.
 * 2. Abre `withTenantContext(prisma, schoolId)` e revalida correspondência
 *    `id`, `schoolId` e `verificationCode` antes de recalcular hashes e projetar o DTO público.
 */
export async function resolvePublicAtaByCode(
  cleanCode: string
): Promise<PublicAtaVerificationData | null> {
  if (!cleanCode) return null;

  const minuteLocator = await prisma.pedagogicalMinute.findUnique({
    where: { verificationCode: cleanCode },
    select: {
      id: true,
      schoolId: true,
      verificationCode: true,
    },
  });

  if (!minuteLocator?.id || !minuteLocator.schoolId) {
    return null;
  }

  return withTenantContext(prisma, minuteLocator.schoolId, async (tx) => {
    const minute = await tx.pedagogicalMinute.findUnique({
      where: { id: minuteLocator.id },
      include: {
        school: {
          select: { name: true, city: true, state: true, nre: true, inepCode: true },
        },
        students: true,
        participants: true,
        actionItems: true,
        addendums: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (
      !minute ||
      minute.id !== minuteLocator.id ||
      minute.schoolId !== minuteLocator.schoolId ||
      minute.verificationCode !== cleanCode ||
      !minute.school
    ) {
      return null;
    }

    let minuteHashValid = false;
    if (minute.contentHash && minute.ataNumber) {
      const canonicalPayload = {
        schoolId: minute.schoolId,
        year: minute.year,
        ataNumber: minute.ataNumber,
        attendedAt: minute.attendedAt.toISOString(),
        category: minute.category,
        isConfidential: minute.isConfidential,
        isExtemporaneous: minute.isExtemporaneous,
        extemporaneousReason: minute.extemporaneousReason,
        subject: minute.subject,
        summary: minute.summary,
        agreementsSummary: minute.agreementsSummary,
        authorEmail: minute.authorEmail,
        students: (minute.students || []).map((s) => ({
          studentId: s.studentId,
          name: s.studentNameSnapshot,
          className: s.classNameSnapshot,
          cgm: s.cgmSnapshot,
        })),
        participants: (minute.participants || []).map((p) => ({
          role: p.role,
          name: p.name,
          documentType: p.documentType,
          documentNumber: p.documentNumber,
          signatureMode: p.signatureMode,
          signatureData: p.signatureData,
          biometricStrokeData: p.biometricStrokeData,
          biometricVerified: p.biometricVerified,
          verifiedEmail: p.verifiedEmail,
          refusalReason: p.refusalReason,
        })),
        actionItems: (minute.actionItems || []).map((a) => ({
          description: a.description,
          responsible: a.responsible,
          dueDate: a.dueDate ? a.dueDate.toISOString() : null,
        })),
      };
      minuteHashValid = verifyMinuteIntegrity(canonicalPayload, minute.contentHash).isValid;
    }

    const addendumChain = verifyAddendumChain(minute.contentHash, minute.addendums || []);
    const isAuthentic = minuteHashValid && addendumChain.isValid;
    const effectivePhysicalProof = evaluateEffectivePhysicalProof(minute);

    return {
      isAuthentic,
      minuteHashValid,
      addendumChainValid: addendumChain.isValid,
      verificationCode: minute.verificationCode,
      school: {
        name: minute.school.name,
        city: minute.school.city,
        state: minute.school.state,
        nre: minute.school.nre,
        inepCode: minute.school.inepCode,
      },
      ataNumber: minute.ataNumber,
      year: minute.year,
      status: minute.status,
      category: minute.category,
      isExtemporaneous: Boolean(minute.isExtemporaneous),
      govBrVerified: effectivePhysicalProof.isValidGovBrVerified,
      govBrProtocol: effectivePhysicalProof.effectiveGovBrProtocol,
      attendedAt: minute.attendedAt,
      finalizedAt: minute.finalizedAt,
      authorName: maskName(minute.authorName),
      authorRole: minute.authorRole,
      contentHash: minute.contentHash,
      participants: (minute.participants || []).map((p) => ({
        role: p.role,
        maskedName: maskName(p.name),
        maskedDoc: maskDocument(p.documentNumber),
        maskedEmail: p.verifiedEmail ? maskEmail(p.verifiedEmail) : null,
        isEscolaSigned: Boolean(p.verifiedEmail),
        signatureMode: p.signatureMode,
        biometricVerified: Boolean(p.biometricVerified),
        signedAt: p.signedAt,
      })),
      addendumsCount: (minute.addendums || []).length,
      addendums: (minute.addendums || []).map((a, idx) => ({
        index: idx + 1,
        createdAt: a.createdAt,
        author: maskName(a.authorName),
        hash: a.addendumHash,
      })),
      isVoided: minute.status === "VOIDED",
      voidedAt: minute.voidedAt,
      voidReason: minute.voidReason
        ? "Ata tornada sem efeito pela Direção/Equipe Pedagógica por motivo administrativo."
        : null,
    };
  });
}
