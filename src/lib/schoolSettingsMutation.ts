import { prisma } from "@/lib/prisma";

export interface SchoolMutationRow {
  id: string;
  inepCode: string;
  name: string;
  city: string;
  state: string;
  nre: string;
  network: string;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  active: boolean;
  syncTokenHash: string | null;
  settingsJson: string | null;
  networkId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const SCHOOL_MUTATION_SELECT = {
  id: true,
  inepCode: true,
  name: true,
  city: true,
  state: true,
  nre: true,
  network: true,
  phone: true,
  email: true,
  logoUrl: true,
  active: true,
  syncTokenHash: true,
  settingsJson: true,
  networkId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type SchoolSettingsPatchOutcome =
  | {
      ok: true;
      nextSettings: Record<string, unknown>;
      extraData?: Record<string, unknown>;
      preserveEmptyObject?: boolean;
    }
  | {
      ok: false;
      status: number;
      reason: string;
      error: string;
    };

export type SchoolSettingsMutationResult =
  | {
      ok: true;
      previousRow: SchoolMutationRow;
      previousSettings: Record<string, unknown>;
      nextSettings: Record<string, unknown>;
      updatedRow: SchoolMutationRow;
    }
  | {
      ok: false;
      status: number;
      reason: string;
      error: string;
      currentRow?: SchoolMutationRow | null;
    };

function parseSettingsObject(raw: string | null | undefined):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: {} };
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return { ok: true, value: {} };
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false };
    }
    return { ok: true, value: { ...(parsed as Record<string, unknown>) } };
  } catch {
    return { ok: false };
  }
}

export function sanitizePublicSchoolSettings(
  settingsJson?: string | null
): Record<string, unknown> {
  const parsed = parseSettingsObject(settingsJson);
  if (!parsed.ok) return {};
  const copy = { ...parsed.value };
  delete copy.syncTokenEncrypted;
  return copy;
}

class AfterCasCallbackError extends Error {
  constructor(public readonly causeError: unknown) {
    super(
      causeError instanceof Error
        ? causeError.message
        : "Falha ao concluir operação complementar em transação."
    );
    this.name = "AfterCasCallbackError";
  }
}

export type SchoolSettingsTransactionContext = {
  previousRow: SchoolMutationRow;
  previousSettings: Record<string, unknown>;
  nextSettings: Record<string, unknown>;
  updatedRow: SchoolMutationRow;
  inTransaction: boolean;
};

/**
 * Executa leitura e atualização com trava otimista (Compare-And-Swap em updatedAt + settingsJson)
 * para impedir que gravações concorrentes (ex.: política de IA externa e rotação/revogação de token
 * de sincronização) ou formulários desatualizados sobrescrevam chaves independentes de settingsJson.
 */
export async function mutateSchoolSettingsAtomically(params: {
  schoolId: string;
  expectedUpdatedAt?: string | Date | null;
  maxRetries?: number;
  requireTransaction?: boolean;
  buildPatch: (
    currentSettings: Record<string, unknown>,
    currentRow: SchoolMutationRow
  ) => SchoolSettingsPatchOutcome | Promise<SchoolSettingsPatchOutcome>;
  afterCasInTransaction?: (
    db: any,
    context: SchoolSettingsTransactionContext
  ) => Promise<void>;
}): Promise<SchoolSettingsMutationResult> {
  const {
    schoolId,
    expectedUpdatedAt,
    buildPatch,
    requireTransaction = false,
    afterCasInTransaction,
  } = params;
  const hasPinnedVersion =
    expectedUpdatedAt !== undefined && expectedUpdatedAt !== null && String(expectedUpdatedAt).trim() !== "";
  const attempts = hasPinnedVersion ? 1 : Math.max(1, params.maxRetries ?? 4);

  let expectedMs: number | null = null;
  if (hasPinnedVersion) {
    const parsedDate =
      expectedUpdatedAt instanceof Date ? expectedUpdatedAt : new Date(String(expectedUpdatedAt));
    expectedMs = parsedDate.getTime();
    if (!Number.isFinite(expectedMs)) {
      return {
        ok: false,
        status: 400,
        reason: "INVALID_EXPECTED_VERSION",
        error: "Versão esperada (expectedUpdatedAt) inválida.",
      };
    }
  }

  const hasTransaction = typeof (prisma as any).$transaction === "function";
  if (requireTransaction && !hasTransaction) {
    return {
      ok: false,
      status: 500,
      reason: "TRANSACTION_UNAVAILABLE",
      error: "Persistência transacional indisponível para gravar a alteração com auditoria.",
    };
  }

  const executeAttempt = async (
    db: any,
    inTransaction: boolean
  ): Promise<
    | { done: true; result: SchoolSettingsMutationResult }
    | { done: false }
  > => {
    const currentRowRaw = await db.school.findUnique({
      where: { id: schoolId },
      select: SCHOOL_MUTATION_SELECT,
    });

    if (!currentRowRaw) {
      return {
        done: true,
        result: {
          ok: false,
          status: 404,
          reason: "NOT_FOUND",
          error: "Instituição escolar não encontrada.",
        },
      };
    }

    const currentRow = currentRowRaw as unknown as SchoolMutationRow;

    if (expectedMs !== null) {
      const currentMs = currentRow.updatedAt ? new Date(currentRow.updatedAt).getTime() : NaN;
      if (!Number.isFinite(currentMs) || currentMs !== expectedMs) {
        return {
          done: true,
          result: {
            ok: false,
            status: 409,
            reason: "CONFLICT_STALE_VERSION",
            error:
              "Os dados desta escola foram alterados por outra operação. Atualize a tela antes de salvar novamente.",
            currentRow,
          },
        };
      }
    }

    const parsedSettings = parseSettingsObject(currentRow.settingsJson);
    if (!parsedSettings.ok) {
      return {
        done: true,
        result: {
          ok: false,
          status: 409,
          reason: "CORRUPT_SETTINGS_JSON",
          error:
            "Configuração institucional em formato inválido; alteração bloqueada por segurança.",
          currentRow,
        },
      };
    }

    const patch = await buildPatch(parsedSettings.value, currentRow);
    if (!patch.ok) {
      return {
        done: true,
        result: {
          ok: false,
          status: patch.status,
          reason: patch.reason,
          error: patch.error,
          currentRow,
        },
      };
    }

    const nextKeysCount = Object.keys(patch.nextSettings).length;
    const nextSettingsJson =
      nextKeysCount > 0 || patch.preserveEmptyObject
        ? JSON.stringify(patch.nextSettings)
        : null;

    const currentMs = currentRow.updatedAt ? new Date(currentRow.updatedAt).getTime() : Date.now();
    const nextUpdatedAt = new Date(Math.max(Date.now(), currentMs + 1));
    const currentSettingsWhere = currentRow.settingsJson ?? null;

    const updatePayload = {
      ...(patch.extraData || {}),
      settingsJson: nextSettingsJson,
      updatedAt: nextUpdatedAt,
    };

    if (typeof db.school?.updateMany === "function") {
      const casWhere: Record<string, unknown> = {
        id: schoolId,
        settingsJson: currentSettingsWhere,
      };
      if (currentRow.updatedAt) {
        casWhere.updatedAt = currentRow.updatedAt;
      }

      const casResult = await db.school.updateMany({
        where: casWhere,
        data: updatePayload,
      });

      if (Number(casResult?.count) === 1) {
        const refreshed = await db.school
          .findUnique({
            where: { id: schoolId },
            select: SCHOOL_MUTATION_SELECT,
          })
          .catch(() => null);

        const updatedRow: SchoolMutationRow = refreshed
          ? ({
              ...currentRow,
              ...(refreshed as any),
              settingsJson:
                (refreshed as any).settingsJson !== undefined
                  ? (refreshed as any).settingsJson
                  : nextSettingsJson,
              updatedAt: (refreshed as any).updatedAt || nextUpdatedAt,
            } as SchoolMutationRow)
          : ({
              ...currentRow,
              ...(patch.extraData || {}),
              settingsJson: nextSettingsJson,
              updatedAt: nextUpdatedAt,
            } as SchoolMutationRow);

        if (afterCasInTransaction) {
          try {
            await afterCasInTransaction(db, {
              previousRow: currentRow,
              previousSettings: parsedSettings.value,
              nextSettings: patch.nextSettings,
              updatedRow,
              inTransaction,
            });
          } catch (auditErr) {
            throw new AfterCasCallbackError(auditErr);
          }
        }

        return {
          done: true,
          result: {
            ok: true,
            previousRow: currentRow,
            previousSettings: parsedSettings.value,
            nextSettings: patch.nextSettings,
            updatedRow,
          },
        };
      }

      if (hasPinnedVersion) {
        const latestRow = await db.school
          .findUnique({
            where: { id: schoolId },
            select: SCHOOL_MUTATION_SELECT,
          })
          .catch(() => null);
        return {
          done: true,
          result: {
            ok: false,
            status: 409,
            reason: "CONFLICT_CONCURRENT_WRITE",
            error:
              "Conflito detectado: outro operador atualizou esta escola simultaneamente. Recarregue os dados e tente novamente.",
            currentRow: (latestRow as unknown as SchoolMutationRow) || currentRow,
          },
        };
      }

      return { done: false };
    }

    // Fallback de compatibilidade exclusivo para mocks parciais que não implementam school.updateMany
    const updated = await db.school.update({
      where: { id: schoolId },
      data: {
        ...(patch.extraData || {}),
        settingsJson: nextSettingsJson,
      },
      select: SCHOOL_MUTATION_SELECT,
    });

    const updatedRow: SchoolMutationRow = {
      ...currentRow,
      ...(patch.extraData || {}),
      ...(updated as any),
      settingsJson:
        (updated as any)?.settingsJson !== undefined
          ? (updated as any).settingsJson
          : nextSettingsJson,
      updatedAt: (updated as any)?.updatedAt || nextUpdatedAt,
    };

    if (afterCasInTransaction) {
      try {
        await afterCasInTransaction(db, {
          previousRow: currentRow,
          previousSettings: parsedSettings.value,
          nextSettings: patch.nextSettings,
          updatedRow,
          inTransaction,
        });
      } catch (auditErr) {
        throw new AfterCasCallbackError(auditErr);
      }
    }

    return {
      done: true,
      result: {
        ok: true,
        previousRow: currentRow,
        previousSettings: parsedSettings.value,
        nextSettings: patch.nextSettings,
        updatedRow,
      },
    };
  };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const outcome = hasTransaction
        ? await (prisma as any).$transaction(async (tx: any) => executeAttempt(tx, true))
        : await executeAttempt(prisma, false);

      if (outcome.done) {
        return outcome.result;
      }
    } catch (err) {
      if (err instanceof AfterCasCallbackError) {
        const latestAfterRollback = await prisma.school
          .findUnique({
            where: { id: schoolId },
            select: SCHOOL_MUTATION_SELECT,
          })
          .catch(() => null);

        return {
          ok: false,
          status: 500,
          reason: "AUDIT_PERSISTENCE_FAILED",
          error:
            "Falha ao persistir o registro de auditoria da alteração. Nenhuma alteração foi mantida.",
          currentRow: (latestAfterRollback as unknown as SchoolMutationRow) || null,
        };
      }
      throw err;
    }
  }

  const latestAfterRetry = await prisma.school
    .findUnique({
      where: { id: schoolId },
      select: SCHOOL_MUTATION_SELECT,
    })
    .catch(() => null);

  return {
    ok: false,
    status: 409,
    reason: "CONFLICT_CONCURRENT_WRITE",
    error:
      "Conflito concorrente ao atualizar configurações da escola após múltiplas tentativas.",
    currentRow: (latestAfterRetry as unknown as SchoolMutationRow) || null,
  };
}
