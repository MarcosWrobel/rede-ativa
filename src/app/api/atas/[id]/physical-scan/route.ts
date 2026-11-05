import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const physicalScanSchema = z.object({
  scanData: z.string().min(10, "Dados do anexo digitalizado não informados"),
  govBrVerified: z.boolean().default(false),
  govBrProtocol: z.string().optional().nullable(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const existing = await prisma.pedagogicalMinute.findUnique({
      where: { id },
      select: {
        id: true,
        schoolId: true,
        ataNumber: true,
        year: true,
        subject: true,
        status: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Ata pedagógica não encontrada" }, { status: 404 });
    }

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    if (!assertTenantOwnership(existing.schoolId, currentSchool.id, authCheck.session)) {
      return NextResponse.json(
        { error: "Acesso negado a ata de outra instituição de ensino." },
        { status: 403 }
      );
    }

    const rawBody = await req.json();
    const parsed = physicalScanSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Payload inválido" },
        { status: 400 }
      );
    }

    const { scanData, govBrVerified, govBrProtocol } = parsed.data;

    // Limite de segurança: 12MB para payload base64
    if (scanData.length > 12 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Arquivo muito grande. O limite máximo para digitalização é 8MB." },
        { status: 400 }
      );
    }

    const now = new Date();
    const updated = await prisma.pedagogicalMinute.update({
      where: { id },
      data: {
        physicalSignedScanData: scanData,
        physicalScanUploadedAt: now,
        physicalScanUploadedBy: authCheck.userName,
        govBrVerified: Boolean(govBrVerified),
        govBrProtocol: govBrProtocol?.trim() || null,
      },
      select: {
        id: true,
        physicalSignedScanData: true,
        physicalScanUploadedAt: true,
        physicalScanUploadedBy: true,
        govBrVerified: true,
        govBrProtocol: true,
      },
    });

    await logAudit({
      action: "ATTACH_PHYSICAL_SCAN",
      entityType: "PedagogicalMinute",
      entityId: id,
      details: {
        ataNumber: existing.ataNumber,
        year: existing.year,
        subject: existing.subject,
        govBrVerified: Boolean(govBrVerified),
        govBrProtocol: govBrProtocol?.trim() || null,
        dataSizeBytes: scanData.length,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      schoolId: currentSchool.id,
      req,
    });

    return NextResponse.json({
      success: true,
      minute: updated,
    });
  } catch (error: any) {
    console.error("[POST /api/atas/[id]/physical-scan] Erro:", error);
    return NextResponse.json(
      { error: error.message || "Erro interno ao salvar via física digitalizada" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const existing = await prisma.pedagogicalMinute.findUnique({
      where: { id },
      select: {
        id: true,
        schoolId: true,
        ataNumber: true,
        year: true,
        subject: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Ata pedagógica não encontrada" }, { status: 404 });
    }

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    if (!assertTenantOwnership(existing.schoolId, currentSchool.id, authCheck.session)) {
      return NextResponse.json(
        { error: "Acesso negado a ata de outra instituição de ensino." },
        { status: 403 }
      );
    }

    await prisma.pedagogicalMinute.update({
      where: { id },
      data: {
        physicalSignedScanData: null,
        physicalScanUploadedAt: null,
        physicalScanUploadedBy: null,
        govBrVerified: false,
        govBrProtocol: null,
      },
    });

    await logAudit({
      action: "REMOVE_PHYSICAL_SCAN",
      entityType: "PedagogicalMinute",
      entityId: id,
      details: {
        ataNumber: existing.ataNumber,
        year: existing.year,
        subject: existing.subject,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      schoolId: currentSchool.id,
      req,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[DELETE /api/atas/[id]/physical-scan] Erro:", error);
    return NextResponse.json(
      { error: error.message || "Erro interno ao remover via física" },
      { status: 500 }
    );
  }
}
