import { cache } from "react";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { withNeonWakeRetry } from "./neonWakeRetry";
import { cookies } from "next/headers";
import { checkIsSuperAdmin, type AuthSessionLike } from "./roles";
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

/**
 * Identifica estritamente se o contexto pertence à Escola Piloto Fundadora (INEP 41042730).
 */
export function isDefaultSchoolContext(
  school: { id?: string | null; inepCode?: string | null } | null | undefined
): boolean {
  if (!school) return false;
  return school.inepCode === "41042730" || school.id === "default-leopoldina";
}

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
  educationNetwork: {
    select: {
      schools: {
        where: { active: true, settingsJson: { not: null } },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { settingsJson: true },
      },
    },
  },
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
  educationNetwork?: {
    settingsJson?: string | null;
    schools?: Array<{ settingsJson?: string | null }>;
  } | null;
  updatedAt?: Date | string | null;
}

function mapSchoolRecordToContext(school: SchoolSelectRecord): SchoolContext {
  const networkSettingsJson =
    school.educationNetwork?.settingsJson ??
    school.educationNetwork?.schools?.[0]?.settingsJson ??
    null;

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
    edition: resolveSchoolEdition(school, networkSettingsJson),
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

async function resolveSchoolContextById(targetId: string): Promise<SchoolContext | null> {
  const cleanId = targetId.trim();
  if (!cleanId) return null;

  if (isCacheEnabled()) {
    return resolveSchoolByIdInRequest(cleanId);
  }

  try {
    const school = await prisma.school.findUnique({
      where: { id: cleanId },
      select: SCHOOL_CONTEXT_SELECT,
    });
    if (school && school.active !== false) {
      return mapSchoolRecordToContext(school);
    }
  } catch (err) {
    console.warn("[currentSchool] Aviso ao consultar escola por id:", err);
  }
  return null;
}

async function canSessionAccessCandidateSchool(params: {
  candidateId: string;
  isSuper: boolean;
  role: string;
  sessionSchoolId: string | null;
  userSchools: NonNullable<AuthSessionLike["user"]>["schools"];
  userNetworks: NonNullable<AuthSessionLike["user"]>["networks"];
  userEmail?: string | null;
}): Promise<boolean> {
  const {
    candidateId,
    isSuper,
    role,
    sessionSchoolId,
    userSchools = [],
    userNetworks = [],
    userEmail,
  } = params;

  if (isSuper) return true;
  if (sessionSchoolId && sessionSchoolId === candidateId) return true;
  if (
    userSchools.some(
      (s) =>
        s.active !== false &&
        ((s.id && s.id === candidateId) || (s.schoolId && s.schoolId === candidateId))
    )
  ) {
    return true;
  }

  if (role === "GESTAO_SECRETARIA" && userNetworks.length > 0) {
    try {
      const candidateSchool = await prisma.school.findUnique({
        where: { id: candidateId },
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
          return true;
        }
      }
    } catch (err) {
      console.warn("[currentSchool] Aviso ao validar acesso de rede à escola:", err);
    }
  }

  if (userEmail) {
    console.warn(
      `[currentSchool] Tentativa de cookie spoofing ignorada para escola ${candidateId} por usuário ${userEmail}`
    );
  }
  return false;
}

/**
 * Resolve estritamente a escola autorizada para a sessão autenticada sem fallback para a Escola Piloto
 * quando a conta não possui vínculo escolar ou de rede válido.
 */
export async function getAuthorizedCurrentSchool(
  session: AuthSessionLike | null | undefined,
  explicitSchoolId?: string | null
): Promise<SchoolContext | null> {
  if (!session?.user || session.user.active === false) {
    return null;
  }

  const isSuper = checkIsSuperAdmin(session);
  const role = (session.user.role || "").toUpperCase();
  const sessionSchoolId = session.user.schoolId ? String(session.user.schoolId).trim() : null;
  const userSchools = session.user.schools || [];
  const userNetworks = session.user.networks || [];
  const userEmail = session.user.email ?? null;

  let cookieVal: string | null = null;
  try {
    const cookieStore = await cookies();
    cookieVal = cookieStore.get("active_school_id")?.value?.trim() || null;
  } catch {
    // Fora do ciclo de requisição HTTP (ex.: testes unitários)
  }

  if (cookieVal) {
    const allowedCookie = await canSessionAccessCandidateSchool({
      candidateId: cookieVal,
      isSuper,
      role,
      sessionSchoolId,
      userSchools,
      userNetworks,
      userEmail,
    });
    if (allowedCookie) {
      const ctx = await resolveSchoolContextById(cookieVal);
      if (ctx) return ctx;
    }
  }

  const cleanExplicitId = explicitSchoolId?.trim() || null;
  if (cleanExplicitId) {
    const allowedExplicit = await canSessionAccessCandidateSchool({
      candidateId: cleanExplicitId,
      isSuper,
      role,
      sessionSchoolId,
      userSchools,
      userNetworks,
      userEmail,
    });
    if (allowedExplicit) {
      const ctx = await resolveSchoolContextById(cleanExplicitId);
      if (ctx) return ctx;
    }
  }

  if (sessionSchoolId) {
    const ctx = await resolveSchoolContextById(sessionSchoolId);
    if (ctx) return ctx;
  }

  for (const link of userSchools) {
    if (link.active === false) continue;
    const linkId = (link.schoolId || link.id || "").trim();
    if (!linkId) continue;
    const ctx = await resolveSchoolContextById(linkId);
    if (ctx) return ctx;
  }

  if (role === "GESTAO_SECRETARIA" && userNetworks.length > 0) {
    const allowedNetIds = userNetworks
      .map((n) => n.networkId || n.id)
      .filter((id): id is string => Boolean(id));
    const allowedCities = userNetworks
      .map((n) => (n.city || n.network?.city || "").trim())
      .filter(Boolean);

    const networkOrConditions: Array<Record<string, unknown>> = [];
    if (allowedNetIds.length > 0) {
      networkOrConditions.push({ networkId: { in: allowedNetIds } });
    }
    for (const city of allowedCities) {
      networkOrConditions.push({
        network: "MUNICIPAL",
        city: { equals: city, mode: "insensitive" },
      });
    }

    if (networkOrConditions.length > 0) {
      try {
        const firstNetworkSchool = await withNeonWakeRetry(() =>
          prisma.school.findFirst({
            where: {
              active: true,
              OR: networkOrConditions,
            },
            orderBy: { createdAt: "asc" },
            select: SCHOOL_CONTEXT_SELECT,
          })
        );
        if (firstNetworkSchool) {
          return mapSchoolRecordToContext(firstNetworkSchool);
        }
      } catch (err) {
        console.warn("[currentSchool] Aviso ao localizar escola autorizada da rede:", err);
      }
    }
  }

  if (isSuper) {
    return await resolveFirstActiveSchoolInRequest();
  }

  return null;
}

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
        const hasAccess = await canSessionAccessCandidateSchool({
          candidateId: cookieVal,
          isSuper: checkIsSuperAdmin(session),
          role: (session.user.role || "").toUpperCase(),
          sessionSchoolId,
          userSchools: session.user.schools || [],
          userNetworks: session.user.networks || [],
          userEmail: session.user.email ?? null,
        });

        if (hasAccess) {
          targetId = cookieVal;
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
    const resolved = await resolveSchoolContextById(targetId);
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
