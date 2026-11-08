import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

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
      include: {
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

    // Executa a higienização de todos os registros em transação atômica
    await prisma.$transaction(async (tx) => {
      await tx.messageLog.deleteMany({ where: { student: { schoolId: id } } });
      await tx.lowAttendanceRecord.deleteMany({ where: { student: { schoolId: id } } });
      await tx.absenceJustification.deleteMany({ where: { student: { schoolId: id } } });
      await tx.inPersonAttendance.deleteMany({ where: { student: { schoolId: id } } });
      await tx.attendanceSnapshot.deleteMany({ where: { student: { schoolId: id } } });
      await tx.studentContact.deleteMany({ where: { student: { schoolId: id } } });
      await tx.pedagogicalMinuteStudent.deleteMany({
        where: {
          OR: [{ minute: { schoolId: id } }, { student: { schoolId: id } }],
        },
      });
      await tx.pedagogicalMinuteParticipant.deleteMany({ where: { minute: { schoolId: id } } });
      await tx.pedagogicalMinuteAddendum.deleteMany({ where: { minute: { schoolId: id } } });
      await tx.pedagogicalActionItem.deleteMany({ where: { minute: { schoolId: id } } });
      await tx.pedagogicalMinute.deleteMany({ where: { schoolId: id } });
      await tx.student.deleteMany({ where: { schoolId: id } });
      await tx.classGroup.deleteMany({ where: { schoolId: id } });
    });

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
