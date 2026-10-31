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

export const maxDuration = 60;

function verifySyncToken(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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
    let userEmail = "sistema@leopoldina.pr.gov.br";
    let userId: string | undefined = undefined;

    if (session?.user?.email && (session.user as any).active !== false) {
      authMethod = "SESSION";
      userEmail = session.user.email;
      userName = session.user.name || session.user.email.split("@")[0];
      userId = (session.user as any).id;
    } else {
      const configuredToken = (process.env.SYNC_API_TOKEN || "").trim();
      if (!configuredToken) {
        return NextResponse.json(
          {
            error:
              "Variável SYNC_API_TOKEN não configurada no servidor. Configure-a no ambiente (.env / Vercel) para habilitar sincronização externa.",
          },
          { status: 503, headers: corsHeaders }
        );
      }

      const authHeader = req.headers.get("authorization") || "";
      const customTokenHeader = req.headers.get("x-sync-token") || "";
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      const providedToken = bearerToken || customTokenHeader.trim();

      if (!providedToken || !verifySyncToken(providedToken, configuredToken)) {
        return NextResponse.json(
          {
            error:
              "Não autorizado. Copie a Chave de Sincronização atualizada no painel Busca-ativa (/faltas) e cole na Extensão Chrome.",
          },
          { status: 401, headers: corsHeaders }
        );
      }
    }

    const rawBody = await req.json();
    const parsedBody = frequenciaSyncSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: formatZodError(parsedBody.error) },
        { status: 400, headers: corsHeaders }
      );
    }

    const { alunos } = parsedBody.data;

    // 2. Carrega todos os estudantes em 1 query leve
    const allStudents = await prisma.student.findMany({
      select: {
        id: true,
        cgm: true,
        name: true,
      },
    });

    const { cgmMap, nameMap, usedCgms } = buildStudentLookupMaps(allStudents);

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
      const [, d, m, y] = match;
      const date = new Date(Number(y), Number(m) - 1, Number(d), 23, 59, 59);
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

    // Helper para parsear idade (inteiro positivo entre 10 e 99)
    function parseAge(val?: number | string | null): number | null {
      if (val === undefined || val === null || val === "") return null;
      const num = typeof val === "number" ? Math.round(val) : parseInt(String(val).replace(/\D/g, ""), 10);
      return !isNaN(num) && num >= 5 && num <= 99 ? num : null;
    }

    // 3. Pareamento em memória (O(N)) e preparação dos lotes deduplicados
    for (const item of alunos) {
      const cgmClean = String(item.cgm ?? "").trim();
      const rawName = normalizeStudentName(item.nome);

      let studentId: string | undefined = cgmClean ? cgmMap.get(cgmClean) : undefined;

      if (!studentId && rawName) {
        const studentByName = nameMap.get(rawName);
        if (studentByName) {
          studentId = studentByName.id;

          if (!studentByName.hasCgm && cgmClean && !usedCgms.has(cgmClean)) {
            pendingCgmUpdates.set(studentId, cgmClean);
            usedCgms.add(cgmClean);
            cgmMap.set(cgmClean, studentId);
            studentByName.hasCgm = true;
          }
        }
      }

      if (studentId) {
        // Enriquecimento cadastral: Ganhando Mundo, Deficiência e Idade
        const isExchangeStudent = parseBooleanFlag(item.ganhandoMundo);
        const isSpecialNeeds = parseBooleanFlag(item.deficienciaAltasHabilidades);
        const age = parseAge(item.idade);

        if (isExchangeStudent || isSpecialNeeds || age !== null) {
          const current = pendingStudentUpdates.get(studentId) || {};
          if (isExchangeStudent) current.isExchangeStudent = true;
          if (isSpecialNeeds) current.isSpecialNeeds = true;
          if (age !== null) current.age = age;
          pendingStudentUpdates.set(studentId, current);
        }

        // Amparo Legal Vigência Máx (Automação de Atestado / Dispensa Legal)
        const amparoDate = parseBrDate(item.amparoLegalVigencia);
        if (amparoDate) {
          pendingAmparos.set(studentId, {
            vigenciaStr: item.amparoLegalVigencia!.trim(),
            date: amparoDate,
          });
        }

        const percent = parseAttendancePercent(item.mediaGeral);
        if (percent !== null) {
          const semAtual = item.semanaAtual !== undefined && item.semanaAtual !== null ? String(item.semanaAtual).trim() : "";
          const semAnt = item.semanaAnterior !== undefined && item.semanaAnterior !== null ? String(item.semanaAnterior).trim() : "";
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

    // 4. Atualiza CGMs novos em transação única (quando aplicável)
    let cgmVinculados = 0;
    if (pendingCgmUpdates.size > 0) {
      const updates = Array.from(pendingCgmUpdates.entries());
      const CHUNK = 100;
      for (let i = 0; i < updates.length; i += CHUNK) {
        const slice = updates.slice(i, i + CHUNK);
        await prisma.$transaction(
          slice.map(([id, cgm]) =>
            prisma.student.update({
              where: { id },
              data: { cgm },
            })
          )
        );
        cgmVinculados += slice.length;
      }
    }

    // 5. Bulk Upsert via SQL parametrizado em blocos de 250 linhas (~150ms para toda a escola)
    const rowsToUpsert = Array.from(batchRecords.values());
    const BATCH_SIZE = 250;
    const defaultAction = "Importado do Power BI (PRESENTE NA ESCOLA)";
    const referenceWeek = getIsoWeekKey(new Date());

    for (let i = 0; i < rowsToUpsert.length; i += BATCH_SIZE) {
      const chunk = rowsToUpsert.slice(i, i + BATCH_SIZE);
      const values = chunk.map(
        (r) =>
          Prisma.sql`(${r.id}, ${r.studentId}, ${r.percent}, ${r.detail}, ${defaultAction}, NOW())`
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
            Prisma.sql`(${r.snapshotId}, ${r.studentId}, ${referenceWeek}, ${r.percent}, ${r.weeklyPercent}, ${r.previousWeeklyPercent}, NOW())`
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

    // 5c. Atualiza atributos adicionais do estudante (Ganhando Mundo, PCD / Altas Habilidades, Idade)
    let estudantesEnriquecidos = 0;
    if (pendingStudentUpdates.size > 0) {
      const studentUpdateEntries = Array.from(pendingStudentUpdates.entries());
      const CHUNK = 100;
      for (let i = 0; i < studentUpdateEntries.length; i += CHUNK) {
        const slice = studentUpdateEntries.slice(i, i + CHUNK);
        await prisma.$transaction(
          slice.map(([id, data]) =>
            prisma.student.update({
              where: { id },
              data,
            })
          )
        );
      }
      estudantesEnriquecidos = studentUpdateEntries.length;
    }

    // 5d. Automação de Amparo Legal Vigente (Criação/Prorrogação de Atestados / Dispensa Legal)
    let amparosCriados = 0;
    let amparosAtualizados = 0;
    if (pendingAmparos.size > 0) {
      const studentIdsWithAmparo = Array.from(pendingAmparos.keys());
      const existingJusts = await prisma.absenceJustification.findMany({
        where: {
          studentId: { in: studentIdsWithAmparo },
          type: "DISPENSA_LEGAL",
        },
        select: {
          id: true,
          studentId: true,
          endDate: true,
        },
      });

      const existingMap = new Map<string, { id: string; endDate: Date }>();
      existingJusts.forEach((j) => existingMap.set(j.studentId, j));

      for (const [studentId, amparo] of pendingAmparos.entries()) {
        const existing = existingMap.get(studentId);
        if (!existing) {
          await prisma.absenceJustification.create({
            data: {
              studentId,
              type: "DISPENSA_LEGAL",
              startDate: new Date(),
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
      { error: error.message || "Erro interno do servidor." },
      { status: 500, headers: corsHeaders }
    );
  }
}
