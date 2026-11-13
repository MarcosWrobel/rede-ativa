/**
 * Protocolo único de serialização transacional para mutações sobre atas pedagógicas.
 * Garante ordem global acíclica de bloqueios (`minute_write_*` -> `seq_ata_*`)
 * sem fallback silencioso caso a conexão/mock não implemente `$executeRaw`.
 */

export interface MinuteLockTxLike {
  $executeRaw?: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}

/**
 * Adquire lock transacional exclusivo para uma ata pedagógica durante a transação ativa.
 * Deve ser chamado antes de ler/revalidar participantes, tokens de assinatura,
 * gravação de assinaturas móveis/OIDC, edição de rascunho ou finalização.
 */
export async function acquireMinuteWriteLock(
  tx: MinuteLockTxLike,
  minuteId: string
): Promise<void> {
  if (!tx || typeof tx.$executeRaw !== "function") {
    throw new Error("Lock transacional indisponível na conexão Prisma ($executeRaw ausente).");
  }
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext('minute_write_' || ${minuteId}));
  `;
}

/**
 * Adquire lock transacional exclusivo por escola e ano para emissão atômica do
 * número sequencial da ata. Sempre deve ser adquirido APÓS `acquireMinuteWriteLock`.
 */
export async function acquireSchoolYearSeqLock(
  tx: MinuteLockTxLike,
  schoolId: string,
  year: number
): Promise<void> {
  if (!tx || typeof tx.$executeRaw !== "function") {
    throw new Error("Lock transacional indisponível na conexão Prisma ($executeRaw ausente).");
  }
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext('seq_ata_' || ${schoolId} || '_' || ${String(year)}));
  `;
}
