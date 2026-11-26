#!/usr/bin/env node
/**
 * Transição idempotente e fail-closed das autorizações legadas de IA externa
 * (`AI_FORMALIZE_ALLOWED_SCHOOL_IDS` + `settingsJson.aiExternalFormalizeEnabled`)
 * para controle explícito por escola em `/admin/escolas` (`aiExternalFormalizePolicyVersion: 2`).
 *
 * Nunca carrega `.env` automaticamente: depende exclusivamente das variáveis de ambiente do processo.
 */
import { PrismaClient } from "@prisma/client";

const AI_EXTERNAL_FORMALIZE_POLICY_VERSION = 2;

function parseLegacyAllowedSchoolIdsForTransition(raw) {
  if (raw === undefined || raw === null) {
    return { reliable: false, reason: "missing_legacy_list", ids: new Set() };
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return { reliable: false, reason: "empty_legacy_list", ids: new Set() };
  }

  const tokens = trimmed.split(",").map((item) => item.trim());
  const ids = new Set();
  const validTokenRegex = /^[A-Za-z0-9_-]{2,128}$/;

  for (const token of tokens) {
    if (!token) continue;
    const lowered = token.toLowerCase();
    if (token === "*" || lowered === "all") {
      return { reliable: false, reason: "wildcard_not_allowed", ids: new Set() };
    }
    if (!validTokenRegex.test(token)) {
      return { reliable: false, reason: "malformed_legacy_list", ids: new Set() };
    }
    ids.add(token);
  }

  if (ids.size === 0) {
    return { reliable: false, reason: "empty_legacy_list", ids: new Set() };
  }

  return { reliable: true, reason: "valid_legacy_list", ids };
}

function parseSettingsForTransition(settingsJson) {
  if (settingsJson === undefined || settingsJson === null) {
    return { valid: true, obj: {}, rawEnabled: false, rawVersion: undefined };
  }
  const trimmed = String(settingsJson).trim();
  if (!trimmed) {
    return { valid: true, obj: {}, rawEnabled: false, rawVersion: undefined };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { valid: false, obj: {}, rawEnabled: false, rawVersion: undefined };
    }
    const rawEnabledVal = parsed.aiExternalFormalizeEnabled;
    if (rawEnabledVal !== undefined && typeof rawEnabledVal !== "boolean") {
      return { valid: false, obj: {}, rawEnabled: false, rawVersion: undefined };
    }
    const rawVersionVal = parsed.aiExternalFormalizePolicyVersion;
    if (rawVersionVal !== undefined && rawVersionVal !== 1 && rawVersionVal !== 2) {
      return { valid: false, obj: {}, rawEnabled: false, rawVersion: undefined };
    }
    return {
      valid: true,
      obj: { ...parsed },
      rawEnabled: rawEnabledVal === true,
      rawVersion: rawVersionVal,
    };
  } catch {
    return { valid: false, obj: {}, rawEnabled: false, rawVersion: undefined };
  }
}

function computeTransitionDecision({ schoolId, settingsJson, legacyAllowed, transitionedAtIso }) {
  const parsed = parseSettingsForTransition(settingsJson);
  if (!parsed.valid) {
    return {
      action: "skip",
      outcome: "corrupt_settings_skipped",
      effectiveEnabled: false,
    };
  }

  if (parsed.rawVersion === AI_EXTERNAL_FORMALIZE_POLICY_VERSION) {
    return {
      action: "skip",
      outcome: "already_panel_controlled",
      effectiveEnabled: parsed.rawEnabled,
    };
  }

  let nextEnabled = false;
  let outcome = "kept_local";
  if (parsed.rawEnabled && legacyAllowed.reliable && legacyAllowed.ids.has(schoolId)) {
    nextEnabled = true;
    outcome = "preserved_enabled";
  } else if (parsed.rawEnabled && legacyAllowed.reliable) {
    nextEnabled = false;
    outcome = "reconciled_to_local_outside_legacy_list";
  } else if (parsed.rawEnabled) {
    nextEnabled = false;
    outcome = "reconciled_to_local_unreliable_legacy_list";
  }

  return {
    action: "update",
    outcome,
    previousRawEnabled: parsed.rawEnabled,
    previousEffectiveEnabled: false,
    nextEnabled,
    nextSettings: {
      ...parsed.obj,
      aiExternalFormalizeEnabled: nextEnabled,
      aiExternalFormalizePolicyVersion: AI_EXTERNAL_FORMALIZE_POLICY_VERSION,
      aiExternalFormalizeTransitionedAt: transitionedAtIso,
      aiExternalFormalizeTransitionOutcome: outcome,
    },
  };
}

function parseCliArgs(argv) {
  let dryRun = false;
  let legacyAllowedRaw = process.env.AI_FORMALIZE_ALLOWED_SCHOOL_IDS;
  let schoolIds = null;

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--no-legacy-list") {
      legacyAllowedRaw = undefined;
    } else if (arg.startsWith("--legacy-allowed-ids=")) {
      legacyAllowedRaw = arg.slice("--legacy-allowed-ids=".length);
    } else if (arg.startsWith("--school-ids=")) {
      const parsedSchoolIds = arg
        .slice("--school-ids=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (parsedSchoolIds.length === 0) {
        throw new Error("O parâmetro --school-ids= requer ao menos um ID de escola válido.");
      }
      schoolIds = parsedSchoolIds;
    } else {
      throw new Error(`Argumento não reconhecido: ${arg}`);
    }
  }

  return { dryRun, legacyAllowedRaw, schoolIds };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não definida no ambiente.");
  }

  const { dryRun, legacyAllowedRaw, schoolIds } = parseCliArgs(process.argv.slice(2));
  const legacyAllowed = parseLegacyAllowedSchoolIdsForTransition(legacyAllowedRaw);
  const transitionedAtIso = new Date().toISOString();

  const prisma = new PrismaClient();
  try {
    const schools = await prisma.school.findMany({
      where: schoolIds !== null ? { id: { in: schoolIds } } : undefined,
      orderBy: { id: "asc" },
      select: {
        id: true,
        inepCode: true,
        name: true,
        settingsJson: true,
        updatedAt: true,
      },
    });

    const totals = {
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
    const items = [];

    const countOutcome = (outcome) => {
      if (outcome === "preserved_enabled") totals.preservedEnabled += 1;
      else if (outcome === "reconciled_to_local_outside_legacy_list") totals.reconciledToLocalOutsideLegacyList += 1;
      else if (outcome === "reconciled_to_local_unreliable_legacy_list") totals.reconciledToLocalUnreliableLegacyList += 1;
      else if (outcome === "kept_local") totals.keptLocal += 1;
      else if (outcome === "already_panel_controlled") totals.alreadyPanelControlled += 1;
      else if (outcome === "corrupt_settings_skipped") totals.corruptSettingsSkipped += 1;
    };

    for (const school of schools) {
      const initial = computeTransitionDecision({
        schoolId: school.id,
        settingsJson: school.settingsJson,
        legacyAllowed,
        transitionedAtIso,
      });

      if (initial.action === "skip") {
        totals.skipped += 1;
        countOutcome(initial.outcome);
        items.push({
          schoolId: school.id,
          inepCode: school.inepCode,
          schoolName: school.name,
          action: "skipped",
          outcome: initial.outcome,
          previousRawEnabled: initial.effectiveEnabled,
          previousEffectiveEnabled: initial.effectiveEnabled,
          nextEnabled: initial.effectiveEnabled,
        });
        continue;
      }

      if (dryRun) {
        totals.wouldUpdate += 1;
        countOutcome(initial.outcome);
        items.push({
          schoolId: school.id,
          inepCode: school.inepCode,
          schoolName: school.name,
          action: "would_update",
          outcome: initial.outcome,
          previousRawEnabled: initial.previousRawEnabled,
          previousEffectiveEnabled: initial.previousEffectiveEnabled,
          nextEnabled: initial.nextEnabled,
        });
        continue;
      }

      let recorded = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const res = await prisma.$transaction(async (tx) => {
          const current = await tx.school.findUnique({
            where: { id: school.id },
            select: {
              id: true,
              inepCode: true,
              name: true,
              settingsJson: true,
              updatedAt: true,
            },
          });
          if (!current) {
            return { status: "not_found" };
          }
          const liveDecision = computeTransitionDecision({
            schoolId: current.id,
            settingsJson: current.settingsJson,
            legacyAllowed,
            transitionedAtIso,
          });
          if (liveDecision.action === "skip") {
            return { status: "skip", decision: liveDecision };
          }
          const nextSettingsJson = JSON.stringify(liveDecision.nextSettings);
          const nextUpdatedAt = new Date(
            Math.max(Date.now(), new Date(current.updatedAt).getTime() + 1)
          );
          const cas = await tx.school.updateMany({
            where: {
              id: current.id,
              settingsJson: current.settingsJson ?? null,
              updatedAt: current.updatedAt,
            },
            data: {
              settingsJson: nextSettingsJson,
              updatedAt: nextUpdatedAt,
            },
          });
          if (cas.count !== 1) {
            return { status: "retry" };
          }
          await tx.auditLog.create({
            data: {
              userId: null,
              userEmail: "transicao-ia@sistema.redeativa",
              userName: "Script de Transição de Política de IA",
              action: "TRANSITION_SCHOOL_AI_POLICY",
              entityType: "SchoolAiPolicy",
              entityId: current.id,
              schoolId: current.id,
              details: JSON.stringify({
                schoolId: current.id,
                schoolName: current.name,
                inepCode: current.inepCode,
                outcome: liveDecision.outcome,
                legacyListReliable: legacyAllowed.reliable,
                legacyListReason: legacyAllowed.reason,
                previousRawEnabled: liveDecision.previousRawEnabled,
                previousEffectiveEnabled: liveDecision.previousEffectiveEnabled,
                previousState: liveDecision.previousEffectiveEnabled,
                nextState: liveDecision.nextEnabled,
                aiExternalFormalizeEnabled: liveDecision.nextEnabled,
                aiExternalFormalizePolicyVersion: AI_EXTERNAL_FORMALIZE_POLICY_VERSION,
                transitionedAt: transitionedAtIso,
              }),
              ipAddress: null,
            },
          });
          return { status: "updated", current, decision: liveDecision };
        });

        if (res.status === "retry") continue;
        recorded = res;
        break;
      }

      if (!recorded || recorded.status === "retry" || recorded.status === "not_found") {
        throw new Error(`Falha ao concluir transição CAS da escola ${school.id}`);
      }

      if (recorded.status === "skip") {
        totals.skipped += 1;
        countOutcome(recorded.decision.outcome);
        items.push({
          schoolId: school.id,
          inepCode: school.inepCode,
          schoolName: school.name,
          action: "skipped",
          outcome: recorded.decision.outcome,
          previousRawEnabled: recorded.decision.effectiveEnabled,
          previousEffectiveEnabled: recorded.decision.effectiveEnabled,
          nextEnabled: recorded.decision.effectiveEnabled,
        });
      } else {
        totals.updated += 1;
        countOutcome(recorded.decision.outcome);
        items.push({
          schoolId: school.id,
          inepCode: school.inepCode,
          schoolName: school.name,
          action: "updated",
          outcome: recorded.decision.outcome,
          previousRawEnabled: recorded.decision.previousRawEnabled,
          previousEffectiveEnabled: recorded.decision.previousEffectiveEnabled,
          nextEnabled: recorded.decision.nextEnabled,
        });
      }
    }

    console.log(
      JSON.stringify(
        {
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
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[transition_ai_policy_to_panel] Erro:", err);
  process.exit(1);
});
