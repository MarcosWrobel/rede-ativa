import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  canMutateSchoolCouncil,
  findCouncilBoardOwnershipRecord,
  getCouncilBoardDetail,
  isCouncilBoardAuthorizedInActiveSchool,
  listSchoolCouncilBoards,
  resolveAuthorizedSchoolForCouncil,
} from "@/services/classCouncilService";
import type { CouncilTrimesterNumber } from "@/components/conselho/types";
import ConselhoTurmaClient from "./ConselhoTurmaClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Conselho da Turma | Rede Ativa SaaS",
};

function parseTrimesterParam(raw?: string): CouncilTrimesterNumber {
  if (raw === "2") return 2;
  if (raw === "3") return 3;
  return 1;
}

export default async function ConselhoTurmaPage({
  params,
  searchParams,
}: {
  params: Promise<{ boardId: string }>;
  searchParams?: Promise<{ trimestre?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.active === false) {
    redirect("/login");
  }

  const [{ boardId }, sp] = await Promise.all([
    params,
    searchParams ? searchParams : Promise.resolve<{ trimestre?: string }>({}),
  ]);
  const initialTrimester = parseTrimesterParam(sp?.trimestre);
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

  const [board, schoolBoards] = await Promise.all([
    getCouncilBoardDetail(currentSchool.id, boardId),
    listSchoolCouncilBoards(currentSchool.id, ownership.year),
  ]);

  if (!board) {
    notFound();
  }

  const availableSourceBoards = schoolBoards.boards
    .filter((b) => b.id !== board.id && b._count.subjects > 0)
    .map((b) => ({
      id: b.id,
      classGroupName: b.classGroup.name,
      shift: b.classGroup.shift,
      subjectsCount: b._count.subjects,
    }));

  const canEdit = canMutateSchoolCouncil(session, currentSchool.id);

  return (
    <ConselhoTurmaClient
      initialBoard={board}
      availableSourceBoards={availableSourceBoards}
      canEdit={canEdit}
      currentUserName={session.user.name || ""}
      initialTrimester={initialTrimester}
    />
  );
}
