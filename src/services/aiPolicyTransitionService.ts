import { prisma } from "@/lib/prisma";
import { logAuditStrict, type AuditLogWriter } from "@/lib/audit";
import { invalidateSchoolCache } from "@/lib/currentSchool";
import {
  AI_EXTERNAL_FORMALIZE_POLICY_VERSION,
  computeLegacyAiPolicyTransition,
  parseLegacyAllowedSchoolIdsForTransition,
  type AiPolicyTransitionOutcome,
  type LegacyAllowedSchoolIdsResult,
} from "@/lib/aiPolicy";
import { mutateSchoolSettingsAtomically } from "@/lib/schoolSettingsMutation";

export interface TransitionSchoolAiPoliciesOptions {
  legacyAllowedSchoolIdsRaw?: string | null;
  dryRun?: boolean;
  schoolIds?: string[];
  operator?: {
    id?: string | null;
    name?: string | null;
    email?: string | null;
  };
  transitionedAtIso?: string;
}

export interface TransitionSchoolAiPolicyItemResult {
  schoolId: string;
  inepCode: string;
  schoolName: string;
  action: "updated" | "would_update" | "skipped";
  outcome: AiPolicyTransitionOutcome;
  previousRawEnabled: boolean;
  previousEffectiveEnabled: boolean;
  nextEnabled: boolean;
}

export interface TransitionSchoolAiPoliciesReport {
  dryRun: boolean;
  policyVersion: number;
  transitionedAt: string;
  legacyList: {
    reliable: boolean;
    reason: LegacyAllowedSchoolIdsResult["reason"];
    allowedCount: number;
  };
  totals: {
    evaluated: number;
    updated: number;
    wouldUpdate: number;
    skipped: number;
    preservedEnabled: number;
    reconciledToLocalOutsideLegacyList: number;
    reconciledToLocalUnreliableLegacyList: number;
    keptLocal: number;
    alreadyPanelControlled: number;
    corruptSettingsSkipped: number;
  };
  items: TransitionSchoolAiPolicyItemResult[];
}

export async function transitionSchoolAiPoliciesToPanelControl(
  options: TransitionSchoolAiPoliciesOptions = {}
): Promise<TransitionSchoolAiPoliciesReport> {
  const dryRun = options.dryRun === true;
  const transitionedAtIso = options.transitionedAtIso || new Date().toISOString();
  const resolvedLegacyRaw =
    options.legacyAllowedSchoolIdsRaw !== undefined
      ? options.legacyAllowedSchoolIdsRaw
      : process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS;

  const legacyAllowed = parseLegacyAllowedSchoolIdsForTransition(resolvedLegacyRaw);
  const operatorId = options.operator?.id?.trim() || undefined;
  const operatorName =
    options.operator?.name?.trim() || "Transição Administrativa de Política de IA";
  const operatorEmail =
    options.operator?.email?.trim() || "transicao-ia@sistema.redeativa";

  let schoolIdsFilter: string[] | undefined;
  if (options.schoolIds !== undefined) {
    if (!Array.isArray(options.schoolIds)) {
      throw new Error("options.schoolIds deve ser um array de IDs de escola.");
    }
    schoolIdsFilter = options.schoolIds.map((s) => String(s).trim()).filter(Boolean);
    if (schoolIdsFilter.length === 0) {
      throw new Error("options.schoolIds não pode ser vazio quando informado.");
    }
  }

  const schools = await prisma.school.findMany({
    where: schoolIdsFilter !== undefined ? { id: { in: schoolIdsFilter } } : undefined,
    orderBy: { id: "asc" },
    select: {
      id: true,
      inepCode: true,
      name: true,
      settingsJson: true,
      updatedAt: true,
    },
  });

  const items: TransitionSchoolAiPolicyItemResult[] = [];
  const totals: TransitionSchoolAiPoliciesReport["totals"] = {
    evaluated: schools.length,
    updated: 0,
    wouldUpdate: 0,
    skipped: 0,
    preservedEnabled: 0,
    reconciledToLocalOutsideLegacyList: 0,
    reconciledToLocalUnreliableLegacyList: 0,
    keptLocal: 0,
    alreadyPanelControlled: 0,
    corruptSettingsSkipped: 0,
  };

  const countOutcome = (outcome: AiPolicyTransitionOutcome) => {
    switch (outcome) {
      case "preserved_enabled":
        totals.preservedEnabled += 1;
        break;
      case "reconciled_to_local_outside_legacy_list":
        totals.reconciledToLocalOutsideLegacyList += 1;
        break;
      case "reconciled_to_local_unreliable_legacy_list":
        totals.reconciledToLocalUnreliableLegacyList += 1;
        break;
      case "kept_local":
        totals.keptLocal += 1;
        break;
      case "already_panel_controlled":
        totals.alreadyPanelControlled += 1;
        break;
      case "corrupt_settings_skipped":
        totals.corruptSettingsSkipped += 1;
        break;
    }
  };

  for (const school of schools) {
    const initialDecision = computeLegacyAiPolicyTransition({
      schoolId: school.id,
      settingsJson: school.settingsJson,
      legacyAllowed,
      transitionedAtIso,
    });

    if (initialDecision.action === "skip") {
      totals.skipped += 1;
      countOutcome(initialDecision.outcome);
      items.push({
        schoolId: school.id,
        inepCode: school.inepCode,
        schoolName: school.name,
        action: "skipped",
        outcome: initialDecision.outcome,
        previousRawEnabled: initialDecision.effectiveEnabled,
        previousEffectiveEnabled: initialDecision.effectiveEnabled,
        nextEnabled: initialDecision.effectiveEnabled,
      });
      continue;
    }

    if (dryRun) {
      totals.wouldUpdate += 1;
      countOutcome(initialDecision.outcome);
      items.push({
        schoolId: school.id,
        inepCode: school.inepCode,
        schoolName: school.name,
        action: "would_update",
        outcome: initialDecision.outcome,
        previousRawEnabled: initialDecision.previousRawEnabled,
        previousEffectiveEnabled: initialDecision.previousEffectiveEnabled,
        nextEnabled: initialDecision.nextEnabled,
      });
      continue;
    }

    let appliedOutcome = initialDecision.outcome;
    let appliedPreviousRaw = initialDecision.previousRawEnabled;
    let appliedPreviousEffective = initialDecision.previousEffectiveEnabled;
    let appliedNextEnabled = initialDecision.nextEnabled;
    let skippedReason: "already_panel_controlled" | "corrupt_settings_skipped" | null = null;
    let skippedEffective = false;

    const mutation = await mutateSchoolSettingsAtomically({
      schoolId: school.id,
      requireTransaction: true,
      buildPatch: (_currentSettings, currentRow) => {
        const liveDecision = computeLegacyAiPolicyTransition({
          schoolId: currentRow.id,
          settingsJson: currentRow.settingsJson,
          legacyAllowed,
          transitionedAtIso,
        });

        if (liveDecision.action === "skip") {
          skippedReason = liveDecision.outcome;
          skippedEffective = liveDecision.effectiveEnabled;
          return {
            ok: false as const,
            status: 409,
            reason: "SKIPPED_DURING_CAS",
            error: "Escola já migrada por decisão mais recente ou com configuração inválida.",
          };
        }

        appliedOutcome = liveDecision.outcome;
        appliedPreviousRaw = liveDecision.previousRawEnabled;
        appliedPreviousEffective = liveDecision.previousEffectiveEnabled;
        appliedNextEnabled = liveDecision.nextEnabled;

        return {
          ok: true as const,
          nextSettings: liveDecision.nextSettings,
        };
      },
      afterCasInTransaction: async (tx, ctx) => {
        await logAuditStrict(
          {
            action: "TRANSITION_SCHOOL_AI_POLICY",
            entityType: "SchoolAiPolicy",
            entityId: school.id,
            schoolId: school.id,
            details: {
              schoolId: school.id,
              schoolName: ctx.updatedRow.name,
              inepCode: ctx.updatedRow.inepCode,
              operatorId: operatorId || null,
              operatorName,
              operatorEmail,
              outcome: appliedOutcome,
              legacyListReliable: legacyAllowed.reliable,
              legacyListReason: legacyAllowed.reason,
              previousRawEnabled: appliedPreviousRaw,
              previousEffectiveEnabled: appliedPreviousEffective,
              previousState: appliedPreviousEffective,
              nextState: appliedNextEnabled,
              aiExternalFormalizeEnabled: appliedNextEnabled,
              aiExternalFormalizePolicyVersion: AI_EXTERNAL_FORMALIZE_POLICY_VERSION,
              transitionedAt: transitionedAtIso,
            },
            user: {
              id: operatorId,
              name: operatorName,
              email: operatorEmail,
            },
          },
          tx as AuditLogWriter
        );
      },
    });

    if (!mutation.ok) {
      if (mutation.reason === "SKIPPED_DURING_CAS" && skippedReason) {
        totals.skipped += 1;
        countOutcome(skippedReason);
        items.push({
          schoolId: school.id,
          inepCode: school.inepCode,
          schoolName: school.name,
          action: "skipped",
          outcome: skippedReason,
          previousRawEnabled: skippedEffective,
          previousEffectiveEnabled: skippedEffective,
          nextEnabled: skippedEffective,
        });
        continue;
      }
      throw new Error(
        `Falha ao concluir transição da escola ${school.id} (${school.inepCode}): ${mutation.error}`
      );
    }

    invalidateSchoolCache(school.id);
    totals.updated += 1;
    countOutcome(appliedOutcome);
    items.push({
      schoolId: school.id,
      inepCode: school.inepCode,
      schoolName: school.name,
      action: "updated",
      outcome: appliedOutcome,
      previousRawEnabled: appliedPreviousRaw,
      previousEffectiveEnabled: appliedPreviousEffective,
      nextEnabled: appliedNextEnabled,
    });
  }

  return {
    dryRun,
    policyVersion: AI_EXTERNAL_FORMALIZE_POLICY_VERSION,
    transitionedAt: transitionedAtIso,
    legacyList: {
      reliable: legacyAllowed.reliable,
      reason: legacyAllowed.reason,
      allowedCount: legacyAllowed.ids.size,
    },
    totals,
    items,
  };
}
