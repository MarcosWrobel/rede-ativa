import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { invalidateSchoolCache } from "@/lib/currentSchool";

export const dynamic = "force-dynamic";

/**
 * Higieniza (Reseta) completamente os dados operacionais de uma escola:
 * - Remove todos os estudantes cadastrados
 * - Remove todas as turmas
 * - Remove registros de infrequência e atestados
 * - Remove mensagens enviadas e retornos
 * - Remove atas pedagógicas e combinados
 * Mantém a instituição ativa, seus dados cadastrais (INEP, brasão) e modelos de mensagem.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireSuperAdmin();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const target = await prisma.school.findUnique({
      where: { id },
      select: {
        id: true,
        inepCode: true,
        name: true,
        _count: {
          select: {
            students: true,
            classGroups: true,
            pedagogicalMinutes: true,
          },
        },
      },
    });

    if (!target) {
      return NextResponse.json({ error: "Instituição escolar não encontrada" }, { status: 404 });
    }

    // Proteção atômica inviolável da escola sede fundadora (INEP 41042730)
    const isPilotSchool = target.inepCode === "41042730" || target.id === "default-leopoldina";
    if (isPilotSchool) {
      return NextResponse.json(
        {
          error:
            "A Unidade Piloto Fundadora (INEP 41042730) é a escola sede de produção e não pode ser higienizada ou resetada.",
        },
        { status: 403 }
      );
    }

    // Executa a higienização de todos os registros em batch transaction compatível com PgBouncer
    await prisma.$transaction([
      prisma.messageLog.deleteMany({ where: { student: { schoolId: id } } }),
      prisma.lowAttendanceRecord.deleteMany({ where: { student: { schoolId: id } } }),
      prisma.absenceJustification.deleteMany({ where: { student: { schoolId: id } } }),
      prisma.inPersonAttendance.deleteMany({ where: { student: { schoolId: id } } }),
      prisma.attendanceSnapshot.deleteMany({ where: { student: { schoolId: id } } }),
      prisma.studentContact.deleteMany({ where: { student: { schoolId: id } } }),
      prisma.pedagogicalMinuteStudent.deleteMany({
        where: {
          OR: [{ minute: { schoolId: id } }, { student: { schoolId: id } }],
        },
      }),
      prisma.pedagogicalMinuteParticipant.deleteMany({ where: { minute: { schoolId: id } } }),
      prisma.pedagogicalMinuteAddendum.deleteMany({ where: { minute: { schoolId: id } } }),
      prisma.pedagogicalActionItem.deleteMany({ where: { minute: { schoolId: id } } }),
      prisma.pedagogicalMinute.deleteMany({ where: { schoolId: id } }),
      prisma.student.deleteMany({ where: { schoolId: id } }),
      prisma.classGroup.deleteMany({ where: { schoolId: id } }),
    ]);

    await logAudit({
      action: "SANITIZE_SCHOOL",
      entityType: "School",
      entityId: id,
      schoolId: id,
      details: {
        schoolName: target.name,
        inepCode: target.inepCode,
        wipedStudentsCount: target._count.students,
        wipedClassesCount: target._count.classGroups,
        wipedMinutesCount: target._count.pedagogicalMinutes,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    invalidateSchoolCache(id);

    return NextResponse.json({
      success: true,
      message: `A escola "${target.name}" foi higienizada com sucesso. Todos os alunos, turmas, atas e registros operacionais foram limpos (0 estudantes, 0 turmas).`,
      schoolId: id,
    });
  } catch (error: any) {
    console.error("[POST /api/schools/[id]/sanitize] Erro:", error);
    return NextResponse.json(
      { error: "Erro ao higienizar dados da instituição" },
      { status: 500 }
    );
  }
}
