import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-sync-token",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

export async function POST(req: Request) {
  try {
    // 1. Verificação de Segurança (Sessão Web ou Token de API)
    const session = await auth();
    let authMethod: "SESSION" | "TOKEN" = "TOKEN";
    let userName = "Extensão Power BI (API)";
    let userEmail = "sistema@leopoldina.pr.gov.br";
    let userId: string | undefined = undefined;

    if (session?.user?.email) {
      authMethod = "SESSION";
      userEmail = session.user.email;
      userName = session.user.name || session.user.email.split("@")[0];
      userId = (session.user as any).id;
    } else {
      // Validação de Token de API
      const authHeader = req.headers.get("authorization") || "";
      const customTokenHeader = req.headers.get("x-sync-token") || "";
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      const providedToken = bearerToken || customTokenHeader;

      const configuredToken = process.env.SYNC_API_TOKEN || "leopoldina-frequencia-2026-secret-sync";

      if (!providedToken || providedToken !== configuredToken) {
        return NextResponse.json(
          {
            error: "Não autorizado. Forneça o token de sincronização correto (Bearer Token ou header x-sync-token).",
          },
          {
            status: 401,
            headers: corsHeaders,
          }
        );
      }
    }

    const body = await req.json();
    const { alunos } = body;

    if (!Array.isArray(alunos) || alunos.length === 0) {
      return NextResponse.json(
        { error: "Nenhum aluno fornecido para sincronização." },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // 2. Carrega todos os estudantes para mapas de alta performance
    const allStudents = await prisma.student.findMany({
      select: {
        id: true,
        cgm: true,
        name: true,
      },
    });

    const cgmMap = new Map<string, string>(); // cgm -> studentId
    const nameMap = new Map<string, { id: string; hasCgm: boolean }>(); // normalizedName -> info

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
    let emRiscoCount = 0; // < 75%
    const naoEncontrados: Array<{ nome: string; cgm?: string; turma?: string }> = [];

    // 3. Processamento em lote
    for (const item of alunos) {
      const cgmClean = (item.cgm || "").trim();
      let rawName = (item.nome || "")
        .toUpperCase()
        .replace(/\s*-\s*\d+.*$/, "") // remove sufixo de CGM se presente
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      // Estratégia de busca: 1) por CGM; 2) por Nome Normalizado
      let studentId: string | undefined = cgmClean ? cgmMap.get(cgmClean) : undefined;
      let matchedByName = false;

      if (!studentId && rawName) {
        const studentByName = nameMap.get(rawName);
        if (studentByName) {
          studentId = studentByName.id;
          matchedByName = true;

          // Se o aluno ainda não tinha CGM salvo e temos o CGM do Power BI, salva no aluno!
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
        // Converte percentual "75,40%" -> 75.40
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

    // 4. Registrar na Trilha de Auditoria
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
    });

    return NextResponse.json(
      {
        sucesso: true,
        totalRecebido: alunos.length,
        atualizados,
        cgmVinculados,
        emRiscoCount,
        naoEncontradosTotal: naoEncontrados.length,
        naoEncontrados: naoEncontrados.slice(0, 15), // Amostra dos 15 primeiros para feedback rápido
      },
      {
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error("Erro na sincronização de frequência:", error);
    return NextResponse.json(
      { error: error.message || "Erro interno do servidor." },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}
