import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { resolveAuthorizedPageContext } from "@/lib/pageAuth";
import { withTenantContext } from "@/lib/rlsTenantContext";
import {
  buildRestrictedConfidentialMinuteSummary,
  canAccessConfidentialMinute,
  stripInternalStudentNameAliases,
} from "@/lib/ataCrypto";
import { evaluateEffectivePhysicalProof } from "@/lib/ataRevision";
import LivroAnualClient from "./LivroAnualClient";

interface Props {
  params: Promise<{ ano: string }>;
}

export default async function LivroAnualPage({ params }: Props) {
  const { ano } = await params;
  const year = parseInt(ano, 10);
  if (isNaN(year)) notFound();

  const ctx = await resolveAuthorizedPageContext();
  const session = ctx.session;
  const school = ctx.school;

  const isDefaultSchoolContext =
    school.id === "default-leopoldina" || school.inepCode === "41042730";

  const schoolFilter = isDefaultSchoolContext
    ? {
        OR: [
          { schoolId: school.id },
          ...(school.id !== "default-leopoldina" ? [{ schoolId: "default-leopoldina" }] : []),
        ],
      }
    : { schoolId: school.id };

  let minutes: any[] = [];
  try {
    minutes = await withTenantContext(prisma, school.id, (tx) =>
      tx.pedagogicalMinute.findMany({
        where: {
          ...schoolFilter,
          year,
          status: { in: ["FINALIZED", "VOIDED"] },
        },
        orderBy: { ataNumber: "asc" },
        select: {
        id: true,
        schoolId: true,
        year: true,
        ataNumber: true,
        status: true,
        category: true,
        isConfidential: true,
        attendedAt: true,
        subject: true,
        rawNotes: true,
        summary: true,
        agreementsSummary: true,
        authorId: true,
        authorName: true,
        authorEmail: true,
        authorRole: true,
        finalizedAt: true,
        contentRevision: true,
        physicalScanRevision: true,
        physicalScanSupersededAt: true,
        hasPhysicalScan: true,
        contentHash: true,
        verificationCode: true,
        pdfArchiveSha256: true,
        pdfArchiveGeneratedAt: true,
        physicalScanStorageKey: true,
        physicalScanSha256: true,
        physicalScanUploadedAt: true,
        govBrVerified: true,
        govBrProtocol: true,
        voidedAt: true,
        voidedByName: true,
        voidedByEmail: true,
        voidReason: true,
        isExtemporaneous: true,
        extemporaneousReason: true,
        createdAt: true,
        updatedAt: true,
        students: {
          select: {
            id: true,
            minuteId: true,
            studentId: true,
            studentNameSnapshot: true,
            classNameSnapshot: true,
            cgmSnapshot: true,
          },
        },
        participants: {
          select: {
            id: true,
            minuteId: true,
            role: true,
            studentId: true,
            name: true,
            kinship: true,
            documentType: true,
            documentNumber: true,
            documentVerifiedByStaff: true,
            phone: true,
            signatureMode: true,
            signedAt: true,
            biometricVerified: true,
            verifiedEmail: true,
            verifiedGoogleName: true,
            refusalReason: true,
            witnessName: true,
          },
        },
        addendums: { orderBy: { createdAt: "asc" } },
        actionItems: true,
      },
      })
    );
  } catch (err) {
    console.error("[LivroAnualPage] Erro ao consultar atas do livro anual:", err);
  }

  const safeMinutes = minutes.map((m: any) => {
    if (!canAccessConfidentialMinute(m, session)) {
      return buildRestrictedConfidentialMinuteSummary(m, {
        summary:
          "[REGISTRO SOB SIGILO INSTITUCIONAL — ACESSO INTEGRAL RESTRITO À DIREÇÃO ESCOLAR E AO SERVIDOR AUTOR]",
      });
    }
    const effectiveProof = evaluateEffectivePhysicalProof(m);
    return {
      ...m,
      students: stripInternalStudentNameAliases(m.students),
      hasPhysicalScan:
        effectiveProof.hasValidPhysicalProof && effectiveProof.hasPhysicalArtifact,
      govBrVerified: effectiveProof.isValidGovBrVerified,
      govBrProtocol: effectiveProof.effectiveGovBrProtocol,
      physicalScanStorageKey: effectiveProof.hasValidPhysicalProof
        ? m.physicalScanStorageKey ?? null
        : null,
      physicalScanSha256: effectiveProof.hasValidPhysicalProof
        ? m.physicalScanSha256 ?? null
        : null,
      physicalScanUploadedAt: effectiveProof.hasValidPhysicalProof
        ? m.physicalScanUploadedAt ?? null
        : null,
    };
  });

  return <LivroAnualClient school={school} year={year} minutes={safeMinutes} />;
}
