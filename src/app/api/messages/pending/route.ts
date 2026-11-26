import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSyncCorsHeaders } from "@/lib/cors";
import {
  getAuthorizedCurrentSchool,
  getSchoolContextByVerifiedId,
  type SchoolContext,
} from "@/lib/currentSchool";
import { resolveServerUserAuthSnapshot } from "@/lib/serverAuthContext";
import { authenticateExtensionSyncToken } from "@/lib/extensionSyncAuth";
import { claimPendingQueuedMessages } from "@/services/messageDispatchService";

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 200,
    headers: getSyncCorsHeaders(req),
  });
}

export async function GET(req: Request) {
  const corsHeaders = getSyncCorsHeaders(req);

  try {
    const session = await auth();
    let currentSchool: SchoolContext | null = null;

    if (session?.user?.email) {
      if (session.user.active === false) {
        return NextResponse.json(
          { error: "Conta desativada. Contate a administração da escola." },
          { status: 403, headers: corsHeaders }
        );
      }
      const snapshot = await resolveServerUserAuthSnapshot(session);
      if (!snapshot || snapshot.active === false) {
        return NextResponse.json(
          { error: "Conta desativada ou acesso revogado no servidor." },
          { status: 403, headers: corsHeaders }
        );
      }
      currentSchool = await getAuthorizedCurrentSchool(session, snapshot.schoolId, snapshot, {
        allowSuperAdminReadOnlyFallback: false,
      });
      if (!currentSchool) {
        return NextResponse.json(
          { error: "Nenhuma instituição escolar autorizada vinculada à sessão atual." },
          { status: 403, headers: corsHeaders }
        );
      }
    } else {
      const tokenAuth = await authenticateExtensionSyncToken({
        req,
        corsHeaders,
        label: "Fila Companion WhatsApp",
      });
      if (!tokenAuth.ok) {
        return tokenAuth.response;
      }
      currentSchool = await getSchoolContextByVerifiedId(tokenAuth.targetSchoolId);
      if (!currentSchool) {
        return NextResponse.json(
          { error: "Instituição escolar não encontrada ou inativa para o token informado." },
          { status: 403, headers: corsHeaders }
        );
      }
    }

    const { searchParams } = new URL(req.url);
    const rawLimit = Number(searchParams.get("limit") || "10");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 50)) : 10;

    const messages = await claimPendingQueuedMessages({
      schoolId: currentSchool.id,
      limit,
    });

    return NextResponse.json(
      {
        success: true,
        schoolId: currentSchool.id,
        count: messages.length,
        messages,
      },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    console.error("[messages/pending] Erro ao reclamar fila de mensagens:", error);
    return NextResponse.json(
      { error: "Erro interno ao consultar fila de mensagens pendentes." },
      { status: 500, headers: corsHeaders }
    );
  }
}
