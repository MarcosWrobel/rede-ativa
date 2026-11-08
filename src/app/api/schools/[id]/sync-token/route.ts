import { NextResponse } from "next/server";
import { requireSchoolAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { hashSchoolSyncToken, encryptSyncToken, decryptSyncToken } from "@/lib/syncToken";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authCheck = await requireSchoolAdmin(id);
    if (!authCheck.ok) return authCheck.response;

    const school = await prisma.school.findUnique({
      where: { id },
      select: { id: true, name: true, syncTokenHash: true, settingsJson: true, updatedAt: true },
    });

    if (!school) {
      return NextResponse.json({ error: "Instituição não encontrada" }, { status: 404 });
    }

    let decryptedToken: string | null = null;
    if (school.settingsJson) {
      try {
        const parsed = JSON.parse(school.settingsJson);
        if (parsed.syncTokenEncrypted) {
          decryptedToken = decryptSyncToken(parsed.syncTokenEncrypted);
        }
      } catch {}
    }

    // Suporte a tokens legados salvos em texto claro pré-auditoria
    if (!decryptedToken && school.syncTokenHash && !school.syncTokenHash.startsWith("sha256:")) {
      decryptedToken = school.syncTokenHash;
    }

    return NextResponse.json({
      configured: Boolean(school.syncTokenHash),
      schoolId: school.id,
      schoolName: school.name,
      syncToken: decryptedToken,
      rawToken: decryptedToken,
      syncTokenCreatedAt: school.syncTokenHash ? school.updatedAt.toISOString() : null,
    });
  } catch (error: any) {
    console.error("[GET /api/schools/[id]/sync-token] Erro:", error);
    return NextResponse.json({ error: "Erro ao consultar status da chave" }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authCheck = await requireSchoolAdmin(id);
    if (!authCheck.ok) return authCheck.response;

    // Gera novo token de 256 bits (64 hexadecimais), grava digest SHA-256 e cifra para recuperação autorizada
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenDigest = hashSchoolSyncToken(rawToken);
    const encryptedToken = encryptSyncToken(rawToken);

    const currentRecord = await prisma.school.findUnique({
      where: { id },
      select: { settingsJson: true },
    });

    let settings: Record<string, any> = {};
    if (currentRecord?.settingsJson) {
      try {
        settings = JSON.parse(currentRecord.settingsJson);
      } catch {}
    }
    settings.syncTokenEncrypted = encryptedToken;

    const updatedSchool = await prisma.school.update({
      where: { id },
      data: {
        syncTokenHash: tokenDigest,
        settingsJson: JSON.stringify(settings),
      },
      select: {
        id: true,
        updatedAt: true,
      },
    });

    await logAudit({
      action: "UPDATE_USER",
      entityType: "SchoolSyncToken",
      entityId: id,
      schoolId: id,
      details: { action: "ROTATE_SYNC_TOKEN" },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    const syncTokenCreatedAt = updatedSchool.updatedAt.toISOString();

    return NextResponse.json({
      success: true,
      syncToken: rawToken,
      rawToken: rawToken,
      school: {
        id: updatedSchool.id,
        syncTokenCreatedAt,
      },
      syncTokenCreatedAt,
      message: "Nova chave de sincronização gerada com sucesso. Copie e insira na Extensão Chrome.",
    });
  } catch (error: any) {
    console.error("[POST /api/schools/[id]/sync-token] Erro:", error);
    return NextResponse.json({ error: "Erro ao gerar chave de sincronização" }, { status: 500 });
  }
}
