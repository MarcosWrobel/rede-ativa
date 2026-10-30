import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import { logAudit, extractClientIp } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createMinuteDraftSchema = z.object({
  category: z.string().default("ACOMPANHAMENTO_PEDAGOGICO"),
  isConfidential: z.boolean().default(false),
  attendedAt: z.string().optional(),
  subject: z.string().min(2, "Assunto é obrigatório"),
  rawNotes: z.string().optional(),
  summary: z.string().default(""),
  agreementsSummary: z.string().optional(),
  studentIds: z.array(z.string()).min(1, "Vincule pelo menos um estudante"),
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

    const where: any = {
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

    const minutes = await prisma.pedagogicalMinute.findMany({
      where,
      orderBy: [
        { status: "asc" }, // DRAFT primeiro se houver
        { ataNumber: "desc" },
        { attendedAt: "desc" },
      ],
      include: {
        students: {
          include: {
            student: {
              select: { id: true, name: true, phone: true, cgm: true },
            },
          },
        },
        participants: true,
        addendums: {
          orderBy: { createdAt: "asc" },
        },
        actionItems: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return NextResponse.json({ success: true, minutes, year, school });
  } catch (error: any) {
    console.error("[GET /api/atas] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao listar atas" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const rawBody = await req.json();
    const parsed = createMinuteDraftSchema.safeParse(rawBody);
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

    // Busca dados cadastrais atuais dos estudantes para snapshot fiel
    const studentsDb = await prisma.student.findMany({
      where: { id: { in: studentIds } },
      include: { classGroup: true },
    });

    if (studentsDb.length === 0) {
      return NextResponse.json({ error: "Nenhum estudante válido encontrado para vincular" }, { status: 400 });
    }

    const minute = await prisma.pedagogicalMinute.create({
      data: {
        schoolId: school.id,
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
          create: participants.map((p) => ({
            role: p.role,
            studentId: p.studentId || null,
            name: p.name,
            kinship: p.kinship || null,
            documentType: p.documentType || null,
            documentNumber: p.documentNumber || null,
            documentVerifiedByStaff: p.documentVerifiedByStaff,
            phone: p.phone || null,
            signatureMode: p.signatureMode || "PENDING",
            signatureData: p.signatureData || null,
            signedAt: p.signatureData ? new Date() : null,
            refusalReason: p.refusalReason || null,
            witnessName: p.witnessName || null,
          })),
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
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      ipAddress: ip,
    });

    return NextResponse.json({ success: true, minute }, { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/atas] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao criar rascunho de ata" }, { status: 500 });
  }
}
