import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import {
  canMutateSchoolCouncil,
  findCouncilBoardOwnershipRecord,
  getCouncilBoardDetail,
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
  const ownership = await findCouncilBoardOwnershipRecord(boardId);
  if (!ownership) {
    notFound();
  }

  const sessionSchoolId = (session.user as { schoolId?: string | null })?.schoolId;
  const currentSchool = await resolveAuthorizedSchoolForCouncil(session, sessionSchoolId);

  if (!currentSchool || !assertTenantOwnership(ownership.schoolId, currentSchool.id, session)) {
    notFound();
  }

  const [board, schoolBoards] = await Promise.all([
    getCouncilBoardDetail(ownership.schoolId, boardId),
    listSchoolCouncilBoards(ownership.schoolId, ownership.year),
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

  const canEdit = canMutateSchoolCouncil(session, ownership.schoolId);

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
