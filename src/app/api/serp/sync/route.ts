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
    let userName = "Extensão SERP (API)";
    let userEmail = "sistema@leopoldina.pr.gov.br";
    let userId: string | undefined = undefined;

    if (session?.user?.email) {
      authMethod = "SESSION";
      userEmail = session.user.email;
      userName = session.user.name || session.user.email.split("@")[0];
      userId = (session.user as any).id;
    } else {
      const authHeader = req.headers.get("authorization") || "";
      const customTokenHeader = req.headers.get("x-sync-token") || "";
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      const providedToken = bearerToken || customTokenHeader;

      const configuredToken = process.env.SYNC_API_TOKEN || "leopoldina-frequencia-2026-secret-sync";

      if (!providedToken || providedToken !== configuredToken) {
        return NextResponse.json(
          { error: "Não autorizado. Forneça o token de sincronização correto." },
          { status: 401, headers: corsHeaders }
        );
      }
    }

    const body = await req.json();
    const fichas = body.fichas || body.alunos || [];

    if (!Array.isArray(fichas) || fichas.length === 0) {
      return NextResponse.json(
        { error: "Nenhuma ficha do SERP fornecida para sincronização." },
        { status: 400, headers: corsHeaders }
      );
    }

    // 2. Carrega estudantes do banco para indexação rápida
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
    let conselhoTutelarCount = 0;
    const naoEncontrados: Array<{ nome: string; cgm?: string; protocolo?: string }> = [];

    // Helper para normalizar status SERP
    const normalizarStatus = (raw?: string): string => {
      const s = (raw || "").toUpperCase();
      if (s.includes("CONSELHO") || s.includes("CT")) return "CONSELHO_TUTELAR";
      if (s.includes("MINIST") || s.includes("PROMOTOR") || s.includes("MP")) return "MINISTERIO_PUBLICO";
      if (s.includes("ARQUIV") || s.includes("NORMALIZ")) return "ARQUIVADO";
      return "EM_ACOMPANHAMENTO";
    };

    // 3. Processamento das Fichas
    for (const item of fichas) {
      const cgmClean = (item.cgm || "").toString().trim();
      const rawName = (item.nome || "")
        .toUpperCase()
        .replace(/\s*-\s*\d+.*$/, "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      // Busca por CGM ou Nome
      let studentId: string | undefined = cgmClean ? cgmMap.get(cgmClean) : undefined;

      if (!studentId && rawName) {
        const studentByName = nameMap.get(rawName);
        if (studentByName) {
          studentId = studentByName.id;

          // Se o aluno não tinha CGM e o SERP trouxe, salva no aluno
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
              console.warn(`[SERP-SYNC] Erro ao gravar CGM ${cgmClean}:`, err);
            }
          }
        }
      }

      if (studentId) {
        const statusEnum = normalizarStatus(item.status || item.situacao);
        if (statusEnum === "CONSELHO_TUTELAR") conselhoTutelarCount++;

        let dataAbertura: Date | null = null;
        if (item.dataAbertura) {
          const parsed = new Date(item.dataAbertura);
          if (!isNaN(parsed.getTime())) dataAbertura = parsed;
        }

        const protocoloStr = item.numeroFicha || item.protocolo || null;
        const acoesDesc = item.acoesRealizadas || item.motivo || item.observacoes || "";
        const actionSummary = [
          protocoloStr ? `Ficha SERP #${protocoloStr}` : "Ficha SERP Ativa",
          statusEnum === "CONSELHO_TUTELAR" ? "ENCAMINHADO CONSELHO TUTELAR" : (statusEnum === "MINISTERIO_PUBLICO" ? "MINISTÉRIO PÚBLICO" : "EM ACOMPANHAMENTO"),
          acoesDesc ? `(${acoesDesc})` : null,
        ].filter(Boolean).join(" - ");

        const detailsStr = typeof item.detalhes === "object" ? JSON.stringify(item.detalhes) : (item.detalhes || acoesDesc || null);

        await prisma.lowAttendanceRecord.upsert({
          where: { studentId },
          update: {
            serpProtocol: protocoloStr,
            serpStatus: statusEnum,
            serpOpenedAt: dataAbertura,
            serpDetails: detailsStr,
            actionsTaken: actionSummary,
          },
          create: {
            studentId,
            attendancePercent: 70.0, // Frequência estimada/padrão de gatilho SERP até ser sincronizado com o Power BI
            enrollmentDetail: "Importado do SERP (Rede de Proteção)",
            serpProtocol: protocoloStr,
            serpStatus: statusEnum,
            serpOpenedAt: dataAbertura,
            serpDetails: detailsStr,
            actionsTaken: actionSummary,
          },
        });

        atualizados++;
      } else {
        naoEncontrados.push({
          nome: item.nome,
          cgm: item.cgm,
          protocolo: item.numeroFicha || item.protocolo,
        });
      }
    }

    // 4. Registro na Trilha de Auditoria
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
