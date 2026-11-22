import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyCouncilTeacherToken } from "@/lib/councilTeacherToken";
import { checkRateLimit, hashIp, RATE_LIMIT_POLICIES } from "@/lib/rateLimit";
import { formatSegmentLabel, formatShiftLabel } from "@/components/conselho/types";
import ProfessorConselhoClient from "./ProfessorConselhoClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Lançamento Docente — Conselho de Classe | Rede Ativa SaaS",
};

interface Props {
  params: Promise<{ token: string }>;
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

export default async function ProfessorConselhoPage({ params }: Props) {
  const reqHeaders = await headers();
  const rawIp =
    reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    reqHeaders.get("x-real-ip")?.trim() ||
    "unknown";

  const rlCheck = await checkRateLimit(
    `rl:council-teacher-page:${hashIp(rawIp)}`,
    RATE_LIMIT_POLICIES.COUNCIL_TEACHER_PORTAL
  );

  if (!rlCheck.success) {
    return renderStatusCard(
      "Limite de acessos excedido",
      `Muitas tentativas em curto intervalo. Aguarde ${rlCheck.retryAfterSeconds} segundos para abrir este link novamente.`
    );
  }

  const { token } = await params;
  let decodedToken = token;
  try {
    decodedToken = decodeURIComponent(token);
  } catch {
    decodedToken = token;
  }

  const tokenCheck = verifyCouncilTeacherToken(decodedToken);
  if (!tokenCheck.ok) {
    return renderStatusCard(
      tokenCheck.reason === "expired" ? "Link Expirado" : "Link Inválido",
      tokenCheck.error
    );
  }

  const board = await prisma.classCouncilBoard.findUnique({
    where: { id: tokenCheck.payload.boardId },
    select: {
      id: true,
      schoolId: true,
      year: true,
      school: { select: { name: true } },
      classGroup: { select: { name: true, segment: true, shift: true } },
    },
  });

  if (!board || board.schoolId !== tokenCheck.payload.schoolId) {
    return renderStatusCard(
      "Conselho não encontrado",
      "Este link não corresponde a uma turma ativa na instituição. Solicite um novo link à coordenação pedagógica."
    );
  }

  let lockedSubjectName: string | null = null;
  if (tokenCheck.payload.subjectId) {
    const matchedSubjects = await prisma.classCouncilSubject.findMany({
      where: {
        id: { in: [tokenCheck.payload.subjectId] },
        boardId: board.id,
        schoolId: board.schoolId,
        active: true,
      },
      select: { id: true, name: true },
    });
    if (matchedSubjects.length === 0) {
      return renderStatusCard(
        "Componente indisponível",
        "O componente curricular associado a este link não está mais ativo nesta turma."
      );
    }
    lockedSubjectName = matchedSubjects[0].name;
  }

  const enableDevAuth =
    process.env.NODE_ENV !== "production" &&
    process.env.VERCEL_ENV !== "production" &&
    process.env.VERCEL_ENV !== "preview" &&
    process.env.ENABLE_DEV_AUTH === "true";

  return (
    <ProfessorConselhoClient
      token={decodedToken}
      schoolName={board.school?.name || "Instituição de Ensino"}
      classNameLabel={board.classGroup.name}
      segmentLabel={formatSegmentLabel(board.classGroup.segment)}
      shiftLabel={formatShiftLabel(board.classGroup.shift)}
      year={board.year}
      trimester={tokenCheck.payload.trimester}
      lockedSubjectName={lockedSubjectName}
      googleClientId={process.env.GOOGLE_CLIENT_ID || ""}
      enableDevAuth={enableDevAuth}
    />
  );
}
