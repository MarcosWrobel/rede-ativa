import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { invalidateSchoolCache } from "@/lib/currentSchool";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { assertNoCrossSchoolCleanupConflicts } from "@/lib/schoolCleanupGuards";

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

    const { wipedStudentsCount, wipedClassesCount, wipedMinutesCount } = await withTenantContext(
      prisma,
      target.id,
      async (tx) => {
        const studentsCount =
          typeof (tx.student as any)?.count === "function"
            ? await tx.student.count({ where: { schoolId: target.id } })
            : 0;
        const classGroupsCount =
          typeof (tx.classGroup as any)?.count === "function"
            ? await tx.classGroup.count({ where: { schoolId: target.id } })
            : 0;
        const minutesCount =
          typeof (tx.pedagogicalMinute as any)?.count === "function"
            ? await tx.pedagogicalMinute.count({ where: { schoolId: target.id } })
            : 0;

        const lockedIds = await assertNoCrossSchoolCleanupConflicts(tx, {
          schoolId: target.id,
          conflictCode: "SCHOOL_SANITIZE_INTEGRITY_CONFLICT",
          actionLabel: "Higienização",
          checkTemplateCrossReferences: false,
        });

        await tx.messageLog.deleteMany({
          where: {
            student: { schoolId: target.id },
            OR: [{ schoolId: null }, { schoolId: target.id }],
          },
        });
        await tx.lowAttendanceRecord.deleteMany({ where: { student: { schoolId: target.id } } });
        await tx.absenceJustification.deleteMany({ where: { student: { schoolId: target.id } } });
        await tx.inPersonAttendance.deleteMany({ where: { student: { schoolId: target.id } } });
        await tx.attendanceSnapshot.deleteMany({ where: { student: { schoolId: target.id } } });
        await tx.studentContact.deleteMany({ where: { student: { schoolId: target.id } } });
        await tx.pedagogicalMinuteStudent.deleteMany({
          where: {
            minute: { schoolId: target.id },
            student: { schoolId: target.id },
          },
        });
        await tx.pedagogicalMinuteParticipant.deleteMany({ where: { minute: { schoolId: target.id } } });
        await tx.pedagogicalMinuteAddendum.deleteMany({ where: { minute: { schoolId: target.id } } });
        await tx.pedagogicalActionItem.deleteMany({ where: { minute: { schoolId: target.id } } });
        await tx.pedagogicalMinute.deleteMany({ where: { schoolId: target.id } });
        if (typeof tx.studentCouncilSubjectEntry?.deleteMany === "function") {
          if (!lockedIds) {
            await tx.studentCouncilSubjectEntry.deleteMany({ where: { schoolId: target.id } });
          } else if (lockedIds.lockedCouncilEntryIds.length > 0) {
            await tx.studentCouncilSubjectEntry.deleteMany({
              where: { id: { in: lockedIds.lockedCouncilEntryIds }, schoolId: target.id },
            });
          }
        }
        if (typeof tx.studentCouncilCard?.deleteMany === "function") {
          if (!lockedIds) {
            await tx.studentCouncilCard.deleteMany({ where: { schoolId: target.id } });
          } else if (lockedIds.lockedCouncilCardIds.length > 0) {
            await tx.studentCouncilCard.deleteMany({
              where: { id: { in: lockedIds.lockedCouncilCardIds }, schoolId: target.id },
            });
          }
        }
        if (typeof tx.classCouncilTrimester?.deleteMany === "function") {
          if (!lockedIds) {
            await tx.classCouncilTrimester.deleteMany({ where: { schoolId: target.id } });
          } else if (lockedIds.lockedCouncilTrimesterIds.length > 0) {
            await tx.classCouncilTrimester.deleteMany({
              where: { id: { in: lockedIds.lockedCouncilTrimesterIds }, schoolId: target.id },
            });
          }
        }
        if (typeof tx.classCouncilSubject?.deleteMany === "function") {
          if (!lockedIds) {
            await tx.classCouncilSubject.deleteMany({ where: { schoolId: target.id } });
          } else if (lockedIds.lockedCouncilSubjectIds.length > 0) {
            await tx.classCouncilSubject.deleteMany({
              where: { id: { in: lockedIds.lockedCouncilSubjectIds }, schoolId: target.id },
            });
          }
        }
        if (typeof tx.classCouncilBoard?.deleteMany === "function") {
          if (!lockedIds) {
            await tx.classCouncilBoard.deleteMany({ where: { schoolId: target.id } });
          } else if (lockedIds.lockedCouncilBoardIds.length > 0) {
            await tx.classCouncilBoard.deleteMany({
              where: { id: { in: lockedIds.lockedCouncilBoardIds }, schoolId: target.id },
            });
          }
        }
        await tx.student.deleteMany({ where: { schoolId: target.id } });
        await tx.classGroup.deleteMany({ where: { schoolId: target.id } });

        return {
          wipedStudentsCount: studentsCount,
          wipedClassesCount: classGroupsCount,
          wipedMinutesCount: minutesCount,
        };
      }
    );

    await logAudit({
      action: "SANITIZE_SCHOOL",
      entityType: "School",
      entityId: id,
      schoolId: id,
      details: {
        schoolName: target.name,
        inepCode: target.inepCode,
        wipedStudentsCount,
        wipedClassesCount,
        wipedMinutesCount,
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

    if (error?.code === "SCHOOL_SANITIZE_INTEGRITY_CONFLICT") {
      return NextResponse.json(
        {
          error: error.message,
          code: "SCHOOL_SANITIZE_INTEGRITY_CONFLICT",
        },
        { status: 409 }
      );
    }

    const constraintText = [
      error?.meta?.constraint,
      error?.meta?.field_name,
      error?.message,
    ]
      .filter((v): v is string => typeof v === "string")
      .join(" ");

    if (constraintText.includes("MessageLog_schoolId_fkey")) {
      return NextResponse.json(
        {
          error:
            "Higienização bloqueada por integridade referencial: existem registros de mensageria vinculados a esta instituição com divergência de vínculo estudantil.",
          code: "SCHOOL_SANITIZE_INTEGRITY_CONFLICT",
        },
        { status: 409 }
      );
    }

    if (error?.code === "P2003") {
      return NextResponse.json(
        {
          error:
            "Higienização bloqueada por integridade referencial: existem registros vinculados a esta instituição que impedem a limpeza.",
          code: "SCHOOL_SANITIZE_FK_CONFLICT",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Erro ao higienizar dados da instituição" },
      { status: 500 }
    );
  }
}
