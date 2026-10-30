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
            Este link de assinatura digital já foi utilizado ou ultrapassou a validade temporária de 20 minutos. Solicite à pedagoga para gerar um novo QR Code na tela.
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
            A validade deste token expirou. Solicite um novo link na tela da equipe escolar.
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
      schoolName={participant.minute.school.name}
      subject={participant.minute.subject}
    />
  );
}
