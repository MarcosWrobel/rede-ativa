import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSyncCorsHeaders } from "@/lib/cors";
import { getCurrentSchool } from "@/lib/currentSchool";
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
    let targetSchoolId: string | undefined;

    if (session?.user?.email && session.user.active !== false) {
      targetSchoolId = session.user.schoolId ?? undefined;
    } else {
      const tokenAuth = await authenticateExtensionSyncToken({
        req,
        corsHeaders,
        label: "Fila Companion WhatsApp",
      });
      if (!tokenAuth.ok) {
        return tokenAuth.response;
      }
      targetSchoolId = tokenAuth.targetSchoolId;
    }

    const currentSchool = await getCurrentSchool(targetSchoolId);
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
