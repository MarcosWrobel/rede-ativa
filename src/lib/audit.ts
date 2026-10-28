import { prisma } from "./prisma";

export type AuditAction =
  | "SEND_MESSAGE"
  | "CREATE_STUDENT"
  | "UPDATE_STUDENT"
  | "DELETE_STUDENT"
  | "MARK_REPLY"
  | "UPDATE_MESSAGE_LOG"
  | "DELETE_MESSAGE_LOG"
  | "CREATE_TEMPLATE"
  | "UPDATE_TEMPLATE"
  | "DELETE_TEMPLATE"
  | "UPDATE_LOW_ATTENDANCE"
  | "USER_LOGIN";

export interface AuditUser {
  id?: string;
  name: string;
  email: string;
}

export async function logAudit({
  action,
  entityType,
  entityId,
  details,
  user,
  ipAddress,
}: {
  action: AuditAction;
  entityType: string;
  entityId?: string;
  details?: Record<string, any> | string;
  user: AuditUser;
  ipAddress?: string;
}) {
  try {
    const detailsStr = typeof details === "object" ? JSON.stringify(details) : details;

    await prisma.auditLog.create({
      data: {
        userId: user.id || null,
        userEmail: user.email,
        userName: user.name,
        action,
        entityType,
        entityId: entityId || null,
        details: detailsStr || null,
        ipAddress: ipAddress || null,
      },
    });
  } catch (err) {
    console.error("Failed to log audit event:", err);
  }
}
