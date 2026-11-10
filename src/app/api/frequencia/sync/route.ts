import { NextResponse } from "next/server";
import { getSyncCorsHeaders } from "@/lib/cors";
import { frequenciaSyncSchema, formatZodError } from "@/lib/schemas";
import {
  executePowerBiFrequencySync,
  resolveExtensionOrSessionSyncContext,
} from "@/services/frequencySyncService";

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
        "A sincronização via extensão de raspagem de Power BI não está autorizada para esta instituição escolar (Edição Institucional Essencial). Utilize a importação de frequência por arquivo ou consulte a administração.",
    });

    if (!syncAuth.ok) {
      return syncAuth.response;
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

    const result = await executePowerBiFrequencySync({
      alunos: parsedBody.data.alunos,
      currentSchool: syncAuth.currentSchool,
      authMethod: syncAuth.authMethod,
      userId: syncAuth.userId,
      userName: syncAuth.userName,
      userEmail: syncAuth.userEmail,
      req,
    });

    return NextResponse.json(result, { headers: corsHeaders });
  } catch (error: any) {
    console.error("Erro na sincronização de frequência:", error);
    return NextResponse.json(
      { error: "Erro interno durante a sincronização de frequência." },
      { status: 500, headers: corsHeaders }
    );
  }
}
