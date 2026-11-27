import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, hashIp, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";
import {
  isSchoolTeacherInviteActive,
  parseSchoolTeacherInviteSettings,
  verifySchoolTeacherInviteToken,
} from "@/lib/schoolTeacherInvite";
import { safeCompareStrings } from "@/lib/syncToken";
import VincularDocenteClient from "./VincularDocenteClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Vínculo Docente — Conselho de Classe | Rede Ativa SaaS",
};

interface Props {
  searchParams: Promise<{ t?: string; school?: string }>;
}

function renderStatusCard(title: string, description: string) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-3xl border border-slate-200 shadow-xs text-center space-y-3">
        <h1 className="text-lg font-black text-slate-900">{title}</h1>
        <p className="text-xs text-slate-600 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

export default async function VincularDocentePage({ searchParams }: Props) {
  const reqHeaders = await headers();
  const rawIp =
    reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    reqHeaders.get("x-real-ip")?.trim() ||
    "unknown";

  const rlCheck = await checkRateLimit(
    `rl:council-teacher-invite-page:${hashIp(rawIp)}`,
    RATE_LIMIT_POLICIES.TEACHER_INVITE_CLAIM
  );
  if (!rlCheck.success) {
    return renderStatusCard(
      "Limite de acessos excedido",
      `Aguarde ${rlCheck.retryAfterSeconds} segundos para tentar novamente.`
    );
  }

  const sp = await searchParams;
  const inviteToken = (sp.t || "").trim() || null;
  const querySchoolId = (sp.school || "").trim() || null;

  let resolvedSchoolId: string | null = querySchoolId;
  let resolvedSchoolName = "Instituição de Ensino";

  if (inviteToken) {
    const check = verifySchoolTeacherInviteToken(inviteToken);
    if (!check.ok) {
      return renderStatusCard("Link de Vínculo Indisponível", check.error);
    }
    const dbSchool = await prisma.school.findUnique({
      where: { id: check.payload.schoolId },
      select: { id: true, name: true, active: true, settingsJson: true },
    });
    if (!dbSchool || !dbSchool.active) {
      return renderStatusCard(
        "Instituição indisponível",
        "A instituição de ensino associada a este link não está ativa."
      );
    }
    const inviteState = parseSchoolTeacherInviteSettings(dbSchool.settingsJson);
    if (!isSchoolTeacherInviteActive(inviteState) || !safeCompareStrings(check.payload.nonce, inviteState.nonce)) {
      return renderStatusCard(
        "Link de Vínculo Expirado ou Revogado",
        "Este link foi substituído ou expirado. Solicite um novo link à equipe pedagógica."
      );
    }
    resolvedSchoolId = dbSchool.id;
    resolvedSchoolName = dbSchool.name;
  } else if (querySchoolId) {
    const dbSchool = await prisma.school.findUnique({
      where: { id: querySchoolId },
      select: { id: true, name: true, active: true },
    });
    if (!dbSchool || !dbSchool.active) {
      return renderStatusCard(
        "Instituição não encontrada",
        "Verifique o endereço completo compartilhado pela equipe pedagógica."
      );
    }
    resolvedSchoolId = dbSchool.id;
    resolvedSchoolName = dbSchool.name;
  } else {
    return renderStatusCard(
      "Link incompleto",
      "Abra o endereço completo de vínculo compartilhado pela equipe pedagógica da sua escola."
    );
  }

  const enableDevAuth =
    process.env.NODE_ENV !== "production" &&
    process.env.VERCEL_ENV !== "production" &&
    process.env.VERCEL_ENV !== "preview" &&
    process.env.ENABLE_DEV_AUTH === "true";

  return (
    <VincularDocenteClient
      inviteToken={inviteToken}
      schoolId={resolvedSchoolId}
      schoolName={resolvedSchoolName}
      googleClientId={process.env.GOOGLE_CLIENT_ID || ""}
      enableDevAuth={enableDevAuth}
    />
  );
}
