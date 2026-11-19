import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSyncCorsHeaders } from "@/lib/cors";
import { classCouncilBiSyncSchema, formatZodError } from "@/lib/schemas";
import { canMutateSchoolCouncil } from "@/services/classCouncilService";
import { executeClassCouncilBiSync } from "@/services/classCouncilBiSyncService";
import { resolveExtensionOrSessionSyncContext } from "@/services/frequencySyncService";

export const maxDuration = 60;

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 200,
    headers: getSyncCorsHeaders(req),
  });
}

export async function POST(req: Request) {
  const corsHeaders = getSyncCorsHeaders(req);

  try {
    const syncAuth = await resolveExtensionOrSessionSyncContext({
      req,
      corsHeaders,
      label: "Extensão Power BI",
      defaultApiUserName: "Extensão Power BI (API)",
      forbiddenEssencialError:
        "A sincronização via extensão de raspagem do Power BI não está autorizada para esta instituição escolar (Edição Institucional Essencial).",
    });

    if (!syncAuth.ok) {
      return syncAuth.response;
    }

    if (syncAuth.authMethod === "SESSION") {
      const session = await auth();
      if (!canMutateSchoolCouncil(session, syncAuth.currentSchool.id)) {
        return NextResponse.json(
          { error: "Sem permissão operacional para atualizar o conselho de classe desta instituição." },
          { status: 403, headers: corsHeaders }
        );
      }
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

    const parsedBody = classCouncilBiSyncSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: formatZodError(parsedBody.error) },
        { status: 400, headers: corsHeaders }
      );
    }

    const result = await executeClassCouncilBiSync({
      payload: parsedBody.data,
      currentSchool: syncAuth.currentSchool,
      authMethod: syncAuth.authMethod,
      userId: syncAuth.userId,
      userName: syncAuth.userName,
      userEmail: syncAuth.userEmail,
      req,
    });

    return NextResponse.json(result, { headers: corsHeaders });
  } catch (error) {
    console.error("Erro na sincronização do BI para o conselho de classe:", error);
    return NextResponse.json(
      { error: "Erro interno durante a sincronização do conselho de classe." },
      { status: 500, headers: corsHeaders }
    );
  }
}
