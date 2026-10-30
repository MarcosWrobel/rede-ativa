import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
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
        },
      },
    },
  });

  if (!participant) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-3xl border border-slate-200 shadow-sm text-center space-y-3">
          <h1 className="text-lg font-black text-slate-900">Link Expirado ou Inválido</h1>
          <p className="text-xs text-slate-500">
            Este link de assinatura digital já foi utilizado ou ultrapassou a validade temporária. Solicite à equipe escolar para gerar um novo link ou QR Code.
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

  if (participant.mobileSignExpiresAt && new Date() > participant.mobileSignExpiresAt) {
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

  return (
    <MobileSignClient
      token={token}
      participantName={participant.name}
      participantRole={participant.role}
      expectedEmail={participant.expectedEmail}
      schoolName={participant.minute.school.name}
      subject={participant.minute.subject}
      summary={participant.minute.summary}
      agreementsSummary={participant.minute.agreementsSummary}
      googleClientId={process.env.GOOGLE_CLIENT_ID || ""}
    />
  );
}
