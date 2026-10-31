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

    // 2. Resolve Rede Municipal (SEMEC) se aplicável
    let networkId: string | undefined = undefined;
    if (data.network === "MUNICIPAL") {
      const cleanCity = data.city.trim();
      const semecId = `semec-${cleanCity.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "-")}`;
      try {
        const net = await prisma.educationNetwork.upsert({
          where: { id: semecId },
          update: {},
          create: {
            id: semecId,
            name: `Secretaria Municipal de Educação de ${cleanCity}`,
            shortName: `SEMEC ${cleanCity}`,
            city: cleanCity,
            state: data.state.trim().toUpperCase(),
            type: "MUNICIPAL",
            logoUrl: data.logoUrl || null,
          },
        });
        networkId = net.id;
      } catch (e) {
        console.warn("[POST /api/schools] Falha não crítica ao criar rede municipal:", e);
      }
    }

    // 3. Cria a nova escola no banco de dados
    const createdSchool = await prisma.school.create({
      data: {
        inepCode: data.inepCode,
        name: data.name.trim(),
        city: data.city.trim(),
        state: data.state.trim().toUpperCase(),
        nre: data.nre?.trim() || (data.network === "MUNICIPAL" ? `SEMEC ${data.city.trim()}` : "Ponta Grossa"),
        network: data.network,
        networkId,
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        logoUrl: data.logoUrl?.trim() || null,
        active: true,
      },
    });

    // 4. Injeta Starter Pack de Modelos Pedagógicos essenciais para a nova escola
    const baseTemplates = [
      {
        title: "AUSÊNCIA HOJE - TURNO MANHÃ",
        segment: "TODOS",
        isAbsenceRelated: true,
        prefixText: "Prezados pais ou responsáveis por {aluno},\n\nIdentificamos a ausência do estudante nas aulas desta manhã.",
        suffixText: "\nSolicitamos justificativa ou contato com a equipe pedagógica para regularização da frequência escolar.",
      },
      {
        title: "AUSÊNCIA HOJE - TURNO TARDE",
        segment: "TODOS",
        isAbsenceRelated: true,
        prefixText: "Prezados pais ou responsáveis por {aluno},\n\nConstatamos a ausência do estudante nas aulas deste período da tarde.",
        suffixText: "\nFavor responder a esta mensagem informando o motivo da ausência.",
      },
      {
        title: "CONVOCAÇÃO DE RESPONSÁVEIS - INFREQUÊNCIA",
        segment: "TODOS",
        isAbsenceRelated: true,
        prefixText: "Prezados responsáveis por {aluno},\n\nSolicitamos seu comparecimento à escola para alinhamento pedagógico urgente sobre a frequência escolar do estudante.",
        suffixText: "\nPedimos que confirme o recebimento desta notificação institucional.",
      },
    ];

    for (const t of baseTemplates) {
      try {
        await prisma.messageTemplate.create({
          data: {
            ...t,
            schoolId: createdSchool.id,
            active: true,
          },
        });
      } catch (err) {
        console.warn("[POST /api/schools] Erro ao injetar modelo starter:", err);
      }
    }

    // 5. Vincula automaticamente o usuário criador como GESTOR/ADMIN da nova escola
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
