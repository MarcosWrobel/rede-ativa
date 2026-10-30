import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { requireAuth } from "@/lib/permissions";
import { formatZodError, messageDeliveryStatusUpdateSchema } from "@/lib/schemas";
import { normalizeWhatsAppPhone } from "@/lib/studentMatcher";

async function handleStatusUpdate(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const rawBody = await req.json();
    const parsed = messageDeliveryStatusUpdateSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { logId, deliveryStatus } = parsed.data;

    const existing = await prisma.messageLog.findUnique({
      where: { id: logId },
      include: {
        student: {
          include: {
            classGroup: true,
            contacts: true,
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Registro de envio não encontrado" }, { status: 404 });
    }

    const updated = await prisma.messageLog.update({
      where: { id: logId },
      data: {
        deliveryStatus,
        deliveryUpdatedAt: new Date(),
      },
    });

    // AUT-01: Saneamento automático do telefone no cadastro familiar do estudante
    const normalizedTarget = normalizeWhatsAppPhone(existing.phoneUsed);
    let syncedContactInvalidated = false;

    try {
      const matchingContacts = existing.student.contacts.filter(
        (c) => normalizeWhatsAppPhone(c.phone) === normalizedTarget
      );

      if (deliveryStatus === "FAILED_NO_WHATSAPP") {
        if (matchingContacts.length > 0) {
          await prisma.studentContact.updateMany({
            where: { id: { in: matchingContacts.map((c) => c.id) } },
            data: { whatsappValid: false },
          });
        } else {
          await prisma.studentContact.create({
            data: {
              studentId: existing.studentId,
              name: existing.student.guardianName || "Contato Cadastral",
              kinship: "RESPONSAVEL",
              phone: existing.phoneUsed,
              isPrimary: normalizeWhatsAppPhone(existing.student.phone) === normalizedTarget,
              whatsappValid: false,
              notes: `Sinalizado sem WhatsApp em ${new Date().toLocaleDateString("pt-BR")} por ${authCheck.userName}`,
            },
          });
        }
        syncedContactInvalidated = true;
      } else if (
        (deliveryStatus === "SENT" || deliveryStatus === "DELIVERED" || deliveryStatus === "READ") &&
        matchingContacts.some((c) => !c.whatsappValid)
      ) {
        await prisma.studentContact.updateMany({
          where: { id: { in: matchingContacts.map((c) => c.id) } },
          data: { whatsappValid: true },
        });
      }
    } catch (syncErr) {
      console.warn("Aviso ao sincronizar whatsappValid em StudentContact:", syncErr);
    }

    await logAudit({
      action: "UPDATE_DELIVERY_STATUS",
      entityType: "MessageLog",
      entityId: logId,
      details: {
        studentName: existing.student.name,
        turma: existing.student.classGroup.name,
        phoneUsed: existing.phoneUsed,
        previousStatus: existing.deliveryStatus,
        newStatus: deliveryStatus,
        contactFlaggedInvalid: syncedContactInvalidated,
      },
      user: {
        id: authCheck.userId,
        name: authCheck.userName,
        email: authCheck.email,
      },
      req,
    });

    return NextResponse.json({
      success: true,
      updated,
      contactFlaggedInvalid: syncedContactInvalidated,
    });
  } catch (error: any) {
    console.error("Erro ao atualizar status de entrega:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  return handleStatusUpdate(req);
}

export async function POST(req: Request) {
  return handleStatusUpdate(req);
}
