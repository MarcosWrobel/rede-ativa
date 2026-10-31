import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { logAudit, extractClientIp } from "@/lib/audit";
import { getCurrentSchool } from "@/lib/currentSchool";
import { z } from "zod";
import { justificationTypeEnum } from "@/lib/schemas";

export const dynamic = "force-dynamic";

const quickJustificationSchema = z
  .object({
    studentId: z.string().min(1, "Selecione o estudante"),
    type: justificationTypeEnum.optional().default("ATESTADO_MEDICO"),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inicial inválida"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data final inválida"),
    cidCode: z.string().trim().max(30).optional().nullable(),
    notes: z.string().trim().optional().nullable(),
  })
  .refine((d) => d.startDate <= d.endDate, {
    message: "A data final do atestado não pode ser anterior à data inicial",
  });

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("q")?.trim();
    const status = searchParams.get("status") || "ALL"; // ACTIVE | EXPIRED | ALL
    const type = searchParams.get("type");
    const classGroupId = searchParams.get("classGroupId");
    const limit = Math.min(Number(searchParams.get("limit") || 100), 200);

    const school = await getCurrentSchool(authCheck.session?.user?.schoolId);

    const now = new Date();
    // Início do dia de hoje no fuso de Brasília
    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
    const startOfTodayBrasilia = new Date(`${todayStr}T00:00:00.000-03:00`);

    const where: any = {
      student: {
        schoolId: school.id,
      },
    };

    if (classGroupId && classGroupId !== "ALL") {
      where.student.classGroupId = classGroupId;
    }

    if (type && type !== "ALL") {
      where.type = type;
    }

    if (status === "ACTIVE") {
      where.endDate = { gte: startOfTodayBrasilia };
    } else if (status === "EXPIRED") {
      where.endDate = { lt: startOfTodayBrasilia };
    }

    if (search) {
      where.OR = [
        { student: { name: { contains: search, mode: "insensitive" } } },
        { student: { cgm: { contains: search, mode: "insensitive" } } },
        { cidCode: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
      ];
    }

    const [justifications, totalCount, activeCount, classes] = await Promise.all([
      prisma.absenceJustification.findMany({
        where,
        take: limit,
        orderBy: [{ endDate: "desc" }, { createdAt: "desc" }],
        include: {
          student: {
            select: {
              id: true,
              name: true,
              cgm: true,
              phone: true,
              guardianName: true,
              classGroup: {
                select: { id: true, name: true, shift: true },
              },
            },
          },
        },
      }),
      prisma.absenceJustification.count({
        where: { student: { schoolId: school.id } },
      }),
      prisma.absenceJustification.count({
        where: {
          student: { schoolId: school.id },
          endDate: { gte: startOfTodayBrasilia },
        },
      }),
      prisma.classGroup.findMany({
        where: { schoolId: school.id, active: true },
        select: { id: true, name: true, shift: true },
        orderBy: { name: "asc" },
      }),
    ]);

    return NextResponse.json({
      success: true,
      justifications,
      metrics: {
        total: totalCount,
        active: activeCount,
        expired: Math.max(0, totalCount - activeCount),
      },
      classes,
    });
  } catch (error: any) {
    console.error("[GET /api/justifications] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao consultar atestados" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const rawBody = await req.json();
    const parsed = quickJustificationSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    }

    const { studentId, type, startDate, endDate, cidCode, notes } = parsed.data;

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { classGroup: true },
    });

    if (!student) {
      return NextResponse.json({ error: "Estudante não encontrado." }, { status: 404 });
    }

    // Grava início e fim no horário civil de Brasília (-03:00)
    const startDt = new Date(`${startDate}T00:00:00.000-03:00`);
    const endDt = new Date(`${endDate}T23:59:59.999-03:00`);

    const created = await prisma.absenceJustification.create({
      data: {
        studentId,
        type,
        startDate: startDt,
        endDate: endDt,
        cidCode: cidCode || null,
        notes: notes || null,
        createdByName: authCheck.userName || "Equipe Pedagógica",
        createdByEmail: authCheck.email,
      },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            cgm: true,
            classGroup: { select: { id: true, name: true } },
          },
        },
      },
    });

    const ip = extractClientIp(req);
    await logAudit({
      action: "CREATE_JUSTIFICATION",
      entityType: "AbsenceJustification",
      entityId: created.id,
      details: `Atestado/Justificativa (${type}) lançado para ${student.name} (${student.classGroup?.name || "Sem turma"}) de ${startDate} a ${endDate}`,
      ipAddress: ip,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
    });

    return NextResponse.json({
      success: true,
      justification: created,
    });
  } catch (error: any) {
    console.error("[POST /api/justifications] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao registrar atestado" }, { status: 500 });
  }
}
