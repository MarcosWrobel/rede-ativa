import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getCurrentSchool } from "@/lib/currentSchool";
import { canAccessConfidentialMinute } from "@/lib/ataCrypto";
import LivroAnualClient from "./LivroAnualClient";

interface Props {
  params: Promise<{ ano: string }>;
}

export default async function LivroAnualPage({ params }: Props) {
  const { ano } = await params;
  const year = parseInt(ano, 10);
  if (isNaN(year)) notFound();

  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const school = await getCurrentSchool((session.user as any)?.schoolId);

  const isDefaultSchoolContext =
    school.id === "default-leopoldina" || school.inepCode === "41042730";

  const schoolFilter = isDefaultSchoolContext
    ? {
        OR: [
          { schoolId: school.id },
          ...(school.id !== "default-leopoldina" ? [{ schoolId: "default-leopoldina" }] : []),
        ],
      }
    : { schoolId: school.id };

  let minutes: any[] = [];
  try {
    minutes = await prisma.pedagogicalMinute.findMany({
      where: {
        ...schoolFilter,
        year,
        status: { in: ["FINALIZED", "VOIDED"] },
      },
      orderBy: { ataNumber: "asc" },
      include: {
        students: true,
        participants: true,
        addendums: { orderBy: { createdAt: "asc" } },
        actionItems: true,
      },
    });
  } catch (err) {
    console.error("[LivroAnualPage] Erro ao consultar atas do livro anual:", err);
  }

  const safeMinutes = minutes.map((m: any) => {
    if (!canAccessConfidentialMinute(m, session)) {
      return {
        ...m,
        rawNotes: null,
        summary: "[REGISTRO SOB SIGILO REFORÇADO ECA — ACESSO INTEGRAL RESTRITO À DIREÇÃO ESCOLAR E AO SERVIDOR AUTOR]",
        agreementsSummary: null,
        actionItems: [],
        addendums: [],
      };
    }
    return m;
  });

  return <LivroAnualClient school={school} year={year} minutes={safeMinutes} />;
}
