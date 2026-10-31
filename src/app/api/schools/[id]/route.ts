import { NextResponse } from "next/server";
import { requireSchoolAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateSchoolSchema = z.object({
  name: z.string().min(3, "Nome da instituição deve ter no mínimo 3 caracteres").optional(),
  inepCode: z
    .string()
    .min(4, "Código INEP deve ter no mínimo 4 dígitos")
    .max(12, "Código INEP inválido")
    .regex(/^\d+$/, "Código INEP deve conter apenas números")
    .optional(),
  city: z.string().min(2, "Município é obrigatório").optional(),
  state: z.string().length(2, "UF deve ter 2 letras").optional(),
  nre: z.string().optional().nullable(),
  network: z.enum(["ESTADUAL", "MUNICIPAL", "PRIVADA"]).optional(),
  phone: z.string().optional().nullable(),
  email: z.string().email("E-mail institucional inválido").optional().nullable(),
  logoUrl: z.string().optional().nullable(),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authCheck = await requireSchoolAdmin(id);
    if (!authCheck.ok) return authCheck.response;

    const school = await prisma.school.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            students: { where: { active: true } },
            classGroups: true,
            pedagogicalMinutes: true,
            userSchools: { where: { active: true } },
          },
        },
        userSchools: {
          where: { active: true },
          include: {
            user: {
              select: { id: true, name: true, email: true, image: true, active: true },
            },
          },
          orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
        },
      },
    });

    if (!school) {
      return NextResponse.json({ error: "Instituição escolar não encontrada" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      school: {
        ...school,
        hasSyncToken: Boolean(school.syncTokenHash),
      },
    });
  } catch (error: any) {
    console.error("[GET /api/schools/[id]] Erro:", error);
    return NextResponse.json({ error: "Erro ao consultar instituição" }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authCheck = await requireSchoolAdmin(id);
    if (!authCheck.ok) return authCheck.response;

    const rawBody = await req.json();
    const parsed = updateSchoolSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    }

    const data = parsed.data;

    // Se estiver alterando o INEP, verifica se não colide com outra escola
    if (data.inepCode) {
      const collision = await prisma.school.findFirst({
        where: {
          inepCode: data.inepCode,
          id: { not: id },
        },
      });
      if (collision) {
        return NextResponse.json(
          { error: `O código INEP ${data.inepCode} já está em uso por ${collision.name}.` },
          { status: 409 }
        );
      }
    }

    const updated = await prisma.school.update({
      where: { id },
      data: {
        ...(data.name?.trim() ? { name: data.name.trim() } : {}),
        ...(data.inepCode?.trim() ? { inepCode: data.inepCode.trim() } : {}),
        ...(data.city?.trim() ? { city: data.city.trim() } : {}),
        ...(data.state?.trim() ? { state: data.state.trim().toUpperCase() } : {}),
        ...(data.nre?.trim() ? { nre: data.nre.trim() } : {}),
        ...(data.network ? { network: data.network } : {}),
        ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
        ...(data.email !== undefined ? { email: data.email?.trim() || null } : {}),
        ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl?.trim() || null } : {}),
      },
    });

    await logAudit({
      action: "UPDATE_USER",
      entityType: "School",
      entityId: id,
      details: {
        name: updated.name,
        inepCode: updated.inepCode,
        network: updated.network,
        city: updated.city,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json({ success: true, school: updated });
  } catch (error: any) {
    console.error("[PUT /api/schools/[id]] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao atualizar instituição" }, { status: 500 });
  }
}
