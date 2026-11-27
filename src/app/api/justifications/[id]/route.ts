import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { logAudit, extractClientIp } from "@/lib/audit";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { withTenantContext } from "@/lib/rlsTenantContext";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const schoolRes = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot
    );
    if (!schoolRes.ok) return schoolRes.response;
    const school = schoolRes.school;

    const txResult = await withTenantContext(prisma, school.id, async (tx) => {
      const justification = await tx.absenceJustification.findUnique({
        where: { id },
        include: {
          student: { select: { id: true, name: true, schoolId: true } },
        },
      });

      if (!justification) {
        return { errorStatus: 404 as const, error: "Justificativa não encontrada." };
      }

      if (!assertTenantOwnership(justification.student.schoolId, school.id, authCheck.session)) {
        return { errorStatus: 403 as const, error: "Acesso negado a registro de outra instituição de ensino." };
      }

      await tx.absenceJustification.delete({
        where: { id },
      });

      return { justification };
    });

    if ("errorStatus" in txResult) {
      return NextResponse.json({ error: txResult.error }, { status: txResult.errorStatus });
    }
    const justification = txResult.justification;

    const ip = extractClientIp(req);
    await logAudit({
      action: "DELETE_JUSTIFICATION",
      entityType: "AbsenceJustification",
      entityId: id,
      details: `Justificativa/Atestado de ${justification.student.name} (${justification.type}) removido por ${authCheck.userName}`,
      ipAddress: ip,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      schoolId: school.id,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[DELETE /api/justifications/[id]] Erro:", error);
    return NextResponse.json({ error: "Erro ao remover atestado" }, { status: 500 });
  }
}
