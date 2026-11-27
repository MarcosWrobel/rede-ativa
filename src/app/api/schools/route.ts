import { NextResponse } from "next/server";
import { requireAuth, requireSecretariat } from "@/lib/permissions";
import { checkIsSuperAdmin, checkIsSecretariat } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { withTenantContext } from "@/lib/rlsTenantContext";
import { readSchoolsScopedCountsBatch } from "@/lib/schoolReadMetrics";
import { invalidateSchoolCache } from "@/lib/currentSchool";
import { resolveSchoolLogoProxyUrl } from "@/lib/schoolLogo";
import { resolveSchoolEdition } from "@/lib/platformEditions";
import {
  AI_EXTERNAL_FORMALIZE_POLICY_VERSION,
  parseSchoolAiExternalFormalizeFlag,
} from "@/lib/aiPolicy";
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
    networkId: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    logoUrl: z.string().optional().nullable(),
    edition: z.enum(["PILOTO_INTEGRADA", "INSTITUCIONAL_ESSENCIAL"]).optional(),
    aiExternalFormalizeEnabled: z.boolean().optional(),
    settings: z.record(z.string(), z.any()).optional().nullable(),
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
      edition: d.edition,
      networkId: d.networkId?.trim() || null,
      aiExternalFormalizeEnabled: d.aiExternalFormalizeEnabled,
      settings: d.settings || null,
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

    const isRootAdmin = checkIsSuperAdmin(authCheck.session);

    const schoolHeaderSelect = {
      id: true,
      inepCode: true,
      name: true,
      city: true,
      state: true,
      nre: true,
      network: true,
      phone: true,
      email: true,
      active: true,
      syncTokenHash: true,
      settingsJson: true,
      networkId: true,
      createdAt: true,
      updatedAt: true,
    } as const;

    let schools: any[];
    if (isRootAdmin) {
      // Administrador Geral tem visão ampla de todas as escolas ativas (sem payload Base64 de logoUrl)
      const schoolHeaders = await prisma.school.findMany({
        where: { active: true },
        select: schoolHeaderSelect,
        orderBy: [{ network: "asc" }, { name: "asc" }],
      });

      const countsBySchool = await readSchoolsScopedCountsBatch(
        schoolHeaders.map((s) => s.id),
        { includePedagogicalMinutes: true, includeActiveUserSchools: true }
      );

      schools = schoolHeaders.map((s) => {
        const counts = countsBySchool.get(s.id);
        return {
          ...s,
          _count: {
            students: counts?.students ?? 0,
            classGroups: counts?.classGroups ?? 0,
            pedagogicalMinutes: counts?.pedagogicalMinutes ?? 0,
            userSchools: counts?.userSchools ?? 0,
          },
        };
      });
    } else {
      // Servidor comum lista apenas escolas com vínculo ativo em UserSchool ou UserNetwork (por networkId)
      const userSchools = await prisma.userSchool.findMany({
        where: { userId: authCheck.userId, active: true, school: { active: true } },
        include: {
          school: {
            select: schoolHeaderSelect,
          },
        },
        orderBy: { school: { name: "asc" } },
      });

      const byId = new Map<string, any>();
      for (const us of userSchools) {
        if (!us.school || us.school.active === false) continue;
        const { syncTokenHash, ...safeSchool } = us.school as any;
        byId.set(safeSchool.id, {
          ...safeSchool,
          hasSyncToken: Boolean(syncTokenHash),
          userRole: us.role,
        });
      }

      let activeSecNetworkIds = (authCheck.snapshot?.networks || [])
        .filter(
          (n) =>
            n.active !== false &&
            n.network?.active !== false &&
            (!n.role || n.role.toUpperCase() === "GESTAO_SECRETARIA")
        )
        .map((n) => n.networkId)
        .filter(Boolean);

      if (
        !authCheck.snapshot &&
        activeSecNetworkIds.length === 0 &&
        authCheck.userId &&
        typeof (prisma as any).userNetwork?.findMany === "function"
      ) {
        const dbNets = await prisma.userNetwork.findMany({
          where: { userId: authCheck.userId, active: true },
          include: { network: true },
        });
        activeSecNetworkIds = (dbNets as any[])
          .filter(
            (un) =>
              un?.active !== false &&
              un?.network?.active !== false &&
              (!un?.role || String(un.role).toUpperCase() === "GESTAO_SECRETARIA")
          )
          .map((un) => String(un.networkId || "").trim())
          .filter(Boolean);
      }

      if (activeSecNetworkIds.length > 0 && typeof (prisma as any).school?.findMany === "function") {
        const netSchools = await prisma.school.findMany({
          where: {
            active: true,
            networkId: { in: Array.from(new Set(activeSecNetworkIds)) },
          },
          select: schoolHeaderSelect,
          orderBy: { name: "asc" },
        });
        for (const ns of netSchools as any[]) {
          if (!byId.has(ns.id)) {
            const { syncTokenHash, ...safeSchool } = ns;
            byId.set(ns.id, {
              ...safeSchool,
              hasSyncToken: Boolean(syncTokenHash),
              userRole: "GESTAO_SECRETARIA",
            });
          }
        }
      }

      const sortedHeaders = Array.from(byId.values()).sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")
      );

      const countsBySchool = await readSchoolsScopedCountsBatch(
        sortedHeaders.map((s) => s.id),
        { includePedagogicalMinutes: true }
      );

      schools = sortedHeaders.map((s) => {
        const counts = countsBySchool.get(s.id);
        return {
          ...s,
          _count: {
            students: counts?.students ?? 0,
            classGroups: counts?.classGroups ?? 0,
            pedagogicalMinutes: counts?.pedagogicalMinutes ?? 0,
          },
        };
      });
    }

    const sanitizedSchools = schools.map((s: any) => {
      const { syncTokenHash, userBySchools, ...safe } = s;
      const flag = parseSchoolAiExternalFormalizeFlag(s.settingsJson);
      return {
        ...safe,
        logoUrl: resolveSchoolLogoProxyUrl({
          id: s.id,
          logoUrl: s.logoUrl,
          updatedAt: s.updatedAt,
        }),
        edition: resolveSchoolEdition(s),
        aiExternalFormalizeEnabled: flag.verified && flag.enabled,
        hasSyncToken: safe.hasSyncToken ?? Boolean(syncTokenHash),
      };
    });

    return NextResponse.json({ success: true, schools: sanitizedSchools });
  } catch (error: any) {
    console.error("[GET /api/schools] Erro:", error);
    return NextResponse.json({ error: "Erro ao consultar instituições escolares" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireSecretariat();
    if (!authCheck.ok) return authCheck.response;

    const isSuper = checkIsSuperAdmin(authCheck.session);
    const isRoot = isSuper;
    const isSec = checkIsSecretariat(authCheck.session);

    if (!isRoot && !isSec) {
      return NextResponse.json(
        { error: "Provisionamento de novas instituições é restrito à Administração Geral ou à Secretaria Municipal de Educação." },
        { status: 403 }
      );
    }

    const rawBody = await req.json();
    const parsed = createSchoolSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    }

    const data = parsed.data;

    // Restringe a definição manual de edição e IA externa exclusivamente ao SuperAdmin
    const rawSettings = (data.settings || {}) as Record<string, any>;
    const hasReservedAiPolicySettings =
      rawSettings.aiExternalFormalizeEnabled !== undefined ||
      rawSettings.aiExternalFormalizePolicyVersion !== undefined ||
      rawSettings.aiExternalFormalizeTransitionedAt !== undefined ||
      rawSettings.aiExternalFormalizeTransitionOutcome !== undefined;
    if (
      !isSuper &&
      (data.edition !== undefined ||
        data.aiExternalFormalizeEnabled !== undefined ||
        hasReservedAiPolicySettings ||
        rawSettings.edition !== undefined ||
        rawSettings.enablePowerBiSync !== undefined)
    ) {
      return NextResponse.json(
        { error: "Apenas o SuperAdmin pode definir a edição ou configurações de IA externa da plataforma." },
        { status: 403 }
      );
    }

    if (
      data.aiExternalFormalizeEnabled === true ||
      hasReservedAiPolicySettings
    ) {
      return NextResponse.json(
        {
          error:
            "Escolas novas iniciam obrigatoriamente com a formalização externa desligada. Utilize a ação explícita de política de IA no painel.",
        },
        { status: 400 }
      );
    }

    // Gestor de Secretaria Municipal só pode provisionar escolas municipais vinculadas ao seu networkId ativo
    let secAuthorizedNetworkId: string | undefined = undefined;
    if (!isSuper && isSec) {
      if (data.network !== "MUNICIPAL") {
        return NextResponse.json(
          { error: "Gestores de Secretaria Municipal só podem cadastrar unidades da rede MUNICIPAL." },
          { status: 403 }
        );
      }

      const activeNetworksList: Array<{ networkId: string; city: string }> = [];
      for (const n of authCheck.snapshot?.networks || []) {
        if (
          n.active !== false &&
          n.network?.active !== false &&
          (!n.role || n.role.toUpperCase() === "GESTAO_SECRETARIA") &&
          n.networkId
        ) {
          activeNetworksList.push({
            networkId: n.networkId,
            city: (n.network?.city || "").toLowerCase().trim(),
          });
        }
      }
      if (activeNetworksList.length === 0) {
        const sessionNets = ((authCheck.session?.user as any)?.networks as any[]) || [];
        for (const n of sessionNets) {
          if (
            n?.active !== false &&
            n?.network?.active !== false &&
            (!n?.role || String(n.role).toUpperCase() === "GESTAO_SECRETARIA")
          ) {
            const nid = String(n.networkId || n.id || "").trim();
            if (nid) {
              activeNetworksList.push({
                networkId: nid,
                city: String(n.city || n.network?.city || "").toLowerCase().trim(),
              });
            }
          }
        }
      }
      if (
        activeNetworksList.length === 0 &&
        authCheck.userId &&
        (prisma as any).userNetwork?.findMany
      ) {
        const dbNets = await prisma.userNetwork.findMany({
          where: { userId: authCheck.userId, active: true },
          include: { network: true },
        });
        for (const un of dbNets as any[]) {
          if (
            un?.active !== false &&
            un?.network?.active !== false &&
            (!un?.role || String(un.role).toUpperCase() === "GESTAO_SECRETARIA") &&
            un?.networkId
          ) {
            activeNetworksList.push({
              networkId: String(un.networkId).trim(),
              city: String(un.network?.city || "").toLowerCase().trim(),
            });
          }
        }
      }

      const targetCityNorm = data.city.toLowerCase().trim();
      const matchedNetwork = activeNetworksList.find((n) => {
        if (data.networkId) {
          return n.networkId === data.networkId && (!n.city || n.city === targetCityNorm);
        }
        return n.city === targetCityNorm;
      });

      if (!matchedNetwork) {
        return NextResponse.json(
          { error: `Você não possui autorização para provisionar unidades fora da sua rede vinculada (${data.city}).` },
          { status: 403 }
        );
      }

      secAuthorizedNetworkId = matchedNetwork.networkId;
    }

    const effectiveNetwork = !isSuper && isSec ? "MUNICIPAL" : data.network;

    // 0. Proteção Inviolável da Escola Piloto Fundadora (INEP 41042730)
    if (data.inepCode === "41042730") {
      return NextResponse.json(
        { error: "O código INEP 41042730 pertence à Unidade Piloto Fundadora e não pode ser recriado." },
        { status: 403 }
      );
    }

    // 1. Verifica se já existe escola com este INEP
    const existing = await prisma.school.findUnique({
      where: { inepCode: data.inepCode },
      select: { id: true, name: true },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Já existe uma instituição cadastrada com o código INEP ${data.inepCode} (${existing.name}).` },
        { status: 409 }
      );
    }

    // 2. Resolve Rede Municipal (SEMEC) se aplicável
    let networkId: string | undefined = secAuthorizedNetworkId || data.networkId || undefined;
    if (!networkId && effectiveNetwork === "MUNICIPAL") {
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

    // 3. Resolve a Edição da Plataforma (Piloto Integrada vs Institucional Essencial)
    // Apenas SuperAdmin pode especificar edition manualmente; para demais perfis, herda da rede/município ou usa INSTITUCIONAL_ESSENCIAL.
    let effectiveEdition: string | undefined = isSuper
      ? data.edition || rawSettings.edition
      : undefined;

    if (data.inepCode === "41042730") {
      effectiveEdition = "PILOTO_INTEGRADA";
    } else if (!effectiveEdition && networkId && typeof (prisma as any).school?.findFirst === "function") {
      try {
        const sibling = await prisma.school.findFirst({
          where: { networkId, active: true },
          select: { settingsJson: true },
        });
        if (sibling?.settingsJson) {
          const parsedSibling = JSON.parse(sibling.settingsJson);
          if (parsedSibling.edition) {
            effectiveEdition = parsedSibling.edition;
          }
        }
      } catch {
        // Fallback silencioso
      }
    }

    if (!isSuper && !effectiveEdition) {
      effectiveEdition = "INSTITUCIONAL_ESSENCIAL";
    }

    const sanitizedSettings = data.settings
      ? Object.fromEntries(
          Object.entries(data.settings).filter(
            ([k]) =>
              k !== "aiExternalFormalizeEnabled" &&
              k !== "aiExternalFormalizePolicyVersion" &&
              k !== "aiExternalFormalizeTransitionedAt" &&
              k !== "aiExternalFormalizeTransitionOutcome" &&
              (isSuper || (k !== "edition" && k !== "enablePowerBiSync"))
          )
        )
      : null;

    const mergedSettings = {
      ...(sanitizedSettings || {}),
      ...(effectiveEdition ? { edition: effectiveEdition } : {}),
      aiExternalFormalizeEnabled: false,
      aiExternalFormalizePolicyVersion: AI_EXTERNAL_FORMALIZE_POLICY_VERSION,
    };

    // 4. Cria a nova escola no banco de dados
    const createdSchool = await prisma.school.create({
      data: {
        inepCode: data.inepCode,
        name: data.name.trim(),
        city: data.city.trim(),
        state: data.state.trim().toUpperCase(),
        nre: data.nre?.trim() || (effectiveNetwork === "MUNICIPAL" ? `SEMEC ${data.city.trim()}` : "Ponta Grossa"),
        network: effectiveNetwork,
        networkId,
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        logoUrl: data.logoUrl?.trim() || null,
        settingsJson: mergedSettings ? JSON.stringify(mergedSettings) : null,
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

    try {
      await withTenantContext(prisma, createdSchool.id, async (tx) => {
        for (const t of baseTemplates) {
          await tx.messageTemplate.create({
            data: {
              ...t,
              schoolId: createdSchool.id,
              active: true,
            },
          });
        }
      });
    } catch (err) {
      console.warn("[POST /api/schools] Erro ao injetar modelo starter:", err);
    }

    // 5. Vincula automaticamente o usuário criador como GESTOR_ESCOLAR (ou GESTAO_SECRETARIA) na nova escola, sem usar "ADMIN" legado
    if (authCheck.userId) {
      const localCreatorRole = isSec && !isSuper ? "GESTAO_SECRETARIA" : "GESTOR_ESCOLAR";
      await prisma.userSchool.upsert({
        where: {
          userId_schoolId: {
            userId: authCheck.userId,
            schoolId: createdSchool.id,
          },
        },
        update: { role: localCreatorRole, active: true },
        create: {
          userId: authCheck.userId,
          schoolId: createdSchool.id,
          role: localCreatorRole,
          active: true,
        },
      });
    }

    await logAudit({
      action: "CREATE_SCHOOL",
      entityType: "School",
      entityId: createdSchool.id,
      schoolId: createdSchool.id,
      details: {
        name: createdSchool.name,
        inepCode: createdSchool.inepCode,
        network: createdSchool.network,
        city: createdSchool.city,
        aiExternalFormalizeEnabled: false,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    invalidateSchoolCache(createdSchool.id);

    return NextResponse.json(
      {
        success: true,
        school: {
          ...createdSchool,
          aiExternalFormalizeEnabled: false,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[POST /api/schools] Erro:", error);
    return NextResponse.json({ error: "Erro ao criar instituição escolar" }, { status: 500 });
  }
}
