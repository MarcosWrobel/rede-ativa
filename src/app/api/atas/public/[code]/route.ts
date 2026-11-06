import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  maskName,
  maskDocument,
  maskEmail,
  verifyMinuteIntegrity,
  verifyAddendumChain,
} from "@/lib/ataCrypto";
import { enforceRateLimit, getPublicIpRateLimitKey, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const rlKey = getPublicIpRateLimitKey("pub-ata", req);
    const rlCheck = await enforceRateLimit(rlKey, RATE_LIMIT_POLICIES.PUBLIC_ATA_VERIFY);
    if (!rlCheck.ok) return rlCheck.response;

    const { code } = await params;
    const cleanCode = code.toUpperCase().trim();

    const minute = await prisma.pedagogicalMinute.findUnique({
      where: { verificationCode: cleanCode },
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

    if (!minute) {
      return NextResponse.json({ error: "Documento não encontrado ou código de verificação inválido." }, { status: 404 });
    }

    // Recalcula em tempo real o selo criptográfico SHA-256 da ata e a cadeia linear de adendos (CPC Art. 411)
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
        students: (minute.students || []).map((s: any) => ({
          studentId: s.studentId,
          name: s.studentNameSnapshot,
          className: s.classNameSnapshot,
          cgm: s.cgmSnapshot,
        })),
        participants: (minute.participants || []).map((p: any) => ({
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
        actionItems: (minute.actionItems || []).map((a: any) => ({
          description: a.description,
          responsible: a.responsible,
          dueDate: a.dueDate ? a.dueDate.toISOString() : null,
        })),
      };
      minuteHashValid = verifyMinuteIntegrity(canonicalPayload, minute.contentHash).isValid;
    }

    const addendumChain = verifyAddendumChain(minute.contentHash, minute.addendums || []);
    const isAuthentic = minuteHashValid && addendumChain.isValid;

    // Retorna APENAS dados institucionais e metadados criptográficos mascarados (LGPD-safe)
    // O texto da ata e dados sensíveis de menores NUNCA são expostos na internet pública!
    const maskedResponse = {
      isAuthentic,
      minuteHashValid,
      addendumChainValid: addendumChain.isValid,
      verificationCode: minute.verificationCode,
      school: minute.school,
      ataNumber: minute.ataNumber,
      year: minute.year,
      status: minute.status,
      category: minute.category,
      isExtemporaneous: Boolean(minute.isExtemporaneous),
      govBrVerified: Boolean(minute.govBrVerified),
      govBrProtocol: minute.govBrProtocol || null,
      attendedAt: minute.attendedAt,
      finalizedAt: minute.finalizedAt,
      authorName: maskName(minute.authorName),
      authorRole: minute.authorRole,
      contentHash: minute.contentHash,
      participants: minute.participants.map((p) => ({
        role: p.role,
        maskedName: maskName(p.name),
        maskedDoc: maskDocument(p.documentNumber),
        maskedEmail: p.verifiedEmail ? maskEmail(p.verifiedEmail) : null,
        isEscolaSigned: Boolean(p.verifiedEmail),
        signatureMode: p.signatureMode,
        biometricVerified: Boolean(p.biometricVerified),
        signedAt: p.signedAt,
      })),
      addendumsCount: minute.addendums.length,
      addendums: minute.addendums.map((a, idx) => ({
        index: idx + 1,
        createdAt: a.createdAt,
        author: maskName(a.authorName),
        hash: a.addendumHash,
      })),
      isVoided: minute.status === "VOIDED",
      voidedAt: minute.voidedAt,
      voidReason: minute.voidReason ? "Ata tornada sem efeito pela Direção/Equipe Pedagógica por motivo administrativo." : null,
    };

    return NextResponse.json({ success: true, data: maskedResponse });
  } catch (error: any) {
    console.error("[GET /api/atas/public/[code]] Erro:", error);
    return NextResponse.json({ error: "Erro ao verificar documento" }, { status: 500 });
  }
}
