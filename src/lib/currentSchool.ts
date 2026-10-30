import { prisma } from "@/lib/prisma";

export interface SchoolContext {
  id: string;
  inepCode: string;
  name: string;
  city: string;
  state: string;
  nre: string;
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
  phone: "(42) 3224-0000",
  email: "leopoldinabpedroso@escola.pr.gov.br",
  logoUrl: "/logo.svg",
};

/**
 * Obtém os dados da escola atual para emissão de documentos, cabeçalhos e disparos.
 * Caso nenhum id seja informado ou não haja escola cadastrada, retorna os dados padrão do Colégio Leopoldina.
 */
export async function getCurrentSchool(schoolId?: string | null): Promise<SchoolContext> {
  if (!schoolId) {
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
          phone: firstSchool.phone,
          email: firstSchool.email,
          logoUrl: firstSchool.logoUrl || DEFAULT_SCHOOL.logoUrl,
        };
      }
    } catch {
      // Falha de conexão ou tabela ainda em processo de migração: fallback gracioso
      return DEFAULT_SCHOOL;
    }
    return DEFAULT_SCHOOL;
  }

  try {
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
    });
    if (school) {
      return {
        id: school.id,
        inepCode: school.inepCode,
        name: school.name,
        city: school.city,
        state: school.state,
        nre: school.nre,
        phone: school.phone,
        email: school.email,
        logoUrl: school.logoUrl || DEFAULT_SCHOOL.logoUrl,
      };
    }
  } catch {
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
