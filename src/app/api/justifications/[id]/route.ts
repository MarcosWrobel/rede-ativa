import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { logAudit, extractClientIp } from "@/lib/audit";
import { getCurrentSchool } from "@/lib/currentSchool";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const school = await getCurrentSchool(authCheck.session?.user?.schoolId);

    const justification = await prisma.absenceJustification.findUnique({
      where: { id },
      include: {
        student: { select: { id: true, name: true, schoolId: true } },
      },
    });

    if (!justification) {
      return NextResponse.json({ error: "Justificativa não encontrada." }, { status: 404 });
    }

    if (justification.student.schoolId !== school.id && authCheck.role !== "ADMIN") {
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    }

    await prisma.absenceJustification.delete({
      where: { id },
    });

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
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[DELETE /api/justifications/[id]] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao remover atestado" }, { status: 500 });
  }
}
