import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import BuscaAtivaClient from "./BuscaAtivaClient";
import { redirect } from "next/navigation";

export default async function BuscaAtivaPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Load initial data
  const [classGroups, templates, initialStudents] = await Promise.all([
    prisma.classGroup.findMany({
      orderBy: { name: "asc" },
    }),
    prisma.messageTemplate.findMany({
      where: { active: true },
      orderBy: { title: "asc" },
    }),
    prisma.student.findMany({
      where: { active: true },
      include: {
        classGroup: true,
        lowAttendanceRecord: true,
        messageLogs: {
          take: 3,
          orderBy: { sentAt: "desc" },
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <BuscaAtivaClient
      classGroups={classGroups}
      templates={templates}
      initialStudents={initialStudents}
      currentUser={{
        name: session.user.name || "Pedagoga",
        email: session.user.email || "",
      }}
    />
  );
}
