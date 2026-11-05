import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/permissions";
import { logAudit, extractClientIp } from "@/lib/audit";
import { validatePinFormat, hashPin, verifyPin } from "@/lib/signingPin";
import { verifyEscolaGoogleIdToken } from "@/lib/escolaGoogleVerify";
import { z } from "zod";

export const dynamic = "force-dynamic";

const pinRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("setup"),
    pin: z.string(),
  }),
  z.object({
    action: z.literal("change"),
    currentPin: z.string(),
    newPin: z.string(),
  }),
  z.object({
    action: z.literal("reset-google"),
    googleIdToken: z.string(),
    newPin: z.string(),
  }),
]);

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const user = await prisma.user.findUnique({
      where: { id: authCheck.userId },
      select: {
        signingPinHash: true,
        pinCreatedAt: true,
        pinAttempts: true,
        pinLockedUntil: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }

    const now = new Date();
    const isLocked = Boolean(user.pinLockedUntil && user.pinLockedUntil > now);
    const lockExpiresInMinutes = isLocked && user.pinLockedUntil
      ? Math.max(1, Math.ceil((user.pinLockedUntil.getTime() - now.getTime()) / 60000))
      : null;

    return NextResponse.json({
      success: true,
      hasPin: Boolean(user.signingPinHash),
      pinCreatedAt: user.pinCreatedAt?.toISOString() || null,
      isLocked,
      lockExpiresInMinutes,
    });
  } catch (error: any) {
    console.error("[GET /api/user/signing-pin] Erro:", error);
    return NextResponse.json({ error: "Erro ao consultar status do PIN." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const rawBody = await req.json();
    const parsed = pinRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Payload inválido." }, { status: 400 });
    }

    const ip = extractClientIp(req);
    const now = new Date();

    const user = await prisma.user.findUnique({
      where: { id: authCheck.userId },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    }

    // 1. Ação SETUP (primeiro cadastro do PIN)
    if (parsed.data.action === "setup") {
      if (user.signingPinHash) {
        return NextResponse.json(
          { error: "Você já possui um PIN cadastrado. Utilize a opção de alteração de PIN." },
          { status: 400 }
        );
      }

      const validation = validatePinFormat(parsed.data.pin);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }

      const hashedPin = await hashPin(parsed.data.pin);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          signingPinHash: hashedPin,
          pinCreatedAt: now,
          pinAttempts: 0,
          pinLockedUntil: null,
        },
      });

      await logAudit({
        schoolId: authCheck.schoolId || user.schoolId || null,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
        action: "SETUP_SIGNING_PIN",
        entityType: "User",
        entityId: user.id,
        details: { ip, message: "Cadastro inicial do PIN de fé pública realizado com sucesso." },
        ipAddress: ip,
      });

      return NextResponse.json({
        success: true,
        message: "PIN de fé pública cadastrado com sucesso!",
      });
    }

    // 2. Ação CHANGE (alteração sabendo o PIN atual)
    if (parsed.data.action === "change") {
      if (!user.signingPinHash) {
        return NextResponse.json({ error: "Nenhum PIN configurado para alteração." }, { status: 400 });
      }

      // Verifica bloqueio temporário
      if (user.pinLockedUntil && user.pinLockedUntil > now) {
        const minsLeft = Math.ceil((user.pinLockedUntil.getTime() - now.getTime()) / 60000);
        return NextResponse.json(
          { error: `PIN temporariamente bloqueado. Aguarde ${minsLeft} minuto(s) para tentar novamente.` },
          { status: 403 }
        );
      }

      const isCurrentValid = await verifyPin(parsed.data.currentPin, user.signingPinHash);
      if (!isCurrentValid) {
        const nextAttempts = user.pinAttempts + 1;
        const shouldLock = nextAttempts >= 3;
        const lockUntil = shouldLock ? new Date(now.getTime() + 5 * 60000) : null;

        await prisma.user.update({
          where: { id: user.id },
          data: {
            pinAttempts: shouldLock ? 0 : nextAttempts,
            pinLockedUntil: lockUntil,
          },
        });

        return NextResponse.json(
          {
            error: shouldLock
              ? "PIN atual incorreto. Limite de 3 tentativas excedido. Bloqueado por 5 minutos."
              : `PIN atual incorreto. Tentativas restantes: ${3 - nextAttempts}.`,
          },
          { status: 401 }
        );
      }

      const validation = validatePinFormat(parsed.data.newPin);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }

      const hashedPin = await hashPin(parsed.data.newPin);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          signingPinHash: hashedPin,
          pinCreatedAt: now,
          pinAttempts: 0,
          pinLockedUntil: null,
        },
      });

      await logAudit({
        schoolId: authCheck.schoolId || user.schoolId || null,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
        action: "CHANGE_SIGNING_PIN",
        entityType: "User",
        entityId: user.id,
        details: { ip, message: "Alteração de PIN de fé pública concluída com sucesso." },
        ipAddress: ip,
      });

      return NextResponse.json({
        success: true,
        message: "PIN de fé pública atualizado com sucesso!",
      });
    }

    // 3. Ação RESET-GOOGLE (esqueci meu PIN, reautenticar com Google SEED-PR)
    if (parsed.data.action === "reset-google") {
      const authResult = await verifyEscolaGoogleIdToken(parsed.data.googleIdToken);
      if (!authResult.ok || !authResult.tokenInfo) {
        return NextResponse.json(
          { error: authResult.error || "Não foi possível validar o token Google da SEED-PR." },
          { status: 401 }
        );
      }

      const tokenEmail = authResult.tokenInfo.email.toLowerCase().trim();
      if (tokenEmail !== user.email.toLowerCase().trim()) {
        return NextResponse.json(
          { error: `A conta Google autenticada (${tokenEmail}) não corresponde ao e-mail deste usuário (${user.email}).` },
          { status: 403 }
        );
      }

      const validation = validatePinFormat(parsed.data.newPin);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }

      const hashedPin = await hashPin(parsed.data.newPin);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          signingPinHash: hashedPin,
          pinCreatedAt: now,
          pinAttempts: 0,
          pinLockedUntil: null,
        },
      });

      await logAudit({
        schoolId: authCheck.schoolId || user.schoolId || null,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
        action: "RESET_SIGNING_PIN_GOOGLE",
        entityType: "User",
        entityId: user.id,
        details: { ip, verifiedEmail: tokenEmail, message: "Redefinição de PIN com revalidação Google Workspace SEED-PR." },
        ipAddress: ip,
      });

      return NextResponse.json({
        success: true,
        message: "PIN de fé pública redefinido com sucesso através da conta institucional!",
      });
    }

    return NextResponse.json({ error: "Ação não suportada." }, { status: 400 });
  } catch (error: any) {
    console.error("[POST /api/user/signing-pin] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro ao processar PIN." }, { status: 500 });
  }
}
