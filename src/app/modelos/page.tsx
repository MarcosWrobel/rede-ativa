import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentSchool } from "@/lib/currentSchool";
import ModelosClient from "./ModelosClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ModelosPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const currentSchool = await getCurrentSchool(session.user?.schoolId);

  let templates: any[] = [];
  try {
    templates = await prisma.messageTemplate.findMany({
      where: {
        schoolId: currentSchool.id,
      },
      orderBy: [{ segment: "asc" }, { title: "asc" }],
    });
  } catch (err) {
    console.error("[ModelosPage] Erro ao buscar templates:", err);
  }

  return <ModelosClient initialTemplates={templates} />;
}
