import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { logAudit, extractClientIp } from "@/lib/audit";
import { computeAddendumHash } from "@/lib/ataCrypto";
import { getCurrentSchool } from "@/lib/currentSchool";
import { z } from "zod";

export const dynamic = "force-dynamic";

const addendumSchema = z.object({
  content: z.string().min(5, "Informe o texto do termo de aditamento/retificação"),
  participantSignatureData: z.string().optional().nullable(),
  participantSignerName: z.string().optional().nullable(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const ip = extractClientIp(req);

    const rawBody = await req.json();
    const parsed = addendumSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos" }, { status: 400 });
    }

    const { content, participantSignatureData, participantSignerName } = parsed.data;

    // Executa em transação atômica para garantir encadeamento linear estrito dos hashes dos adendos
    const addendum = await prisma.$transaction(async (tx) => {
      const minute = await tx.pedagogicalMinute.findUnique({
        where: { id },
        include: {
          addendums: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      if (!minute) {
        throw new Error("Ata pedagógica não encontrada");
      }

      const currentSchool = await getCurrentSchool(authCheck.schoolId);
      if (minute.schoolId && minute.schoolId !== currentSchool.id && authCheck.role !== "ADMIN") {
        throw new Error("Acesso negado a registro de outra instituição de ensino.");
      }

      if (minute.status !== "FINALIZED") {
        throw new Error("Termos de aditamento ('Em tempo') só podem ser lavrados em atas já finalizadas.");
      }

      // Obtém o hash imediatamente anterior (ou o da ata ou o do último adendo) para encadear
      const previousHash =
        minute.addendums.length > 0
          ? minute.addendums[0].addendumHash
          : minute.contentHash || "genesis";

      const now = new Date();
      const addendumHash = computeAddendumHash(
        previousHash,
        content,
        authCheck.email,
        now.toISOString()
      );

      const created = await tx.pedagogicalMinuteAddendum.create({
        data: {
          minuteId: id,
          content,
          authorName: authCheck.userName || "Equipe Pedagógica",
          authorEmail: authCheck.email,
          authorIp: ip,
          previousHash,
          addendumHash,
          participantSignatureData: participantSignatureData || null,
          participantSignerName: participantSignerName || null,
          createdAt: now,
        },
      });

      return {
        ...created,
        minuteAtaNumber: minute.ataNumber,
        minuteYear: minute.year,
      };
    });

    await logAudit({
      action: "ADD_ATA_ADDENDUM",
      entityType: "PedagogicalMinuteAddendum",
      entityId: addendum.id,
      details: `Adendo 'Em tempo' adicionado à Ata nº ${String(addendum.minuteAtaNumber || 0).padStart(3, "0")}/${addendum.minuteYear || new Date().getFullYear()} — Hash: ${addendum.addendumHash.slice(0, 16)}...`,
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      ipAddress: ip,
    });

    return NextResponse.json({ success: true, addendum }, { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/atas/[id]/addendums] Erro:", error);
    const status = error.message?.includes("Acesso negado") ? 403 : error.message?.includes("não encontrada") ? 404 : error.message?.includes("já finalizadas") ? 400 : 500;
    return NextResponse.json({ error: error.message || "Erro ao adicionar termo de aditamento" }, { status });
  }
}
