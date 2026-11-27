import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { withTenantContext } from "./rlsTenantContext";
import { withNeonWakeRetry } from "./neonWakeRetry";
import { evaluateEffectivePhysicalProof } from "./ataRevision";

/**
 * Executa consultas das tabelas pedagógicas da Fase 3 com retry de wake-up do Neon
 * e fallback resiliente caso uma tabela opcional ainda não exista.
 */
export async function safeQueryList<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await withNeonWakeRetry(fn);
  } catch (err: any) {
    if (err?.code === "P2021" || String(err?.message || "").includes("does not exist")) {
      return [];
    }
    throw err;
  }
}

export async function loadStudent360Bundle(studentId: string, schoolId?: string) {
  const runBundleQueries = async (
    dbClient: PrismaClient | Prisma.TransactionClient,
    scopedSchoolId?: string
  ) => {
    const studentInclude = {
      classGroup: true,
      lowAttendanceRecord: true,
      messageLogs: {
        ...(scopedSchoolId
          ? { where: { OR: [{ schoolId: null }, { schoolId: scopedSchoolId }] } }
          : {}),
        orderBy: { sentAt: "desc" as const },
      },
    };
    const student =
      scopedSchoolId && typeof dbClient.student?.findFirst === "function"
        ? await dbClient.student.findFirst({
            where: { id: studentId, schoolId: scopedSchoolId },
            include: studentInclude,
          })
        : await dbClient.student.findUnique({
            where: { id: studentId },
            include: studentInclude,
          });
    if (!student) return null;
    if (scopedSchoolId && student.schoolId && student.schoolId !== scopedSchoolId) {
      return null;
    }

    const contacts = await safeQueryList(() =>
      dbClient.studentContact.findMany({
        where: { studentId },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      })
    );
    const justifications = await safeQueryList(() =>
      dbClient.absenceJustification.findMany({
        where: { studentId },
        orderBy: { endDate: "desc" },
      })
    );
    const attendances = await safeQueryList(() =>
      dbClient.inPersonAttendance.findMany({
        where: { studentId },
        orderBy: { attendedAt: "desc" },
      })
    );
    const snapshots = await safeQueryList(() =>
      dbClient.attendanceSnapshot.findMany({
        where: { studentId },
        orderBy: { recordedAt: "desc" },
        take: 24,
      })
    );
    const minutes = await safeQueryList(() =>
      dbClient.pedagogicalMinute.findMany({
        where: {
          ...(scopedSchoolId ? { schoolId: scopedSchoolId } : {}),
          students: { some: { studentId } },
        },
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
          contentHash: true,
          verificationCode: true,
          pdfArchiveSha256: true,
          pdfArchiveGeneratedAt: true,
          physicalScanStorageKey: true,
          physicalScanProvider: true,
          physicalScanMimeType: true,
          physicalScanSizeBytes: true,
          physicalScanSha256: true,
          physicalScanUploadedAt: true,
          physicalScanUploadedBy: true,
          hasPhysicalScan: true,
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
              previousNameSnapshots: true,
              student: { select: { name: true } },
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
              biometricDeviceType: true,
              biometricAuthTime: true,
              expectedEmail: true,
              verifiedEmail: true,
              verifiedGoogleName: true,
              emailVerifiedAt: true,
              refusalReason: true,
              witnessName: true,
              hasSignature: true,
              hasActiveSignLink: true,
              createdAt: true,
            },
          },
          addendums: { orderBy: { createdAt: "asc" } },
          actionItems: { orderBy: { createdAt: "asc" } },
        },
        orderBy: [{ ataNumber: "desc" }, { attendedAt: "desc" }],
      })
    );
    const councilCards = await safeQueryList<any>(() =>
      typeof dbClient.studentCouncilCard?.findMany === "function"
        ? dbClient.studentCouncilCard.findMany({
            where: {
              studentId,
              ...(scopedSchoolId ? { schoolId: scopedSchoolId } : {}),
            },
            include: {
              board: {
                select: {
                  id: true,
                  year: true,
                  schoolId: true,
                  classGroup: {
                    select: { id: true, name: true, segment: true, shift: true },
                  },
                  subjects: {
                    where: { active: true },
                    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
                    select: { id: true, name: true, teacherName: true, displayOrder: true },
                  },
                },
              },
              subjectEntries: {
                orderBy: [{ trimester: "asc" }],
                select: {
                  id: true,
                  subjectId: true,
                  trimester: true,
                  descriptorCodes: true,
                  grade: true,
                },
              },
            },
            orderBy: { board: { year: "desc" } },
          })
        : Promise.resolve([])
    );

    // Garante que atas vinculadas no prontuário/dossiê pertençam estritamente ao mesmo tenant do estudante
  const scopedMinutes = minutes
    .filter((m: any) => !student.schoolId || !m.schoolId || m.schoolId === student.schoolId)
    .map((m: any) => {
      const inferredLegacyArtifact =
        typeof m.hasPhysicalScan === "boolean"
          ? m.hasPhysicalScan
          : Boolean(
              m.physicalSignedScanData ||
                m.physicalScanStorageKey ||
                m.physicalScanSha256 ||
                m.physicalScanUploadedAt ||
                m.physicalScanSizeBytes ||
                m.physicalScanMimeType
            );
      const effectiveProof = evaluateEffectivePhysicalProof({
        ...m,
        // Preserva compatibilidade com mocks ou registros pré-versionamento sem campo status
        status: m.status || "FINALIZED",
        hasPhysicalScan: inferredLegacyArtifact,
      });

      return {
        ...m,
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
        physicalScanUploadedBy: effectiveProof.hasValidPhysicalProof
          ? m.physicalScanUploadedBy ?? null
          : null,
        physicalSignedScanData: null,
      };
    });

  const scopedCouncilCards = councilCards.filter(
    (c: any) =>
      !student.schoolId ||
      ((!c.schoolId || c.schoolId === student.schoolId) &&
        (!c.board?.schoolId || c.board.schoolId === student.schoolId))
  );

  return {
    student,
    contacts,
    justifications,
    attendances,
    snapshots,
    minutes: scopedMinutes,
    councilCards: scopedCouncilCards,
  };
  };

  if (schoolId) {
    return withTenantContext(prisma, schoolId, (tx) => runBundleQueries(tx, schoolId));
  }
  return runBundleQueries(prisma, undefined);
}
