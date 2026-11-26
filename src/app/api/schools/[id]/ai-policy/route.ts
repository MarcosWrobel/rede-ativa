import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logAuditStrict, type AuditLogWriter } from "@/lib/audit";
import { invalidateSchoolCache } from "@/lib/currentSchool";
import {
  AI_EXTERNAL_FORMALIZE_POLICY_VERSION,
  getExternalFormalizeServerStatus,
  parseSchoolAiExternalFormalizeFlag,
} from "@/lib/aiPolicy";
import {
  mutateSchoolSettingsAtomically,
  sanitizePublicSchoolSettings,
} from "@/lib/schoolSettingsMutation";

export const dynamic = "force-dynamic";

const aiPolicyPatchSchema = z.object({
  aiExternalFormalizeEnabled: z.boolean(),
  expectedUpdatedAt: z
    .string()
    .min(1, "Versão atual da escola (expectedUpdatedAt) é obrigatória."),
  expectedPreviousEnabled: z.boolean(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireSuperAdmin();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const school = await prisma.school.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        inepCode: true,
        active: true,
        settingsJson: true,
        updatedAt: true,
      },
    });

    if (!school) {
      return NextResponse.json(
        { error: "Instituição escolar não encontrada." },
        { status: 404 }
      );
    }

    const flag = parseSchoolAiExternalFormalizeFlag(school.settingsJson);
    const safeSettings = sanitizePublicSchoolSettings(school.settingsJson);
    const serverAvailability = getExternalFormalizeServerStatus();

    return NextResponse.json({
      success: true,
      serverAvailability,
      school: {
        id: school.id,
        name: school.name,
        inepCode: school.inepCode,
        active: school.active,
        aiExternalFormalizeEnabled: flag.verified && flag.enabled,
        configVerified: flag.verified,
        panelControlled: flag.panelControlled,
        legacyPolicyPendingTransition: flag.legacyFlagPendingTransition,
        aiExternalFormalizeUpdatedAt:
          typeof safeSettings.aiExternalFormalizeUpdatedAt === "string"
            ? safeSettings.aiExternalFormalizeUpdatedAt
            : null,
        aiExternalFormalizeUpdatedBy:
          typeof safeSettings.aiExternalFormalizeUpdatedBy === "string"
            ? safeSettings.aiExternalFormalizeUpdatedBy
            : null,
        updatedAt: school.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("[GET /api/schools/[id]/ai-policy] Erro:", error);
    return NextResponse.json(
      { error: "Erro ao consultar política de IA da instituição." },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireSuperAdmin();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const rawBody = await req.json();
    const parsed = aiPolicyPatchSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados inválidos." },
        { status: 400 }
      );
    }

    const {
      aiExternalFormalizeEnabled: nextEnabled,
      expectedUpdatedAt,
      expectedPreviousEnabled,
    } = parsed.data;

    const changedAtIso = new Date().toISOString();
    let recordedPreviousEnabled = false;
    let recordedLegacyPendingTransition = false;

    const buildPolicyPatch = (
      currentSettings: Record<string, unknown>,
      currentRow: { settingsJson: string | null }
    ) => {
      const flag = parseSchoolAiExternalFormalizeFlag(currentRow.settingsJson);
      if (!flag.verified) {
        return {
          ok: false as const,
          status: 409,
          reason: "CORRUPT_SETTINGS_JSON",
          error:
            "Configuração de IA em estado inválido; recarregue e regularize antes de alterar.",
        };
      }

      if (flag.enabled !== expectedPreviousEnabled) {
        return {
          ok: false as const,
          status: 409,
          reason: "CONFLICT_STALE_POLICY_STATE",
          error:
            "O estado da política de IA foi alterado por outra operação. Atualize a tela e tente novamente.",
        };
      }

      recordedPreviousEnabled = flag.enabled;
      recordedLegacyPendingTransition = flag.legacyFlagPendingTransition;

      return {
        ok: true as const,
        nextSettings: {
          ...currentSettings,
          aiExternalFormalizeEnabled: nextEnabled,
          aiExternalFormalizePolicyVersion: AI_EXTERNAL_FORMALIZE_POLICY_VERSION,
          aiExternalFormalizeUpdatedAt: changedAtIso,
          aiExternalFormalizeUpdatedBy: authCheck.email,
        },
      };
    };

    let mutation = await mutateSchoolSettingsAtomically({
      schoolId: id,
      expectedUpdatedAt,
      requireTransaction: nextEnabled === true,
      buildPatch: buildPolicyPatch,
      afterCasInTransaction: async (tx, ctx) => {
        await logAuditStrict(
          {
            action: "UPDATE_SCHOOL_AI_POLICY",
            entityType: "SchoolAiPolicy",
            entityId: id,
            schoolId: id,
            details: {
              schoolId: id,
              schoolName: ctx.updatedRow.name,
              inepCode: ctx.updatedRow.inepCode,
              operatorId: authCheck.userId,
              operatorName: authCheck.userName,
              operatorEmail: authCheck.email,
              previousState: recordedPreviousEnabled,
              nextState: nextEnabled,
              legacyPolicyPendingTransition: recordedLegacyPendingTransition,
              previousAiExternalFormalizeEnabled: recordedPreviousEnabled,
              aiExternalFormalizeEnabled: nextEnabled,
              aiExternalFormalizePolicyVersion: AI_EXTERNAL_FORMALIZE_POLICY_VERSION,
              changedAt: changedAtIso,
            },
            user: {
              id: authCheck.userId,
              name: authCheck.userName,
              email: authCheck.email,
            },
            req,
          },
          tx as AuditLogWriter
        );
      },
    });

    let auditRecorded = mutation.ok;

    if (
      !mutation.ok &&
      nextEnabled === false &&
      mutation.reason === "AUDIT_PERSISTENCE_FAILED"
    ) {
      // Desligamento emergencial prioriza bloquear o fluxo externo mesmo se a trilha de auditoria estiver degradada.
      const emergencyShutoff = await mutateSchoolSettingsAtomically({
        schoolId: id,
        expectedUpdatedAt,
        requireTransaction: false,
        buildPatch: buildPolicyPatch,
      });

      if (emergencyShutoff.ok) {
        mutation = emergencyShutoff;
        auditRecorded = false;
        console.error(
          "[CRITICAL][PATCH /api/schools/[id]/ai-policy] Desligamento emergencial concluído sem persistência de auditoria.",
          {
            schoolId: id,
            operatorId: authCheck.userId,
            operatorEmail: authCheck.email,
            changedAt: changedAtIso,
          }
        );
      }
    }

    if (!mutation.ok) {
      const currentRow = mutation.currentRow;
      const freshFlag = currentRow
        ? parseSchoolAiExternalFormalizeFlag(currentRow.settingsJson)
        : null;

      return NextResponse.json(
        {
          error: mutation.error,
          code: mutation.reason,
          ...(currentRow
            ? {
                school: {
                  id: currentRow.id,
                  name: currentRow.name,
                  inepCode: currentRow.inepCode,
                  aiExternalFormalizeEnabled: Boolean(freshFlag?.verified && freshFlag.enabled),
                  updatedAt: currentRow.updatedAt
                    ? new Date(currentRow.updatedAt).toISOString()
                    : null,
                },
              }
            : {}),
        },
        { status: mutation.status }
      );
    }

    invalidateSchoolCache(id);

    const updatedRow = mutation.updatedRow;
    const serverAvailability = getExternalFormalizeServerStatus();

    return NextResponse.json({
      success: true,
      auditRecorded,
      serverAvailability,
      ...(!auditRecorded
        ? {
            warning:
              "Desligamento emergencial aplicado, porém a persistência da trilha de auditoria falhou e exige verificação.",
          }
        : {}),
      school: {
        id: updatedRow.id,
        name: updatedRow.name,
        inepCode: updatedRow.inepCode,
        aiExternalFormalizeEnabled: nextEnabled,
        panelControlled: true,
        legacyPolicyPendingTransition: false,
        aiExternalFormalizeUpdatedAt: changedAtIso,
        aiExternalFormalizeUpdatedBy: authCheck.email,
        updatedAt: new Date(updatedRow.updatedAt).toISOString(),
        changedAt: changedAtIso,
      },
    });
  } catch (error) {
    console.error("[PATCH /api/schools/[id]/ai-policy] Erro:", error);
    return NextResponse.json(
      { error: "Erro ao atualizar política de IA da instituição." },
      { status: 500 }
    );
  }
}
