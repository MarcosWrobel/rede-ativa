import { logAudit } from "@/lib/audit";

export type AiExecutionMode =
  | "EXTERNAL_AI"
  | "LOCAL_FALLBACK"
  | "LOCAL_POLICY_GUARD"
  | "LOCAL_ONLY";

const DISALLOWED_ATTACHMENT_KEYS = new Set([
  "screenshotDataUrl",
  "attachments",
  "attachment",
  "image",
  "images",
  "file",
  "files",
  "media",
]);

export const MAX_EXTERNAL_AI_INPUT_CHARS = 4000;

export const APPROVED_EXTERNAL_AI_CATEGORIES = new Set([
  "ACOMPANHAMENTO_PEDAGOGICO",
  "BUSCA_ATIVA_FALTAS",
  "ORIENTACAO_DOCENTE",
  "ORIENTACAO_ROTINA",
]);

const SENSITIVE_CATEGORIES = new Set([
  "CONSELHO_TUTELAR",
  "REDE_PROTECAO",
  "REDE_PROTECAO_CT",
  "SAUDE_MENTAL",
  "SAUDE_VULNERABILIDADE",
  "CONVIVENCIA_INDISCIPLINA",
  "MEDIDA_PROTETIVA",
  "VIOLENCIA",
  "SIGILOSA",
]);

const SENSITIVE_CONTENT_PATTERNS: RegExp[] = [
  /\bconselho\s+tutelar\b/i,
  /\bminist[ée]rio\s+p[úu]blico\b/i,
  /\bboletim\s+de\s+ocorr[êe]ncia\b/i,
  /\bmedida\s+protetiva\b/i,
  /\b(?:viol[êe]ncia|agress[ãa]o|maus[-\s]?tratos|abuso|ass[ée]dio)\b/i,
  /\b(?:autoles[ãa]o|automutila[çc][ãa]o|suic[íi]d|ideia[çc][ãa]o)\b/i,
  /\b(?:laudo\s+m[ée]dico|atestado\s+m[ée]dico|CID[-\s]?\d*|medica[çc][ãa]o|psiquiatr|psicol[óo]g|sa[úu]de\s+mental)\b/i,
  /\b(?:delegacia|pol[íi]cia\s+militar|pol[íi]cia\s+civil|patrulha\s+escolar|CREAS|CRAS|CAPS)\b/i,
  /\b(?:sigilo\s+refor[çc]ado|confidencial)\b/i,
  /\b(?:processo\s+judicial|vara\s+da\s+inf[âa]ncia|defensoria\s+p[úu]blica|segredo\s+de\s+justi[çc]a|autos\s+(?:do\s+processo|judiciais|infracionais))\b/i,
  /\bB\.?O\.?\b/i,
  /\b(?:vulnerabilidade|neglig[êe]ncia|bullying|amea[çc]a)\b/i,
  /\b(?:diagn[óo]stico|laudo|receita\s+m[ée]dica|transtorno|TDAH|TEA|autismo|depress[ãa]o|ansiedade|interna[çc][ãa]o|prontu[áa]rio|UPA|UBS|hospital|SUS|CNS|NIS)\b/i,
];

function cleanEnvSecret(raw?: string | null): string | null {
  const cleaned = raw?.replace(/^["']|["']$/g, "").trim();
  return cleaned && cleaned.length > 10 ? cleaned : null;
}

/**
 * Credencial externa exclusiva do servidor.
 * Nunca utiliza chaves enviadas pelo navegador (`x-gemini-key` ou `body.apiKey`).
 */
export function getServerGeminiApiKey(): string | null {
  return (
    cleanEnvSecret(process.env.GEMINI_API_KEY) ||
    cleanEnvSecret(process.env.GOOGLE_API_KEY) ||
    cleanEnvSecret(process.env.GOOGLE_GENAI_API_KEY)
  );
}

export function isExternalFormalizeEnabledGlobally(): boolean {
  return (process.env.AI_FORMALIZE_EXTERNAL_ENABLED || "").trim().toLowerCase() === "true";
}

export interface ExternalAiServerStatus {
  provider: "google_gemini";
  providerLabel: string;
  globalEnabled: boolean;
  credentialConfigured: boolean;
  available: boolean;
  unavailableReason: "disabled_globally" | "missing_credential" | null;
}

/**
 * Resume se o provedor, o controle geral e a credencial externa estão configurados no servidor.
 * Não expõe segredos ou chaves privadas para a interface.
 */
export function getExternalFormalizeServerStatus(): ExternalAiServerStatus {
  const globalEnabled = isExternalFormalizeEnabledGlobally();
  const credentialConfigured = Boolean(getServerGeminiApiKey());
  const available = globalEnabled && credentialConfigured;
  const unavailableReason = !globalEnabled
    ? "disabled_globally"
    : !credentialConfigured
      ? "missing_credential"
      : null;

  return {
    provider: "google_gemini",
    providerLabel: "Provedor configurado no servidor",
    globalEnabled,
    credentialConfigured,
    available,
    unavailableReason,
  };
}

export function hasDisallowedAttachmentPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const queue: unknown[] = [payload];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        if (typeof item === "string" && /data:(?:image|application\/pdf)\//i.test(item)) {
          return true;
        }
        if (item && typeof item === "object") {
          queue.push(item);
        }
      }
      continue;
    }

    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      if (DISALLOWED_ATTACHMENT_KEYS.has(key)) {
        if (Array.isArray(value) && value.length > 0) return true;
        if (typeof value === "string" && value.trim().length > 0) return true;
        if (value && typeof value === "object" && !Array.isArray(value)) return true;
      }
      if (typeof value === "string" && /data:(?:image|application\/pdf)\//i.test(value)) {
        return true;
      }
      if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return false;
}

export const AI_EXTERNAL_FORMALIZE_POLICY_VERSION = 2 as const;

export interface ParsedSchoolAiPolicy {
  verified: boolean;
  enabled: boolean;
  panelControlled: boolean;
  legacyFlagPendingTransition: boolean;
  rawStoredEnabled: boolean;
}

export interface LegacyAllowedSchoolIdsResult {
  reliable: boolean;
  reason:
    | "valid_legacy_list"
    | "missing_legacy_list"
    | "empty_legacy_list"
    | "wildcard_not_allowed"
    | "malformed_legacy_list";
  ids: Set<string>;
}

export type AiPolicyTransitionOutcome =
  | "preserved_enabled"
  | "reconciled_to_local_outside_legacy_list"
  | "reconciled_to_local_unreliable_legacy_list"
  | "kept_local"
  | "already_panel_controlled"
  | "corrupt_settings_skipped";

export type AiPolicyTransitionDecision =
  | {
      action: "update";
      outcome: Exclude<
        AiPolicyTransitionOutcome,
        "already_panel_controlled" | "corrupt_settings_skipped"
      >;
      previousRawEnabled: boolean;
      previousEffectiveEnabled: boolean;
      nextEnabled: boolean;
      nextSettings: Record<string, unknown>;
    }
  | {
      action: "skip";
      outcome: "already_panel_controlled" | "corrupt_settings_skipped";
      effectiveEnabled: boolean;
    };

export function parseSchoolAiExternalFormalizeFlag(
  settingsJson?: string | null
): ParsedSchoolAiPolicy {
  if (settingsJson === undefined || settingsJson === null) {
    return {
      verified: true,
      enabled: false,
      panelControlled: false,
      legacyFlagPendingTransition: false,
      rawStoredEnabled: false,
    };
  }
  const trimmed = String(settingsJson).trim();
  if (!trimmed) {
    return {
      verified: true,
      enabled: false,
      panelControlled: false,
      legacyFlagPendingTransition: false,
      rawStoredEnabled: false,
    };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        verified: false,
        enabled: false,
        panelControlled: false,
        legacyFlagPendingTransition: false,
        rawStoredEnabled: false,
      };
    }
    const obj = parsed as Record<string, unknown>;
    const rawFlag = obj.aiExternalFormalizeEnabled;
    if (rawFlag !== undefined && typeof rawFlag !== "boolean") {
      return {
        verified: false,
        enabled: false,
        panelControlled: false,
        legacyFlagPendingTransition: false,
        rawStoredEnabled: false,
      };
    }
    const rawVersion = obj.aiExternalFormalizePolicyVersion;
    if (rawVersion !== undefined && rawVersion !== 1 && rawVersion !== 2) {
      return {
        verified: false,
        enabled: false,
        panelControlled: false,
        legacyFlagPendingTransition: false,
        rawStoredEnabled: false,
      };
    }

    const panelControlled = rawVersion === AI_EXTERNAL_FORMALIZE_POLICY_VERSION;

    if (rawFlag === true && panelControlled) {
      return {
        verified: true,
        enabled: true,
        panelControlled: true,
        legacyFlagPendingTransition: false,
        rawStoredEnabled: true,
      };
    }

    if (rawFlag === true && !panelControlled) {
      // Fail-closed: flag legada (sem transição comprovada nem ativação explícita no painel) permanece em modo local
      return {
        verified: true,
        enabled: false,
        panelControlled: false,
        legacyFlagPendingTransition: true,
        rawStoredEnabled: true,
      };
    }

    return {
      verified: true,
      enabled: false,
      panelControlled,
      legacyFlagPendingTransition: false,
      rawStoredEnabled: false,
    };
  } catch {
    return {
      verified: false,
      enabled: false,
      panelControlled: false,
      legacyFlagPendingTransition: false,
      rawStoredEnabled: false,
    };
  }
}

export function parseLegacyAllowedSchoolIdsForTransition(
  raw?: string | null
): LegacyAllowedSchoolIdsResult {
  if (raw === undefined || raw === null) {
    return { reliable: false, reason: "missing_legacy_list", ids: new Set() };
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return { reliable: false, reason: "empty_legacy_list", ids: new Set() };
  }

  const tokens = trimmed.split(",").map((item) => item.trim());
  const ids = new Set<string>();
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

export function computeLegacyAiPolicyTransition(params: {
  schoolId: string;
  settingsJson?: string | null;
  legacyAllowed: LegacyAllowedSchoolIdsResult;
  transitionedAtIso?: string;
}): AiPolicyTransitionDecision {
  const flag = parseSchoolAiExternalFormalizeFlag(params.settingsJson);
  if (!flag.verified) {
    return {
      action: "skip",
      outcome: "corrupt_settings_skipped",
      effectiveEnabled: false,
    };
  }

  let parsedObj: Record<string, unknown> = {};
  const trimmed = (params.settingsJson || "").trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {
          action: "skip",
          outcome: "corrupt_settings_skipped",
          effectiveEnabled: false,
        };
      }
      parsedObj = { ...(parsed as Record<string, unknown>) };
    } catch {
      return {
        action: "skip",
        outcome: "corrupt_settings_skipped",
        effectiveEnabled: false,
      };
    }
  }

  if (parsedObj.aiExternalFormalizePolicyVersion === AI_EXTERNAL_FORMALIZE_POLICY_VERSION) {
    return {
      action: "skip",
      outcome: "already_panel_controlled",
      effectiveEnabled: parsedObj.aiExternalFormalizeEnabled === true,
    };
  }

  const rawEnabled = flag.rawStoredEnabled;
  let nextEnabled = false;
  let outcome: Exclude<
    AiPolicyTransitionOutcome,
    "already_panel_controlled" | "corrupt_settings_skipped"
  > = "kept_local";

  if (rawEnabled && params.legacyAllowed.reliable && params.legacyAllowed.ids.has(params.schoolId)) {
    nextEnabled = true;
    outcome = "preserved_enabled";
  } else if (rawEnabled && params.legacyAllowed.reliable) {
    nextEnabled = false;
    outcome = "reconciled_to_local_outside_legacy_list";
  } else if (rawEnabled) {
    nextEnabled = false;
    outcome = "reconciled_to_local_unreliable_legacy_list";
  }

  const transitionedAtIso = params.transitionedAtIso || new Date().toISOString();

  return {
    action: "update",
    outcome,
    previousRawEnabled: rawEnabled,
    previousEffectiveEnabled: flag.enabled,
    nextEnabled,
    nextSettings: {
      ...parsedObj,
      aiExternalFormalizeEnabled: nextEnabled,
      aiExternalFormalizePolicyVersion: AI_EXTERNAL_FORMALIZE_POLICY_VERSION,
      aiExternalFormalizeTransitionedAt: transitionedAtIso,
      aiExternalFormalizeTransitionOutcome: outcome,
    },
  };
}

export function isSensitiveOrRestrictedAtaContent(input: {
  isConfidential?: boolean | null;
  hasPersistedMinute?: boolean;
  nonConfidentialConfirmed?: boolean | null;
  minuteConfidentialityUnconfirmed?: boolean;
  minuteScopeUnconfirmed?: boolean;
  ataScope?: "STUDENTS" | "TEACHERS" | null;
  category?: string | null;
  subject?: string | null;
  rawNotes?: string | null;
  existingSummary?: string | null;
}): { restricted: boolean; reason?: string } {
  if (input.isConfidential === true) {
    return { restricted: true, reason: "confidential_minute" };
  }

  if (input.minuteConfidentialityUnconfirmed === true) {
    return { restricted: true, reason: "minute_confidentiality_unconfirmed" };
  }

  if (input.minuteScopeUnconfirmed === true) {
    return { restricted: true, reason: "minute_scope_unconfirmed" };
  }

  if (typeof input.isConfidential !== "boolean") {
    return { restricted: true, reason: "confidentiality_unconfirmed" };
  }

  if (!input.hasPersistedMinute && input.nonConfidentialConfirmed !== true) {
    return { restricted: true, reason: "new_minute_confidentiality_unconfirmed" };
  }

  const normalizedCategory = (input.category || "").trim().toUpperCase();
  if (!normalizedCategory) {
    return { restricted: true, reason: "category_unconfirmed" };
  }
  if (SENSITIVE_CATEGORIES.has(normalizedCategory)) {
    return { restricted: true, reason: `restricted_category:${normalizedCategory}` };
  }
  if (!APPROVED_EXTERNAL_AI_CATEGORIES.has(normalizedCategory)) {
    return { restricted: true, reason: "category_not_approved_for_external_ai" };
  }

  if (
    (input.ataScope === "TEACHERS" && normalizedCategory !== "ORIENTACAO_DOCENTE") ||
    (input.ataScope === "STUDENTS" && normalizedCategory === "ORIENTACAO_DOCENTE")
  ) {
    return { restricted: true, reason: "minute_scope_mismatch" };
  }

  const hasEligibleNotes =
    typeof input.rawNotes === "string" && input.rawNotes.trim().length >= 3;
  const hasEligibleSummary =
    typeof input.existingSummary === "string" && input.existingSummary.trim().length >= 5;
  if (!hasEligibleNotes && !hasEligibleSummary) {
    return { restricted: true, reason: "text_eligibility_unconfirmed" };
  }

  const combinedText = [input.subject, input.rawNotes, input.existingSummary]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join("\n");

  if (combinedText.length > MAX_EXTERNAL_AI_INPUT_CHARS) {
    return { restricted: true, reason: "content_length_exceeds_safe_limit" };
  }

  for (const pattern of SENSITIVE_CONTENT_PATTERNS) {
    if (pattern.test(combinedText)) {
      return { restricted: true, reason: "sensitive_protection_or_health_terms" };
    }
  }

  return { restricted: false };
}

export function evaluateFormalizeExternalAiEligibility(params: {
  schoolId?: string | null;
  schoolSettingsJson?: string | null;
  schoolConfigLoaded?: boolean;
}): {
  allowed: boolean;
  reason: string;
  apiKey?: string;
} {
  if (!isExternalFormalizeEnabledGlobally()) {
    return { allowed: false, reason: "external_formalize_disabled_globally" };
  }

  const schoolId = (params.schoolId || "").trim();
  if (!schoolId) {
    return { allowed: false, reason: "missing_school_context" };
  }

  if (params.schoolConfigLoaded === false) {
    return { allowed: false, reason: "school_config_unconfirmed" };
  }

  const flag = parseSchoolAiExternalFormalizeFlag(params.schoolSettingsJson);
  if (!flag.verified) {
    return { allowed: false, reason: "school_config_unconfirmed" };
  }

  if (flag.legacyFlagPendingTransition) {
    return { allowed: false, reason: "legacy_policy_transition_required" };
  }

  if (!flag.enabled) {
    return { allowed: false, reason: "disabled_by_school_configuration" };
  }

  const apiKey = getServerGeminiApiKey();
  if (!apiKey) {
    return { allowed: false, reason: "missing_server_ai_credential" };
  }

  return {
    allowed: true,
    reason: "school_authorized_for_external_formalize",
    apiKey,
  };
}

export async function recordAiOperationalEvent(params: {
  schoolId: string | null;
  route: string;
  mode: AiExecutionMode;
  reason: string;
  status: "SUCCESS" | "FALLBACK" | "BLOCKED" | "ERROR";
  user?: {
    id?: string | null;
    name?: string | null;
    email?: string | null;
  };
  req?: Request;
}) {
  // Registra exclusivamente metadados operacionais — zero prompts, textos ou identificadores.
  console.info("[AI Operational Event]", {
    route: params.route,
    schoolId: params.schoolId,
    mode: params.mode,
    reason: params.reason,
    status: params.status,
  });

  if (!params.user?.email && !params.user?.id) return;

  try {
    await logAudit({
      action: "AI_OPERATIONAL_EVENT",
      entityType: "AiExecution",
      schoolId: params.schoolId,
      details: {
        route: params.route,
        mode: params.mode,
        reason: params.reason,
        status: params.status,
      },
      user: {
        id: params.user?.id || undefined,
        name: params.user?.name || "Equipe Pedagógica",
        email: params.user?.email || "sistema@redeativa",
      },
      req: params.req,
    });
  } catch {
    // Falha de auditoria não deve interromper o atendimento pedagógico
  }
}
