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
  | "USER_LOGIN"
  | "LOGIN_DENIED"
  | "CREATE_USER"
  | "UPDATE_USER"
  | "DEACTIVATE_USER"
  | "GENERATE_DOSSIER"
  | "CREATE_STUDENT_CONTACT"
  | "UPDATE_STUDENT_CONTACT"
  | "DELETE_STUDENT_CONTACT"
  | "CREATE_JUSTIFICATION"
  | "DELETE_JUSTIFICATION"
  | "CREATE_IN_PERSON_ATTENDANCE"
  | "DELETE_IN_PERSON_ATTENDANCE"
  | "UPDATE_DELIVERY_STATUS"
  | "WEBHOOK_REPLY";

export interface AuditUser {
  id?: string;
  name: string;
  email: string;
}

export function extractClientIp(source?: Request | Headers | null): string | null {
  if (!source) return null;
  const hdrs = source instanceof Request ? source.headers : source;
  const forwarded = hdrs.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = hdrs.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return null;
}

export async function logAudit({
  action,
  entityType,
  entityId,
  details,
  user,
  ipAddress,
  req,
}: {
  action: AuditAction;
  entityType: string;
  entityId?: string;
  details?: Record<string, any> | string;
  user: AuditUser;
  ipAddress?: string | null;
  req?: Request | Headers | null;
}) {
  try {
    const detailsStr = typeof details === "object" ? JSON.stringify(details) : details;
    const resolvedIp = ipAddress || extractClientIp(req) || null;

    await prisma.auditLog.create({
      data: {
        userId: user.id || null,
        userEmail: user.email,
        userName: user.name,
        action,
        entityType,
        entityId: entityId || null,
        details: detailsStr || null,
        ipAddress: resolvedIp,
      },
    });
  } catch (err) {
    console.error("Failed to log audit event:", err);
  }
}
