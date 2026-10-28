import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AlunosClient from "./AlunosClient";
import { redirect } from "next/navigation";

export default async function AlunosPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const [students, classGroups] = await Promise.all([
    prisma.student.findMany({
      where: { active: true },
      include: {
        classGroup: true,
        _count: { select: { messageLogs: true } },
      },
      orderBy: [{ classGroup: { name: "asc" } }, { name: "asc" }],
    }),
    prisma.classGroup.findMany({
      orderBy: { name: "asc" },
    }),
  ]);

  return <AlunosClient initialStudents={students} classGroups={classGroups} />;
}
