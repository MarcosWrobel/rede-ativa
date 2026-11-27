import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { anonymizeOtherMinorsInText } from "@/lib/ataCrypto";
import { resolveSchoolLogoProxyUrl } from "@/lib/schoolLogo";
import {
  findCouncilBoardOwnershipRecord,
  getCouncilBoardDetail,
  isCouncilBoardAuthorizedInActiveSchool,
  resolveAuthorizedSchoolForCouncil,
} from "@/services/classCouncilService";
import type {
  CouncilTrimesterNumber,
  SchoolPrintMeta,
} from "@/components/conselho/types";
import ConselhoPrintClient, { type CouncilPrintMode } from "./ConselhoPrintClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Impressão — Conselho de Classe | Rede Ativa SaaS",
};

export default async function ConselhoPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ boardId: string }>;
  searchParams?: Promise<{
    mode?: string;
    trimester?: string;
    studentId?: string;
    hideHealthTags?: string;
    mapId?: string;
    perspective?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.active === false) {
    redirect("/login");
  }

  const { boardId } = await params;
  const sessionSchoolId = (session.user as { schoolId?: string | null })?.schoolId;
  const currentSchool = await resolveAuthorizedSchoolForCouncil(session, sessionSchoolId);

  const ownership = await findCouncilBoardOwnershipRecord(boardId);
  if (
    !ownership ||
    !isCouncilBoardAuthorizedInActiveSchool(ownership, currentSchool, session) ||
    (ownership.classGroup && ownership.classGroup.schoolId !== ownership.schoolId)
  ) {
    notFound();
  }

  const [board, schoolDb] = await Promise.all([
    getCouncilBoardDetail(currentSchool.id, boardId),
    prisma.school.findUnique({
      where: { id: currentSchool.id },
      select: {
        id: true,
        name: true,
        inepCode: true,
        city: true,
        state: true,
        nre: true,
        network: true,
        updatedAt: true,
      },
    }),
  ]);

  if (!board) {
    notFound();
  }

  const sp = searchParams ? await searchParams : {};
  const rawMode = sp?.mode;
  const initialMode: CouncilPrintMode =
    rawMode === "pre-conselho" ||
    rawMode === "pos-conselho" ||
    rawMode === "aluno" ||
    rawMode === "mapa-sala"
      ? rawMode
      : "turma";

  const parsedTri = sp?.trimester ? Number.parseInt(sp.trimester, 10) : 1;
  const initialTrimester: CouncilTrimesterNumber =
    parsedTri === 2 || parsedTri === 3 ? parsedTri : 1;

  const requestedStudentId = sp?.studentId?.trim() || null;
  if (
    initialMode === "aluno" &&
    requestedStudentId &&
    !board.studentCards.some((c) => c.studentId === requestedStudentId)
  ) {
    notFound();
  }

  const linkedStudentsList = board.studentCards.map((c) => ({
    id: c.student.id,
    name: c.student.name,
  }));

  // Proteção ECA Arts. 17, 143 e 247: mascara eventuais menções a colegas nos pareceres individuais
  const anonymizedOpinionsByStudentId: Record<
    string,
    { t1: string; t2: string; t3: string }
  > = {};

  for (const card of board.studentCards) {
    anonymizedOpinionsByStudentId[card.studentId] = {
      t1: anonymizeOtherMinorsInText(
        card.trimester1Opinion || "",
        card.studentId,
        linkedStudentsList
      ),
      t2: anonymizeOtherMinorsInText(
        card.trimester2Opinion || "",
        card.studentId,
        linkedStudentsList
      ),
      t3: anonymizeOtherMinorsInText(
        card.trimester3Opinion || "",
        card.studentId,
        linkedStudentsList
      ),
    };
  }

  const schoolMeta: SchoolPrintMeta = schoolDb
    ? {
        id: schoolDb.id,
        name: schoolDb.name,
        inepCode: schoolDb.inepCode,
        city: schoolDb.city,
        state: schoolDb.state,
        nre: schoolDb.nre,
        network: schoolDb.network,
        logoUrl: resolveSchoolLogoProxyUrl({
          id: schoolDb.id,
          updatedAt: schoolDb.updatedAt,
        }),
      }
    : {
        id: currentSchool.id,
        name: currentSchool.name,
        inepCode: currentSchool.inepCode,
        city: currentSchool.city,
        state: currentSchool.state,
        nre: currentSchool.nre,
        network: currentSchool.network,
        logoUrl: currentSchool.logoUrl,
      };

  return (
    <ConselhoPrintClient
      board={board}
      school={schoolMeta}
      initialMode={initialMode}
      initialTrimester={initialTrimester}
      initialStudentId={requestedStudentId}
      initialHideHealthTags={sp?.hideHealthTags === "1"}
      anonymizedOpinionsByStudentId={anonymizedOpinionsByStudentId}
      initialMapId={sp?.mapId?.trim() || null}
      initialPerspective={sp?.perspective === "teacher" ? "TEACHER" : "ROOM"}
    />
  );
}
