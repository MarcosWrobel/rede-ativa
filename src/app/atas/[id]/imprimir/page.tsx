import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { generateVerificationCode, canAccessConfidentialMinute } from "@/lib/ataCrypto";
import { generateQrCodeSvg, getAtaValidationUrl, getRequestOrigin } from "@/lib/qrCode";
import PrintPageClient from "./PrintPageClient";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AtaPrintPage({ params }: Props) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  let minute = await prisma.pedagogicalMinute.findUnique({
    where: { id },
    include: {
      school: true,
      students: true,
      participants: true,
      addendums: { orderBy: { createdAt: "asc" } },
      actionItems: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!minute) {
    notFound();
  }

  const currentSchool = await getCurrentSchool((session.user as any)?.schoolId);

  // Validação estrita de isolamento multi-tenant (Ponto 2) e Sigilo Reforçado ECA
  const isOwner = assertTenantOwnership(minute.schoolId, currentSchool.id, session);
  if (!isOwner || !canAccessConfidentialMinute(minute, session)) {
    notFound();
  }

  // Auto-healing: Se a ata está FINALIZED mas não tem verificationCode (legado ou importado),
  // assegura a geração atômica e salva no banco para garantir a fé pública e o QR Code.
  // Executado estritamente APÓS validação de tenant autorizada.
  if (minute.status === "FINALIZED" && !minute.verificationCode) {
    const newCode = generateVerificationCode();
    try {
      minute = await prisma.pedagogicalMinute.update({
        where: { id: minute.id },
        data: { verificationCode: newCode },
        include: {
          school: true,
          students: true,
          participants: true,
          addendums: { orderBy: { createdAt: "asc" } },
          actionItems: { orderBy: { createdAt: "asc" } },
        },
      });
    } catch (err) {
      console.warn("[AtaPrintPage] Falha ao persistir verificationCode legado:", err);
      minute.verificationCode = newCode;
    }
  }

  const reqHeaders = await headers();
  const origin = getRequestOrigin(reqHeaders);
  const verificationUrl = minute.verificationCode
    ? getAtaValidationUrl(minute.verificationCode, origin)
    : "";

  let qrSvg: string | undefined;
  if (verificationUrl) {
    try {
      qrSvg = await generateQrCodeSvg(verificationUrl, {
        width: 120,
        margin: 1,
        errorCorrectionLevel: "M",
      });
    } catch (err) {
      console.warn("[AtaPrintPage] Falha ao pré-renderizar SVG do QR Code:", err);
    }
  }

  return (
    <PrintPageClient
      minute={minute}
      initialOrigin={origin}
      initialQrSvg={qrSvg}
      initialVerificationUrl={verificationUrl}
    />
  );
}
