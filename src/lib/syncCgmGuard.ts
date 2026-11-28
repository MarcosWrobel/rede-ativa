import { withTenantContext } from "@/lib/rlsTenantContext";

/**
 * Utilitários server-side para blindar atualizações de CGM (@unique global no PostgreSQL)
 * durante sincronizações em lote (Power BI e SERP).
 */

interface CgmLookupPrisma {
  student: {
    findMany: (args: any) => Promise<Array<{ id?: string; cgm: string | null }>>;
    update: (args: any) => Promise<any>;
    updateMany?: (args: any) => Promise<{ count: number }>;
  };
  $transaction: (arg: any) => Promise<any>;
  $queryRaw?: <T = unknown>(query: TemplateStringsArray, ...values: any[]) => Promise<T>;
}

/**
 * Exceção explícita da Fase A (consulta global cross-tenant):
 * Consulta no banco apenas os CGMs já atribuídos globalmente (inclusive a estudantes inativos
 * ou de outras escolas) para impedir violação da restrição @unique em `Student.cgm`.
 * O retorno é restrito exclusivamente ao campo `cgm` (sem `id`, `schoolId` ou dados pessoais).
 * Na Fase B sob FORCE RLS (`RLS_CGM_SECDEF_RESOLVER=true` / `RLS_WAVE1_SECDEF_RESOLVER=true`),
 * opera via função SECURITY DEFINER dedicada (`public.resolve_taken_cgms`) que retorna apenas
 * a lista de CGMs ocupados.
 */
export async function populateGlobalTakenCgms(
  prismaClient: Pick<CgmLookupPrisma, "student"> & Partial<Pick<CgmLookupPrisma, "$queryRaw">>,
  incomingCgms: Array<string | null | undefined>,
  usedCgms: Set<string>,
  options?: { useSecDefResolver?: boolean }
): Promise<void> {
  const candidates = Array.from(
    new Set(
      incomingCgms
        .map((c) => String(c ?? "").trim())
        .filter((c) => c.length > 0 && !usedCgms.has(c))
    )
  );

  if (candidates.length === 0) return;

  const useSecDefResolver =
    options?.useSecDefResolver ??
    (process.env.RLS_CGM_SECDEF_RESOLVER === "true" ||
      process.env.RLS_WAVE1_SECDEF_RESOLVER === "true");

  const CHUNK = 1000;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const slice = candidates.slice(i, i + CHUNK);
    const existingRows =
      useSecDefResolver && typeof prismaClient.$queryRaw === "function"
        ? await prismaClient.$queryRaw<Array<{ cgm: string | null }>>`
            SELECT "cgm" FROM public.resolve_taken_cgms(${slice}::text[])
          `
        : await prismaClient.student.findMany({
            where: { cgm: { in: slice } },
            select: { cgm: true },
          });

    for (const row of existingRows) {
      const clean = row.cgm?.trim();
      if (clean) usedCgms.add(clean);
    }
  }
}

function isUniqueConstraintError(err: any): boolean {
  if (err?.code === "P2002") return true;
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("unique constraint") || msg.includes("duplicate key");
}

/**
 * Persiste vinculações pendentes de CGM em lotes transacionais, com fallback resiliente
 * caso uma corrida concorrente dispare P2002 em um registro específico.
 * Quando `schoolId` é informado, cada lote e cada retry após colisão operam em uma
 * transação própria dentro de `withTenantContext(prismaClient, schoolId, ...)`.
 */
export async function applyPendingCgmUpdatesSafely(
  prismaClient: CgmLookupPrisma,
  pendingCgmUpdates: Map<string, string>,
  schoolId?: string
): Promise<number> {
  if (pendingCgmUpdates.size === 0) return 0;

  let cgmVinculados = 0;
  const updates = Array.from(pendingCgmUpdates.entries());
  const CHUNK = 100;
  const normalizedSchoolId = schoolId?.trim() || null;

  const updateSingleStudentCgm = async (
    client: Pick<CgmLookupPrisma, "student">,
    id: string,
    cgm: string
  ): Promise<number> => {
    if (normalizedSchoolId && typeof client.student.updateMany === "function") {
      const res = await client.student.updateMany({
        where: { id, schoolId: normalizedSchoolId },
        data: { cgm },
      });
      return res.count;
    }
    await client.student.update({
      where: { id },
      data: { cgm },
    });
    return 1;
  };

  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK);
    try {
      if (normalizedSchoolId) {
        const chunkCount = await withTenantContext(
          prismaClient as any,
          normalizedSchoolId,
          async (tx) => {
            let count = 0;
            for (const [id, cgm] of slice) {
              count += await updateSingleStudentCgm(tx as any, id, cgm);
            }
            return count;
          }
        );
        cgmVinculados += chunkCount;
      } else {
        await prismaClient.$transaction(
          slice.map(([id, cgm]) =>
            prismaClient.student.update({
              where: { id },
              data: { cgm },
            })
          )
        );
        cgmVinculados += slice.length;
      }
    } catch (err: any) {
      if (!isUniqueConstraintError(err)) {
        throw err;
      }

      // Fallback isolado: cada retry abre uma nova transação válida no contexto do tenant
      for (const [id, cgm] of slice) {
        try {
          if (normalizedSchoolId) {
            const count = await withTenantContext(
              prismaClient as any,
              normalizedSchoolId,
              async (tx) => updateSingleStudentCgm(tx as any, id, cgm)
            );
            cgmVinculados += count;
          } else {
            await prismaClient.student.update({
              where: { id },
              data: { cgm },
            });
            cgmVinculados++;
          }
        } catch (itemErr: any) {
          if (isUniqueConstraintError(itemErr)) {
            console.warn(
              `[syncCgmGuard] Vinculação de CGM ${cgm} ignorada por colisão de chave única para o estudante ${id}.`
            );
          } else {
            throw itemErr;
          }
        }
      }
    }
  }

  return cgmVinculados;
}
