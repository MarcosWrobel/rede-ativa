import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { getCurrentSchool, ensureDefaultSchool } from "@/lib/currentSchool";
import { logAudit, extractClientIp } from "@/lib/audit";
import { generateVerificationCode, canAccessConfidentialMinute } from "@/lib/ataCrypto";
import { sanitizeMinutePayload, validateParticipantStudentLinks } from "@/services/ataParticipantService";
import { sanitizeKinshipForRole } from "@/lib/participantKinship";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createMinuteDraftSchema = z.object({
  category: z.string().default("ACOMPANHAMENTO_PEDAGOGICO"),
  isConfidential: z.boolean().default(false),
  attendedAt: z.string().optional(),
  subject: z.string().min(2, "Assunto é obrigatório"),
  rawNotes: z.string().optional().nullable(),
  summary: z.string().default(""),
  agreementsSummary: z.string().optional().nullable(),
  studentIds: z.array(z.string()).default([]),
  participants: z
    .array(
      z.object({
        role: z.string().default("RESPONSAVEL"),
        studentId: z.string().optional().nullable(),
        name: z.string().min(2, "Nome do participante é obrigatório"),
        kinship: z.string().optional().nullable(),
        documentType: z.string().optional().nullable(),
        documentNumber: z.string().optional().nullable(),
        documentVerifiedByStaff: z.boolean().default(false),
        phone: z.string().optional().nullable(),
        signatureMode: z.string().default("PENDING"),
        signatureData: z.string().optional().nullable(),
        biometricVerified: z.boolean().default(false),
        biometricDeviceType: z.string().optional().nullable(),
        expectedEmail: z.string().optional().nullable(),
        verifiedEmail: z.string().optional().nullable(),
        verifiedGoogleSub: z.string().optional().nullable(),
        verifiedGoogleName: z.string().optional().nullable(),
        refusalReason: z.string().optional().nullable(),
        witnessName: z.string().optional().nullable(),
      })
    )
    .default([]),
  actionItems: z
    .array(
      z.object({
        description: z.string().min(2),
        responsible: z.string().default("FAMILIA"),
        dueDate: z.string().optional().nullable(),
      })
    )
    .default([]),
});

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { searchParams } = new URL(req.url);
    const yearParam = searchParams.get("year");
    const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
    const status = searchParams.get("status"); // DRAFT | FINALIZED | VOIDED
    const studentId = searchParams.get("studentId");
    const category = searchParams.get("category");
    const search = searchParams.get("q")?.trim();

    const school = await getCurrentSchool(authCheck.session?.user?.schoolId);

    const where: Prisma.PedagogicalMinuteWhereInput = {
      schoolId: school.id,
      year,
    };

    if (status) where.status = status;
    if (category) where.category = category;
    if (studentId) {
      where.students = {
        some: { studentId },
      };
    }
    if (search) {
      where.OR = [
        { subject: { contains: search, mode: "insensitive" } },
        { summary: { contains: search, mode: "insensitive" } },
        { authorName: { contains: search, mode: "insensitive" } },
        { verificationCode: { contains: search, mode: "insensitive" } },
        {
          students: {
            some: { studentNameSnapshot: { contains: search, mode: "insensitive" } },
          },
        },
      ];
    }

    const includeSignatures = searchParams.get("includeSignatures") === "true";

    const minutes = await prisma.pedagogicalMinute.findMany({
      where,
      orderBy: [
        { status: "asc" }, // DRAFT primeiro se houver
        { ataNumber: "desc" },
        { attendedAt: "desc" },
      ],
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
        authorIp: true,
        finalizedAt: true,
        contentHash: true,
        verificationCode: true,
        pdfArchiveSha256: true,
        pdfArchiveGeneratedAt: true,
        ...(includeSignatures ? { physicalSignedScanData: true } : {}),
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
          include: {
            student: {
              select: { id: true, name: true, phone: true, cgm: true },
            },
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
            ...(includeSignatures ? { signatureData: true } : {}),
            signedAt: true,
            signerIp: true,
            signerUserAgent: true,
            clientTimestampIso: true,
            refusalReason: true,
            witnessName: true,
            hasSignature: true,
            hasActiveSignLink: true,
            biometricVerified: true,
            biometricDeviceType: true,
            biometricAuthTime: true,
            expectedEmail: true,
            verifiedEmail: true,
            verifiedGoogleSub: true,
            verifiedGoogleName: true,
            emailVerifiedAt: true,
            createdAt: true,
          },
        },
        addendums: {
          orderBy: { createdAt: "asc" },
        },
        actionItems: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    // Auto-recuperação de fé pública: assegura verificationCode para atas finalizadas legadas
    const missingCodes = minutes.filter((m) => m.status === "FINALIZED" && !m.verificationCode);
    if (missingCodes.length > 0) {
      await Promise.all(
        missingCodes.map(async (m) => {
          const code = generateVerificationCode();
          m.verificationCode = code;
          try {
            await prisma.pedagogicalMinute.update({
              where: { id: m.id },
              data: { verificationCode: code },
            });
          } catch (e) {
            console.warn(`[GET /api/atas] Falha ao persistir verificationCode para ata ${m.id}:`, e);
          }
        })
      );
    }

    const responseMinutes = minutes.map((m) => {
      const allowedConfidential = canAccessConfidentialMinute(m, authCheck.session);
      const safeParticipants = m.participants.map((p) => {
        const {
          signatureData,
          mobileSignToken,
          mobileSignExpiresAt,
          ...rest
        } = p as typeof p & {
          signatureData?: string | null;
          mobileSignToken?: string | null;
          mobileSignExpiresAt?: Date | string | null;
        };
        return {
          ...rest,
          ...(includeSignatures && allowedConfidential ? { signatureData } : {}),
          hasSignature: Boolean(p.hasSignature),
          hasActiveSignLink: Boolean(p.hasActiveSignLink),
        };
      });

      if (!allowedConfidential) {
        return {
          ...m,
          rawNotes: null,
          summary: "[CONTEÚDO SOB SIGILO REFORÇADO ECA — ACESSO RESTRITO À DIREÇÃO ESCOLAR E AO SERVIDOR AUTOR]",
          agreementsSummary: null,
          actionItems: [],
          addendums: [],
          physicalSignedScanData: null,
          hasPhysicalScan: false,
          restrictedConfidential: true,
          participants: safeParticipants,
        };
      }

      const minuteWithScan = m as typeof m & { physicalSignedScanData?: string | null };

      return {
        ...m,
        hasPhysicalScan: Boolean(m.hasPhysicalScan),
        physicalSignedScanData: includeSignatures
          ? minuteWithScan.physicalSignedScanData ?? null
          : null,
        participants: safeParticipants,
      };
    });

    return NextResponse.json({ success: true, minutes: responseMinutes, year, school });
  } catch (error: unknown) {
    console.error("[GET /api/atas] Erro:", error);
    return NextResponse.json({ error: "Erro ao listar atas" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const rawBody = await req.json();
    const parsed = createMinuteDraftSchema.safeParse(sanitizeMinutePayload(rawBody, "CREATE"));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    }

    const school = await getCurrentSchool(authCheck.session?.user?.schoolId);
    const ip = extractClientIp(req);
    const currentYear = new Date().getFullYear();

    const {
      category,
      isConfidential,
      attendedAt,
      subject,
      rawNotes,
      summary,
      agreementsSummary,
      studentIds,
      participants,
      actionItems,
    } = parsed.data;

    // Garante que a escola exista no banco de dados para satisfazer a chave estrangeira (FK)
    let effectiveSchoolId = school.id;
    if (effectiveSchoolId === "default-leopoldina") {
      const ensured = await ensureDefaultSchool();
      if (ensured) {
        effectiveSchoolId = ensured.id;
      }
    }

    const uniqueStudentIds = Array.from(new Set(studentIds));

    if (uniqueStudentIds.length === 0) {
      if (!participants || participants.length === 0) {
        return NextResponse.json(
          { error: "Vincule pelo menos um estudante ou adicione ao menos um docente/participante na ata." },
          { status: 400 }
        );
      }
    }

    // Busca dados cadastrais atuais dos estudantes para snapshot fiel, garantindo escopo da escola ativa
    const studentsDb = uniqueStudentIds.length > 0
      ? await prisma.student.findMany({
          where: {
            id: { in: uniqueStudentIds },
            schoolId: effectiveSchoolId,
          },
          include: { classGroup: true },
        })
      : [];

    if (uniqueStudentIds.length > 0 && studentsDb.length !== uniqueStudentIds.length) {
      return NextResponse.json(
        { error: "Um ou mais estudantes informados não foram encontrados nesta instituição escolar para vincular." },
        { status: 400 }
      );
    }

    await validateParticipantStudentLinks(prisma, effectiveSchoolId, participants);

    const minute = await prisma.pedagogicalMinute.create({
      data: {
        schoolId: effectiveSchoolId,
        year: currentYear,
        status: "DRAFT", // Sempre inicia como rascunho sem consumir número
        category,
        isConfidential,
        attendedAt: attendedAt ? new Date(attendedAt) : new Date(),
        subject,
        rawNotes,
        summary: summary || "",
        agreementsSummary,
        authorId: authCheck.userId,
        authorName: authCheck.userName || "Equipe Pedagógica",
        authorEmail: authCheck.email,
        authorRole: authCheck.role || "PEDAGOGA",
        authorIp: ip,
        students: {
          create: studentsDb.map((s) => ({
            studentId: s.id,
            studentNameSnapshot: s.name,
            classNameSnapshot: s.classGroup?.name || null,
            cgmSnapshot: s.cgm || null,
          })),
        },
        participants: {
          create: participants.map((p) => {
            const isSigned = Boolean(p.signatureData || p.verifiedEmail || p.biometricVerified);
            return {
              role: p.role,
              studentId:
                (p.role || "RESPONSAVEL").trim().toUpperCase() === "ESTUDANTE"
                  ? p.studentId || null
                  : null,
              name: p.name,
              kinship: sanitizeKinshipForRole(p.role, p.kinship, { isSigned }),
            documentType: p.documentType || null,
            documentNumber: p.documentNumber || null,
            documentVerifiedByStaff: p.documentVerifiedByStaff,
            phone: p.phone || null,
            signatureMode: p.signatureMode || "PENDING",
            signatureData: p.signatureData || null,
            signedAt: p.signatureData ? new Date() : null,
            hasSignature: Boolean(p.signatureData),
            hasActiveSignLink: false,
            biometricVerified: false,
            biometricDeviceType: null,
            biometricAuthTime: null,
            expectedEmail: p.expectedEmail || null,
            verifiedEmail: null,
            verifiedGoogleSub: null,
            verifiedGoogleName: null,
            emailVerifiedAt: null,
            refusalReason: p.refusalReason || null,
            witnessName: p.witnessName || null,
          }; }),
        },
        actionItems: {
          create: actionItems.map((a) => ({
            description: a.description,
            responsible: a.responsible,
            dueDate: a.dueDate ? new Date(a.dueDate) : null,
          })),
        },
      },
      include: {
        students: true,
        participants: true,
        actionItems: true,
      },
    });

    await logAudit({
      action: "CREATE_ATA_DRAFT",
      entityType: "PedagogicalMinute",
      entityId: minute.id,
      details: `Rascunho de ata pedagógica aberto para ${studentsDb.map((s) => s.name).join(", ")} (${subject})`,
      schoolId: effectiveSchoolId,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      ipAddress: ip,
    });

    return NextResponse.json({ success: true, minute }, { status: 201 });
  } catch (error: any) {
    const msg = error?.message || "";
    if (msg.startsWith("FORBIDDEN:")) {
      return NextResponse.json({ error: msg.replace("FORBIDDEN:", "") }, { status: 403 });
    }
    if (msg.startsWith("VALIDATION:")) {
      return NextResponse.json({ error: msg.replace("VALIDATION:", "") }, { status: 400 });
    }
    console.error("[POST /api/atas] Erro:", error);
    return NextResponse.json({ error: "Erro ao criar rascunho de ata" }, { status: 500 });
  }
}
