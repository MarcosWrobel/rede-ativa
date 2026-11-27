import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { formatZodError } from "@/lib/schemas";
import { getTrustedAppOrigin } from "@/lib/qrCode";
import {
  createSchoolTeacherInviteToken,
  createTeacherInviteRecord,
  formatTeacherInviteCode,
  isSchoolTeacherInviteActive,
  mergeSchoolTeacherInviteSettings,
  parseSchoolTeacherInviteSettings,
} from "@/lib/schoolTeacherInvite";
import {
  canMutateSchoolCouncil,
  readSafeJsonBody,
  resolveCouncilHttpError,
  resolveExplicitSelectedSchoolForCouncil,
} from "@/services/classCouncilService";

export const dynamic = "force-dynamic";

const teacherInviteMutationSchema = z.object({
  action: z.enum(["GENERATE", "REVOKE"]).default("GENERATE"),
  expiresInDays: z.number().int().min(1).max(90).optional(),
});

export async function GET(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const school = await resolveExplicitSelectedSchoolForCouncil(
      authCheck.session,
      authCheck.schoolId
    );
    if (!school) {
      return NextResponse.json(
        { error: "Selecione explicitamente uma instituição de ensino." },
        { status: 403 }
      );
    }

    if (!canMutateSchoolCouncil(authCheck.session, school.id)) {
      return NextResponse.json(
        { error: "Perfil em modo somente leitura para esta instituição escolar." },
        { status: 403 }
      );
    }

    const dbSchool = await prisma.school.findUnique({
      where: { id: school.id },
      select: { id: true, name: true, settingsJson: true },
    });
    if (!dbSchool) {
      return NextResponse.json({ error: "Instituição não encontrada." }, { status: 404 });
    }

    const state = parseSchoolTeacherInviteSettings(dbSchool.settingsJson);
    const active = isSchoolTeacherInviteActive(state);
    const origin = getTrustedAppOrigin(req.headers);
    const inviteUrl =
      active && state?.nonce && state.expiresAt
        ? `${origin}/conselho-classe/vincular?t=${encodeURIComponent(
            createSchoolTeacherInviteToken({
              schoolId: school.id,
              nonce: state.nonce,
              expiresAt: state.expiresAt,
            })
          )}`
        : null;

    return NextResponse.json({
      success: true,
      schoolId: school.id,
      schoolName: dbSchool.name,
      hasActiveInvite: active,
      expiresAt: active ? state?.expiresAt ?? null : null,
      updatedAt: state?.updatedAt ?? null,
      inviteUrl,
    });
  } catch (err) {
    console.error("[GET /api/conselho-classe/teacher-invite] Erro:", err);
    const { status, message } = resolveCouncilHttpError(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const authCheck = await requireAuth();
    if (!authCheck.ok) return authCheck.response;

    const school = await resolveExplicitSelectedSchoolForCouncil(
      authCheck.session,
      authCheck.schoolId
    );
    if (!school) {
      return NextResponse.json(
        { error: "Selecione explicitamente uma instituição de ensino." },
        { status: 403 }
      );
    }

    if (!canMutateSchoolCouncil(authCheck.session, school.id)) {
      return NextResponse.json(
        { error: "Perfil em modo somente leitura para esta instituição escolar." },
        { status: 403 }
      );
    }

    const rawBody = await readSafeJsonBody(req);
    const parsed = teacherInviteMutationSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const dbSchool = await prisma.school.findUnique({
      where: { id: school.id },
      select: { id: true, name: true, active: true, settingsJson: true },
    });
    if (!dbSchool || !dbSchool.active) {
      return NextResponse.json(
        { error: "Instituição de ensino não encontrada ou inativa." },
        { status: 404 }
      );
    }

    if (parsed.data.action === "REVOKE") {
      const nextSettings = mergeSchoolTeacherInviteSettings(dbSchool.settingsJson, null);
      await prisma.school.update({
        where: { id: school.id },
        data: { settingsJson: nextSettings },
      });

      await logAudit({
        action: "REVOKE_SCHOOL_TEACHER_INVITE",
        entityType: "School",
        entityId: school.id,
        schoolId: school.id,
        details: { schoolId: school.id },
        user: {
          id: authCheck.userId,
          name: authCheck.userName,
          email: authCheck.email,
        },
        req,
      });

      return NextResponse.json({
        success: true,
        hasActiveInvite: false,
        code: null,
        formattedCode: null,
        inviteUrl: null,
        expiresAt: null,
      });
    }

    const created = createTeacherInviteRecord({
      schoolId: school.id,
      expiresInDays: parsed.data.expiresInDays ?? 15,
      updatedByEmail: authCheck.email,
    });
    const nextSettings = mergeSchoolTeacherInviteSettings(dbSchool.settingsJson, created.state);

    await prisma.school.update({
      where: { id: school.id },
      data: { settingsJson: nextSettings },
    });

    const origin = getTrustedAppOrigin(req.headers);
    const inviteToken = createSchoolTeacherInviteToken({
      schoolId: school.id,
      nonce: created.nonce,
      expiresAt: created.state.expiresAt!,
    });
    const inviteUrl = `${origin}/conselho-classe/vincular?t=${encodeURIComponent(inviteToken)}`;

    await logAudit({
      action: "CREATE_SCHOOL_TEACHER_INVITE",
      entityType: "School",
      entityId: school.id,
      schoolId: school.id,
      details: {
        schoolId: school.id,
        expiresAt: created.state.expiresAt,
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
      hasActiveInvite: true,
      schoolId: school.id,
      schoolName: dbSchool.name,
      code: created.plainCode,
      formattedCode: formatTeacherInviteCode(created.plainCode),
      inviteUrl,
      expiresAt: created.state.expiresAt,
    });
  } catch (err) {
    console.error("[POST /api/conselho-classe/teacher-invite] Erro:", err);
    const { status, message } = resolveCouncilHttpError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
