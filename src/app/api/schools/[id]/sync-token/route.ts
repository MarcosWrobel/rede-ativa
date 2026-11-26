import { NextResponse } from "next/server";
import { requireSchoolAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { invalidateSchoolCache } from "@/lib/currentSchool";
import { hashSchoolSyncToken, encryptSyncToken, decryptSyncToken } from "@/lib/syncToken";
import { mutateSchoolSettingsAtomically } from "@/lib/schoolSettingsMutation";
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

    const mutation = await mutateSchoolSettingsAtomically({
      schoolId: id,
      maxRetries: 4,
      buildPatch: (currentSettings) => ({
        ok: true,
        nextSettings: {
          ...currentSettings,
          syncTokenEncrypted: encryptedToken,
        },
        extraData: {
          syncTokenHash: tokenDigest,
        },
      }),
    });

    if (!mutation.ok) {
      return NextResponse.json(
        { error: mutation.error, code: mutation.reason },
        { status: mutation.status }
      );
    }

    const updatedSchool = mutation.updatedRow;

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
    // Nota de arquitetura (N1): invalidateSchoolCache limpa o cache L1 (schoolContextCache) da instância atual.
    // A autenticação da extensão (findSchoolBySyncToken) consulta o banco PostgreSQL diretamente sem cache em memória,
    // de modo que a rotação ou revogação do token invalida o token anterior imediatamente em todas as instâncias serverless.
    invalidateSchoolCache(id);

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

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authCheck = await requireSchoolAdmin(id);
    if (!authCheck.ok) return authCheck.response;

    const mutation = await mutateSchoolSettingsAtomically({
      schoolId: id,
      maxRetries: 4,
      buildPatch: (currentSettings) => {
        const nextSettings = { ...currentSettings };
        delete nextSettings.syncTokenEncrypted;
        return {
          ok: true,
          nextSettings,
          extraData: {
            syncTokenHash: null,
          },
        };
      },
    });

    if (!mutation.ok) {
      return NextResponse.json(
        { error: mutation.error, code: mutation.reason },
        { status: mutation.status }
      );
    }

    await logAudit({
      action: "UPDATE_USER",
      entityType: "SchoolSyncToken",
      entityId: id,
      schoolId: id,
      details: { action: "REVOKE_SYNC_TOKEN" },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    invalidateSchoolCache(id);

    return NextResponse.json({
      success: true,
      configured: false,
      message: "Chave de sincronização revogada com sucesso.",
    });
  } catch (error: any) {
    console.error("[DELETE /api/schools/[id]/sync-token] Erro:", error);
    return NextResponse.json({ error: "Erro ao revogar chave de sincronização" }, { status: 500 });
  }
}
