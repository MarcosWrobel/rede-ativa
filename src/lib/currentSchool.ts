import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { checkIsSuperAdmin } from "./roles";

export interface SchoolContext {
  id: string;
  inepCode: string;
  name: string;
  city: string;
  state: string;
  nre: string;
  network?: string; // "ESTADUAL" | "MUNICIPAL" | "PRIVADA"
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
}

export const DEFAULT_SCHOOL: SchoolContext = {
  id: "default-leopoldina",
  inepCode: "41042730",
  name: "Colégio Estadual Leopoldina B. Pedroso",
  city: "Ponta Grossa",
  state: "PR",
  nre: "Ponta Grossa",
  network: "ESTADUAL",
  phone: "(42) 3224-0000",
  email: "leopoldinabpedroso@escola.pr.gov.br",
  logoUrl: "/logo.svg",
};

/**
 * Obtém os dados da escola atual para emissão de documentos, cabeçalhos e disparos.
 * Prioridade:
 * 1. Cookie ativo de instituição selecionada no painel (`active_school_id`) validado contra a sessão
 * 2. schoolId explicitamente fornecido (da sessão ou parâmetro)
 * 3. schoolId da sessão autenticada (fallback seguro contra cookie spoofing)
 * 4. Primeira escola ativa no banco de dados
 * 5. Fallback padrão para o Colégio Estadual Leopoldina
 */
export async function getCurrentSchool(schoolId?: string | null): Promise<SchoolContext> {
  let targetId: string | null = null;
  let sessionSchoolId: string | null = null;

  // 1. Validação estrita do cookie da instituição ativa contra a sessão autenticada
  try {
    let session: any = null;
    try {
      const { auth } = await import("@/lib/auth");
      session = await auth();
    } catch {
      // Fora de contexto de autenticação / CLI / testes
    }

    if (session?.user) {
      if ((session.user as any).schoolId) {
        sessionSchoolId = String((session.user as any).schoolId).trim();
      }
    }

    const cookieStore = await cookies();
    const cookieVal = cookieStore.get("active_school_id")?.value?.trim();

    if (cookieVal) {
      if (session?.user) {
        const role = (session.user as any).role;
        const isSuper = checkIsSuperAdmin(session);
        const userSchools = ((session.user as any).schools as any[]) || [];
        const userNetworks = ((session.user as any).networks as any[]) || [];

        let hasAccess =
          isSuper ||
          sessionSchoolId === cookieVal ||
          userSchools.some(
            (s: any) =>
              (s.id && s.id === cookieVal) ||
              (s.schoolId && s.schoolId === cookieVal)
          );

        // Gestor de Secretaria Municipal: acesso via cookie restrito às escolas de sua rede/município vinculado
        if (!hasAccess && role === "GESTAO_SECRETARIA" && userNetworks.length > 0) {
          const candidateSchool = await prisma.school.findUnique({
            where: { id: cookieVal },
          });
          if (candidateSchool && candidateSchool.active !== false) {
            const allowedNetIds = userNetworks
              .map((n: any) => n.networkId || n.id)
              .filter(Boolean);
            const allowedCities = userNetworks
              .map((n: any) => (n.city || n.network?.city || "").toLowerCase().trim())
              .filter(Boolean);

            const matchesNetworkId =
              Boolean((candidateSchool as any).networkId) &&
              allowedNetIds.includes((candidateSchool as any).networkId);
            const matchesMunicipalCity =
              ((candidateSchool as any).network || "ESTADUAL") === "MUNICIPAL" &&
              Boolean(candidateSchool.city) &&
              allowedCities.includes(candidateSchool.city.toLowerCase().trim());

            if (matchesNetworkId || matchesMunicipalCity) {
              hasAccess = true;
            }
          }
        }

        if (hasAccess) {
          targetId = cookieVal;
        } else {
          console.warn(
            `[currentSchool] Tentativa de cookie spoofing ignorada para escola ${cookieVal} por usuário ${session.user.email}`
          );
        }
      }
    }
  } catch {
    // Fora do ciclo de requisição HTTP (ex: testes unitários, scripts locais, CLI)
  }

  // 2. Se não houver cookie autorizado, utiliza o schoolId explicitamente fornecido
  if (!targetId && schoolId && schoolId.trim()) {
    targetId = schoolId.trim();
  }

  // 3. Se ainda não houver targetId mas houver schoolId na sessão, utiliza como fallback
  if (!targetId && sessionSchoolId) {
    targetId = sessionSchoolId;
  }

  if (targetId) {
    try {
      const school = await prisma.school.findUnique({
        where: { id: targetId },
      });
      if (school && school.active !== false) {
        return {
          id: school.id,
          inepCode: school.inepCode,
          name: school.name,
          city: school.city,
          state: school.state,
          nre: school.nre,
          network: (school as any).network || "ESTADUAL",
          phone: school.phone,
          email: school.email,
          logoUrl: school.logoUrl || DEFAULT_SCHOOL.logoUrl,
        };
      }
    } catch (err) {
      console.warn("[currentSchool] Aviso ao consultar escola por id:", err);
    }
  }

  // 3. Fallback: primeira escola ativa cadastrada no banco de dados
  try {
    const firstSchool = await prisma.school.findFirst({
      where: { active: true },
      orderBy: { createdAt: "asc" },
    });
    if (firstSchool) {
      return {
        id: firstSchool.id,
        inepCode: firstSchool.inepCode,
        name: firstSchool.name,
        city: firstSchool.city,
        state: firstSchool.state,
        nre: firstSchool.nre,
        network: (firstSchool as any).network || "ESTADUAL",
        phone: firstSchool.phone,
        email: firstSchool.email,
        logoUrl: firstSchool.logoUrl || DEFAULT_SCHOOL.logoUrl,
      };
    }

    // Se a tabela School estiver vazia, cria a escola padrão no banco de dados para garantir que a FK exista
    const created = await ensureDefaultSchool();
    if (created) {
      return {
        id: created.id,
        inepCode: created.inepCode,
        name: created.name,
        city: created.city,
        state: created.state,
        nre: created.nre,
        network: (created as any).network || "ESTADUAL",
        phone: created.phone,
        email: created.email,
        logoUrl: created.logoUrl || DEFAULT_SCHOOL.logoUrl,
      };
    }
  } catch {
    // Falha de conexão ou tabela ainda em processo de migração: fallback gracioso
    return DEFAULT_SCHOOL;
  }

  return DEFAULT_SCHOOL;
}

/**
 * Assegura que o registro da escola sede exista no banco de dados.
 */
export async function ensureDefaultSchool() {
  try {
    return await prisma.school.upsert({
      where: { inepCode: DEFAULT_SCHOOL.inepCode },
      update: {},
      create: {
        inepCode: DEFAULT_SCHOOL.inepCode,
        name: DEFAULT_SCHOOL.name,
        city: DEFAULT_SCHOOL.city,
        state: DEFAULT_SCHOOL.state,
        nre: DEFAULT_SCHOOL.nre,
        network: "ESTADUAL",
        phone: DEFAULT_SCHOOL.phone,
        email: DEFAULT_SCHOOL.email,
        logoUrl: DEFAULT_SCHOOL.logoUrl,
        active: true,
      },
    });
  } catch (error) {
    console.warn("[Multi-Tenancy] Falha não crítica ao assegurar escola padrão:", error);
    return null;
  }
}

/**
 * Atualiza o perfil e identidade visual de uma unidade escolar (Acesso Gestor).
 */
export async function updateSchoolProfile(
  schoolId: string,
  data: {
    name?: string;
    city?: string;
    state?: string;
    nre?: string;
    network?: string;
    phone?: string | null;
    email?: string | null;
    logoUrl?: string | null;
  }
) {
  return await prisma.school.update({
    where: { id: schoolId },
    data: {
      ...(data.name?.trim() ? { name: data.name.trim() } : {}),
      ...(data.city?.trim() ? { city: data.city.trim() } : {}),
      ...(data.state?.trim() ? { state: data.state.trim().toUpperCase() } : {}),
      ...(data.nre?.trim() ? { nre: data.nre.trim() } : {}),
      ...(data.network?.trim() ? { network: data.network.trim().toUpperCase() } : {}),
      ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
      ...(data.email !== undefined ? { email: data.email?.trim() || null } : {}),
      ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl?.trim() || null } : {}),
    },
  });
}
