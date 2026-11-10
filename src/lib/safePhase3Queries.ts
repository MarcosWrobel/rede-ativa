import { prisma } from "./prisma";

/**
 * Executa consultas das tabelas pedagógicas da Fase 3 com fallback resiliente
 * caso o ambiente local ainda não tenha aplicado `prisma db push` (que roda automaticamente na Vercel).
 */
export async function safeQueryList<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (err: any) {
    if (err?.code === "P2021" || String(err?.message || "").includes("does not exist")) {
      return [];
    }
    throw err;
  }
}

export async function loadStudent360Bundle(studentId: string) {
  const [student, contacts, justifications, attendances, snapshots, minutes] = await Promise.all([
    prisma.student.findUnique({
      where: { id: studentId },
      include: {
        classGroup: true,
        lowAttendanceRecord: true,
        messageLogs: {
          orderBy: { sentAt: "desc" },
        },
      },
    }),
    safeQueryList(() =>
      prisma.studentContact.findMany({
        where: { studentId },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      })
    ),
    safeQueryList(() =>
      prisma.absenceJustification.findMany({
        where: { studentId },
        orderBy: { endDate: "desc" },
      })
    ),
    safeQueryList(() =>
      prisma.inPersonAttendance.findMany({
        where: { studentId },
        orderBy: { attendedAt: "desc" },
      })
    ),
    safeQueryList(() =>
      prisma.attendanceSnapshot.findMany({
        where: { studentId },
        orderBy: { recordedAt: "desc" },
        take: 24,
      })
    ),
    safeQueryList(() =>
      prisma.pedagogicalMinute.findMany({
        where: {
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
          students: true,
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
              createdAt: true,
            },
          },
          addendums: { orderBy: { createdAt: "asc" } },
          actionItems: { orderBy: { createdAt: "asc" } },
        },
        orderBy: [{ ataNumber: "desc" }, { attendedAt: "desc" }],
      })
    ),
  ]);

  if (!student) return null;

  // Garante que atas vinculadas no prontuário/dossiê pertençam estritamente ao mesmo tenant do estudante
  const scopedMinutes = minutes
    .filter((m: any) => !student.schoolId || !m.schoolId || m.schoolId === student.schoolId)
    .map((m: any) => ({
      ...m,
      hasPhysicalScan: Boolean(
        m.physicalSignedScanData ||
          m.physicalScanStorageKey ||
          m.physicalScanSha256 ||
          m.physicalScanUploadedAt ||
          m.physicalScanSizeBytes ||
          m.physicalScanMimeType
      ),
      physicalSignedScanData: null,
    }));

  return {
    student,
    contacts,
    justifications,
    attendances,
    snapshots,
    minutes: scopedMinutes,
  };
}
