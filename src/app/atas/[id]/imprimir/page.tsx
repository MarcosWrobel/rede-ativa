import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { generateVerificationCode, canAccessConfidentialMinute } from "@/lib/ataCrypto";
import { generateQrCodeSvg, getAtaValidationUrl, getRequestOrigin } from "@/lib/qrCode";
import { resolveSchoolLogoProxyUrl } from "@/lib/schoolLogo";
import PrintPageClient from "./PrintPageClient";

const PRINT_MINUTE_SELECT = {
  id: true,
  schoolId: true,
  year: true,
  ataNumber: true,
  status: true,
  category: true,
  isConfidential: true,
  attendedAt: true,
  subject: true,
  rawNotes: true,
  summary: true,
  agreementsSummary: true,
  authorId: true,
  authorName: true,
  authorEmail: true,
  authorRole: true,
  finalizedAt: true,
  contentHash: true,
  verificationCode: true,
  pdfArchiveSha256: true,
  pdfArchiveGeneratedAt: true,
  physicalScanStorageKey: true,
  physicalScanSha256: true,
  physicalScanUploadedAt: true,
  govBrVerified: true,
  govBrProtocol: true,
  voidedAt: true,
  voidedByName: true,
  voidedByEmail: true,
  voidReason: true,
  isExtemporaneous: true,
  extemporaneousReason: true,
  createdAt: true,
  updatedAt: true,
  school: {
    select: {
      id: true,
      inepCode: true,
      name: true,
      city: true,
      state: true,
      nre: true,
      network: true,
      phone: true,
      email: true,
      settingsJson: true,
      updatedAt: true,
    },
  },
  students: true,
  participants: {
    select: {
      id: true,
      minuteId: true,
      role: true,
      studentId: true,
      name: true,
      kinship: true,
      documentType: true,
      documentNumber: true,
      documentVerifiedByStaff: true,
      phone: true,
      signatureMode: true,
      signatureData: true,
      signedAt: true,
      biometricVerified: true,
      biometricDeviceType: true,
      biometricAuthTime: true,
      verifiedEmail: true,
      verifiedGoogleName: true,
      emailVerifiedAt: true,
      refusalReason: true,
      witnessName: true,
    },
  },
  addendums: { orderBy: { createdAt: "asc" as const } },
  actionItems: { orderBy: { createdAt: "asc" as const } },
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AtaPrintPage({ params }: Props) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  let minute: any = await prisma.pedagogicalMinute.findUnique({
    where: { id },
    select: PRINT_MINUTE_SELECT,
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
        select: PRINT_MINUTE_SELECT,
      });
    } catch (err) {
      console.warn("[AtaPrintPage] Falha ao persistir verificationCode legado:", err);
      minute.verificationCode = newCode;
    }
  }

  if (minute?.school) {
    minute = {
      ...minute,
      school: {
        ...minute.school,
        logoUrl: resolveSchoolLogoProxyUrl({
          id: minute.school.id,
          logoUrl: (minute.school as { logoUrl?: string | null }).logoUrl,
          updatedAt: minute.school.updatedAt,
        }),
      },
    };
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
