import { cache } from "react";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { withNeonWakeRetry } from "./neonWakeRetry";
import { cookies } from "next/headers";
import { checkIsSuperAdmin } from "./roles";
import { PlatformEdition, resolveSchoolEdition } from "./platformEditions";
import { resolveSchoolLogoProxyUrl } from "./schoolLogo";

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
  edition: PlatformEdition;
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
  edition: "PILOTO_INTEGRADA",
};

// Select enxuto: omite `logoUrl` (que pode conter SVG/imagem Base64 > 1 MB) e `syncTokenHash`
const SCHOOL_CONTEXT_SELECT = {
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
  settingsJson: true,
  networkId: true,
  updatedAt: true,
} as const;

const SCHOOL_CACHE_TTL_MS = 60 * 1000;
const schoolContextCache = new Map<string, { value: SchoolContext; expiresAt: number }>();
const schoolDirectoryCache = new Map<string, { value: unknown[]; expiresAt: number }>();

function isCacheEnabled(): boolean {
  return process.env.VITEST !== "true" && process.env.NODE_ENV !== "test";
}

function getCachedSchool(key: string): SchoolContext | null {
  if (!isCacheEnabled()) return null;
  const entry = schoolContextCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    schoolContextCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedSchool(key: string, value: SchoolContext): void {
  if (!isCacheEnabled()) return;
  schoolContextCache.set(key, {
    value,
    expiresAt: Date.now() + SCHOOL_CACHE_TTL_MS,
  });
}

export function getCachedDirectory<T>(key: string): T[] | null {
  if (!isCacheEnabled()) return null;
  const entry = schoolDirectoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    schoolDirectoryCache.delete(key);
    return null;
  }
  return entry.value as T[];
}

export function setCachedDirectory<T>(key: string, value: T[]): void {
  if (!isCacheEnabled()) return;
  schoolDirectoryCache.set(key, {
    value,
    expiresAt: Date.now() + SCHOOL_CACHE_TTL_MS,
  });
}

/**
 * Invalida os caches em memória após criação/atualização/higienização de escolas.
 */
export function invalidateSchoolCache(schoolId?: string): void {
  schoolDirectoryCache.clear();
  if (schoolId) {
    schoolContextCache.delete(schoolId);
    schoolContextCache.delete("__first__");
  } else {
    schoolContextCache.clear();
  }
}

interface SchoolSelectRecord {
  id: string;
  inepCode: string;
  name: string;
  city: string;
  state: string;
  nre: string;
  network?: string | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  active?: boolean;
  settingsJson?: string | null;
  networkId?: string | null;
  updatedAt?: Date | string | null;
}

function mapSchoolRecordToContext(school: SchoolSelectRecord): SchoolContext {
  return {
    id: school.id,
    inepCode: school.inepCode,
    name: school.name,
    city: school.city,
    state: school.state,
    nre: school.nre,
    network: school.network || "ESTADUAL",
    phone: school.phone,
    email: school.email,
    logoUrl: resolveSchoolLogoProxyUrl(school),
    edition: resolveSchoolEdition(school),
  };
}

const resolveSchoolByIdInRequest = cache(async (targetId: string): Promise<SchoolContext | null> => {
  const cached = getCachedSchool(targetId);
  if (cached) return cached;

  try {
    const school = await withNeonWakeRetry(() =>
      prisma.school.findUnique({
        where: { id: targetId },
        select: SCHOOL_CONTEXT_SELECT,
      })
    );
    if (school && school.active !== false) {
      const ctx = mapSchoolRecordToContext(school);
      setCachedSchool(targetId, ctx);
      return ctx;
    }
  } catch (err) {
    console.warn("[currentSchool] Aviso ao consultar escola por id:", err);
  }
  return null;
});

const resolveFirstActiveSchoolInRequest = cache(async (): Promise<SchoolContext> => {
  const cached = getCachedSchool("__first__");
  if (cached) return cached;

  try {
    const firstSchool = await withNeonWakeRetry(() =>
      prisma.school.findFirst({
        where: { active: true },
        orderBy: { createdAt: "asc" },
        select: SCHOOL_CONTEXT_SELECT,
      })
    );
    if (firstSchool) {
      const ctx = mapSchoolRecordToContext(firstSchool);
      setCachedSchool("__first__", ctx);
      setCachedSchool(firstSchool.id, ctx);
      return ctx;
    }

    // Se a tabela School estiver vazia, cria a escola padrão no banco de dados para garantir que a FK exista
    const created = await ensureDefaultSchool();
    if (created) {
      const ctx = mapSchoolRecordToContext(created);
      setCachedSchool("__first__", ctx);
      setCachedSchool(created.id, ctx);
      return ctx;
    }
  } catch {
    // Falha de conexão ou tabela ainda em processo de migração: fallback gracioso
    return DEFAULT_SCHOOL;
  }

  return DEFAULT_SCHOOL;
});

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

  // 1. Lê cookies antes de chamar auth() para evitar invocação desnecessária quando não há cookie nem fallback pendente
  try {
    const cookieStore = await cookies();
    const cookieVal = cookieStore.get("active_school_id")?.value?.trim();

    if (cookieVal || !schoolId || !schoolId.trim()) {
      let session: Session | null = null;
      try {
        const { auth } = await import("@/lib/auth");
        session = await auth();
      } catch {
        // Fora de contexto de autenticação / CLI / testes
      }

      if (session?.user?.schoolId) {
        sessionSchoolId = String(session.user.schoolId).trim();
      }

      if (cookieVal && session?.user) {
        const role = session.user.role;
        const isSuper = checkIsSuperAdmin(session);
        const userSchools = session.user.schools || [];
        const userNetworks = session.user.networks || [];

        let hasAccess =
          isSuper ||
          sessionSchoolId === cookieVal ||
          userSchools.some(
            (s) =>
              (s.id && s.id === cookieVal) ||
              (s.schoolId && s.schoolId === cookieVal)
          );

        // Gestor de Secretaria Municipal: acesso via cookie restrito às escolas de sua rede/município vinculado
        if (!hasAccess && role === "GESTAO_SECRETARIA" && userNetworks.length > 0) {
          const candidateSchool = await prisma.school.findUnique({
            where: { id: cookieVal },
            select: {
              id: true,
              active: true,
              city: true,
              network: true,
              networkId: true,
            },
          });
          if (candidateSchool && candidateSchool.active !== false) {
            const allowedNetIds = userNetworks
              .map((n) => n.networkId || n.id)
              .filter((id): id is string => Boolean(id));
            const allowedCities = userNetworks
              .map((n) => (n.city || n.network?.city || "").toLowerCase().trim())
              .filter(Boolean);

            const matchesNetworkId =
              Boolean(candidateSchool.networkId) &&
              allowedNetIds.includes(candidateSchool.networkId!);
            const matchesMunicipalCity =
              (candidateSchool.network || "ESTADUAL") === "MUNICIPAL" &&
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
    const resolved = isCacheEnabled()
      ? await resolveSchoolByIdInRequest(targetId)
      : await (async () => {
          try {
            const school = await prisma.school.findUnique({
              where: { id: targetId! },
              select: SCHOOL_CONTEXT_SELECT,
            });
            if (school && school.active !== false) {
              return mapSchoolRecordToContext(school);
            }
          } catch (err) {
            console.warn("[currentSchool] Aviso ao consultar escola por id:", err);
          }
          return null;
        })();

    if (resolved) return resolved;
  }

  // 4. Fallback: primeira escola ativa cadastrada no banco de dados
  if (isCacheEnabled()) {
    return resolveFirstActiveSchoolInRequest();
  }

  try {
    const firstSchool = await prisma.school.findFirst({
      where: { active: true },
      orderBy: { createdAt: "asc" },
      select: SCHOOL_CONTEXT_SELECT,
    });
    if (firstSchool) {
      return mapSchoolRecordToContext(firstSchool);
    }

    const created = await ensureDefaultSchool();
    if (created) {
      return mapSchoolRecordToContext(created);
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
  const updated = await prisma.school.update({
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
  invalidateSchoolCache(schoolId);
  return updated;
}
