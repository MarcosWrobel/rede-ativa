import { NextResponse } from "next/server";
import { requireAuth, isBootstrapAdminEmail } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const switchSchoolSchema = z.object({
  schoolId: z.string().optional(),
  targetSchoolId: z.string().optional(),
}).refine((data) => Boolean(data.schoolId || data.targetSchoolId), {
  message: "ID da escola é obrigatório",
});

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const body = await req.json();
    const parsed = switchSchoolSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    }

    const schoolId = (parsed.data.schoolId || parsed.data.targetSchoolId)!;
    const isRootAdmin = isBootstrapAdminEmail(authCheck.email);

    // 1. Verifica se a escola existe e está ativa
    const targetSchool = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, inepCode: true, city: true, network: true, active: true },
    });

    if (!targetSchool || !targetSchool.active) {
      return NextResponse.json({ error: "Instituição escolar não encontrada ou inativa." }, { status: 404 });
    }

    // 2. Valida se o usuário tem vínculo com essa escola (ou se é Administrador Geral)
    if (!isRootAdmin && authCheck.userId) {
      const membership = await prisma.userSchool.findUnique({
        where: {
          userId_schoolId: {
            userId: authCheck.userId,
            schoolId,
          },
        },
      });

      if (!membership || !membership.active) {
        return NextResponse.json(
          { error: "Você não possui vínculo autorizado com esta instituição de ensino." },
          { status: 403 }
        );
      }
    }

    // 3. Atualiza o schoolId padrão no perfil do usuário no banco
    if (authCheck.userId) {
      await prisma.user.update({
        where: { id: authCheck.userId },
        data: { schoolId },
      });
    }

    await logAudit({
      action: "UPDATE_USER",
      entityType: "SchoolContext",
      entityId: schoolId,
      details: {
        switchedTo: targetSchool.name,
        inepCode: targetSchool.inepCode,
        network: (targetSchool as any).network,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    const response = NextResponse.json({
      success: true,
      activeSchool: {
        id: targetSchool.id,
        name: targetSchool.name,
        inepCode: targetSchool.inepCode,
        city: targetSchool.city,
        network: (targetSchool as any).network || "ESTADUAL",
      },
    });

    response.cookies.set("active_school_id", schoolId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 dias
      sameSite: "lax",
    });

    return response;
  } catch (error: any) {
    console.error("[POST /api/auth/switch-school] Erro:", error);
    return NextResponse.json({ error: "Erro ao alternar instituição escolar" }, { status: 500 });
  }
}
