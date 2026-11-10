import crypto from "crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
import { getCurrentSchool } from "@/lib/currentSchool";
import { applyPendingCgmUpdatesSafely, populateGlobalTakenCgms } from "@/lib/syncCgmGuard";
import {
  authenticateExtensionSyncToken,
  type ExtensionSyncLabel,
} from "@/lib/extensionSyncAuth";

export type ResolvedSchool = Awaited<ReturnType<typeof getCurrentSchool>>;
export type StudentNameMap = ReturnType<typeof buildStudentLookupMaps>["nameMap"];

export type SyncAuthContextResult =
  | {
      ok: true;
      authMethod: "SESSION" | "TOKEN";
      userName: string;
      userEmail: string;
      userId: string | undefined;
      currentSchool: ResolvedSchool;
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

  if (session?.user?.email && session.user.active !== false) {
    authMethod = "SESSION";
    userEmail = session.user.email;
    userName = session.user.name || session.user.email.split("@")[0];
    userId = session.user.id;
    targetSchoolId = session.user.schoolId ?? undefined;
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

  const currentSchool = await getCurrentSchool(targetSchoolId);

  if (currentSchool.edition === "INSTITUCIONAL_ESSENCIAL") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: forbiddenEssencialError },
        { status: 403, headers: corsHeaders }
      ),
    };
  }

  return {
    ok: true,
    authMethod,
    userName,
    userEmail,
    userId,
    currentSchool,
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
  const allStudents = await prisma.student.findMany({
    where: schoolId ? { schoolId, active: true } : { active: true },
    select: {
      id: true,
      cgm: true,
      name: true,
      isExchangeStudent: true,
      isSpecialNeeds: true,
      age: true,
    },
  });

  const studentByIdMap = new Map(allStudents.map((s) => [s.id, s]));
  const { cgmMap, nameMap, usedCgms } = buildStudentLookupMaps(allStudents);

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
  userId?: string;
  userName: string;
  userEmail: string;
  req: Request;
}) {
  const { alunos, currentSchool, authMethod, userId, userName, userEmail, req } = options;

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

      const isExchangeStudent = parseBooleanFlag(item.ganhandoMundo);
      const isSpecialNeeds = parseBooleanFlag(item.deficienciaAltasHabilidades);
      const age = parseAge(item.idade);

      const needsExchange = isExchangeStudent && !studentRecord?.isExchangeStudent;
      const needsSpecial = isSpecialNeeds && !studentRecord?.isSpecialNeeds;
      const needsAge = age !== null && studentRecord?.age !== age;

      if (needsExchange || needsSpecial || needsAge) {
        const current = pendingStudentUpdates.get(studentId) || {};
        if (needsExchange) current.isExchangeStudent = true;
        if (needsSpecial) current.isSpecialNeeds = true;
        if (needsAge) current.age = age;
        pendingStudentUpdates.set(studentId, current);
      }

      const isGanhandoMundo = isExchangeStudent || Boolean(studentRecord?.isExchangeStudent);

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

  const cgmVinculados = await applyPendingCgmUpdatesSafely(prisma, pendingCgmUpdates);

  const rowsToUpsert = Array.from(batchRecords.values());
  const BATCH_SIZE = 250;
  const defaultAction = "Importado do Power BI (PRESENTE NA ESCOLA)";
  const referenceWeek = getIsoWeekKey(new Date());

  for (let i = 0; i < rowsToUpsert.length; i += BATCH_SIZE) {
    const chunk = rowsToUpsert.slice(i, i + BATCH_SIZE);
    const values = chunk.map(
      (r) =>
        Prisma.sql`(${r.id}, ${r.studentId}, CAST(${r.percent} AS DOUBLE PRECISION), ${r.detail}, ${defaultAction}, NOW())`
    );

    await prisma.$executeRaw`
      INSERT INTO "LowAttendanceRecord" (
        "id",
        "studentId",
        "attendancePercent",
        "enrollmentDetail",
        "actionsTaken",
        "updatedAt"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("studentId") DO UPDATE SET
        "attendancePercent" = EXCLUDED."attendancePercent",
        "enrollmentDetail" = EXCLUDED."enrollmentDetail",
        "updatedAt" = NOW()
    `;

    try {
      const snapshotValues = chunk.map(
        (r) =>
          Prisma.sql`(${r.snapshotId}, ${r.studentId}, ${referenceWeek}, CAST(${r.percent} AS DOUBLE PRECISION), CAST(${r.weeklyPercent} AS DOUBLE PRECISION), CAST(${r.previousWeeklyPercent} AS DOUBLE PRECISION), NOW())`
      );

      await prisma.$executeRaw`
        INSERT INTO "AttendanceSnapshot" (
          "id",
          "studentId",
          "referenceWeek",
          "attendancePercent",
          "weeklyPercent",
          "previousWeeklyPercent",
          "recordedAt"
        )
        VALUES ${Prisma.join(snapshotValues)}
        ON CONFLICT ("studentId", "referenceWeek") DO UPDATE SET
          "attendancePercent" = EXCLUDED."attendancePercent",
          "weeklyPercent" = EXCLUDED."weeklyPercent",
          "previousWeeklyPercent" = EXCLUDED."previousWeeklyPercent",
          "recordedAt" = NOW()
      `;
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
          Prisma.sql`(${id}, CAST(${Boolean(data.isExchangeStudent)} AS BOOLEAN), CAST(${Boolean(data.isSpecialNeeds)} AS BOOLEAN), CAST(${data.age ?? null} AS INTEGER))`
      );
      await prisma.$executeRaw`
        UPDATE "Student" AS s
        SET
          "isExchangeStudent" = CASE WHEN v."setExchange" THEN true ELSE s."isExchangeStudent" END,
          "isSpecialNeeds" = CASE WHEN v."setSpecial" THEN true ELSE s."isSpecialNeeds" END,
          "age" = COALESCE(v."ageVal", s."age"),
          "updatedAt" = NOW()
        FROM (VALUES ${Prisma.join(values)}) AS v("id", "setExchange", "setSpecial", "ageVal")
        WHERE s."id" = v."id"
          ${currentSchool.id ? Prisma.sql`AND s."schoolId" = ${currentSchool.id}` : Prisma.empty}
      `;
    }
    estudantesEnriquecidos = studentUpdateEntries.length;
  }

  let amparosCriados = 0;
  let amparosAtualizados = 0;

  const exchangeStudentIds = Array.from(
    new Set([
      ...allStudents.filter((s) => s.isExchangeStudent).map((s) => s.id),
      ...Array.from(pendingStudentUpdates.entries())
        .filter(([, u]) => u.isExchangeStudent)
        .map(([id]) => id),
    ])
  );

  if (exchangeStudentIds.length > 0) {
    try {
      await prisma.absenceJustification.deleteMany({
        where: {
          studentId: { in: exchangeStudentIds },
          type: "DISPENSA_LEGAL",
          notes: { contains: "Power BI" },
        },
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
    const existingJusts = await prisma.absenceJustification.findMany({
      where: {
        studentId: { in: studentIdsWithAmparo },
        type: "DISPENSA_LEGAL",
        notes: { contains: "Power BI" },
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

    for (const [studentId, amparo] of pendingAmparos.entries()) {
      const existing = existingMap.get(studentId);
      if (!existing) {
        await prisma.absenceJustification.create({
          data: {
            studentId,
            type: "DISPENSA_LEGAL",
            startDate: amparo.date < now ? amparo.date : now,
            endDate: amparo.date,
            notes: `Sincronizado automaticamente via Power BI (Amparo Legal Vigência Máx: ${amparo.vigenciaStr})`,
            createdByName: userName,
            createdByEmail: userEmail,
          },
        });
        amparosCriados++;
      } else {
        const existingTime = new Date(existing.endDate).setHours(0, 0, 0, 0);
        const newTime = new Date(amparo.date).setHours(0, 0, 0, 0);
        if (existingTime !== newTime) {
          await prisma.absenceJustification.update({
            where: { id: existing.id },
            data: {
              endDate: amparo.date,
              notes: `Sincronizado automaticamente via Power BI (Amparo Legal Vigência Máx atualizada para: ${amparo.vigenciaStr})`,
            },
          });
          amparosAtualizados++;
        }
      }
    }
  }

  const atualizados = rowsToUpsert.length;
  const emRiscoCount = rowsToUpsert.filter((r) => r.percent < 75).length;

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

  const cgmVinculados = await applyPendingCgmUpdatesSafely(prisma, pendingCgmUpdates);

  const rowsToUpsert = Array.from(batchRecords.values());
  const BATCH_SIZE = 250;
  const defaultEnrollment = "Importado do SERP (Rede de Proteção)";

  for (let i = 0; i < rowsToUpsert.length; i += BATCH_SIZE) {
    const chunk = rowsToUpsert.slice(i, i + BATCH_SIZE);
    const values = chunk.map(
      (r) =>
        Prisma.sql`(
          ${r.id},
          ${r.studentId},
          ${70.0},
          ${defaultEnrollment},
          ${r.protocoloStr},
          ${r.statusEnum},
          ${r.dataAbertura},
          ${r.detailsStr},
          ${r.actionSummary},
          NOW()
        )`
    );

    await prisma.$executeRaw`
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
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("studentId") DO UPDATE SET
        "serpProtocol" = EXCLUDED."serpProtocol",
        "serpStatus" = EXCLUDED."serpStatus",
        "serpOpenedAt" = EXCLUDED."serpOpenedAt",
        "serpDetails" = EXCLUDED."serpDetails",
        "actionsTaken" = EXCLUDED."actionsTaken",
        "updatedAt" = NOW()
    `;
  }

  const atualizados = rowsToUpsert.length;
  const conselhoTutelarCount = rowsToUpsert.filter(
    (r) => r.statusEnum === "CONSELHO_TUTELAR"
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
