import crypto from "crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import {
  buildSessionFromSnapshot,
  resolveEffectiveRoleForSchool,
  resolveServerUserAuthSnapshot,
} from "@/lib/serverAuthContext";
import { isAllowedMessagingRole, type AuthSessionLike } from "@/lib/roles";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import type { frequenciaSyncSchema, serpSyncItemSchema } from "@/lib/schemas";
import {
  buildStudentLookupMaps,
  normalizeSerpStatus,
  normalizeStudentName,
  parseAttendancePercent,
} from "@/lib/studentMatcher";
import { getIsoWeekKey } from "@/lib/pedagogicalClassifier";
import * as currentSchoolModule from "@/lib/currentSchool";
import type { SchoolContext } from "@/lib/currentSchool";
import { applyPendingCgmUpdatesSafely, populateGlobalTakenCgms } from "@/lib/syncCgmGuard";
import { withTenantContext } from "@/lib/rlsTenantContext";
import {
  authenticateExtensionSyncToken,
  type ExtensionSyncLabel,
} from "@/lib/extensionSyncAuth";

export type ResolvedSchool = SchoolContext;
export type StudentNameMap = ReturnType<typeof buildStudentLookupMaps>["nameMap"];

export type SyncAuthContextResult =
  | {
      ok: true;
      authMethod: "SESSION" | "TOKEN";
      userName: string;
      userEmail: string;
      userId: string | undefined;
      currentSchool: ResolvedSchool;
      session?: AuthSessionLike;
    }
  | {
      ok: false;
      response: NextResponse;
    };

/**
 * Autentica a requisição (Sessão Web ativa ou Token da Extensão MV3),
 * resolve a escola ativa e aplica a trava de edição INSTITUCIONAL_ESSENCIAL.
 */
export async function resolveExtensionOrSessionSyncContext(options: {
  req: Request;
  corsHeaders: Record<string, string>;
  label: ExtensionSyncLabel;
  defaultApiUserName: string;
  forbiddenEssencialError: string;
}): Promise<SyncAuthContextResult> {
  const { req, corsHeaders, label, defaultApiUserName, forbiddenEssencialError } = options;
  const session = await auth();

  let authMethod: "SESSION" | "TOKEN" = "TOKEN";
  let userName = defaultApiUserName;
  let userEmail = process.env.SYSTEM_SYNC_EMAIL || "sistema@redeativa.com.br";
  let userId: string | undefined = undefined;
  let targetSchoolId: string | undefined = undefined;
  let sessionSnapshot: Awaited<ReturnType<typeof resolveServerUserAuthSnapshot>> = null;

  if (session?.user?.email) {
    if (session.user.active === false) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Conta desativada. Contate a administração da escola." },
          { status: 403, headers: corsHeaders }
        ),
      };
    }

    sessionSnapshot = await resolveServerUserAuthSnapshot(session);
    if (!sessionSnapshot || sessionSnapshot.active === false) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Conta desativada ou acesso revogado no servidor." },
          { status: 403, headers: corsHeaders }
        ),
      };
    }
    authMethod = "SESSION";
    userEmail = sessionSnapshot.email;
    userName = sessionSnapshot.name || sessionSnapshot.email.split("@")[0];
    userId = sessionSnapshot.id;
    targetSchoolId = sessionSnapshot.schoolId ?? undefined;
  } else {
    const tokenAuth = await authenticateExtensionSyncToken({
      req,
      corsHeaders,
      label,
    });
    if (!tokenAuth.ok) {
      return { ok: false, response: tokenAuth.response };
    }
    targetSchoolId = tokenAuth.targetSchoolId;
    userName = tokenAuth.userName;
  }

  let currentSchool: currentSchoolModule.SchoolContext | null = null;
  if (authMethod === "SESSION") {
    let authorizedResolver: typeof currentSchoolModule.getAuthorizedCurrentSchool | undefined;
    try {
      authorizedResolver = currentSchoolModule.getAuthorizedCurrentSchool;
    } catch {
      authorizedResolver = undefined;
    }
    if (typeof authorizedResolver === "function") {
      currentSchool = await authorizedResolver(session, targetSchoolId, sessionSnapshot, {
        allowSuperAdminReadOnlyFallback: false,
      });
    } else if (
      (session?.user?.role || "").toUpperCase() === "SUPERADMIN" ||
      Boolean(
        session?.user?.schools?.some(
          (s) => s.active !== false && Boolean(s.schoolId || s.id)
        )
      ) ||
      ((session?.user?.role || "").toUpperCase() === "GESTAO_SECRETARIA" &&
        Boolean(session?.user?.networks?.length))
    ) {
      currentSchool = await currentSchoolModule.getCurrentSchool(targetSchoolId);
    }
  } else {
    let verifiedResolver: typeof currentSchoolModule.getSchoolContextByVerifiedId | undefined;
    try {
      verifiedResolver = currentSchoolModule.getSchoolContextByVerifiedId;
    } catch {
      verifiedResolver = undefined;
    }
    if (typeof verifiedResolver === "function") {
      currentSchool = await verifiedResolver(targetSchoolId);
    } else if (targetSchoolId) {
      currentSchool = await currentSchoolModule.getCurrentSchool(targetSchoolId);
    }
  }

  if (!currentSchool) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Nenhuma instituição escolar autorizada vinculada à sessão atual." },
        { status: 403, headers: corsHeaders }
      ),
    };
  }

  if (authMethod === "SESSION") {
    const effectiveRole = sessionSnapshot
      ? resolveEffectiveRoleForSchool(sessionSnapshot, currentSchool)
      : session?.user?.role || "";
    if (!isAllowedMessagingRole(effectiveRole)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Perfil sem permissão para sincronizar dados nesta instituição." },
          { status: 403, headers: corsHeaders }
        ),
      };
    }
  }

  if (currentSchool.edition === "INSTITUCIONAL_ESSENCIAL") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: forbiddenEssencialError },
        { status: 403, headers: corsHeaders }
      ),
    };
  }

  const revalidatedSession: AuthSessionLike | undefined =
    authMethod === "SESSION"
      ? sessionSnapshot
        ? (buildSessionFromSnapshot(session as AuthSessionLike, sessionSnapshot) as AuthSessionLike)
        : (session as AuthSessionLike)
      : undefined;

  return {
    ok: true,
    authMethod,
    userName,
    userEmail,
    userId,
    currentSchool,
    session: revalidatedSession,
  };
}

/**
 * Carrega os estudantes ativos do tenant e constrói os mapas de pareamento em memória
 * com proteção contra colisão global de CGM (@unique).
 */
export async function loadSchoolStudentMatcherContext(
  schoolId: string | null | undefined,
  incomingRawCgms: Array<string | number | null | undefined>
) {
  const normalizedSchoolId = (schoolId || "").trim();
  if (!normalizedSchoolId) {
    throw new Error("TENANT_REQUIRED");
  }

  const allStudents = await withTenantContext(prisma, normalizedSchoolId, async (tx) =>
    tx.student.findMany({
      where: { schoolId: normalizedSchoolId, active: true },
      select: {
        id: true,
        cgm: true,
        name: true,
        isExchangeStudent: true,
        isSpecialNeeds: true,
        age: true,
      },
    })
  );

  const studentByIdMap = new Map(allStudents.map((s) => [s.id, s]));
  const { cgmMap, nameMap, usedCgms } = buildStudentLookupMaps(allStudents);

  // Exceção explícita da Fase A: consulta global mínima apenas de `cgm` para prevenir colisão @unique
  await populateGlobalTakenCgms(
    prisma,
    incomingRawCgms.map((c) => String(c ?? "").replace(/\u0000/g, "").trim()),
    usedCgms
  );

  return {
    allStudents,
    studentByIdMap,
    cgmMap,
    nameMap,
    usedCgms,
  };
}

/**
 * Resolve o ID do estudante via CGM exato ou nome normalizado (com guarda contra homônimos)
 * e agenda a vinculação automática de CGM quando aplicável.
 */
export function matchStudentAndTrackPendingCgm(params: {
  cgmClean: string;
  rawName: string;
  cgmMap: Map<string, string>;
  nameMap: StudentNameMap;
  usedCgms: Set<string>;
  pendingCgmUpdates: Map<string, string>;
  logPrefix: string;
}): string | undefined {
  const { cgmClean, rawName, cgmMap, nameMap, usedCgms, pendingCgmUpdates, logPrefix } = params;

  let studentId: string | undefined = cgmClean ? cgmMap.get(cgmClean) : undefined;

  if (!studentId && rawName) {
    const studentByName = nameMap.get(rawName);
    if (studentByName) {
      if (studentByName.isHomonym) {
        console.warn(
          `[${logPrefix}] Pareamento por nome ignorado para homônimo sem CGM correspondente: ${rawName}`
        );
      } else {
        const matchedId = studentByName.id;
        studentId = matchedId;

        if (!studentByName.hasCgm && cgmClean && !usedCgms.has(cgmClean)) {
          pendingCgmUpdates.set(matchedId, cgmClean);
          usedCgms.add(cgmClean);
          cgmMap.set(cgmClean, matchedId);
          studentByName.hasCgm = true;
        }
      }
    }
  }

  return studentId;
}

function parseBrDate(val?: string | null): Date | null {
  if (!val) return null;
  const match = String(val).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const d = Number(match[1]);
  const m = Number(match[2]);
  const y = Number(match[3]);
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d, 23, 59, 59);
  return isNaN(date.getTime()) ? null : date;
}

function parseBooleanFlag(val?: boolean | number | string | null): boolean {
  if (val === true || val === 1 || val === "1") return true;
  if (typeof val === "string") {
    const lower = val.toLowerCase().trim();
    return lower === "true" || lower === "sim" || lower === "1" || lower === "✓";
  }
  return false;
}

function parseAge(val?: number | string | null): number | null {
  if (val === undefined || val === null || val === "") return null;
  const num =
    typeof val === "number" ? Math.round(val) : parseInt(String(val).replace(/\D/g, ""), 10);
  return !isNaN(num) && num >= 5 && num <= 99 ? num : null;
}

export type PowerBiSyncAlunoItem = z.infer<typeof frequenciaSyncSchema>["alunos"][number];
export type SerpSyncFichaItem = z.infer<typeof serpSyncItemSchema>;

export async function executePowerBiFrequencySync(options: {
  alunos: PowerBiSyncAlunoItem[];
  currentSchool: ResolvedSchool;
  authMethod: "SESSION" | "TOKEN";
  sourceMode?: "EXTENSION_SCRAPER" | "MANUAL_FILE";
  userId?: string;
  userName: string;
  userEmail: string;
  req: Request;
}) {
  const {
    alunos,
    currentSchool,
    authMethod,
    sourceMode = "EXTENSION_SCRAPER",
    userId,
    userName,
    userEmail,
    req,
  } = options;

  const { allStudents, studentByIdMap, cgmMap, nameMap, usedCgms } =
    await loadSchoolStudentMatcherContext(
      currentSchool.id,
      alunos.map((a) => a.cgm)
    );

  const pendingCgmUpdates = new Map<string, string>();
  const pendingStudentUpdates = new Map<
    string,
    {
      isExchangeStudent?: boolean;
      isSpecialNeeds?: boolean;
      age?: number | null;
    }
  >();
  const pendingAmparos = new Map<string, { vigenciaStr: string; date: Date }>();

  const batchRecords = new Map<
    string,
    {
      id: string;
      snapshotId: string;
      studentId: string;
      percent: number;
      weeklyPercent: number | null;
      previousWeeklyPercent: number | null;
      detail: string;
    }
  >();
  const naoEncontrados: Array<{ nome: string; cgm?: string; turma?: string }> = [];

  for (const item of alunos) {
    const cgmClean = String(item.cgm ?? "").replace(/\u0000/g, "").trim();
    const rawName = normalizeStudentName(item.nome);

    const studentId = matchStudentAndTrackPendingCgm({
      cgmClean,
      rawName,
      cgmMap,
      nameMap,
      usedCgms,
      pendingCgmUpdates,
      logPrefix: "frequencia/sync",
    });

    if (studentId) {
      const studentRecord = studentByIdMap.get(studentId);

      const hasExplicitExchange =
        item.ganhandoMundo !== undefined &&
        item.ganhandoMundo !== null &&
        String(item.ganhandoMundo).trim() !== "";
      const hasExplicitSpecial =
        item.deficienciaAltasHabilidades !== undefined &&
        item.deficienciaAltasHabilidades !== null &&
        String(item.deficienciaAltasHabilidades).trim() !== "";

      const isExchangeStudent = parseBooleanFlag(item.ganhandoMundo);
      const isSpecialNeeds = parseBooleanFlag(item.deficienciaAltasHabilidades);
      const age = parseAge(item.idade);

      const currentExchange = Boolean(studentRecord?.isExchangeStudent);
      const currentSpecial = Boolean(studentRecord?.isSpecialNeeds);

      const needsExchange = hasExplicitExchange && isExchangeStudent !== currentExchange;
      const needsSpecial = hasExplicitSpecial && isSpecialNeeds !== currentSpecial;
      const needsAge = age !== null && studentRecord?.age !== age;

      if (needsExchange || needsSpecial || needsAge) {
        const current = pendingStudentUpdates.get(studentId) || {};
        if (needsExchange) current.isExchangeStudent = isExchangeStudent;
        if (needsSpecial) current.isSpecialNeeds = isSpecialNeeds;
        if (needsAge) current.age = age;
        pendingStudentUpdates.set(studentId, current);
      }

      const isGanhandoMundo = hasExplicitExchange ? isExchangeStudent : currentExchange;

      const cleanAmparo = item.amparoLegalVigencia
        ? String(item.amparoLegalVigencia).replace(/\u0000/g, "").trim()
        : null;
      const amparoDate = parseBrDate(cleanAmparo);
      if (amparoDate && cleanAmparo && !isGanhandoMundo) {
        pendingAmparos.set(studentId, {
          vigenciaStr: cleanAmparo,
          date: amparoDate,
        });
      }

      const percent = parseAttendancePercent(item.mediaGeral ?? item.frequencia);
      if (percent !== null) {
        const semAtual =
          item.semanaAtual !== undefined && item.semanaAtual !== null
            ? String(item.semanaAtual).replace(/\u0000/g, "").trim()
            : "";
        const semAnt =
          item.semanaAnterior !== undefined && item.semanaAnterior !== null
            ? String(item.semanaAnterior).replace(/\u0000/g, "").trim()
            : "";
        const weeklyPercent = parseAttendancePercent(semAtual);
        const previousWeeklyPercent = parseAttendancePercent(semAnt);
        const detail = [
          cgmClean ? `CGM: ${cgmClean}` : null,
          semAtual ? `Semana Atual: ${semAtual}` : null,
          semAnt ? `Semana Anterior: ${semAnt}` : null,
        ]
          .filter(Boolean)
          .join(" | ");

        batchRecords.set(studentId, {
          id: crypto.randomUUID(),
          snapshotId: crypto.randomUUID(),
          studentId,
          percent,
          weeklyPercent,
          previousWeeklyPercent,
          detail,
        });
      }
    } else {
      naoEncontrados.push({
        nome: item.nome || "",
        cgm: cgmClean || undefined,
        turma: item.turma || undefined,
      });
    }
  }

  const cgmVinculados = await applyPendingCgmUpdatesSafely(
    prisma,
    pendingCgmUpdates,
    currentSchool.id
  );

  const rowsToUpsert = Array.from(batchRecords.values());
  const BATCH_SIZE = 250;
  const isManualOrEssential =
    sourceMode === "MANUAL_FILE" || currentSchool.edition === "INSTITUCIONAL_ESSENCIAL";
  const defaultAction = isManualOrEssential
    ? "Importado por arquivo de frequência"
    : "Importado do Power BI (PRESENTE NA ESCOLA)";
  const referenceWeek = getIsoWeekKey(new Date());

  const persistedLowAttendanceRows: Array<{ studentId: string; attendancePercent: number }> = [];

  for (let i = 0; i < rowsToUpsert.length; i += BATCH_SIZE) {
    const chunk = rowsToUpsert.slice(i, i + BATCH_SIZE);
    const values = chunk.map(
      (r) =>
        Prisma.sql`(${r.id}, ${r.studentId}, CAST(${r.percent} AS DOUBLE PRECISION), ${r.detail}, ${defaultAction})`
    );

    const chunkPersisted = await withTenantContext(prisma, currentSchool.id, async (tx) =>
      tx.$queryRaw<Array<{ studentId: string; attendancePercent: number }>>`
        INSERT INTO "LowAttendanceRecord" (
          "id",
          "studentId",
          "attendancePercent",
          "enrollmentDetail",
          "actionsTaken",
          "updatedAt"
        )
        SELECT
          v."id",
          v."studentId",
          v."attendancePercent",
          v."enrollmentDetail",
          v."actionsTaken",
          NOW()
        FROM (VALUES ${Prisma.join(values)}) AS v(
          "id",
          "studentId",
          "attendancePercent",
          "enrollmentDetail",
          "actionsTaken"
        )
        INNER JOIN "Student" AS s
          ON s."id" = v."studentId"
         AND s."schoolId" = ${currentSchool.id}
        ON CONFLICT ("studentId") DO UPDATE SET
          "attendancePercent" = EXCLUDED."attendancePercent",
          "enrollmentDetail" = EXCLUDED."enrollmentDetail",
          "updatedAt" = NOW()
        RETURNING "studentId", "attendancePercent"
      `
    );
    persistedLowAttendanceRows.push(...chunkPersisted);

    try {
      const snapshotValues = chunk.map(
        (r) =>
          Prisma.sql`(${r.snapshotId}, ${r.studentId}, ${referenceWeek}, CAST(${r.percent} AS DOUBLE PRECISION), CAST(${r.weeklyPercent} AS DOUBLE PRECISION), CAST(${r.previousWeeklyPercent} AS DOUBLE PRECISION))`
      );

      await withTenantContext(prisma, currentSchool.id, async (tx) => {
        await tx.$executeRaw`
          INSERT INTO "AttendanceSnapshot" (
            "id",
            "studentId",
            "referenceWeek",
            "attendancePercent",
            "weeklyPercent",
            "previousWeeklyPercent",
            "recordedAt"
          )
          SELECT
            v."id",
            v."studentId",
            v."referenceWeek",
            v."attendancePercent",
            v."weeklyPercent",
            v."previousWeeklyPercent",
            NOW()
          FROM (VALUES ${Prisma.join(snapshotValues)}) AS v(
            "id",
            "studentId",
            "referenceWeek",
            "attendancePercent",
            "weeklyPercent",
            "previousWeeklyPercent"
          )
          INNER JOIN "Student" AS s
            ON s."id" = v."studentId"
           AND s."schoolId" = ${currentSchool.id}
          ON CONFLICT ("studentId", "referenceWeek") DO UPDATE SET
            "attendancePercent" = EXCLUDED."attendancePercent",
            "weeklyPercent" = EXCLUDED."weeklyPercent",
            "previousWeeklyPercent" = EXCLUDED."previousWeeklyPercent",
            "recordedAt" = NOW()
        `;
      });
    } catch (snapErr: any) {
      console.warn("[frequencia/sync] Aviso ao gravar AttendanceSnapshot:", snapErr?.message);
    }
  }

  let estudantesEnriquecidos = 0;
  if (pendingStudentUpdates.size > 0) {
    const studentUpdateEntries = Array.from(pendingStudentUpdates.entries());
    for (let i = 0; i < studentUpdateEntries.length; i += BATCH_SIZE) {
      const slice = studentUpdateEntries.slice(i, i + BATCH_SIZE);
      const values = slice.map(
        ([id, data]) =>
          Prisma.sql`(${id}, CAST(${data.isExchangeStudent ?? null} AS BOOLEAN), CAST(${data.isSpecialNeeds ?? null} AS BOOLEAN), CAST(${data.age ?? null} AS INTEGER))`
      );
      const updatedCount = await withTenantContext(prisma, currentSchool.id, async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          UPDATE "Student" AS s
          SET
            "isExchangeStudent" = COALESCE(v."setExchange", s."isExchangeStudent"),
            "isSpecialNeeds" = COALESCE(v."setSpecial", s."isSpecialNeeds"),
            "age" = COALESCE(v."ageVal", s."age"),
            "updatedAt" = NOW()
          FROM (VALUES ${Prisma.join(values)}) AS v("id", "setExchange", "setSpecial", "ageVal")
          WHERE s."id" = v."id"
            AND s."schoolId" = ${currentSchool.id}
          RETURNING s."id"
        `;
        return rows.length;
      });
      estudantesEnriquecidos += updatedCount;
    }
  }

  let amparosCriados = 0;
  let amparosAtualizados = 0;

  const exchangeStudentIds = Array.from(
    new Set(
      allStudents
        .filter((s) => {
          const pending = pendingStudentUpdates.get(s.id);
          return pending?.isExchangeStudent !== undefined
            ? pending.isExchangeStudent
            : s.isExchangeStudent;
        })
        .map((s) => s.id)
    )
  );

  if (exchangeStudentIds.length > 0) {
    try {
      await withTenantContext(prisma, currentSchool.id, async (tx) => {
        await tx.absenceJustification.deleteMany({
          where: {
            studentId: { in: exchangeStudentIds },
            student: { schoolId: currentSchool.id },
            type: "DISPENSA_LEGAL",
            OR: [{ notes: { contains: "Power BI" } }, { notes: { contains: "arquivo de frequência" } }],
          },
        });
      });
    } catch (err: any) {
      console.warn(
        "[frequencia/sync] Aviso ao limpar atestados automáticos de alunos Ganhando Mundo:",
        err?.message
      );
    }
  }

  if (pendingAmparos.size > 0) {
    const studentIdsWithAmparo = Array.from(pendingAmparos.keys());
    const amparoResult = await withTenantContext(prisma, currentSchool.id, async (tx) => {
      const validStudents = await tx.student.findMany({
        where: {
          id: { in: studentIdsWithAmparo },
          schoolId: currentSchool.id,
        },
        select: { id: true },
      });
      const validStudentIds = new Set(validStudents.map((s) => s.id));

      const existingJusts = await tx.absenceJustification.findMany({
        where: {
          studentId: { in: Array.from(validStudentIds) },
          student: { schoolId: currentSchool.id },
          type: "DISPENSA_LEGAL",
          OR: [{ notes: { contains: "Power BI" } }, { notes: { contains: "arquivo de frequência" } }],
        },
        select: {
          id: true,
          studentId: true,
          endDate: true,
        },
      });

      const existingMap = new Map<string, { id: string; endDate: Date }>();
      existingJusts.forEach((j) => existingMap.set(j.studentId, j));
      const now = new Date();
      const amparoPrefix = isManualOrEssential
        ? "Importado via arquivo de frequência"
        : "Sincronizado automaticamente via Power BI";

      let createdCount = 0;
      let updatedCount = 0;

      for (const [studentId, amparo] of pendingAmparos.entries()) {
        if (!validStudentIds.has(studentId)) continue;
        const existing = existingMap.get(studentId);
        if (!existing) {
          await tx.absenceJustification.create({
            data: {
              studentId,
              type: "DISPENSA_LEGAL",
              startDate: amparo.date < now ? amparo.date : now,
              endDate: amparo.date,
              notes: `${amparoPrefix} (Amparo Legal Vigência Máx: ${amparo.vigenciaStr})`,
              createdByName: userName,
              createdByEmail: userEmail,
            },
          });
          createdCount++;
        } else {
          const existingTime = new Date(existing.endDate).setHours(0, 0, 0, 0);
          const newTime = new Date(amparo.date).setHours(0, 0, 0, 0);
          if (existingTime !== newTime) {
            await tx.absenceJustification.update({
              where: { id: existing.id },
              data: {
                endDate: amparo.date,
                notes: `${amparoPrefix} (Amparo Legal Vigência Máx atualizada para: ${amparo.vigenciaStr})`,
              },
            });
            updatedCount++;
          }
        }
      }

      return { createdCount, updatedCount };
    });

    amparosCriados = amparoResult.createdCount;
    amparosAtualizados = amparoResult.updatedCount;
  }

  const atualizados = persistedLowAttendanceRows.length;
  const emRiscoCount = persistedLowAttendanceRows.filter(
    (r) => Number(r.attendancePercent) < 75
  ).length;

  await logAudit({
    action: "UPDATE_LOW_ATTENDANCE",
    entityType: "LowAttendanceRecord",
    entityId: "BATCH_SYNC",
    schoolId: currentSchool.id,
    details: {
      totalRecebido: alunos.length,
      atualizados,
      cgmVinculados,
      emRiscoCount,
      naoEncontradosCount: naoEncontrados.length,
      estudantesEnriquecidos,
      amparosCriados,
      amparosAtualizados,
      authMethod,
    },
    user: {
      id: userId,
      name: userName,
      email: userEmail,
    },
    req,
  });

  return {
    sucesso: true,
    totalRecebido: alunos.length,
    atualizados,
    cgmVinculados,
    emRiscoCount,
    estudantesEnriquecidos,
    amparosCriados,
    amparosAtualizados,
    naoEncontradosTotal: naoEncontrados.length,
    naoEncontrados: naoEncontrados.slice(0, 15),
  };
}

export async function executeSerpProtectionSync(options: {
  fichas: SerpSyncFichaItem[];
  currentSchool: ResolvedSchool;
  authMethod: "SESSION" | "TOKEN";
  userId?: string;
  userName: string;
  userEmail: string;
  req: Request;
}) {
  const { fichas, currentSchool, authMethod, userId, userName, userEmail, req } = options;

  const { cgmMap, nameMap, usedCgms } = await loadSchoolStudentMatcherContext(
    currentSchool.id,
    fichas.map((f) => f.cgm)
  );

  const pendingCgmUpdates = new Map<string, string>();
  const batchRecords = new Map<
    string,
    {
      id: string;
      studentId: string;
      protocoloStr: string | null;
      statusEnum: string;
      dataAbertura: Date | null;
      detailsStr: string | null;
      actionSummary: string;
    }
  >();
  const naoEncontrados: Array<{ nome: string; cgm?: string; protocolo?: string }> = [];

  for (const item of fichas) {
    const cgmClean = String(item.cgm ?? "").trim();
    const rawName = normalizeStudentName(item.nome);

    const studentId = matchStudentAndTrackPendingCgm({
      cgmClean,
      rawName,
      cgmMap,
      nameMap,
      usedCgms,
      pendingCgmUpdates,
      logPrefix: "serp/sync",
    });

    if (studentId) {
      const statusEnum = normalizeSerpStatus(item.status || item.situacao);

      let dataAbertura: Date | null = null;
      if (item.dataAbertura) {
        const parsed = new Date(item.dataAbertura);
        if (!isNaN(parsed.getTime())) dataAbertura = parsed;
      }

      const rawProt = item.numeroFicha ?? item.protocolo;
      const protocoloStr =
        rawProt !== undefined && rawProt !== null && String(rawProt).trim()
          ? String(rawProt).trim()
          : null;
      const acoesDesc = item.acoesRealizadas || item.motivo || item.observacoes || "";
      const actionSummary = [
        protocoloStr ? `Ficha SERP #${protocoloStr}` : "Ficha SERP Ativa",
        statusEnum === "CONSELHO_TUTELAR"
          ? "ENCAMINHADO CONSELHO TUTELAR"
          : statusEnum === "MINISTERIO_PUBLICO"
          ? "MINISTÉRIO PÚBLICO"
          : statusEnum === "ARQUIVADO"
          ? "ARQUIVADO"
          : "EM ACOMPANHAMENTO",
        acoesDesc ? `(${acoesDesc})` : null,
      ]
        .filter(Boolean)
        .join(" - ");

      const detailsStr =
        typeof item.detalhes === "object" && item.detalhes !== null
          ? JSON.stringify(item.detalhes)
          : item.detalhes || acoesDesc || null;

      batchRecords.set(studentId, {
        id: crypto.randomUUID(),
        studentId,
        protocoloStr,
        statusEnum,
        dataAbertura,
        detailsStr,
        actionSummary,
      });
    } else {
      const rawProt = item.numeroFicha ?? item.protocolo;
      naoEncontrados.push({
        nome: item.nome || "",
        cgm: cgmClean || undefined,
        protocolo: rawProt ? String(rawProt) : undefined,
      });
    }
  }

  const cgmVinculados = await applyPendingCgmUpdatesSafely(
    prisma,
    pendingCgmUpdates,
    currentSchool.id
  );

  const rowsToUpsert = Array.from(batchRecords.values());
  const BATCH_SIZE = 250;
  const defaultEnrollment = "Importado do SERP (Rede de Proteção)";

  const persistedSerpRows: Array<{ studentId: string; serpStatus: string | null }> = [];

  for (let i = 0; i < rowsToUpsert.length; i += BATCH_SIZE) {
    const chunk = rowsToUpsert.slice(i, i + BATCH_SIZE);
    const values = chunk.map(
      (r) =>
        Prisma.sql`(
          ${r.id},
          ${r.studentId},
          ${70.0},
          ${defaultEnrollment},
          CAST(${r.protocoloStr} AS TEXT),
          ${r.statusEnum},
          CAST(${r.dataAbertura} AS TIMESTAMP),
          CAST(${r.detailsStr} AS TEXT),
          ${r.actionSummary}
        )`
    );

    const chunkPersisted = await withTenantContext(prisma, currentSchool.id, async (tx) =>
      tx.$queryRaw<Array<{ studentId: string; serpStatus: string | null }>>`
        INSERT INTO "LowAttendanceRecord" (
          "id",
          "studentId",
          "attendancePercent",
          "enrollmentDetail",
          "serpProtocol",
          "serpStatus",
          "serpOpenedAt",
          "serpDetails",
          "actionsTaken",
          "updatedAt"
        )
        SELECT
          v."id",
          v."studentId",
          v."attendancePercent",
          v."enrollmentDetail",
          v."serpProtocol",
          v."serpStatus",
          v."serpOpenedAt",
          v."serpDetails",
          v."actionsTaken",
          NOW()
        FROM (VALUES ${Prisma.join(values)}) AS v(
          "id",
          "studentId",
          "attendancePercent",
          "enrollmentDetail",
          "serpProtocol",
          "serpStatus",
          "serpOpenedAt",
          "serpDetails",
          "actionsTaken"
        )
        INNER JOIN "Student" AS s
          ON s."id" = v."studentId"
         AND s."schoolId" = ${currentSchool.id}
        ON CONFLICT ("studentId") DO UPDATE SET
          "serpProtocol" = EXCLUDED."serpProtocol",
          "serpStatus" = EXCLUDED."serpStatus",
          "serpOpenedAt" = EXCLUDED."serpOpenedAt",
          "serpDetails" = EXCLUDED."serpDetails",
          "actionsTaken" = EXCLUDED."actionsTaken",
          "updatedAt" = NOW()
        RETURNING "studentId", "serpStatus"
      `
    );
    persistedSerpRows.push(...chunkPersisted);
  }

  const atualizados = persistedSerpRows.length;
  const conselhoTutelarCount = persistedSerpRows.filter(
    (r) => r.serpStatus === "CONSELHO_TUTELAR"
  ).length;

  await logAudit({
    action: "UPDATE_LOW_ATTENDANCE",
    entityType: "SerpSync",
    entityId: "BATCH_SERP",
    schoolId: currentSchool.id,
    details: {
      totalRecebido: fichas.length,
      atualizados,
      cgmVinculados,
      conselhoTutelarCount,
      naoEncontradosCount: naoEncontrados.length,
      authMethod,
    },
    user: {
      id: userId,
      name: userName,
      email: userEmail,
    },
    req,
  });

  return {
    sucesso: true,
    totalRecebido: fichas.length,
    atualizados,
    cgmVinculados,
    conselhoTutelarCount,
    naoEncontradosTotal: naoEncontrados.length,
    naoEncontrados: naoEncontrados.slice(0, 15),
  };
}
