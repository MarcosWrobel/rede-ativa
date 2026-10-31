import { NextResponse } from "next/server";
import { requireAuth, requireAdmin, isBootstrapAdminEmail } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchoolSchema = z
  .object({
    inepCode: z.string().optional(),
    inep: z.string().optional(),
    name: z.string().min(3, "Nome da instituição deve ter no mínimo 3 caracteres"),
    city: z.string().optional(),
    municipality: z.string().optional(),
    state: z.string().default("PR"),
    nre: z.string().optional().nullable(),
    network: z.enum(["ESTADUAL", "MUNICIPAL", "PRIVADA"]).default("MUNICIPAL"),
    phone: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    logoUrl: z.string().optional().nullable(),
  })
  .transform((d) => {
    const rawInep = (d.inepCode || d.inep || "").trim();
    const rawCity = (d.city || d.municipality || "Tibagi").trim();
    const rawEmail = (d.email || "").trim() || null;
    const rawPhone = (d.phone || "").trim() || null;
    return {
      ...d,
      inepCode: rawInep,
      city: rawCity,
      email: rawEmail,
      phone: rawPhone,
      state: (d.state || "PR").trim().toUpperCase(),
    };
  })
  .refine((d) => d.inepCode.length >= 4, {
    message: "Código INEP ou identificador deve ter no mínimo 4 caracteres",
    path: ["inepCode"],
  })
  .refine((d) => !d.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email), {
    message: "E-mail institucional inválido",
    path: ["email"],
  });

export async function GET() {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const isRootAdmin = isBootstrapAdminEmail(authCheck.email);

    let schools;
    if (isRootAdmin) {
      // Administrador Geral tem visão ampla de todas as escolas cadastradas
      schools = await prisma.school.findMany({
        where: { active: true },
        include: {
          _count: {
            select: {
              students: { where: { active: true } },
              classGroups: true,
              pedagogicalMinutes: true,
              userSchools: { where: { active: true } },
            },
          },
        },
        orderBy: [{ network: "asc" }, { name: "asc" }],
      });
    } else {
      // Servidor comum lista apenas as escolas onde possui vínculo em UserSchool
      const userSchools = await prisma.userSchool.findMany({
        where: { userId: authCheck.userId, active: true },
        include: {
          school: {
            include: {
              _count: {
                select: {
                  students: { where: { active: true } },
                  classGroups: true,
                  pedagogicalMinutes: true,
                },
              },
            },
          },
        },
        orderBy: { school: { name: "asc" } },
      });

      schools = userSchools.map((us) => ({
        ...us.school,
        userRole: us.role,
      }));
    }

    return NextResponse.json({ success: true, schools });
  } catch (error: any) {
    console.error("[GET /api/schools] Erro:", error);
    return NextResponse.json({ error: "Erro ao consultar instituições escolares" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAdmin();
    if (!authCheck.ok) return authCheck.response;

    const rawBody = await req.json();
    const parsed = createSchoolSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    }

    const data = parsed.data;

    // 1. Verifica se já existe escola com este INEP
    const existing = await prisma.school.findUnique({
      where: { inepCode: data.inepCode },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Já existe uma instituição cadastrada com o código INEP ${data.inepCode} (${existing.name}).` },
        { status: 409 }
      );
    }

    // 2. Cria a nova escola no banco de dados
    const createdSchool = await prisma.school.create({
      data: {
        inepCode: data.inepCode,
        name: data.name.trim(),
        city: data.city.trim(),
        state: data.state.trim().toUpperCase(),
        nre: data.nre?.trim() || (data.network === "MUNICIPAL" ? `SEMEC ${data.city.trim()}` : "Ponta Grossa"),
        network: data.network,
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        logoUrl: data.logoUrl?.trim() || null,
        active: true,
      },
    });

    // 3. Vincula automaticamente o usuário criador como ADMIN da nova escola
    if (authCheck.userId) {
      await prisma.userSchool.upsert({
        where: {
          userId_schoolId: {
            userId: authCheck.userId,
            schoolId: createdSchool.id,
          },
        },
        update: { role: "ADMIN", active: true },
        create: {
          userId: authCheck.userId,
          schoolId: createdSchool.id,
          role: "ADMIN",
          active: true,
        },
      });
    }

    await logAudit({
      action: "CREATE_USER",
      entityType: "School",
      entityId: createdSchool.id,
      details: {
        name: createdSchool.name,
        inepCode: createdSchool.inepCode,
        network: createdSchool.network,
        city: createdSchool.city,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json({ success: true, school: createdSchool }, { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/schools] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao criar instituição escolar" }, { status: 500 });
  }
}
