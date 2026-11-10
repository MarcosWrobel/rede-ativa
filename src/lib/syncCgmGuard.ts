/**
 * Utilitários server-side para blindar atualizações de CGM (@unique global no PostgreSQL)
 * durante sincronizações em lote (Power BI e SERP).
 */

interface CgmLookupPrisma {
  student: {
    findMany: (args: any) => Promise<Array<{ id: string; cgm: string | null }>>;
    update: (args: any) => Promise<any>;
  };
  $transaction: (ops: Array<Promise<any>>) => Promise<any>;
}

/**
 * Consulta no banco todos os CGMs já atribuídos globalmente (inclusive a estudantes inativos
 * ou de outras escolas) para impedir violação da restrição @unique em `Student.cgm`.
 */
export async function populateGlobalTakenCgms(
  prismaClient: Pick<CgmLookupPrisma, "student">,
  incomingCgms: Array<string | null | undefined>,
  usedCgms: Set<string>
): Promise<void> {
  const candidates = Array.from(
    new Set(
      incomingCgms
        .map((c) => String(c ?? "").trim())
        .filter((c) => c.length > 0 && !usedCgms.has(c))
    )
  );

  if (candidates.length === 0) return;

  const CHUNK = 1000;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const slice = candidates.slice(i, i + CHUNK);
    const existingRows = await prismaClient.student.findMany({
      where: { cgm: { in: slice } },
      select: { id: true, cgm: true },
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
 */
export async function applyPendingCgmUpdatesSafely(
  prismaClient: CgmLookupPrisma,
  pendingCgmUpdates: Map<string, string>
): Promise<number> {
  if (pendingCgmUpdates.size === 0) return 0;

  let cgmVinculados = 0;
  const updates = Array.from(pendingCgmUpdates.entries());
  const CHUNK = 100;

  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK);
    try {
      await prismaClient.$transaction(
        slice.map(([id, cgm]) =>
          prismaClient.student.update({
            where: { id },
            data: { cgm },
          })
        )
      );
      cgmVinculados += slice.length;
    } catch (err: any) {
      if (!isUniqueConstraintError(err)) {
        throw err;
      }

      // Fallback isolado: aplica item a item ignorando apenas colisões P2002 concorrentes
      for (const [id, cgm] of slice) {
        try {
          await prismaClient.student.update({
            where: { id },
            data: { cgm },
          });
          cgmVinculados++;
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
