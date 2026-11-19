import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import {
  canMutateSchoolCouncil,
  findCouncilBoardOwnershipRecord,
  getCouncilBoardDetail,
  listSchoolCouncilBoards,
} from "@/services/classCouncilService";
import ConselhoTurmaClient from "./ConselhoTurmaClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Conselho da Turma | Rede Ativa SaaS",
};

export default async function ConselhoTurmaPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { boardId } = await params;
  const ownership = await findCouncilBoardOwnershipRecord(boardId);
  if (!ownership) {
    notFound();
  }

  const sessionSchoolId = (session.user as { schoolId?: string | null })?.schoolId;
  const currentSchool = await getCurrentSchool(sessionSchoolId);

  if (!assertTenantOwnership(ownership.schoolId, currentSchool.id, session)) {
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
    />
  );
}
