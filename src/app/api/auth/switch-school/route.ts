import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import {
  canSnapshotAccessSchool,
  resolveEffectiveRoleForSchool,
  resolveServerUserAuthSnapshot,
} from "@/lib/serverAuthContext";
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

    const schoolId = (parsed.data.schoolId || parsed.data.targetSchoolId)!.trim();

    // 1. Verifica se a escola existe e está ativa no banco (nunca usa fallback sintético em memória)
    let targetSchool = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, inepCode: true, city: true, network: true, networkId: true, active: true },
    });

    if (!targetSchool && (schoolId === "default-leopoldina" || schoolId === "41042730")) {
      targetSchool = await prisma.school.findFirst({
        where: { inepCode: "41042730", active: true },
        select: { id: true, name: true, inepCode: true, city: true, network: true, networkId: true, active: true },
      });
    }

    if (!targetSchool || targetSchool.active === false) {
      return NextResponse.json({ error: "Instituição escolar não encontrada ou inativa." }, { status: 404 });
    }

    // 2. Valida vínculo vigente no servidor para a escola destino
    const snapshot =
      authCheck.snapshot ?? (await resolveServerUserAuthSnapshot(authCheck.session));

    const isAuthorized = canSnapshotAccessSchool(snapshot, {
      id: targetSchool.id,
      networkId: targetSchool.networkId,
      network: targetSchool.network,
      city: targetSchool.city,
      active: targetSchool.active,
    });

    if (!isAuthorized) {
      return NextResponse.json(
        { error: "Você não possui vínculo autorizado com esta instituição de ensino." },
        { status: 403 }
      );
    }

    const effectiveRole = resolveEffectiveRoleForSchool(snapshot, {
      id: targetSchool.id,
      networkId: targetSchool.networkId,
      network: targetSchool.network,
      city: targetSchool.city,
      active: targetSchool.active,
    });

    // 3. Atualiza a preferência selecionada no perfil do usuário no banco com o ID canônico resolvido
    if (authCheck.userId || authCheck.email) {
      try {
        await prisma.user.updateMany({
          where: {
            OR: [
              ...(authCheck.userId ? [{ id: authCheck.userId }] : []),
              ...(authCheck.email ? [{ email: authCheck.email.toLowerCase().trim() }] : []),
            ],
          },
          data: { schoolId: targetSchool.id },
        });
      } catch (err) {
        console.warn("[POST /api/auth/switch-school] Aviso ao sincronizar schoolId no perfil do usuário:", err);
      }
    }

    try {
      await logAudit({
        action: "UPDATE_USER",
        entityType: "SchoolContext",
        entityId: targetSchool.id,
        schoolId: targetSchool.id,
        details: {
          switchedTo: targetSchool.name,
          inepCode: targetSchool.inepCode,
          network: targetSchool.network,
          effectiveRole,
        },
        user: {
          id: authCheck.userId,
          name: authCheck.userName,
          email: authCheck.email,
        },
        req,
      });
    } catch (auditErr) {
      console.warn("[POST /api/auth/switch-school] Aviso ao registrar auditoria de troca de escola:", auditErr);
    }

    const response = NextResponse.json(
      {
        success: true,
        effectiveRole,
        activeSchool: {
          id: targetSchool.id,
          name: targetSchool.name,
          inepCode: targetSchool.inepCode,
          city: targetSchool.city,
          network: targetSchool.network || "ESTADUAL",
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );

    response.cookies.set("active_school_id", targetSchool.id, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 dias
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    return response;
  } catch (error: any) {
    console.error("[POST /api/auth/switch-school] Erro:", error);
    return NextResponse.json({ error: "Erro ao alternar instituição escolar" }, { status: 500 });
  }
}
