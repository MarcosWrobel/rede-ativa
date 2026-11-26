import { prisma } from "@/lib/prisma";
import { resolveAuthorizedPageContext } from "@/lib/pageAuth";
import ModelosClient from "./ModelosClient";

export const dynamic = "force-dynamic";

export default async function ModelosPage() {
  const ctx = await resolveAuthorizedPageContext();
  const currentSchool = ctx.school;

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
