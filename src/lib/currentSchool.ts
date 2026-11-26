import { cache } from "react";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { withNeonWakeRetry } from "./neonWakeRetry";
import { cookies } from "next/headers";
import type { AuthSessionLike } from "./roles";
import { PlatformEdition, resolveSchoolEdition } from "./platformEditions";
import { resolveSchoolLogoProxyUrl } from "./schoolLogo";
import {
  canSnapshotAccessSchool,
  isSnapshotSuperAdmin,
  resolveServerUserAuthSnapshot,
  type ServerUserAuthSnapshot,
} from "./serverAuthContext";

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
  networkId?: string | null;
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

export class UnauthorizedSchoolError extends Error {
  readonly statusCode = 403;
  constructor(message = "Nenhuma instituição escolar autorizada vinculada à sessão atual.") {
    super(message);
    this.name = "UnauthorizedSchoolError";
  }
}

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
export const SCHOOL_CONTEXT_SELECT = {
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

const SCHOOL_DIRECTORY_CACHE_TTL_MS = 60 * 1000;
const schoolDirectoryCache = new Map<string, { value: unknown[]; expiresAt: number }>();

function isCacheEnabled(): boolean {
  return process.env.VITEST !== "true" && process.env.NODE_ENV !== "test";
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
    expiresAt: Date.now() + SCHOOL_DIRECTORY_CACHE_TTL_MS,
  });
}

/**
 * Invalida caches de diretório após criação/atualização/desativação de escolas.
 */
export function invalidateSchoolCache(_schoolId?: string): void {
  schoolDirectoryCache.clear();
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
    networkId: school.networkId ?? null,
  };
}

const resolveActiveSchoolByIdInRequest = cache(async (targetId: string): Promise<SchoolContext | null> => {
  try {
    const school = await withNeonWakeRetry(() =>
      prisma.school.findUnique({
        where: { id: targetId },
        select: SCHOOL_CONTEXT_SELECT,
      })
    );
    if (school && school.active !== false) {
      return mapSchoolRecordToContext(school);
    }
  } catch (err) {
    console.warn("[currentSchool] Aviso ao consultar escola por id:", err);
  }
  return null;
});

async function resolveSchoolContextById(targetId: string): Promise<SchoolContext | null> {
  const cleanId = targetId.trim();
  if (!cleanId) return null;

  if (isCacheEnabled()) {
    return resolveActiveSchoolByIdInRequest(cleanId);
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

/**
 * Resolve uma escola ativa diretamente pelo ID quando o fluxo já possui credencial própria
 * verificada no servidor (ex.: token de extensão da escola, CRON autorizado ou posse já validada).
 * Não realiza fallback para a primeira escola ativa nem cria registros padrão em leitura.
 */
export async function getSchoolContextByVerifiedId(
  schoolId?: string | null
): Promise<SchoolContext | null> {
  const cleanId = schoolId?.trim();
  if (!cleanId) return null;
  return resolveSchoolContextById(cleanId);
}

/**
 * Resolve estritamente a escola ativa autorizada no servidor para a sessão autenticada.
 * - Cookie `active_school_id` e `User.schoolId` expressam seleção; a autorização sempre exige
 *   vínculo ativo vigente (`UserSchool`, `UserNetwork` ou `SUPERADMIN` ativo).
 * - Nunca faz fallback para a primeira escola ativa para usuários sem vínculo ou com escola inativa.
 * - Nunca executa escrita automática (`ensureDefaultSchool`) em caminhos de leitura.
 */
export interface AuthorizedSchoolOptions {
  allowSuperAdminReadOnlyFallback?: boolean;
}

export async function getAuthorizedCurrentSchool(
  session: AuthSessionLike | null | undefined,
  explicitSchoolId?: string | null,
  preloadedSnapshot?: ServerUserAuthSnapshot | null,
  options?: AuthorizedSchoolOptions
): Promise<SchoolContext | null> {
  const snapshot = preloadedSnapshot ?? (await resolveServerUserAuthSnapshot(session));
  if (!snapshot || snapshot.active === false) {
    return null;
  }

  const isSuper = isSnapshotSuperAdmin(snapshot);

  let cookieVal: string | null = null;
  try {
    const cookieStore = await cookies();
    cookieVal = cookieStore.get("active_school_id")?.value?.trim() || null;
  } catch {
    // Fora do ciclo de requisição HTTP (ex.: testes unitários)
  }

  // Candidatos de seleção (nunca concedem autorização por si sós)
  const selectionCandidates = [
    { source: "cookie" as const, id: cookieVal },
    { source: "explicit" as const, id: explicitSchoolId?.trim() || null },
    { source: "profile" as const, id: snapshot.schoolId?.trim() || null },
  ];

  const checkedIds = new Set<string>();
  for (const candidate of selectionCandidates) {
    if (!candidate.id || checkedIds.has(candidate.id)) continue;
    checkedIds.add(candidate.id);

    const ctx = await resolveSchoolContextById(candidate.id);
    if (!ctx) continue;

    const allowed = canSnapshotAccessSchool(snapshot, {
      id: ctx.id,
      networkId: ctx.networkId ?? null,
      network: ctx.network,
      city: ctx.city,
      active: true,
    });

    if (allowed) {
      return ctx;
    }

    if (candidate.source === "cookie") {
      console.warn(
        `[currentSchool] Seleção não autorizada via cookie active_school_id descartada para usuário ${snapshot.email}`
      );
    }
  }

  // Fallback exclusivo para vínculos ativos reais do próprio usuário
  for (const link of snapshot.schools) {
    if (link.active === false) continue;
    const linkId = link.schoolId.trim();
    if (!linkId) continue;
    const ctx = await resolveSchoolContextById(linkId);
    if (ctx && canSnapshotAccessSchool(snapshot, { ...ctx, active: true })) {
      return ctx;
    }
  }

  // Fallback para escolas ativas de redes vinculadas a GESTAO_SECRETARIA
  const activeSecretariatNetworks = snapshot.networks.filter(
    (n) =>
      n.active !== false &&
      n.network?.active !== false &&
      (!n.role || n.role === "GESTAO_SECRETARIA")
  );

  if (activeSecretariatNetworks.length > 0) {
    const allowedNetIds = activeSecretariatNetworks.map((n) => n.networkId).filter(Boolean);

    if (allowedNetIds.length > 0) {
      try {
        const firstNetworkSchool = await withNeonWakeRetry(() =>
          prisma.school.findFirst({
            where: {
              active: true,
              networkId: { in: allowedNetIds },
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

  // Apenas SuperAdmin ativo sem seleção pode visualizar a primeira escola ativa existente (somente leitura)
  if (isSuper && options?.allowSuperAdminReadOnlyFallback !== false) {
    try {
      const firstSchool = await withNeonWakeRetry(() =>
        prisma.school.findFirst({
          where: { active: true },
          orderBy: { createdAt: "asc" },
          select: SCHOOL_CONTEXT_SELECT,
        })
      );
      if (firstSchool) {
        return mapSchoolRecordToContext(firstSchool);
      }
    } catch (err) {
      console.warn("[currentSchool] Aviso ao localizar primeira escola para SuperAdmin:", err);
    }
  }

  return null;
}

export async function requireAuthorizedSchool(
  session: AuthSessionLike | null | undefined,
  explicitSchoolId?: string | null,
  preloadedSnapshot?: ServerUserAuthSnapshot | null,
  options?: AuthorizedSchoolOptions
): Promise<
  | { ok: true; school: SchoolContext }
  | { ok: false; response: NextResponse }
> {
  const school = await getAuthorizedCurrentSchool(session, explicitSchoolId, preloadedSnapshot, options);
  if (!school) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Nenhuma instituição escolar autorizada vinculada à sessão atual." },
        { status: 403 }
      ),
    };
  }
  return { ok: true, school };
}

/**
 * Wrapper fail-closed de compatibilidade para chamadores ainda não migrados.
 * Nunca retorna escola não autorizada nem primeira escola ativa como fallback.
 */
export async function getCurrentSchool(schoolId?: string | null): Promise<SchoolContext> {
  let session: Session | null = null;
  try {
    const { auth } = await import("@/lib/auth");
    session = await auth();
  } catch {
    session = null;
  }

  if (session?.user) {
    const authorized = await getAuthorizedCurrentSchool(session, schoolId);
    if (!authorized) {
      throw new UnauthorizedSchoolError();
    }
    return authorized;
  }

  const cleanId = schoolId?.trim();
  if (cleanId) {
    const verified = await getSchoolContextByVerifiedId(cleanId);
    if (verified) return verified;
  }

  throw new UnauthorizedSchoolError(
    "Contexto escolar obrigatório não autorizado ou instituição inativa."
  );
}

/**
 * Provisiona explicitamente o registro da escola piloto em fluxos administrativos/seed.
 * Nunca deve ser invocado em leituras operacionais.
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
