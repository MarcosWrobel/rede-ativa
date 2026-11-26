import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/permissions";
import { formatZodError, messageSendSchema } from "@/lib/schemas";
import { requireAuthorizedSchool } from "@/lib/currentSchool";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";
import { resolveEffectiveRoleForSchool } from "@/lib/serverAuthContext";
import { isAllowedMessagingRole } from "@/lib/roles";
import { dispatchAndPersistMessage } from "@/services/messageDispatchService";

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const rateLimitKey = `msg-send:${authCheck.schoolId || "global"}:${authCheck.userId}`;
    const rlCheck = await enforceRateLimit(rateLimitKey, RATE_LIMIT_POLICIES.MESSAGE_REPLY);
    if (!rlCheck.ok) return rlCheck.response;

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

    const schoolCheck = await requireAuthorizedSchool(
      authCheck.session,
      authCheck.schoolId,
      authCheck.snapshot,
      { allowSuperAdminReadOnlyFallback: false }
    );
    if (!schoolCheck.ok) return schoolCheck.response;
    const currentSchool = schoolCheck.school;

    const effectiveRole =
      (authCheck.snapshot
        ? resolveEffectiveRoleForSchool(authCheck.snapshot, currentSchool)
        : authCheck.role) || "";

    if (!isAllowedMessagingRole(effectiveRole)) {
      return NextResponse.json(
        { error: "Perfil sem autorização para enviar mensagens nesta instituição." },
        { status: 403 }
      );
    }

    const result = await dispatchAndPersistMessage({
      studentId,
      templateId,
      reasonTitle,
      messageContent,
      customPhone,
      initialDeliveryStatus,
      currentSchoolId: currentSchool.id,
      currentSchoolInepCode: currentSchool.inepCode,
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
