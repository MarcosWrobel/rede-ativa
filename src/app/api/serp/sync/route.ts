import crypto from "crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getSyncCorsHeaders } from "@/lib/cors";
import { serpSyncItemSchema, formatZodError } from "@/lib/schemas";
import {
  buildStudentLookupMaps,
  normalizeSerpStatus,
  normalizeStudentName,
} from "@/lib/studentMatcher";
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
    let userName = "Extensão SERP (API)";
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
        userName = `Extensão SERP (${schoolByToken.name})`;
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
            "A sincronização via extensão de raspagem do SERP não está autorizada para esta instituição escolar (Edição Institucional Essencial). Utilize o registro pedagógico padrão ou consulte a administração.",
        },
        { status: 403, headers: corsHeaders }
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Payload JSON inválido." },
        { status: 400, headers: corsHeaders }
      );
    }

    const rawList = body?.fichas || body?.alunos || [];
    const parsedList = z
      .array(serpSyncItemSchema)
      .min(1, "Nenhuma ficha do SERP fornecida para sincronização.")
      .safeParse(rawList);

    if (!parsedList.success) {
      return NextResponse.json(
        { error: formatZodError(parsedList.error) },
        { status: 400, headers: corsHeaders }
      );
    }

    const fichas = parsedList.data;

    // 2. Carrega estudantes da escola ativa em 1 query leve
    const allStudents = await prisma.student.findMany({
      where: currentSchool.id ? { schoolId: currentSchool.id, active: true } : { active: true },
      select: {
        id: true,
        cgm: true,
        name: true,
      },
    });

    const { cgmMap, nameMap, usedCgms } = buildStudentLookupMaps(allStudents);

    // Previne colisão P2002 na restrição @unique global de CGM com alunos inativos ou de outras escolas
    await populateGlobalTakenCgms(
      prisma,
      fichas.map((f) => String(f.cgm ?? "").replace(/\u0000/g, "").trim()),
      usedCgms
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

    // 3. Pareamento em memória e deduplicação por studentId
    for (const item of fichas) {
      const cgmClean = String(item.cgm ?? "").trim();
      const rawName = normalizeStudentName(item.nome);

      let studentId: string | undefined = cgmClean ? cgmMap.get(cgmClean) : undefined;

      if (!studentId && rawName) {
        const studentByName = nameMap.get(rawName);
        if (studentByName) {
          if (studentByName.isHomonym) {
            // Proteção contra contaminação cadastral e sobrescrita de homônimos na mesma instituição (Q-01)
            // Se o aluno for homônimo, o pareamento exige CGM explícito no lote para desambiguação
            console.warn(`[serp/sync] Pareamento por nome ignorado para homônimo sem CGM correspondente: ${rawName}`);
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
        const statusEnum = normalizeSerpStatus(item.status || item.situacao);

        let dataAbertura: Date | null = null;
        if (item.dataAbertura) {
          const parsed = new Date(item.dataAbertura);
          if (!isNaN(parsed.getTime())) dataAbertura = parsed;
        }

        const rawProt = item.numeroFicha ?? item.protocolo;
        const protocoloStr = rawProt !== undefined && rawProt !== null && String(rawProt).trim()
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

    // 4. Atualiza CGMs novos com blindagem contra P2002
    const cgmVinculados = await applyPendingCgmUpdatesSafely(prisma, pendingCgmUpdates);

    // 5. Bulk Upsert via SQL parametrizado em blocos de 250 linhas
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

    // 6. Registro na Trilha de Auditoria com IP
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

    return NextResponse.json(
      {
        sucesso: true,
        totalRecebido: fichas.length,
        atualizados,
        cgmVinculados,
        conselhoTutelarCount,
        naoEncontradosTotal: naoEncontrados.length,
        naoEncontrados: naoEncontrados.slice(0, 15),
      },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    console.error("Erro na sincronização do SERP:", error);
    return NextResponse.json(
      { error: "Erro interno durante a sincronização do SERP." },
      { status: 500, headers: corsHeaders }
    );
  }
}
