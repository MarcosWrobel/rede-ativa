import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { formatZodError, messageSendSchema } from "@/lib/schemas";
import { getCurrentSchool } from "@/lib/currentSchool";
import { dispatchAndPersistMessage } from "@/services/messageDispatchService";

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const parsed = messageSendSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const {
      studentId,
      templateId,
      reasonTitle,
      messageContent,
      customPhone,
      initialDeliveryStatus,
    } = parsed.data;

    const currentSchool = await getCurrentSchool(authCheck.schoolId);

    const result = await dispatchAndPersistMessage({
      studentId,
      templateId,
      reasonTitle,
      messageContent,
      customPhone,
      initialDeliveryStatus,
      currentSchoolId: currentSchool.id,
      session: authCheck.session,
      userId: authCheck.userId,
      userName: authCheck.userName,
      userEmail: authCheck.email,
      userAgent: req.headers.get("user-agent") || undefined,
      req,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result.data);
  } catch (error: any) {
    console.error("Erro ao enviar mensagem:", error);
    return NextResponse.json({ error: "Erro interno ao registrar envio de mensagem" }, { status: 500 });
  }
}
