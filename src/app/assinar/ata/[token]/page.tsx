import { prisma } from "@/lib/prisma";
import { anonymizeOtherMinorsInText } from "@/lib/ataCrypto";
import { isSignTokenExpired } from "@/lib/signTokenExpiry";
import MobileSignClient from "./MobileSignClient";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function AssinarAtaPage({ params }: Props) {
  const { token } = await params;

  const participant = await prisma.pedagogicalMinuteParticipant.findUnique({
    where: { mobileSignToken: token },
    include: {
      minute: {
        include: {
          school: true,
          students: true,
        },
      },
    },
  });

  if (!participant) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-3xl border border-slate-200 shadow-sm text-center space-y-3">
          <h1 className="text-lg font-black text-slate-900">Link Inválido, Substituído ou Já Utilizado</h1>
          <p className="text-xs text-slate-500">
            Este link de assinatura digital não está mais ativo porque já foi utilizado, foi substituído por um novo QR Code ou foi revogado. Solicite à equipe escolar um link atualizado.
          </p>
        </div>
      </div>
    );
  }

  if (participant.minute.status !== "DRAFT") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-3xl border border-slate-200 shadow-sm text-center space-y-3">
          <h1 className="text-lg font-black text-slate-900">Ata Já Lavrada Oficialmente</h1>
          <p className="text-xs text-slate-500">
            Esta ata pedagógica já foi finalizada e selada criptograficamente. Não é mais possível coletar novas assinaturas neste registro.
          </p>
        </div>
      </div>
    );
  }

  if (isSignTokenExpired(participant.mobileSignExpiresAt)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-3xl border border-slate-200 shadow-sm text-center space-y-3">
          <h1 className="text-lg font-black text-slate-900">Link Expirado</h1>
          <p className="text-xs text-slate-500">
            A validade deste token expirou. Solicite um novo link ou QR Code à equipe escolar.
          </p>
        </div>
      </div>
    );
  }

  // Proteção ECA Arts. 17 e 143: quando a ata envolve múltiplos menores e o link pertence a responsável/estudante,
  // anonimiza os nomes dos outros menores co-envolvidos antes de enviar ao dispositivo móvel não autenticado.
  const linkedStudents = ((participant.minute as any).students || []).map((s: any) => ({
    id: s.studentId,
    name: s.studentNameSnapshot || "",
  }));
  const shouldAnonymizeOthers =
    linkedStudents.length > 1 &&
    (participant.role === "RESPONSAVEL" ||
      participant.role === "FAMILIAR_CONTATO" ||
      participant.role === "ESTUDANTE");

  const safeSubject = shouldAnonymizeOthers
    ? anonymizeOtherMinorsInText(participant.minute.subject, participant.studentId, linkedStudents)
    : participant.minute.subject;
  const safeSummary = shouldAnonymizeOthers
    ? anonymizeOtherMinorsInText(participant.minute.summary, participant.studentId, linkedStudents)
    : participant.minute.summary;
  const safeAgreements =
    shouldAnonymizeOthers && participant.minute.agreementsSummary
      ? anonymizeOtherMinorsInText(participant.minute.agreementsSummary, participant.studentId, linkedStudents)
      : participant.minute.agreementsSummary;

  return (
    <MobileSignClient
      token={token}
      participantName={participant.name}
      participantRole={participant.role}
      expectedEmail={participant.expectedEmail}
      schoolName={participant.minute.school.name}
      subject={safeSubject}
      summary={safeSummary}
      agreementsSummary={safeAgreements}
      googleClientId={process.env.GOOGLE_CLIENT_ID || ""}
    />
  );
}
