import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

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
 * 1. Cookie ativo de instituição selecionada no painel (`active_school_id`)
 * 2. schoolId explicitamente fornecido (da sessão ou parâmetro)
 * 3. Primeira escola ativa no banco de dados
 * 4. Fallback padrão para o Colégio Estadual Leopoldina
 */
export async function getCurrentSchool(schoolId?: string | null): Promise<SchoolContext> {
  let targetId: string | null = null;

  // 1. Prioridade máxima: cookie da instituição ativa selecionada pelo usuário no painel
  try {
    const cookieStore = await cookies();
    const cookieVal = cookieStore.get("active_school_id")?.value;
    if (cookieVal && cookieVal.trim()) {
      targetId = cookieVal.trim();
    }
  } catch {
    // Fora do ciclo de requisição HTTP (ex: testes unitários, scripts locais, CLI)
  }

  // 2. Se não houver cookie, utiliza o schoolId explicitamente fornecido
  if (!targetId && schoolId && schoolId.trim()) {
    targetId = schoolId.trim();
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
