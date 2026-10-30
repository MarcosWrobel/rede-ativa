import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getSyncCorsHeaders } from "@/lib/cors";

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

    const body = await req.json();
    const { alunos } = body;

    if (!Array.isArray(alunos) || alunos.length === 0) {
      return NextResponse.json(
        { error: "Nenhum aluno fornecido para sincronização." },
        { status: 400, headers: corsHeaders }
      );
    }

    // 2. Carrega todos os estudantes para mapas em memória
    const allStudents = await prisma.student.findMany({
      select: {
        id: true,
        cgm: true,
        name: true,
      },
    });

    const cgmMap = new Map<string, string>();
    const nameMap = new Map<string, { id: string; hasCgm: boolean }>();

    allStudents.forEach((s) => {
      if (s.cgm) {
        cgmMap.set(s.cgm.trim(), s.id);
      }
      const norm = s.name
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      nameMap.set(norm, { id: s.id, hasCgm: !!s.cgm });
    });

    let atualizados = 0;
    let cgmVinculados = 0;
    let emRiscoCount = 0;
    const naoEncontrados: Array<{ nome: string; cgm?: string; turma?: string }> = [];

    // 3. Processamento dos estudantes
    for (const item of alunos) {
      const cgmClean = (item.cgm || "").trim();
      const rawName = (item.nome || "")
        .toUpperCase()
        .replace(/\s*-\s*\d+.*$/, "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      let studentId: string | undefined = cgmClean ? cgmMap.get(cgmClean) : undefined;

      if (!studentId && rawName) {
        const studentByName = nameMap.get(rawName);
        if (studentByName) {
          studentId = studentByName.id;

          if (!studentByName.hasCgm && cgmClean) {
            try {
              await prisma.student.update({
                where: { id: studentId },
                data: { cgm: cgmClean },
              });
              cgmMap.set(cgmClean, studentId);
              studentByName.hasCgm = true;
              cgmVinculados++;
            } catch (err) {
              console.warn(`[SYNC] Aviso ao vincular CGM ${cgmClean} ao aluno ${studentId}:`, err);
            }
          }
        }
      }

      if (studentId) {
        const pctStr = (item.mediaGeral || "").replace("%", "").replace(",", ".").trim();
        const percent = parseFloat(pctStr);

        if (!isNaN(percent)) {
          if (percent < 75) {
            emRiscoCount++;
          }

          const detail = [
            cgmClean ? `CGM: ${cgmClean}` : null,
            item.semanaAtual ? `Semana Atual: ${item.semanaAtual}` : null,
            item.semanaAnterior ? `Semana Anterior: ${item.semanaAnterior}` : null,
          ]
            .filter(Boolean)
            .join(" | ");

          await prisma.lowAttendanceRecord.upsert({
            where: { studentId },
            update: {
              attendancePercent: percent,
              enrollmentDetail: detail,
            },
            create: {
              studentId,
              attendancePercent: percent,
              enrollmentDetail: detail,
              actionsTaken: "Importado do Power BI (PRESENTE NA ESCOLA)",
            },
          });

          atualizados++;
        }
      } else {
        naoEncontrados.push({
          nome: item.nome,
          cgm: item.cgm,
          turma: item.turma,
        });
      }
    }

    // 4. Registrar na Trilha de Auditoria com IP
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
