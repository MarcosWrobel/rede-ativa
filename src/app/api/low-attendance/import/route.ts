import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import { formatZodError, frequenciaSyncSchema } from "@/lib/schemas";
import { executePowerBiFrequencySync } from "@/services/frequencySyncService";

export const maxDuration = 60;

/**
 * Endpoint dedicado para importação manual de frequência via CSV/planilha/JSON
 * no painel /faltas, disponível para ambas as edições (PILOTO_INTEGRADA e
 * INSTITUCIONAL_ESSENCIAL) sem liberar os endpoints de raspagem automática.
 */
export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: "Payload JSON inválido." }, { status: 400 });
    }

    const parsedBody = frequenciaSyncSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return NextResponse.json({ error: formatZodError(parsedBody.error) }, { status: 400 });
    }

    const currentSchool = await getCurrentSchool(authCheck.schoolId);

    const result = await executePowerBiFrequencySync({
      alunos: parsedBody.data.alunos,
      currentSchool,
      authMethod: "SESSION",
      sourceMode: "MANUAL_FILE",
      userId: authCheck.userId,
      userName: authCheck.userName,
      userEmail: authCheck.email,
      req,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[POST /api/low-attendance/import] Erro:", error);
    return NextResponse.json(
      { error: "Erro interno durante a importação de frequência." },
      { status: 500 }
    );
  }
}
