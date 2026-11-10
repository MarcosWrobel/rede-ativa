import { NextResponse } from "next/server";
import { z } from "zod";
import { getSyncCorsHeaders } from "@/lib/cors";
import { serpSyncItemSchema, formatZodError } from "@/lib/schemas";
import {
  executeSerpProtectionSync,
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
      label: "Extensão SERP",
      defaultApiUserName: "Extensão SERP (API)",
      forbiddenEssencialError:
        "A sincronização via extensão de raspagem do SERP não está autorizada para esta instituição escolar (Edição Institucional Essencial). Utilize o registro pedagógico padrão ou consulte a administração.",
    });

    if (!syncAuth.ok) {
      return syncAuth.response;
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

    const result = await executeSerpProtectionSync({
      fichas: parsedList.data,
      currentSchool: syncAuth.currentSchool,
      authMethod: syncAuth.authMethod,
      userId: syncAuth.userId,
      userName: syncAuth.userName,
      userEmail: syncAuth.userEmail,
      req,
    });

    return NextResponse.json(result, { headers: corsHeaders });
  } catch (error: any) {
    console.error("Erro na sincronização do SERP:", error);
    return NextResponse.json(
      { error: "Erro interno durante a sincronização do SERP." },
      { status: 500, headers: corsHeaders }
    );
  }
}
