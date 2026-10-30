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
    let userName = "Extensão SERP (API)";
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

    const body = await req.json();
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

    // 2. Carrega estudantes do banco em 1 query leve
    const allStudents = await prisma.student.findMany({
      select: {
        id: true,
        cgm: true,
        name: true,
      },
    });

    const { cgmMap, nameMap, usedCgms } = buildStudentLookupMaps(allStudents);

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

    // 4. Atualiza CGMs novos em transação única
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
      { error: error.message || "Erro interno do servidor." },
      { status: 500, headers: corsHeaders }
    );
  }
}
