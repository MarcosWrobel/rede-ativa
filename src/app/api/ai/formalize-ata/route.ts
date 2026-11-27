import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { withTenantContext } from "@/lib/rlsTenantContext";
import {
  buildSessionFromSnapshot,
  resolveEffectiveRoleForSchool,
} from "@/lib/serverAuthContext";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { canAccessConfidentialMinute } from "@/lib/ataCrypto";
import { evaluateMinuteRevisionLock } from "@/lib/ataRevision";
import { prisma } from "@/lib/prisma";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { generateLocalAtaMinuta, formatAtaDateExtenso } from "@/lib/nreAtaFormatter";
import { createAiPseudonymizer, detectResidualIdentifiers } from "@/lib/aiPseudonymizer";
import {
  evaluateFormalizeExternalAiEligibility,
  hasDisallowedAttachmentPayload,
  isSensitiveOrRestrictedAtaContent,
  recordAiOperationalEvent,
} from "@/lib/aiPolicy";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";

export const maxDuration = 45;
export const dynamic = "force-dynamic";

const ALLOWED_FORMALIZE_ROLES = new Set([
  "PEDAGOGA",
  "GESTOR_ESCOLAR",
  "GESTAO_SECRETARIA",
  "SUPERADMIN",
  "ADMIN",
]);

function humanizeGeminiError(rawMsg: string): string {
  if (!rawMsg) return "tempo limite esgotado";
  try {
    const trimmed = rawMsg.trim();
    const parsed = trimmed.startsWith("{") ? JSON.parse(trimmed) : null;
    if (
      parsed?.error?.code === 503 ||
      parsed?.error?.status === "UNAVAILABLE" ||
      parsed?.error?.message?.includes("high demand")
    ) {
      return "Os servidores do provedor externo estão com alta demanda temporária (503). Tente novamente em instantes.";
    }
    if (parsed?.error?.code === 429 || parsed?.error?.status === "RESOURCE_EXHAUSTED") {
      return "Limite temporário de requisições excedido (429). Aguarde um instante e tente novamente.";
    }
    if (parsed?.error?.message) {
      return "serviço externo temporariamente indisponível";
    }
  } catch {
    // rawMsg is not JSON
  }

  if (rawMsg.includes("503") || rawMsg.includes("high demand") || rawMsg.includes("UNAVAILABLE")) {
    return "Os servidores do provedor externo estão com alta demanda temporária (503). Tente novamente em instantes.";
  }
  if (rawMsg.includes("429") || rawMsg.includes("RESOURCE_EXHAUSTED")) {
    return "Limite temporário de requisições excedido (429). Aguarde um instante e tente novamente.";
  }
  return "serviço externo temporariamente indisponível";
}

function buildDateFormats(attendedAt?: string | null): {
  numericBr?: string;
  isoDate?: string;
  yearNumeric?: string;
  timeColon?: string;
} {
  let d: Date;
  if (!attendedAt) {
    d = new Date();
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(attendedAt)) {
    d = new Date(`${attendedAt}T12:00:00.000-03:00`);
  } else {
    d = new Date(attendedAt);
  }
  const validDate = isNaN(d.getTime()) ? new Date() : d;

  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(validDate);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  const year = map.year;
  const month = map.month;
  const day = map.day;
  const hour = map.hour;
  const minute = map.minute;

  return {
    numericBr: day && month && year ? `${day}/${month}/${year}` : undefined,
    isoDate: year && month && day ? `${year}-${month}-${day}` : undefined,
    yearNumeric: year,
    timeColon: hour && minute ? `${hour}:${minute}` : undefined,
  };
}

const formalizeAtaSchema = z
  .object({
    minuteId: z.string().optional().nullable(),
    isConfidential: z.boolean().optional(),
    nonConfidentialConfirmed: z.boolean().optional(),
    ataScope: z.enum(["STUDENTS", "TEACHERS"]).optional(),
    studentIds: z.array(z.string()).optional(),
    subject: z.string().optional().nullable(),
    rawNotes: z.string().default(""),
    existingSummary: z.string().optional().default(""),
    category: z.string().optional(),
    studentNames: z.array(z.string()).default([]),
    guardianNames: z.array(z.string()).default([]),
    teacherNames: z.array(z.string()).default([]),
    attendedAt: z.string().optional(),
    // Campo mantido apenas por retrocompatibilidade; credenciais de cliente são sempre ignoradas.
    apiKey: z.string().optional(),
  })
  .refine(
    (data) =>
      (data.rawNotes && data.rawNotes.trim().length >= 3) ||
      (data.existingSummary && data.existingSummary.trim().length >= 5),
    {
      message: "Informe as anotações do atendimento ou um texto prévio para revisão.",
      path: ["rawNotes"],
    }
  );

const FORMALIZE_ATA_JSON_SCHEMA = {
  type: "object",
  properties: {
    formalSubject: {
      type: "string",
      description:
        "Título formal e objetivo da ata pedagógica (ex: 'Atendimento Pedagógico e Alinhamento de Frequência Escolar').",
    },
    formalSummary: {
      type: "string",
      description:
        "Texto oficial contínuo (texto corrido sem quebra de linhas/parágrafos em branco), no pretérito perfeito, em norma culta, preservando exatamente os placeholders fornecidos ([ESTUDANTE_n], [RESPONSAVEL_n], [DOCENTE_n], [DATA_ATENDIMENTO], [ANO_ATENDIMENTO], [HORA_ATENDIMENTO]).",
    },
    agreementsSummary: {
      type: "string",
      description: "Síntese objetiva e concisa dos combinados, prazos e compromissos pactuados.",
    },
    actionItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "Descrição objetiva da ação ou compromisso pactuado.",
          },
          responsible: {
            type: "string",
            enum: ["FAMILIA", "ESTUDANTE", "ESCOLA", "REDE_PROTECAO", "DOCENTE"],
            description: "Responsável direto pelo cumprimento deste combinado.",
          },
          suggestedDaysToComplete: {
            type: "number",
            description: "Prazo sugerido em dias úteis a contar da reunião.",
          },
        },
        required: ["description", "responsible"],
      },
      description: "Lista estruturada de ações e combinados.",
    },
  },
  required: ["formalSubject", "formalSummary", "agreementsSummary", "actionItems"],
};

async function verifyCurrentSchoolExternalAiAllowed(schoolId: string) {
  let schoolConfigLoaded = false;
  let schoolSettingsJson: string | null = null;

  if (typeof (prisma as any)?.school?.findUnique === "function") {
    try {
      const freshSchool = await prisma.school.findUnique({
        where: { id: schoolId },
        select: { active: true, settingsJson: true },
      });
      if (freshSchool && (freshSchool as any).active !== false) {
        schoolSettingsJson = freshSchool.settingsJson ?? null;
        schoolConfigLoaded = true;
      }
    } catch {
      schoolConfigLoaded = false;
    }
  }

  return evaluateFormalizeExternalAiEligibility({
    schoolId,
    schoolSettingsJson,
    schoolConfigLoaded,
  });
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const schoolRes = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot
    );
    if (!schoolRes.ok) return schoolRes.response;
    const currentSchool = schoolRes.school;

    const effectiveRole = (
      (authCheck.snapshot
        ? resolveEffectiveRoleForSchool(authCheck.snapshot, currentSchool)
        : authCheck.role) || ""
    ).toUpperCase();

    if (!effectiveRole || !ALLOWED_FORMALIZE_ROLES.has(effectiveRole)) {
      return NextResponse.json(
        { error: "Perfil sem autorização para gerar minuta de ata nesta instituição." },
        { status: 403 }
      );
    }

    const rateLimitKey = `ai:${currentSchool.id}:${authCheck.userId}`;
    const rlCheck = await enforceRateLimit(rateLimitKey, RATE_LIMIT_POLICIES.AI_ENDPOINT);
    if (!rlCheck.ok) return rlCheck.response;

    const rawBody = await req.json();

    // Política F04: imagens, PDFs e anexos são rejeitados antes de qualquer chamada externa
    if (hasDisallowedAttachmentPayload(rawBody)) {
      await recordAiOperationalEvent({
        schoolId: currentSchool.id,
        route: "/api/ai/formalize-ata",
        mode: "LOCAL_POLICY_GUARD",
        reason: "disallowed_attachment_or_image_payload",
        status: "BLOCKED",
        user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
        req,
      });
      return NextResponse.json(
        { error: "O envio de imagens ou anexos para processamento por IA está indisponível neste fluxo." },
        { status: 400 }
      );
    }

    const parsed = formalizeAtaSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Dados inválidos" },
        { status: 400 }
      );
    }

    const {
      minuteId,
      isConfidential,
      nonConfidentialConfirmed,
      ataScope,
      studentIds,
      subject,
      rawNotes,
      existingSummary,
      category,
      studentNames,
      guardianNames,
      teacherNames,
      attendedAt,
    } = parsed.data;

    const resolvedInitialCategory = (category || "ACOMPANHAMENTO_PEDAGOGICO").trim();

    // 1. Quando houver minuteId, validar metadados (escola, autoria/sigilo e status DRAFT) ANTES de carregar participantes ou gerar qualquer minuta (externa ou local)
    let dbConfidential = false;
    let dbCategory: string | null = null;
    let hasPersistedMinute = false;
    let minuteScopeUnconfirmed = false;

    const mergedStudentNames = new Set<string>(studentNames.map((n) => n.trim()).filter(Boolean));
    const mergedGuardianNames = new Set<string>(guardianNames.map((n) => n.trim()).filter(Boolean));
    const mergedTeacherNames = new Set<string>(teacherNames.map((n) => n.trim()).filter(Boolean));

    const normalizedMinuteId = typeof minuteId === "string" ? minuteId.trim() : "";

    const effectiveSession = authCheck.snapshot
      ? buildSessionFromSnapshot(authCheck.session, authCheck.snapshot, currentSchool)
      : authCheck.session;

    if (normalizedMinuteId) {
      const findMetaFn =
        typeof (prisma as any)?.pedagogicalMinute?.findFirst === "function"
          ? (prisma as any).pedagogicalMinute.findFirst
          : typeof (prisma as any)?.pedagogicalMinute?.findUnique === "function"
            ? (prisma as any).pedagogicalMinute.findUnique
            : null;

      if (!findMetaFn) {
        await recordAiOperationalEvent({
          schoolId: currentSchool.id,
          route: "/api/ai/formalize-ata",
          mode: "LOCAL_POLICY_GUARD",
          reason: "minute_authorization_unavailable",
          status: "BLOCKED",
          user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
          req,
        });
        return NextResponse.json(
          { error: "Não foi possível confirmar a autorização da ata informada." },
          { status: 500 }
        );
      }

      let minuteMeta: {
        id: string;
        schoolId: string | null;
        status: string | null;
        isConfidential: boolean;
        category: string | null;
        authorId?: string | null;
        authorEmail?: string | null;
        updatedAt?: Date | string | null;
      } | null = null;

      try {
        minuteMeta = await findMetaFn({
          where: { id: normalizedMinuteId, schoolId: currentSchool.id },
          select: {
            id: true,
            schoolId: true,
            status: true,
            isConfidential: true,
            category: true,
            authorId: true,
            authorEmail: true,
            updatedAt: true,
          },
        });
      } catch {
        await recordAiOperationalEvent({
          schoolId: currentSchool.id,
          route: "/api/ai/formalize-ata",
          mode: "LOCAL_POLICY_GUARD",
          reason: "minute_authorization_query_failed",
          status: "BLOCKED",
          user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
          req,
        });
        return NextResponse.json(
          { error: "Erro ao validar autorização da ata informada." },
          { status: 500 }
        );
      }

      if (!minuteMeta) {
        return NextResponse.json(
          { error: "Ata pedagógica não encontrada." },
          { status: 404 }
        );
      }

      if (
        !assertTenantOwnership(minuteMeta.schoolId, currentSchool.id, effectiveSession) ||
        minuteMeta.schoolId !== currentSchool.id
      ) {
        return NextResponse.json(
          { error: "Acesso negado ao registro de outra instituição." },
          { status: 403 }
        );
      }

      if (!canAccessConfidentialMinute(minuteMeta, effectiveSession)) {
        await recordAiOperationalEvent({
          schoolId: currentSchool.id,
          route: "/api/ai/formalize-ata",
          mode: "LOCAL_POLICY_GUARD",
          reason: "confidential_minute_access_denied",
          status: "BLOCKED",
          user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
          req,
        });
        return NextResponse.json(
          { error: "Esta ata possui sigilo reforçado restrito à direção escolar e ao servidor autor." },
          { status: 403 }
        );
      }

      if (minuteMeta.status !== "DRAFT") {
        return NextResponse.json(
          { error: "Somente atas em rascunho podem gerar nova minuta." },
          { status: 403 }
        );
      }

      hasPersistedMinute = true;
      dbConfidential = Boolean(minuteMeta.isConfidential);
      dbCategory = minuteMeta.category ?? null;

      // Carrega a ata e suas relações (estudantes/participantes) sobre um único snapshot PostgreSQL
      // em transação curta RepeatableRead, evitando visões mistas sob Read Committed.
      const pinnedWhere: Record<string, unknown> = {
        id: normalizedMinuteId,
        schoolId: currentSchool.id,
        status: "DRAFT",
        isConfidential: Boolean(minuteMeta.isConfidential),
      };
      if (minuteMeta.category !== undefined) {
        pinnedWhere.category = minuteMeta.category;
      }
      if (minuteMeta.authorId !== undefined) {
        pinnedWhere.authorId = minuteMeta.authorId;
      }
      if (minuteMeta.authorEmail !== undefined) {
        pinnedWhere.authorEmail = minuteMeta.authorEmail;
      }
      if (minuteMeta.updatedAt !== undefined && minuteMeta.updatedAt !== null) {
        pinnedWhere.updatedAt = minuteMeta.updatedAt;
      }

      if (typeof (prisma as any)?.$transaction !== "function") {
        await recordAiOperationalEvent({
          schoolId: currentSchool.id,
          route: "/api/ai/formalize-ata",
          mode: "LOCAL_POLICY_GUARD",
          reason: "snapshot_transaction_unavailable",
          status: "BLOCKED",
          user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
          req,
        });
        return NextResponse.json(
          { error: "Não foi possível carregar os dados autorizados da ata em snapshot isolado." },
          { status: 500 }
        );
      }

      let minuteParticipants: any = null;
      try {
        minuteParticipants = await (prisma as any).$transaction(
          async (tx: any) => {
            if (typeof tx?.$executeRaw === "function") {
              await tx.$executeRaw`SELECT set_config('app.current_school_id', ${currentSchool.id}, true)`;
            }
            const txFinder =
              typeof tx?.pedagogicalMinute?.findFirst === "function"
                ? tx.pedagogicalMinute.findFirst
                : typeof tx?.pedagogicalMinute?.findUnique === "function"
                  ? tx.pedagogicalMinute.findUnique
                  : null;
            if (!txFinder) {
              throw new Error("SNAPSHOT_READER_UNAVAILABLE");
            }
            return await txFinder({
              where: pinnedWhere,
              select: {
                id: true,
                schoolId: true,
                status: true,
                contentRevision: true,
                physicalScanRevision: true,
                physicalScanSupersededAt: true,
                hasPhysicalScan: true,
                govBrVerified: true,
                isConfidential: true,
                category: true,
                authorId: true,
                authorEmail: true,
                updatedAt: true,
                students: {
                  select: {
                    student: { select: { id: true, name: true } },
                  },
                },
                participants: {
                  select: {
                    id: true,
                    name: true,
                    role: true,
                    signatureMode: true,
                    hasSignature: true,
                    verifiedEmail: true,
                    signedAt: true,
                    biometricVerified: true,
                    signedRevision: true,
                  },
                },
              },
            });
          },
          {
            isolationLevel: "RepeatableRead",
            maxWait: 5000,
            timeout: 10000,
          }
        );
      } catch (err: any) {
        const errCode = String(err?.code || err?.meta?.code || "");
        const errText = String(err?.message || "");
        const isSerializationConflict =
          errCode === "P2034" ||
          errCode === "40001" ||
          /could not serialize access|40001/i.test(errText);
        if (isSerializationConflict) {
          await recordAiOperationalEvent({
            schoolId: currentSchool.id,
            route: "/api/ai/formalize-ata",
            mode: "LOCAL_POLICY_GUARD",
            reason: "minute_snapshot_serialization_conflict",
            status: "BLOCKED",
            user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
            req,
          });
          return NextResponse.json(
            { error: "O estado da ata foi alterado durante a validação. Recarregue a ata e tente novamente." },
            { status: 409 }
          );
        }
        return NextResponse.json(
          { error: "Erro ao carregar os dados autorizados da ata." },
          { status: 500 }
        );
      }

      const normalizeUpdatedAtMs = (val: Date | string | null | undefined): number | null => {
        if (val === undefined || val === null) return null;
        const ms = val instanceof Date ? val.getTime() : new Date(val).getTime();
        return Number.isFinite(ms) ? ms : null;
      };

      const expectedUpdatedMs = normalizeUpdatedAtMs(minuteMeta.updatedAt);
      const actualUpdatedMs = minuteParticipants
        ? normalizeUpdatedAtMs(minuteParticipants.updatedAt)
        : null;

      const stateStillMatches =
        Boolean(minuteParticipants) &&
        minuteParticipants.schoolId === currentSchool.id &&
        assertTenantOwnership(minuteParticipants.schoolId, currentSchool.id, effectiveSession) &&
        minuteParticipants.status === "DRAFT" &&
        Boolean(minuteParticipants.isConfidential) === Boolean(minuteMeta.isConfidential) &&
        (minuteMeta.category === undefined ||
          (minuteParticipants.category ?? null) === (minuteMeta.category ?? null)) &&
        (minuteParticipants.authorId ?? null) === (minuteMeta.authorId ?? null) &&
        (minuteParticipants.authorEmail ?? null) === (minuteMeta.authorEmail ?? null) &&
        (expectedUpdatedMs === null || actualUpdatedMs === expectedUpdatedMs) &&
        canAccessConfidentialMinute(minuteParticipants, effectiveSession);

      if (!stateStillMatches) {
        await recordAiOperationalEvent({
          schoolId: currentSchool.id,
          route: "/api/ai/formalize-ata",
          mode: "LOCAL_POLICY_GUARD",
          reason: "minute_state_changed_after_authorization",
          status: "BLOCKED",
          user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
          req,
        });
        return NextResponse.json(
          { error: "O estado da ata foi alterado durante a validação. Recarregue a ata e tente novamente." },
          { status: 409 }
        );
      }

      if (evaluateMinuteRevisionLock(minuteParticipants).isLockedBySignature) {
        await recordAiOperationalEvent({
          schoolId: currentSchool.id,
          route: "/api/ai/formalize-ata",
          mode: "LOCAL_POLICY_GUARD",
          reason: "minute_locked_by_signature",
          status: "BLOCKED",
          user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
          req,
        });
        return NextResponse.json(
          {
            error:
              "Esta ata já possui assinatura registrada na revisão atual e não pode ter o texto sobrescrito. Utilize 'Reabrir para edição' se precisar alterar o conteúdo.",
          },
          { status: 409 }
        );
      }

      if (Array.isArray(minuteParticipants?.students)) {
        for (const link of minuteParticipants.students) {
          const name = link?.student?.name;
          if (typeof name === "string" && name.trim()) {
            mergedStudentNames.add(name.trim());
          }
        }
      }
      if (Array.isArray(minuteParticipants?.participants)) {
        for (const p of minuteParticipants.participants) {
          if (typeof p?.name !== "string" || !p.name.trim()) continue;
          if (p.role === "PROFESSOR" || p.role === "EQUIPE_ESCOLAR") {
            mergedTeacherNames.add(p.name.trim());
          } else {
            mergedGuardianNames.add(p.name.trim());
          }
        }
      }
    }

    if (Array.isArray(studentIds) && studentIds.length > 0) {
      const uniqueStudentIds = Array.from(
        new Set(studentIds.map((s) => String(s || "").trim()).filter(Boolean))
      );
      if (uniqueStudentIds.length > 0) {
        if (typeof (prisma as any)?.student?.findMany !== "function") {
          minuteScopeUnconfirmed = true;
        } else {
          try {
            const matchedStudents =
              typeof (prisma as any)?.$transaction === "function"
                ? await withTenantContext(prisma, currentSchool.id, (tx) =>
                    tx.student.findMany({
                      where: {
                        id: { in: uniqueStudentIds },
                        schoolId: currentSchool.id,
                      },
                      select: { id: true, name: true },
                    })
                  )
                : await prisma.student.findMany({
                    where: {
                      id: { in: uniqueStudentIds },
                      schoolId: currentSchool.id,
                    },
                    select: { id: true, name: true },
                  });
            if (!Array.isArray(matchedStudents) || matchedStudents.length !== uniqueStudentIds.length) {
              minuteScopeUnconfirmed = true;
            } else {
              for (const st of matchedStudents) {
                if (typeof st?.name === "string" && st.name.trim()) {
                  mergedStudentNames.add(st.name.trim());
                }
              }
            }
          } catch {
            minuteScopeUnconfirmed = true;
          }
        }
      }
    }

    const effectiveStudentNames = Array.from(mergedStudentNames);
    const effectiveGuardianNames = Array.from(mergedGuardianNames);
    const effectiveTeacherNames = Array.from(mergedTeacherNames);

    const effectiveConfidential: boolean | undefined = normalizedMinuteId
      ? Boolean(isConfidential) || dbConfidential
      : isConfidential;
    const effectiveCategory = (dbCategory || category || "").trim();

    const buildLocalOnlyResponse = async (reason: string) => {
      const localDraft = generateLocalAtaMinuta({
        rawNotes,
        existingSummary,
        category: effectiveCategory || resolvedInitialCategory,
        studentNames: effectiveStudentNames,
        guardianNames: effectiveGuardianNames,
        teacherNames: effectiveTeacherNames,
        attendedAt,
      });
      await recordAiOperationalEvent({
        schoolId: currentSchool.id,
        route: "/api/ai/formalize-ata",
        mode: "LOCAL_ONLY",
        reason,
        status: "FALLBACK",
        user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
        req,
      });
      return NextResponse.json({
        success: true,
        usedFallback: true,
        mode: "LOCAL_ONLY",
        fallbackReason: "Processamento local ativo para esta instituição.",
        result: localDraft,
      });
    };

    // 2. Confirmação no servidor da configuração e autorização externa da escola (falha fechada -> LOCAL_ONLY)
    let schoolSettingsJson: string | null = null;
    let schoolConfigLoaded = false;
    let schoolRowMeta: {
      name?: string | null;
      city?: string | null;
      inepCode?: string | null;
      active?: boolean;
      settingsJson?: string | null;
    } | null = null;

    if (typeof (prisma as any)?.school?.findUnique === "function") {
      try {
        const schoolRow = await prisma.school.findUnique({
          where: { id: currentSchool.id },
          select: {
            id: true,
            name: true,
            city: true,
            inepCode: true,
            active: true,
            settingsJson: true,
          },
        });
        if (schoolRow && (schoolRow as any).active !== false) {
          schoolRowMeta = schoolRow as any;
          schoolSettingsJson = schoolRow.settingsJson ?? null;
          schoolConfigLoaded = true;
        }
      } catch {
        schoolConfigLoaded = false;
      }
    }

    const eligibility = evaluateFormalizeExternalAiEligibility({
      schoolId: currentSchool.id,
      schoolSettingsJson,
      schoolConfigLoaded,
    });

    if (!eligibility.allowed || !eligibility.apiKey) {
      return buildLocalOnlyResponse(eligibility.reason);
    }

    // 3. Guarda F04: minutas sigilosas, novas sem confirmação explícita, incertas ou fora da allowlist seguem para gerador local
    const sensitivityCheck = isSensitiveOrRestrictedAtaContent({
      isConfidential: effectiveConfidential,
      hasPersistedMinute,
      nonConfidentialConfirmed,
      minuteConfidentialityUnconfirmed: false,
      minuteScopeUnconfirmed,
      ataScope: ataScope ?? null,
      category: effectiveCategory,
      subject,
      rawNotes,
      existingSummary,
    });

    if (sensitivityCheck.restricted) {
      const localDraft = generateLocalAtaMinuta({
        rawNotes,
        existingSummary,
        category: effectiveCategory || "ACOMPANHAMENTO_PEDAGOGICO",
        studentNames: effectiveStudentNames,
        guardianNames: effectiveGuardianNames,
        teacherNames: effectiveTeacherNames,
        attendedAt,
      });
      await recordAiOperationalEvent({
        schoolId: currentSchool.id,
        route: "/api/ai/formalize-ata",
        mode: "LOCAL_POLICY_GUARD",
        reason: sensitivityCheck.reason || "restricted_content",
        status: "FALLBACK",
        user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
        req,
      });
      return NextResponse.json({
        success: true,
        usedFallback: true,
        mode: "LOCAL_POLICY_GUARD",
        fallbackReason: "Conteúdo sigiloso, sensível ou sem confirmação elegível processado no gerador local.",
        result: localDraft,
      });
    }

    const isDocentMeeting =
      effectiveCategory === "ORIENTACAO_DOCENTE" || effectiveStudentNames.length === 0;
    const dateInfo = formatAtaDateExtenso(attendedAt);
    const dateFormats = buildDateFormats(attendedAt);

    let pseudonymizer: ReturnType<typeof createAiPseudonymizer>;
    let maskedSystemInstruction = "";
    let maskedInputPrompt = "";
    let residualFindings: string[] = [];
    let hasUnmaskedKnownEntity = false;

    try {
      pseudonymizer = createAiPseudonymizer(
        effectiveStudentNames,
        effectiveGuardianNames,
        effectiveTeacherNames,
        {
          schoolName: schoolRowMeta?.name || currentSchool.name,
          schoolCity: schoolRowMeta?.city || currentSchool.city,
          schoolInep: schoolRowMeta?.inepCode || currentSchool.inepCode,
          maskDatesAndTimes: true,
          maskPartialNames: true,
          dateReplacements: {
            attendedDateExtenso: dateInfo.dataExtensoCompleta,
            attendedYearExtenso: dateInfo.anoExtenso,
            attendedYearNumeric: dateFormats.yearNumeric,
            attendedDateNumeric: dateFormats.numericBr,
            attendedDateIso: dateFormats.isoDate,
            attendedTime: dateInfo.horaFormatada,
            attendedTimeColon: dateFormats.timeColon,
          },
        }
      );

      const maskedRawNotes = pseudonymizer.maskText(rawNotes || "");
      const maskedExistingSummary = pseudonymizer.maskText(existingSummary || "");
      const maskedSubject = subject ? pseudonymizer.maskText(subject) : "";
      const maskedCategory = pseudonymizer.maskText(effectiveCategory);

      const openingCanonicalPlaceholder = isDocentMeeting
        ? `"[DATA_ATENDIMENTO], nas dependências deste estabelecimento de ensino, reuniu-se a Equipe Pedagógica/Direção com..."`
        : `"[DATA_ATENDIMENTO], nas dependências da Equipe Pedagógica deste estabelecimento de ensino, realizou-se atendimento com a presença de..."`;

      const rawSystemInstruction = `Você atua como Revisor Gramatical e Redator Oficial da Equipe Pedagógica de uma instituição da Rede Pública de Ensino.
Sua missão é gerar uma minuta editável para conferência humana da ata de atendimento/orientação pedagógica aplicando com rigor a Norma Culta da Língua Portuguesa e as diretrizes escolares para elaboração de Atas Pedagógicas.

DIRETRIZES OBRIGATÓRIAS:
1. RIGOR GRAMATICAL TOTAL: Atue como corretor ortográfico (Novo Acordo Ortográfico), garantindo concordância verbal e nominal, sintaxe impecável, pontuação precisa e regência adequada.
2. ABERTURA CANÔNICA COM PLACEHOLDERS PRESERVADOS: O corpo da ata (formalSummary) DEVE OBRIGATORIAMENTE iniciar utilizando exatamente os marcadores literais fornecidos:
${openingCanonicalPlaceholder}
Mantenha literalmente os marcadores [ESTUDANTE_n], [RESPONSAVEL_n], [DOCENTE_n], [DATA_ATENDIMENTO], [ANO_ATENDIMENTO] e [HORA_ATENDIMENTO] exatamente como enviados, sem alterá-los nem inventar datas ou nomes.
3. CONTINUIDADE TEXTUAL (TEXTO CORRIDO): Redija formalSummary em um ÚNICO bloco contínuo de texto corrido, sem marcadores ou linhas em branco.
4. TEMPO VERBAL: Empregue os verbos no PRETÉRITO PERFEITO DO INDICATIVO.
5. PROIBIÇÃO DE ABREVIATURAS INFORMAIS: Não utilize abreviações nem gírias.
6. IMPESSOALIDADE E POSTURA INSTITUCIONAL: Mantenha postura protetiva, sóbria e descritiva.
7. CLÁUSULA DE CIÊNCIA E FECHAMENTO: Conclua declarando que nada mais havendo a tratar, a ata foi lida, conferida e segue para assinatura dos presentes em sinal de ciência.
8. PRESERVAÇÃO DE EDIÇÃO PRÉVIA: Se existingSummary for fornecido, preserve conteúdo e intenções já registradas pela equipe pedagógica.`;

      maskedSystemInstruction = pseudonymizer.maskText(rawSystemInstruction);

      const rawInputPrompt = isDocentMeeting
        ? `DADOS DA ORIENTAÇÃO PEDAGÓGICA DOCENTE / REUNIÃO DE EQUIPE:
- Data e Hora: [DATA_ATENDIMENTO], às [HORA_ATENDIMENTO] ([ANO_ATENDIMENTO])
- Docente(s) / Servidor(es): ${pseudonymizer.maskedTeacherNames.join(", ") || "Docente presente"}
${pseudonymizer.maskedStudentNames.length > 0 ? `- Estudante(s) citado(s): ${pseudonymizer.maskedStudentNames.join(", ")}` : "- Foco: Alinhamento e orientação técnico-pedagógica docente"}
- Natureza: ${maskedCategory}
${maskedSubject ? `- Assunto preliminar: ${maskedSubject}` : ""}
${
  maskedExistingSummary && maskedExistingSummary.trim().length >= 5
    ? `- Minuta Prévia em Edição (REVISAR PRESERVANDO SENTIDO):\n"""\n${maskedExistingSummary.trim()}\n"""\n`
    : ""
}
- Anotações / Tópicos Brutos:
"""
${maskedRawNotes.trim() || "(Sem notas adicionais — revisar texto formal existente)"}
"""

REGRAS DO JSON DE RESPOSTA:
Responda em JSON com as 4 chaves exatas: "formalSubject", "formalSummary", "agreementsSummary", "actionItems" (1 a 3 itens com "description", "responsible" e "suggestedDaysToComplete").`
        : `DADOS DO ATENDIMENTO:
- Data e Hora: [DATA_ATENDIMENTO], às [HORA_ATENDIMENTO] ([ANO_ATENDIMENTO])
- Estudante(s): ${pseudonymizer.maskedStudentNames.join(", ") || "Conforme registro"}
- Responsável(is): ${pseudonymizer.maskedGuardianNames.join(", ") || "Responsável legal presente"}
- Natureza: ${maskedCategory}
${maskedSubject ? `- Assunto preliminar: ${maskedSubject}` : ""}
${
  maskedExistingSummary && maskedExistingSummary.trim().length >= 5
    ? `- Minuta Prévia em Edição (REVISAR PRESERVANDO SENTIDO):\n"""\n${maskedExistingSummary.trim()}\n"""\n`
    : ""
}
- Anotações / Tópicos Brutos:
"""
${maskedRawNotes.trim() || "(Sem notas adicionais — revisar texto formal existente)"}
"""

REGRAS DO JSON DE RESPOSTA:
Responda em JSON com as 4 chaves exatas: "formalSubject", "formalSummary", "agreementsSummary", "actionItems" (1 a 3 itens com "description", "responsible" e "suggestedDaysToComplete").`;

      maskedInputPrompt = pseudonymizer.maskText(rawInputPrompt);

      const combinedMaskedPayload = `${maskedSystemInstruction}\n${maskedInputPrompt}`;
      const userMaskedText = [maskedSubject, maskedRawNotes, maskedExistingSummary]
        .filter(Boolean)
        .join("\n");

      residualFindings = Array.from(
        new Set([
          ...detectResidualIdentifiers(combinedMaskedPayload),
          ...detectResidualIdentifiers(userMaskedText, { checkUnmaskedProperNames: true }),
        ])
      );

      const normPayload = combinedMaskedPayload
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

      const distinctiveSchoolTokens = String(schoolRowMeta?.name || currentSchool.name || "")
        .split(/\s+/)
        .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
        .filter(
          (t) =>
            t.length >= 5 &&
            ![
              "escola",
              "colegio",
              "estadual",
              "municipal",
              "ensino",
              "fundamental",
              "medio",
              "infantil",
              "educacao",
              "centro",
              "unidade",
              "professor",
              "professora",
            ].includes(
              t
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase()
            )
        );

      const knownEntities = [
        ...effectiveStudentNames,
        ...effectiveGuardianNames,
        ...effectiveTeacherNames,
        schoolRowMeta?.name || currentSchool.name || "",
        schoolRowMeta?.city || currentSchool.city || "",
        schoolRowMeta?.inepCode || currentSchool.inepCode || "",
        ...distinctiveSchoolTokens,
      ]
        .map((v) =>
          String(v || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim()
        )
        .filter((v) => v.length >= 3);

      hasUnmaskedKnownEntity = knownEntities.some((entity) => normPayload.includes(entity));
    } catch {
      const localDraft = generateLocalAtaMinuta({
        rawNotes,
        existingSummary,
        category: effectiveCategory,
        studentNames: effectiveStudentNames,
        guardianNames: effectiveGuardianNames,
        teacherNames: effectiveTeacherNames,
        attendedAt,
      });
      await recordAiOperationalEvent({
        schoolId: currentSchool.id,
        route: "/api/ai/formalize-ata",
        mode: "LOCAL_POLICY_GUARD",
        reason: "text_eligibility_unconfirmed",
        status: "FALLBACK",
        user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
        req,
      });
      return NextResponse.json({
        success: true,
        usedFallback: true,
        mode: "LOCAL_POLICY_GUARD",
        fallbackReason: "Não foi possível confirmar elegibilidade textual; gerada minuta exclusivamente local.",
        result: localDraft,
      });
    }

    if (residualFindings.length > 0 || hasUnmaskedKnownEntity) {
      const localDraft = generateLocalAtaMinuta({
        rawNotes,
        existingSummary,
        category: effectiveCategory,
        studentNames: effectiveStudentNames,
        guardianNames: effectiveGuardianNames,
        teacherNames: effectiveTeacherNames,
        attendedAt,
      });
      await recordAiOperationalEvent({
        schoolId: currentSchool.id,
        route: "/api/ai/formalize-ata",
        mode: "LOCAL_POLICY_GUARD",
        reason: residualFindings.length > 0
          ? `residual_identifier_blocked:${residualFindings.join(",")}`
          : "unmasked_known_entity_blocked",
        status: "BLOCKED",
        user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
        req,
      });
      return NextResponse.json({
        success: true,
        usedFallback: true,
        mode: "LOCAL_POLICY_GUARD",
        fallbackReason: "Identificador residual detectado antes do envio; gerada minuta exclusivamente local.",
        result: localDraft,
      });
    }

    // 4. Revalidação pré-despacho contra alteração concorrente da configuração da escola (TOCTOU)
    const preDispatchEligibility = await verifyCurrentSchoolExternalAiAllowed(currentSchool.id);

    if (!preDispatchEligibility.allowed || !preDispatchEligibility.apiKey) {
      return buildLocalOnlyResponse(preDispatchEligibility.reason);
    }

    const ai = new GoogleGenAI({ apiKey: preDispatchEligibility.apiKey });
    const modelsToTry = [
      "gemini-3.5-flash",
      "gemini-flash-latest",
      "gemini-3.5-flash-lite",
      "gemini-3.8-flash",
    ];

    let rawJsonText: string | null = null;
    let lastErrorMsg = "";
    let midFlightPolicyBlockedReason: string | null = null;

    for (const model of modelsToTry) {
      const attemptEligibility = await verifyCurrentSchoolExternalAiAllowed(currentSchool.id);
      if (!attemptEligibility.allowed || !attemptEligibility.apiKey) {
        midFlightPolicyBlockedReason = attemptEligibility.reason;
        break;
      }

      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 18000);
      try {
        const response = await ai.models.generateContent({
          model,
          contents: `${maskedInputPrompt}\n\nResponda estritamente em formato JSON com as chaves: "formalSubject", "formalSummary", "agreementsSummary", "actionItems".`,
          config: {
            systemInstruction: maskedSystemInstruction,
            responseMimeType: "application/json",
            responseSchema: FORMALIZE_ATA_JSON_SCHEMA,
            temperature: 0.2,
            thinkingConfig: {
              thinkingLevel: "low" as any,
            },
            abortSignal: abortController.signal,
          },
        });

        if (response?.text) {
          rawJsonText = response.text.trim();
          break;
        }
      } catch (err: any) {
        lastErrorMsg = err?.message || String(err);
        if (
          lastErrorMsg.toLowerCase().includes("api key not valid") ||
          lastErrorMsg.includes("403 Forbidden")
        ) {
          break;
        }
        if (
          lastErrorMsg.includes("503") ||
          lastErrorMsg.includes("high demand") ||
          lastErrorMsg.includes("UNAVAILABLE")
        ) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (midFlightPolicyBlockedReason) {
      return buildLocalOnlyResponse(midFlightPolicyBlockedReason);
    }

    // Fallback secundário com `store: false` obrigatório para operação stateless
    if (!rawJsonText && !lastErrorMsg.toLowerCase().includes("api key not valid")) {
      const interactionEligibility = await verifyCurrentSchoolExternalAiAllowed(currentSchool.id);
      if (!interactionEligibility.allowed || !interactionEligibility.apiKey) {
        return buildLocalOnlyResponse(interactionEligibility.reason);
      }

      try {
        const interaction: any = await (ai as any).interactions.create(
          {
            model: "gemini-3.5-flash-lite",
            store: false,
            input: maskedInputPrompt,
            system_instruction: maskedSystemInstruction,
            response_format: {
              type: "json_object",
              response_schema: FORMALIZE_ATA_JSON_SCHEMA,
            },
          },
          { maxRetries: 0 }
        );

        if (interaction?.output_text) {
          rawJsonText = interaction.output_text.trim();
        } else if (interaction?.outputs?.[0]?.text) {
          rawJsonText = interaction.outputs[0].text.trim();
        }
      } catch (err: any) {
        lastErrorMsg = lastErrorMsg || err?.message || "interactions_fallback_failed";
      }
    }

    if (rawJsonText) {
      try {
        const cleanJson = rawJsonText
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/```$/i, "")
          .trim();
        const parsedProviderObj = JSON.parse(cleanJson);
        if (
          !parsedProviderObj ||
          typeof parsedProviderObj !== "object" ||
          Array.isArray(parsedProviderObj) ||
          typeof parsedProviderObj.formalSummary !== "string" ||
          parsedProviderObj.formalSummary.trim().length < 10
        ) {
          throw new Error("Resposta externa sem formalSummary válido.");
        }

        const sanitizedFormalSubject = parsedProviderObj.formalSubject
          ? pseudonymizer.unmaskText(String(parsedProviderObj.formalSubject)).trim()
          : subject?.trim() || "Atendimento Pedagógico";

        const sanitizedAgreementsSummary = parsedProviderObj.agreementsSummary
          ? pseudonymizer.unmaskText(String(parsedProviderObj.agreementsSummary)).trim()
          : "";

        const sanitizedActionItems = Array.isArray(parsedProviderObj.actionItems)
          ? parsedProviderObj.actionItems
              .slice(0, 5)
              .map((item: any) => {
                if (typeof item === "string") {
                  return {
                    description: pseudonymizer.unmaskText(item.trim()),
                    responsible: isDocentMeeting ? "DOCENTE" : "FAMILIA",
                    suggestedDaysToComplete: 5,
                  };
                }
                if (!item || typeof item !== "object") return null;
                const desc =
                  item.description ||
                  item.descricao ||
                  item.acao ||
                  item.item ||
                  item.task ||
                  item.texto ||
                  item.detalhes ||
                  "";
                let resp = String(
                  item.responsible || item.responsavel || (isDocentMeeting ? "DOCENTE" : "FAMILIA")
                ).toUpperCase();
                if (!["FAMILIA", "ESTUDANTE", "ESCOLA", "REDE_PROTECAO", "DOCENTE"].includes(resp)) {
                  resp = isDocentMeeting ? "DOCENTE" : "FAMILIA";
                }
                const days =
                  Number(item.suggestedDaysToComplete || item.prazoDias || item.prazo || item.days) || 7;
                return {
                  description: pseudonymizer.unmaskText(String(desc).trim()),
                  responsible: resp,
                  suggestedDaysToComplete: Math.min(Math.max(Math.round(days), 1), 90),
                };
              })
              .filter((a: any) => a && a.description && a.description.length > 0)
          : [];

        let cleanSummary = pseudonymizer
          .unmaskText(parsedProviderObj.formalSummary)
          .replace(/\r\n/g, "\n")
          .split(/\n+/)
          .map((s: string) => s.trim())
          .filter(Boolean)
          .join(" ");

        const prefixoDataObrigatorio = dateInfo.dataExtensoCompleta;
        if (!cleanSummary.startsWith(prefixoDataObrigatorio)) {
          const matchAbertura = cleanSummary.match(
            /^(?:Aos?|No dia|Em|Nesta data)\s+[^,]+(?:,[^,]+)*?,\s*(?:nas dependências[^\.,]+?realizou-se atendimento\s*|realizou-se atendimento\s*)/i
          );
          if (matchAbertura) {
            cleanSummary = cleanSummary.replace(
              matchAbertura[0],
              `${prefixoDataObrigatorio}, nas dependências da Equipe Pedagógica deste estabelecimento de ensino, realizou-se atendimento `
            );
          } else {
            const fallbackMatch = cleanSummary.match(/^(?:Aos?|No dia|Em|Nesta data)\s+[^,]+,\s*/i);
            if (fallbackMatch) {
              cleanSummary = cleanSummary.replace(
                fallbackMatch[0],
                `${prefixoDataObrigatorio}, `
              );
            } else if (!cleanSummary.toLowerCase().includes(dateInfo.mesExtenso.toLowerCase())) {
              cleanSummary = `${prefixoDataObrigatorio}, ${cleanSummary}`;
            }
          }
        }

        cleanSummary = cleanSummary.replace(
          /(?:nas dependências\s+da\s+Equipe\s+Pedagógica\s+deste\s+estabelecimento\s+de\s+ensino,?\s*realizou-se\s+atendimento\s*)+/gi,
          "nas dependências da Equipe Pedagógica deste estabelecimento de ensino, realizou-se atendimento "
        );
        cleanSummary = cleanSummary.replace(
          /(?:da\s+Equipe\s+Pedagógica\s+deste\s+estabelecimento\s+de\s+ensino,?\s*realizou-se\s+atendimento\s*)+/gi,
          "da Equipe Pedagógica deste estabelecimento de ensino, realizou-se atendimento "
        );
        cleanSummary = cleanSummary.replace(/\s{2,}/g, " ").trim();

        const whitelistedResult = {
          formalSubject: sanitizedFormalSubject,
          formalSummary: cleanSummary,
          agreementsSummary: sanitizedAgreementsSummary,
          actionItems: sanitizedActionItems,
        };

        await recordAiOperationalEvent({
          schoolId: currentSchool.id,
          route: "/api/ai/formalize-ata",
          mode: "EXTERNAL_AI",
          reason: "draft_generated_for_human_review",
          status: "SUCCESS",
          user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
          req,
        });

        return NextResponse.json({
          success: true,
          usedFallback: false,
          mode: "EXTERNAL_AI",
          result: whitelistedResult,
        });
      } catch {
        // Fallback determinístico caso a resposta JSON externa não seja válida
      }
    }

    const fallbackResult = generateLocalAtaMinuta({
      rawNotes,
      existingSummary,
      category: effectiveCategory,
      studentNames: effectiveStudentNames,
      guardianNames: effectiveGuardianNames,
      teacherNames: effectiveTeacherNames,
      attendedAt,
    });

    await recordAiOperationalEvent({
      schoolId: currentSchool.id,
      route: "/api/ai/formalize-ata",
      mode: "LOCAL_FALLBACK",
      reason: lastErrorMsg ? "external_provider_unavailable" : "invalid_provider_response",
      status: "FALLBACK",
      user: { id: authCheck.userId, name: authCheck.userName, email: authCheck.email },
      req,
    });

    return NextResponse.json({
      success: true,
      usedFallback: true,
      mode: "LOCAL_FALLBACK",
      fallbackReason: `Minuta gerada localmente (${humanizeGeminiError(lastErrorMsg)}).`,
      result: fallbackResult,
    });
  } catch {
    return NextResponse.json({ error: "Erro ao processar minuta" }, { status: 500 });
  }
}
