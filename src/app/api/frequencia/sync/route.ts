import crypto from "crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getSyncCorsHeaders } from "@/lib/cors";
import { frequenciaSyncSchema, formatZodError } from "@/lib/schemas";
import {
  buildStudentLookupMaps,
  normalizeStudentName,
  parseAttendancePercent,
} from "@/lib/studentMatcher";
import { getIsoWeekKey } from "@/lib/pedagogicalClassifier";
import { getCurrentSchool } from "@/lib/currentSchool";
import { findSchoolBySyncToken, safeCompareStrings } from "@/lib/syncToken";
import { applyPendingCgmUpdatesSafely, populateGlobalTakenCgms } from "@/lib/syncCgmGuard";
import { checkRateLimit, resetRateLimit, getPublicIpRateLimitKey, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";

export const maxDuration = 60;

function verifySyncToken(provided: string, expected: string): boolean {
  return safeCompareStrings(provided, expected);
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 200,
    headers: getSyncCorsHeaders(req),
  });
}

export async function POST(req: Request) {
  const corsHeaders = getSyncCorsHeaders(req);

  try {
    // 1. Verificação de Segurança (Sessão Web ativa ou Token de API configurado)
    const session = await auth();
    let authMethod: "SESSION" | "TOKEN" = "TOKEN";
    let userName = "Extensão Power BI (API)";
    let userEmail = process.env.SYSTEM_SYNC_EMAIL || "sistema@redeativa.com.br";
    let userId: string | undefined = undefined;
    let targetSchoolId: string | undefined = undefined;

    if (session?.user?.email && (session.user as any).active !== false) {
      authMethod = "SESSION";
      userEmail = session.user.email;
      userName = session.user.name || session.user.email.split("@")[0];
      userId = (session.user as any).id;
      targetSchoolId = (session.user as any).schoolId;
    } else {
      const configuredToken = (process.env.SYNC_API_TOKEN || "").trim();
      const authHeader = req.headers.get("authorization") || "";
      const customTokenHeader = req.headers.get("x-sync-token") || "";
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      const providedToken = bearerToken || customTokenHeader.trim();

      // Trava Anti-Brute-Force contra adivinhação de Token da Extensão (SEC-08)
      const syncLockKey = getPublicIpRateLimitKey("sync-fail", req);
      const syncRateCheck = await checkRateLimit(syncLockKey, RATE_LIMIT_POLICIES.EXTENSION_SYNC_AUTH);
      if (!syncRateCheck.success) {
        return NextResponse.json(
          {
            error: `Muitas tentativas com token inválido. Acesso bloqueado por ${syncRateCheck.retryAfterSeconds} segundos.`,
            retryAfter: syncRateCheck.retryAfterSeconds,
          },
          { status: 429, headers: corsHeaders }
        );
      }

      if (!providedToken) {
        return NextResponse.json(
          {
            error:
              "Não autorizado. Forneça o token de sincronização da instituição no cabeçalho Authorization: Bearer <TOKEN>.",
          },
          { status: 401, headers: corsHeaders }
        );
      }

      // 1.1 Procura se é a chave de sincronização de uma escola específica (SHA-256 ou fallback legado)
      const schoolByToken = await findSchoolBySyncToken(prisma, providedToken);

      if (schoolByToken) {
        targetSchoolId = schoolByToken.id;
        userName = `Extensão Power BI (${schoolByToken.name})`;
        await resetRateLimit(syncLockKey);
      } else if (configuredToken && verifySyncToken(providedToken, configuredToken)) {
        // 1.2 Token global: vincula à escola especificada em header/query ou escola sede padrão
        const { searchParams } = new URL(req.url);
        const reqSchoolId = searchParams.get("schoolId") || req.headers.get("x-school-id");
        const resolved = await getCurrentSchool(reqSchoolId);
        targetSchoolId = resolved.id;
        await resetRateLimit(syncLockKey);
      } else {
        return NextResponse.json(
          {
            error:
              "Chave de sincronização inválida. Copie a chave atualizada no painel da sua escola e cole na Extensão.",
          },
          { status: 401, headers: corsHeaders }
        );
      }
    }

    const currentSchool = await getCurrentSchool(targetSchoolId);

    // Trava de Edição: Escolas na versão Institucional Essencial não utilizam raspagem de dados
    if (currentSchool.edition === "INSTITUCIONAL_ESSENCIAL") {
      return NextResponse.json(
        {
          error:
            "A sincronização via extensão de raspagem de Power BI não está autorizada para esta instituição escolar (Edição Institucional Essencial). Utilize a importação de frequência por arquivo ou consulte a administração.",
        },
        { status: 403, headers: corsHeaders }
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Payload JSON inválido." },
        { status: 400, headers: corsHeaders }
      );
    }

    const parsedBody = frequenciaSyncSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: formatZodError(parsedBody.error) },
        { status: 400, headers: corsHeaders }
      );
    }

    const { alunos } = parsedBody.data;

    // 2. Carrega estudantes da escola ativa em 1 query leve
    const allStudents = await prisma.student.findMany({
      where: currentSchool.id ? { schoolId: currentSchool.id, active: true } : { active: true },
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

    // Previne colisão P2002 na restrição @unique global de CGM com alunos inativos ou de outras escolas
    await populateGlobalTakenCgms(
      prisma,
      alunos.map((a) => String(a.cgm ?? "").replace(/\u0000/g, "").trim()),
      usedCgms
    );

    const pendingCgmUpdates = new Map<string, string>(); // studentId -> cgm
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

    // Helper para parsear data brasileira DD/MM/AAAA
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

    // Helper para parsear flag booleana (1, true, "1", "sim", "✓")
    function parseBooleanFlag(val?: boolean | number | string | null): boolean {
      if (val === true || val === 1 || val === "1") return true;
      if (typeof val === "string") {
        const lower = val.toLowerCase().trim();
        return lower === "true" || lower === "sim" || lower === "1" || lower === "✓";
      }
      return false;
    }

    // Helper para parsear idade (inteiro positivo entre 5 e 99)
    function parseAge(val?: number | string | null): number | null {
      if (val === undefined || val === null || val === "") return null;
      const num = typeof val === "number" ? Math.round(val) : parseInt(String(val).replace(/\D/g, ""), 10);
      return !isNaN(num) && num >= 5 && num <= 99 ? num : null;
    }

    // 3. Pareamento em memória (O(N)) e preparação dos lotes deduplicados
    for (const item of alunos) {
      const cgmClean = String(item.cgm ?? "").replace(/\u0000/g, "").trim();
      const rawName = normalizeStudentName(item.nome);

      let studentId: string | undefined = cgmClean ? cgmMap.get(cgmClean) : undefined;

      if (!studentId && rawName) {
        const studentByName = nameMap.get(rawName);
        if (studentByName) {
          if (studentByName.isHomonym) {
            // Proteção contra sobrescrita e contaminação cadastral de homônimos na mesma instituição (Q-01)
            // Se o aluno for homônimo, o pareamento exige CGM explícito no lote para desambiguação
            console.warn(`[frequencia/sync] Pareamento por nome ignorado para homônimo sem CGM correspondente: ${rawName}`);
          } else {
            studentId = studentByName.id;

            if (!studentByName.hasCgm && cgmClean && !usedCgms.has(cgmClean)) {
              pendingCgmUpdates.set(studentId, cgmClean);
              usedCgms.add(cgmClean);
              cgmMap.set(cgmClean, studentId);
              studentByName.hasCgm = true;
            }
          }
        }
      }

      if (studentId) {
        const studentRecord = studentByIdMap.get(studentId);

        // Enriquecimento cadastral (apenas quando houver alteração efetiva em relação ao banco)
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

        // Verifica se o estudante é Ganhando Mundo (no payload ou no banco)
        const isGanhandoMundo = isExchangeStudent || Boolean(studentRecord?.isExchangeStudent);

        // Amparo Legal Vigência Máx (Automação de Atestado / Dispensa Legal)
        // REGRA DE NEGÓCIO: Se o estudante for de intercâmbio (Ganhando Mundo), a vigência na coluna do BI
        // refere-se ao período de intercâmbio internacional e NÃO deve ser inserida como atestado médico/pedagógico.
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

    // 4. Atualiza CGMs novos com blindagem contra P2002
    const cgmVinculados = await applyPendingCgmUpdatesSafely(prisma, pendingCgmUpdates);

    // 5. Bulk Upsert via SQL parametrizado em blocos de 250 linhas (~150ms para toda a escola)
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

      // 5b. Preserva série histórica semanal (AttendanceSnapshot) por estudante/semana ISO
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

    // 5c. Atualiza atributos adicionais alterados em lote via SQL parametrizado (elimina 600+ roundtrips)
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

    // 5d. Automação de Amparo Legal Vigente (Criação/Prorrogação de Atestados / Dispensa Legal)
    let amparosCriados = 0;
    let amparosAtualizados = 0;

    // Limpeza de segurança: Remove qualquer atestado/dispensa legal criada indevidamente para alunos do Ganhando Mundo
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
        console.warn("[frequencia/sync] Aviso ao limpar atestados automáticos de alunos Ganhando Mundo:", err?.message);
      }
    }

    if (pendingAmparos.size > 0) {
      const studentIdsWithAmparo = Array.from(pendingAmparos.keys());
      const existingJusts = await prisma.absenceJustification.findMany({
        where: {
          studentId: { in: studentIdsWithAmparo },
          type: "DISPENSA_LEGAL",
          notes: { contains: "Power BI" }, // Preserva dispensas manuais lançadas pela equipe da escola (Q-03)
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
          // Se a data de término for diferente (ex: foi prorrogada no Power BI)
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

    // 6. Registrar na Trilha de Auditoria com IP
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

    return NextResponse.json(
      {
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
      },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    console.error("Erro na sincronização de frequência:", error);
    return NextResponse.json(
      { error: "Erro interno durante a sincronização de frequência." },
      { status: 500, headers: corsHeaders }
    );
  }
}
