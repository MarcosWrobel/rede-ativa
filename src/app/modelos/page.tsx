import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ModelosClient from "./ModelosClient";
import { redirect } from "next/navigation";

export default async function ModelosPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const templates = await prisma.messageTemplate.findMany({
    orderBy: [{ segment: "asc" }, { title: "asc" }],
  });

  return <ModelosClient initialTemplates={templates} />;
}
