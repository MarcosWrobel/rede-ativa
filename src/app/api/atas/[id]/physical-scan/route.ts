import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, checkIsSchoolManager, checkIsSuperAdmin } from "@/lib/permissions";
import { getCurrentSchool } from "@/lib/currentSchool";
import { assertTenantOwnership } from "@/lib/tenantGuard";
import { logAudit } from "@/lib/audit";
import {
  savePhysicalScanFile,
  getPhysicalScanBuffer,
  deletePhysicalScanFile,
} from "@/lib/objectStorage";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ALLOWED_SCAN_PREFIX = /^data:(image\/(png|jpeg|jpg|webp)|application\/pdf);base64,/i;

const physicalScanSchema = z
  .object({
    scanData: z
      .string()
      .min(10, "Dados do anexo digitalizado não informados")
      .refine((v) => ALLOWED_SCAN_PREFIX.test(v.trim()), {
        message: "Formato de arquivo inválido. Envie apenas imagem (PNG, JPEG, WEBP) ou documento PDF codificado em Base64.",
      })
      .optional()
      .nullable(),
    govBrVerified: z.boolean().default(false),
    govBrProtocol: z.string().optional().nullable(),
  })
  .refine((d) => !d.govBrVerified || Boolean(d.govBrProtocol && d.govBrProtocol.trim().length >= 5), {
    message: "Informe o código/protocolo verificador ICP-Brasil/Gov.br (mínimo 5 caracteres) ao marcar assinatura Gov.br verificada.",
    path: ["govBrProtocol"],
  });

/**
 * GET /api/atas/[id]/physical-scan
 * Proxy Autenticado Anti-IDOR para Visualização e Download do Anexo Físico
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const download = searchParams.get("download") === "1";

    const minute = await prisma.pedagogicalMinute.findUnique({
      where: { id },
      select: {
        id: true,
        schoolId: true,
        ataNumber: true,
        year: true,
        subject: true,
        isConfidential: true,
        authorId: true,
        authorEmail: true,
        physicalSignedScanData: true,
        physicalScanStorageKey: true,
        physicalScanProvider: true,
        physicalScanMimeType: true,
        physicalScanSizeBytes: true,
        physicalScanSha256: true,
      },
    });

    if (!minute) {
      return NextResponse.json({ error: "Ata pedagógica não encontrada" }, { status: 404 });
    }

    const currentSchool = await getCurrentSchool(authCheck.schoolId);
    if (!assertTenantOwnership(minute.schoolId, currentSchool.id, authCheck.session)) {
      return NextResponse.json(
        { error: "Acesso negado a registro de outra instituição de ensino." },
        { status: 403 }
      );
    }

    // Sigilo Reforçado (ECA Art. 143): Se for ata confidencial, apenas autor, Gestão Escolar ou SuperAdmin acessam
    if (minute.isConfidential) {
      const isAuthor =
        minute.authorId === authCheck.userId ||
        minute.authorEmail?.toLowerCase() === authCheck.email?.toLowerCase();
      const isManager =
        checkIsSuperAdmin(authCheck.session) ||
        checkIsSchoolManager(authCheck.session, minute.schoolId || currentSchool.id);

      if (!isAuthor && !isManager) {
        return NextResponse.json(
          {
            error:
              "Acesso restrito. Este documento possui sigilo reforçado (ECA Art. 143) e sua via física só pode ser acessada pelo autor ou direção escolar.",
          },
          { status: 403 }
        );
      }
    }

    if (!minute.physicalSignedScanData && !minute.physicalScanStorageKey) {
      return NextResponse.json(
        { error: "Esta ata não possui via física digitalizada anexada." },
        { status: 404 }
      );
    }

    const { buffer, mimeType, isVerifiedSha256 } = await getPhysicalScanBuffer(minute);

    const ext = mimeType === "application/pdf" ? "pdf" : mimeType.split("/")[1] || "bin";
    const numStr = minute.ataNumber ? String(minute.ataNumber).padStart(3, "0") : "SN";
    const filename = `Ata_${numStr}_${minute.year}_ViaFisica.${ext}`;
    const disposition = download ? "attachment" : "inline";

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `${disposition}; filename="${filename}"`,
        "Content-Length": String(buffer.length),
        "X-Content-Type-Options": "nosniff",
        "X-Scan-SHA256": minute.physicalScanSha256 || "",
        "X-Scan-Integrity-Verified": String(isVerifiedSha256),
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (error: any) {
    console.error("[GET /api/atas/[id]/physical-scan] Erro:", error);
    return NextResponse.json(
      { error: "Erro interno ao obter anexo da via física" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/atas/[id]/physical-scan
 * Upload Multi-Driver de Anexo Físico com Custódia SHA-256 e Fallback Automático
 */
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
        physicalScanStorageKey: true,
        physicalScanProvider: true,
        physicalSignedScanData: true,
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
    const hasExistingScan = Boolean(existing.physicalScanStorageKey || existing.physicalSignedScanData);

    if (!scanData && !hasExistingScan) {
      return NextResponse.json(
        { error: "O envio do arquivo digitalizado é obrigatório quando a ata ainda não possui anexo físico." },
        { status: 400 }
      );
    }

    const now = new Date();
    let updateData: any = {
      govBrVerified: Boolean(govBrVerified),
      govBrProtocol: govBrProtocol?.trim() || null,
    };
    let auditDetails: any = {
      ataNumber: existing.ataNumber,
      year: existing.year,
      subject: existing.subject,
      govBrVerified: Boolean(govBrVerified),
      govBrProtocol: govBrProtocol?.trim() || null,
    };

    if (scanData) {
      // Salva via motor híbrido (Object Storage se configurado ou Fallback Base64 no Postgres)
      const stored = await savePhysicalScanFile({
        schoolId: existing.schoolId,
        minuteId: id,
        year: existing.year,
        dataUrl: scanData,
      });

      updateData = {
        ...updateData,
        physicalSignedScanData: stored.fallbackBase64,
        physicalScanStorageKey: stored.storageKey,
        physicalScanProvider: stored.provider,
        physicalScanMimeType: stored.mimeType,
        physicalScanSizeBytes: stored.sizeBytes,
        physicalScanSha256: stored.sha256,
        physicalScanUploadedAt: now,
        physicalScanUploadedBy: authCheck.userName,
        hasPhysicalScan: true,
      };

      auditDetails = {
        ...auditDetails,
        storageProvider: stored.provider,
        dataSizeBytes: stored.sizeBytes,
        scanSha256: stored.sha256,
      };
    }

    const updated = await prisma.pedagogicalMinute.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        physicalSignedScanData: true,
        physicalScanStorageKey: true,
        physicalScanProvider: true,
        physicalScanMimeType: true,
        physicalScanSizeBytes: true,
        physicalScanSha256: true,
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
      details: auditDetails,
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
      { error: "Erro interno ao salvar via física digitalizada" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/atas/[id]/physical-scan
 * Remoção com Purga do Storage Externo e Auditoria
 */
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
        status: true,
        physicalScanStorageKey: true,
        physicalScanProvider: true,
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

    // Cadeia de Custódia Probatória: em atas já lavradas (FINALIZED/VOIDED), apenas Direção Escolar ou SuperAdmin removem
    if (existing.status === "FINALIZED" || existing.status === "VOIDED") {
      const canRemoveOfficialScan =
        checkIsSuperAdmin(authCheck.session) ||
        checkIsSchoolManager(authCheck.session, existing.schoolId || currentSchool.id);
      if (!canRemoveOfficialScan) {
        return NextResponse.json(
          {
            error:
              "A remoção de via física assinada em ata oficial lavrada é restrita à Direção/Gestão Escolar.",
          },
          { status: 403 }
        );
      }
    }

    // Remove do storage externo (se estiver no S3/Blob)
    await deletePhysicalScanFile(existing);

    await prisma.pedagogicalMinute.update({
      where: { id },
      data: {
        physicalSignedScanData: null,
        physicalScanStorageKey: null,
        physicalScanProvider: null,
        physicalScanMimeType: null,
        physicalScanSizeBytes: null,
        physicalScanSha256: null,
        physicalScanUploadedAt: null,
        physicalScanUploadedBy: null,
        hasPhysicalScan: false,
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
      { error: "Erro interno ao remover via física" },
      { status: 500 }
    );
  }
}
