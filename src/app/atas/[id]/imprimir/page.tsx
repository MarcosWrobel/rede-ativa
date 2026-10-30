import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Printer, ArrowLeft, ShieldCheck, FileCheck2, Lock } from "lucide-react";
import PrintPageClient from "./PrintPageClient";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AtaPrintPage({ params }: Props) {
  const { id } = await params;

  const minute = await prisma.pedagogicalMinute.findUnique({
    where: { id },
    include: {
      school: true,
      students: true,
      participants: true,
      addendums: { orderBy: { createdAt: "asc" } },
      actionItems: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!minute) {
    notFound();
  }

  return <PrintPageClient minute={minute} />;
}
